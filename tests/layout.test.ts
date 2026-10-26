/**
 * 布局模型的单元测试（Node 内置 test runner，无额外依赖）。
 * 用法: node --experimental-strip-types --test tests/layout.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  clampWidth,
  DEFAULT_LAYOUT,
  dockGeometry,
  loadLayout,
  MAX_WIDTH,
  MIN_WIDTH,
  parseLayout,
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
    autoHide: 'edge',
  })
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
    { side: 'left', open: false, visibility: 'collapsed', width: 420, autoHide: 'edge' },
    store,
  )
  assert.deepEqual(loadLayout(store), {
    side: 'left',
    open: false,
    visibility: 'collapsed',
    width: 420,
    autoHide: 'edge',
  })
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
