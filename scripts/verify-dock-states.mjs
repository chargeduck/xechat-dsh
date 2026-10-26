/**
 * DockShell 三态行为验证（真实 React 渲染 + jsdom）。
 *
 * 拉起的验证点：
 *   1. 默认展开：活动栏 + 内容面板同时在 DOM，宽度 = width + 44
 *   2. 点「收起」：内容面板从 DOM 消失、容器宽度收敛到 44px
 *   3. 点「完全隐藏」：整个 dock 消失，只剩一个 14px 的恢复按钮
 *   4. 点恢复：回到展开态
 *
 * 为什么不用静态断言：收起是否「真的让出位置」取决于 React 是否卸载
 * 面板子树，只有真实渲染才能确认。
 *
 * 用法: node scripts/verify-dock-states.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const JSDOM_HOME =
  process.env.JSDOM_HOME || 'C:/Users/24962/.workbuddy/binaries/node/workspace/node_modules'
const projRequire = createRequire(path.resolve('package.json'))
const jsdomRequire = createRequire(path.join(JSDOM_HOME, 'noop.js'))

const { JSDOM } = jsdomRequire('jsdom')
const React = projRequire('react')
const ReactDOMClient = projRequire('react-dom/client')

// 清掉残留布局，保证从默认态开始
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
})
const { window } = dom
globalThis.window = window
globalThis.document = window.document
// Node 22 的 navigator 只有 getter，用 defineProperty 覆盖
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator,
  configurable: true,
  writable: true,
})
globalThis.HTMLElement = window.HTMLElement
globalThis.Element = window.Element
globalThis.Node = window.Node
globalThis.MutationObserver = window.MutationObserver
globalThis.getComputedStyle = window.getComputedStyle.bind(window)
globalThis.requestAnimationFrame = window.requestAnimationFrame?.bind(window) ?? ((cb) => setTimeout(cb, 16))
globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout

// 本地存储空实现（避免读到真实历史布局）
const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
}

// app-loader 依赖 Blob/URL，这里全部桩掉：本脚本只验证外壳，
// 不加载真实 Vue 应用（那条链路由 verify-client-bundle.mjs 覆盖）
globalThis.Blob = class {
  constructor(parts) {
    this.parts = parts
  }
}
globalThis.URL.createObjectURL = () => 'blob:stub'
globalThis.URL.revokeObjectURL = () => {}

// 用 esbuild 把 TSX 转成可执行 JS（项目里已有 esbuild）
const esbuild = projRequire('esbuild')

async function loadModule(entry) {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client'],
    // app-loader 里引用的虚拟模块由 tsdown 注入，这里替换成空桩
    alias: {
      'virtual:xechat-app-source': path.resolve('src/plugin/empty-module.js'),
    },
    define: { 'process.env.NODE_ENV': '"development"' },
  })
  const code = result.outputFiles[0].text
  const tmp = path.resolve('node_modules/.cache-dock-states.mjs')
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  fs.writeFileSync(tmp, code)
  return import('file://' + tmp.replace(/\\/g, '/'))
}

const mod = await loadModule(path.resolve('src/plugin/DockShell.tsx'))
const { DockShell } = mod
const { DEFAULT_LAYOUT } = await import(
  'file://' + path.resolve('src/plugin/layout.ts').replace(/\\/g, '/')
)

const root = window.document.getElementById('root')
const reactRoot = ReactDOMClient.createRoot(root)
reactRoot.render(React.createElement(DockShell, {}))

const tick = (ms = 60) => new Promise((r) => setTimeout(r, ms))
await tick(120)

function snapshot(label) {
  const dock = root.querySelector('.xds-root')
  const activity = root.querySelector('.xds-activity')
  const panel = root.querySelector('.xds-panel')
  const restore = root.querySelector('.xds-restore')
  const style = dock ? dock.getAttribute('style') || '' : ''
  const widthMatch = /width:\s*(\d+)px/.exec(style)
  return {
    label,
    dock: !!dock,
    activity: !!activity,
    panel: !!panel,
    restore: !!restore,
    width: widthMatch ? Number(widthMatch[1]) : null,
    buttons: Array.from(root.querySelectorAll('button')).map(
      (b) => b.getAttribute('title') || b.getAttribute('aria-label') || '',
    ),
  }
}

function clickByTitle(title) {
  const btn = Array.from(root.querySelectorAll('button')).find(
    (b) => (b.getAttribute('title') || '') === title,
  )
  if (!btn) throw new Error(`找不到按钮: ${title}`)
  btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
}

const results = []
results.push(snapshot('1. 默认展开'))
await tick()

clickByTitle('收起 xechat')
await tick()
results.push(snapshot('2. 点「收起」'))
await tick()

clickByTitle('完全隐藏 xechat')
await tick()
results.push(snapshot('3. 点「完全隐藏」'))
await tick()

// 恢复按钮没有 title，按 class 找
const restoreBtn = root.querySelector('.xds-restore-btn')
if (!restoreBtn) {
  console.error('恢复按钮缺失，无法验证第 4 步')
} else {
  restoreBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  await tick()
  results.push(snapshot('4. 点恢复'))
}

console.log('=== DockShell 三态 ===')
for (const r of results) {
  console.log(
    `  ${r.label.padEnd(16)} dock=${String(r.dock).padEnd(5)} 活动栏=${String(r.activity).padEnd(5)} ` +
      `面板=${String(r.panel).padEnd(5)} 恢复键=${String(r.restore).padEnd(5)} width=${r.width}`,
  )
}

console.log('\n=== 断言 ===')
const checks = [
  ['默认展开有面板', results[0].panel === true],
  ['默认宽度 = 380 + 44', results[0].width === DEFAULT_LAYOUT.width + 44],
  ['收起后面板从 DOM 移除', results[1].panel === false],
  ['收起后宽度收敛到 44', results[1].width === 44],
  ['收起后活动栏仍在', results[1].activity === true],
  ['完全隐藏后 dock 消失', results[2].dock === false],
  ['完全隐藏后只剩恢复键', results[2].restore === true && results[2].activity === false],
  ['恢复后回到展开态', results[3]?.panel === true && results[3]?.width === DEFAULT_LAYOUT.width + 44],
]
let failed = 0
for (const [name, ok] of checks) {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) failed++
}

reactRoot.unmount()
window.close()
process.exit(failed === 0 ? 0 : 1)
