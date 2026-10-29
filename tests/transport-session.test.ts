/**
 * 传输层会话生命周期测试。
 *
 * 回归目标：一个面板只对应一条 WebSocket 连接。
 *
 * 真实故障（2026-10-29 实测）：侧边栏收起再展开后，所有人都发现彼此的每条消息
 * 都显示两遍。原因是 DockShell 每次展开都重新挂载 Vue 应用 ——>
 * `initXechat()` -> `TransportManager.init()` 每次都 new 一个 WebSocketTransport，
 * 却从不关闭上一个。旧连接在服务端仍是一条有效会话，服务端广播时每条连接各投递
 * 一次，再经共享事件表进入同一个 chatStore，于是每条消息被 push 两次。
 *
 * 本测试用桩 WebSocket 锁定两条契约：
 *   1. 同地址重复 init 复用连接，不新建 socket
 *   2. 一条服务端帧只投递一次（即便 init 被调用多次）
 *
 * 用法: node --experimental-strip-types --test tests/transport-session.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'

/** 桩 WebSocket：记录实例、手动触发握手与收帧。 */
class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: FakeWebSocket[] = []

  url: string
  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []
  onopen: ((e?: unknown) => void) | null = null
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null
  onerror: ((e?: unknown) => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  /** 模拟服务端握手完成 */
  open() {
    this.readyState = FakeWebSocket.OPEN
    this.onopen?.()
  }

  /** 模拟服务端下发一帧 */
  receive(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: '', wasClean: true })
  }
}

const store = new Map<string, string>()
;(globalThis as any).WebSocket = FakeWebSocket
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}

const { transport } = await import('../src/transport/transport-manager.js')

/** 每个用例前清空桩状态 */
function reset() {
  transport.disconnect()
  FakeWebSocket.instances = []
}

test('同地址重复 init 复用连接，不新建 socket', async (t) => {
  reset()
  t.after(() => transport.disconnect())

  const first = transport.init({ wsUrl: 'ws://stub:9000/xechat' })
  assert.equal(FakeWebSocket.instances.length, 1, '首次 init 应建立一条连接')
  FakeWebSocket.instances[0].open()
  await first

  // 面板收起再展开：init 会被再次调用
  await transport.init({ wsUrl: 'ws://stub:9000/xechat' })
  await transport.init({ wsUrl: 'ws://stub:9000/xechat' })

  assert.equal(
    FakeWebSocket.instances.length,
    1,
    '重复 init 不应新建 WebSocket：多出来的连接在服务端也是一条会话，广播会被重复投递',
  )
})

test('一条服务端帧只投递一次（重复 init 后仍然如此）', async (t) => {
  reset()
  t.after(() => transport.disconnect())

  let received = 0
  const handler = () => {
    received++
  }
  transport.on('message', handler)
  t.after(() => transport.off('message', handler))

  const p = transport.init({ wsUrl: 'ws://stub:9001/xechat' })
  FakeWebSocket.instances[0].open()
  await p
  await transport.init({ wsUrl: 'ws://stub:9001/xechat' })

  FakeWebSocket.instances[0].receive({
    action: 'CHAT',
    user: { username: 'tester' },
    body: { content: 'hello', msgType: 'TEXT' },
    time: '15:00',
  })

  assert.equal(received, 1, '同一条 CHAT 帧只应触发一次 message 回调')
})

test('CONNECTING 期间重复 connect 不叠加 socket', async (t) => {
  reset()
  t.after(() => transport.disconnect())

  const p = transport.init({ wsUrl: 'ws://stub:9002/xechat' })
  // 握手尚未完成时再调一次（重连定时器 / 宿主重渲染都可能撞上）
  await (transport as any)._transport.connect()
  assert.equal(FakeWebSocket.instances.length, 1, 'CONNECTING 状态不应再开一条连接')
  FakeWebSocket.instances[0].open()
  await p
})

test('地址变化时先断开旧连接再新建', async (t) => {
  reset()
  t.after(() => transport.disconnect())

  const p1 = transport.init({ wsUrl: 'ws://stub:9003/xechat' })
  FakeWebSocket.instances[0].open()
  await p1

  const p2 = transport.init({ wsUrl: 'ws://stub:9004/xechat' })
  assert.equal(FakeWebSocket.instances.length, 2, '换地址应新建连接')
  assert.equal(FakeWebSocket.instances[0].readyState, FakeWebSocket.CLOSED, '旧连接必须关闭，否则服务端会残留会话')
  FakeWebSocket.instances[1].open()
  await p2
})

test('登录后标记 loggedIn，断开后复位', async (t) => {
  reset()
  t.after(() => transport.disconnect())

  const p = transport.init({ wsUrl: 'ws://stub:9005/xechat' })
  FakeWebSocket.instances[0].open()
  await p
  assert.equal(transport.loggedIn, false, '仅连接不算登录')

  const login = transport.loginToServer('stub', 9005, { action: 'LOGIN', body: { username: 'tester' } })
  const loginSocket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  loginSocket.open()
  await login
  assert.equal(transport.loggedIn, true, '发出 LOGIN 后应标记为已登录')

  transport.disconnect()
  assert.equal(transport.loggedIn, false, '断开后登录态必须复位，避免误判为“已在线”而跳过恢复登录')
})
