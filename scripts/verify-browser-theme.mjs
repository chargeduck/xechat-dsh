/**
 * 浏览器面板配色的真实渲染验证。
 *
 * 验证点：
 *   1. dark 模式下容器铺深色底、遮罩层存在且透明度正确
 *   2. light 模式下换浅色底
 *   3. off 模式下不生成遮罩
 *   4. 遮罩 pointer-events 为 none（不影响页面点击）
 *   5. 跨源 iframe 注入被跳过而不抛错
 *
 * 用法: node scripts/verify-browser-theme.mjs
 */
import path from 'node:path'
import { createRequire } from 'node:module'

const JSDOM_HOME =
  process.env.JSDOM_HOME || 'C:/Users/24962/.workbuddy/binaries/node/workspace/node_modules'
const projRequire = createRequire(path.resolve('package.json'))
const jsdomRequire = createRequire(path.join(JSDOM_HOME, 'noop.js'))

const { JSDOM } = jsdomRequire('jsdom')
const React = projRequire('react')
const ReactDOMClient = projRequire('react-dom/client')
const esbuild = projRequire('esbuild')

const dom = new JSDOM(
  '<!doctype html><html class="dark"><head></head><body><div id="root"></div></body></html>',
  { url: 'http://localhost/', pretendToBeVisual: true },
)
const { window } = dom
globalThis.window = window
globalThis.document = window.document
Object.defineProperty(globalThis, 'navigator', {
  value: window.navigator,
  configurable: true,
  writable: true,
})
globalThis.HTMLElement = window.HTMLElement
globalThis.Element = window.Element
globalThis.Node = window.Node
globalThis.SVGElement = window.SVGElement
globalThis.getComputedStyle = window.getComputedStyle.bind(window)
globalThis.requestAnimationFrame =
  window.requestAnimationFrame?.bind(window) ?? ((cb) => setTimeout(cb, 16))
globalThis.cancelAnimationFrame = window.cancelAnimationFrame?.bind(window) ?? clearTimeout

const mem = new Map()
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
}

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
}

// 直接测纯函数在 DOM 上的落地效果：构造与 BrowserPanel 相同的结构
const { buildStageStyle, buildSameOriginCss } = await import(
  'file://' + path.resolve('src/composables/browserTheme.js').replace(/\\/g, '/')
)

function renderStage(theme, dim, url) {
  const s = buildStageStyle(theme, dim)
  const stage = window.document.createElement('div')
  stage.className = 'browser-stage'
  stage.setAttribute('data-browser-theme', theme)
  stage.style.background = s.surface

  const frame = window.document.createElement('iframe')
  frame.className = 'browser-frame'
  frame.style.colorScheme = s.colorScheme
  frame.src = url
  // jsdom 不加载真实页面，contentDocument 存在但为空（同源）
  for (const prop of ['width', 'height']) frame.style[prop] = '100%'
  stage.appendChild(frame)

  if (s.scrimOpacity > 0) {
    const scrim = window.document.createElement('div')
    scrim.className = 'browser-scrim'
    // 关键：纯函数不负责这条，样式表负责。这里断言样式表里的声明。
    stage.appendChild(scrim)
  }
  if (theme !== 'off') {
    const css = buildSameOriginCss(theme)
    check(`${theme} 生成注入样式`, css.length > 0, css.split('\n')[0])
  }
  return { stage, frame, scrim: stage.querySelector('.browser-scrim'), style: s }
}

const dark = renderStage('dark', 0.25, 'http://localhost:5173')
check(
  'dark 容器铺深色底',
  dark.stage.style.background.includes('30, 30, 30') || dark.stage.style.background.includes('#1e1e1e'),
  dark.stage.style.background,
)
check('dark 生成遮罩层', !!dark.scrim)
check('dark 遮罩强度 0.25', dark.style.scrimOpacity === 0.25)
check('dark iframe 声明 color-scheme', dark.frame.style.colorScheme === 'dark')

const light = renderStage('light', 0.3, 'http://localhost:5173')
check('light 换浅色底', light.style.surface === '#ffffff', light.style.surface)
check('light 遮罩强度 0.3', light.style.scrimOpacity === 0.3)

const off = renderStage('off', 0.5, 'http://localhost:5173')
check('off 不生成遮罩', !off.scrim)
check('off 全白底（旧行为）', off.style.surface === '#ffffff')

// 验证样式表中遮罩不吃指针事件
const cssFile = path.resolve('src/views/tools/BrowserPanel.vue')
const fs = await import('node:fs')
const vueSrc = fs.readFileSync(cssFile, 'utf-8')
const scrimRule = /\.browser-scrim\s*\{([^}]*)\}/.exec(vueSrc)
check('遮罩样式存在', !!scrimRule)
if (scrimRule) {
  check(
    '遮罩 pointer-events: none',
    /pointer-events:\s*none/.test(scrimRule[1]),
    '否则页面内点击与滚动会被挡住',
  )
}

// 跨源注入必须静默跳过
const { canInject } = await import(
  'file://' + path.resolve('src/composables/browserTheme.js').replace(/\\/g, '/')
)
const crossOrigin = {
  get contentDocument() {
    throw new Error('SecurityError')
  },
  contentWindow: {},
}
let threw = false
try {
  canInject(crossOrigin)
} catch {
  threw = true
}
check('跨源探测不抛错', !threw)

console.log('=== 浏览器面板配色 ===')
let failed = 0
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`)
  if (!r.ok) failed++
}
console.log(`\n${results.length - failed}/${results.length} 通过`)
window.close()
process.exit(failed === 0 ? 0 : 1)
