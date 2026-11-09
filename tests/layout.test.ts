/**
 * 布局模型的单元测试（Node 内置 test runner，无额外依赖）。
 * 用法: node --experimental-strip-types --test tests/layout.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clampHeight,
  clampTopOffset,
  clampWidth,
  DEFAULT_LAYOUT,
  dockGeometry,
  loadLayout,
  MAX_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  parseLayout,
  resizeFromEdge,
  resolveHeight,
  saveLayout,
} from '../src/plugin/layout.ts'

/** 内存版 Storage，避免依赖浏览器环境 */
function memoryStorage(initial?: Record<string, string>) {
  const map = new Map(Object.entries(initial ?? {}))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  } as Storage
}

test('clampWidth 夹到合法区间', () => {
  assert.equal(clampWidth(500), 500)
  assert.equal(clampWidth(100), MIN_WIDTH)
  assert.equal(clampWidth(9999), MAX_WIDTH)
  // 非有限值回落默认宽度
  assert.equal(clampWidth(Number.NaN), DEFAULT_LAYOUT.width)
  assert.equal(clampWidth(Number.POSITIVE_INFINITY), DEFAULT_LAYOUT.width)
  // 取整
  assert.equal(clampWidth(400.7), 401)
})

test('parseLayout 对非法输入逐字段回落', () => {
  assert.deepEqual(parseLayout(null), DEFAULT_LAYOUT)
  assert.deepEqual(parseLayout('nope'), DEFAULT_LAYOUT)
  assert.deepEqual(parseLayout({ side: 'top' }), DEFAULT_LAYOUT)

  const parsed = parseLayout({ side: 'left', visibility: 'collapsed', width: 500, autoHide: 'edge' })
  assert.deepEqual(parsed, {
    side: 'left',
    open: false,
    visibility: 'collapsed',
    width: 500,
    height: null,
    topOffset: 0,
    autoHide: 'edge',
  })
})

test('clampHeight 夹到合法区间，并跟随可用高度', () => {
  assert.equal(clampHeight(500), 500)
  assert.equal(clampHeight(10), MIN_HEIGHT)
  // 超过可用高度时按可用高度收，但不会低于下限
  assert.equal(clampHeight(2000, 600), 600)
  assert.equal(clampHeight(2000, 100), MIN_HEIGHT)
  assert.equal(clampHeight(Number.NaN), MIN_HEIGHT)
  assert.equal(clampHeight(400.7), 401)
})

test('resolveHeight：null 表示铺满，数值按当前视口再夹一次', () => {
  assert.equal(resolveHeight(null, 900), null)
  assert.equal(resolveHeight(520, 900), 520)
  // 窗口变矮：渲染值收窄，但存储值本身不变（由调用方持有）
  assert.equal(resolveHeight(900, 500), 500)
  assert.equal(resolveHeight(120, 900), MIN_HEIGHT)
})

test('parseLayout 修正越界高度并保留合法值', () => {
  assert.equal(parseLayout({ height: 600 }).height, 600)
  assert.equal(parseLayout({ height: 10 }).height, MIN_HEIGHT)
  // 缺省/非法 → 铺满
  assert.equal(parseLayout({}).height, null)
  assert.equal(parseLayout({ height: 'tall' }).height, null)
})

test('parseLayout 兼容旧版只有 open 的存储', () => {
  // 旧版没有 visibility 字段，靠 open 推断
  const collapsed = parseLayout({ side: 'left', open: false, width: 420, autoHide: 'edge' })
  assert.equal(collapsed.visibility, 'collapsed')
  assert.equal(collapsed.open, false)

  const opened = parseLayout({ side: 'right', open: true, width: 420, autoHide: 'edge' })
  assert.equal(opened.visibility, 'open')
  assert.equal(opened.open, true)
})

test('open 与 visibility 不会互相矛盾', () => {
  assert.equal(parseLayout({ visibility: 'paused' }).open, true)
  assert.equal(parseLayout({ visibility: 'collapsed' }).open, false)
})

test('paused 宽度为 0，collapsed 只留活动栏', () => {
  assert.equal(dockGeometry({ ...DEFAULT_LAYOUT, visibility: 'paused' }, 44).width, 0)
  assert.equal(dockGeometry({ ...DEFAULT_LAYOUT, visibility: 'collapsed' }, 44).width, 44)
  assert.equal(dockGeometry({ ...DEFAULT_LAYOUT, visibility: 'open', width: 380 }, 44).width, 424)
})

test('parseLayout 修正越界宽度', () => {
  assert.equal(parseLayout({ width: 10 }).width, MIN_WIDTH)
  assert.equal(parseLayout({ width: 99999 }).width, MAX_WIDTH)
})

test('loadLayout 在存储损坏时返回默认值', () => {
  const broken = memoryStorage({ 'xechat-dsh:layout': '{not json' })
  assert.deepEqual(loadLayout(broken), DEFAULT_LAYOUT)
})

test('loadLayout 读取已保存布局', () => {
  const store = memoryStorage()
  saveLayout(
    {
      side: 'left',
      open: false,
      visibility: 'collapsed',
      width: 420,
      height: null,
      topOffset: 0,
      autoHide: 'edge',
    },
    store,
  )
  assert.deepEqual(loadLayout(store), {
    side: 'left',
    open: false,
    visibility: 'collapsed',
    width: 420,
    height: null,
    topOffset: 0,
    autoHide: 'edge',
  })
})

test('高度持久化后能原样读回', () => {
  const store = memoryStorage()
  saveLayout({ ...DEFAULT_LAYOUT, height: 560 }, store)
  assert.equal(loadLayout(store).height, 560)
})

test('顶边偏移随布局持久化，兼容旧版存储', () => {
  const store = memoryStorage()
  saveLayout({ ...DEFAULT_LAYOUT, height: 560, topOffset: 120 }, store)
  assert.equal(loadLayout(store).topOffset, 120)
  // 旧版存储没有该字段：缺省 0 = 顶边贴标题栏下沿
  assert.equal(parseLayout({ height: 560 }).topOffset, 0)
  // 非法值不污染布局
  assert.equal(parseLayout({ height: 560, topOffset: 'down' }).topOffset, 0)
  assert.equal(parseLayout({ height: 560, topOffset: -50 }).topOffset, 0)
  // 铺满态忽略残留偏移（例如双击恢复铺满前被中断的旧存储）
  assert.equal(parseLayout({ height: null, topOffset: 120 }).topOffset, 0)
})

test('clampTopOffset 保证顶边偏移不把面板底边顶出可用区', () => {
  assert.equal(clampTopOffset(0, 560, 800), 0)
  assert.equal(clampTopOffset(120, 560, 800), 120)
  // 可用 800、面板 560 → 偏移最多 240
  assert.equal(clampTopOffset(400, 560, 800), 240)
  // 窗口变矮后旧偏移被收回，但存储值本身不变（由调用方持有）
  assert.equal(clampTopOffset(400, 560, 600), 40)
  assert.equal(clampTopOffset(-20, 560, 800), 0)
  assert.equal(clampTopOffset(Number.NaN, 560, 800), 0)
})

/**
 * 回归：抓上沿往下拖，必须动**顶边**而不是底边。
 * 旧版只减 height，容器是 top 锚定 → 底边上移，面板缩到右上角。
 */
test('resizeFromEdge 抓上沿：顶边跟随鼠标，底边固定', () => {
  const start = { y: 100, height: 800, topOffset: 0, edge: 'top' as const }
  const r = resizeFromEdge(start, 200, 800) // 往下拖 200px
  assert.equal(r.height, 600)
  assert.equal(r.topOffset, 200)
  // 底边位置不变：0 + 800 === 200 + 600
  assert.equal(start.topOffset + start.height, r.topOffset + r.height)

  // 往上拖则反向：顶边上移、面板变高，底边依旧不动
  const up = resizeFromEdge({ y: 100, height: 500, topOffset: 120, edge: 'top' }, -100, 800)
  assert.equal(up.height, 600)
  assert.equal(up.topOffset, 20)
  assert.equal(120 + 500, up.topOffset + up.height)
})

test('resizeFromEdge 抓下沿：底边跟随鼠标，顶边固定', () => {
  const start = { y: 100, height: 500, topOffset: 120, edge: 'bottom' as const }
  const r = resizeFromEdge(start, 100, 800)
  assert.equal(r.height, 600)
  assert.equal(r.topOffset, 120)
  const smaller = resizeFromEdge(start, -100, 800)
  assert.equal(smaller.height, 400)
  assert.equal(smaller.topOffset, 120)
})

test('resizeFromEdge 在上下限处不把面板拖出可用区', () => {
  const start = { y: 0, height: 800, topOffset: 0, edge: 'top' as const }
  // 向上拖过头：高度封顶在可用高度，偏移归零
  const tooTall = resizeFromEdge(start, -500, 800)
  assert.equal(tooTall.height, 800)
  assert.equal(tooTall.topOffset, 0)
  // 向下拖过头：高度封底在 MIN_HEIGHT，偏移也停在上限
  const tooShort = resizeFromEdge(start, 5000, 800)
  assert.equal(tooShort.height, MIN_HEIGHT)
  assert.equal(tooShort.topOffset, 800 - MIN_HEIGHT)
  assert.equal(tooShort.topOffset + tooShort.height, 800)
})

test('saveLayout 写入失败不抛错', () => {
  const throwing = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota exceeded')
    },
  } as unknown as Storage
  assert.doesNotThrow(() => saveLayout(DEFAULT_LAYOUT, throwing))
})

test('dockGeometry 收起时只保留活动栏宽度', () => {
  const open = dockGeometry({ ...DEFAULT_LAYOUT, open: true, width: 400, side: 'right' }, 44)
  assert.equal(open.width, 444)
  assert.equal(open.right, 0)
  assert.equal('left' in open, false)

  const closed = dockGeometry({ ...DEFAULT_LAYOUT, open: false }, 44)
  assert.equal(closed.width, 44)

  const left = dockGeometry({ ...DEFAULT_LAYOUT, side: 'left', open: true, width: 300 }, 44)
  assert.equal(left.left, 0)
  assert.equal(left.width, 344)
})
