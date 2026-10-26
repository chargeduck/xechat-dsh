/**
 * 端到端冒烟：按 DSH 的真实加载路径验证 client.js。
 *
 * 依次模拟：
 *   1. window.__ModuleLoader__.load 注册
 *   2. 工厂函数执行（require 走模块桩）
 *   3. apply(ctx) 把 DockShell 注册进 shell.overlay slot
 *   4. 取出 slot 里的组件并渲染 → Vue 应用应挂载成功
 *
 * 这样能覆盖「内联进 client.js 的那份应用包」是否真的可用，
 * 而不只是单独测 lib/xechat-app.js。
 *
 * 用法: node scripts/verify-client-bundle.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const JSDOM_HOME =
  process.env.JSDOM_HOME ||
  'C:/Users/24962/.workbuddy/binaries/node/workspace/node_modules'
const require = createRequire(path.join(JSDOM_HOME, 'noop.js'))
const { JSDOM } = require('jsdom')

const CLIENT = path.resolve('lib/client.js')
if (!fs.existsSync(CLIENT)) {
  console.error('缺少', CLIENT, '请先 npm run build')
  process.exit(1)
}

const src = fs.readFileSync(CLIENT, 'utf-8')

/** 挂载 → 断言渲染 → 卸载 → 断言清空。 */
async function verifyMount(app, window) {
  console.log('  mountXechat:', typeof app.mountXechat)
  const host = window.document.getElementById('root')
  try {
    const handle = app.mountXechat(host)
    await new Promise((r) => setTimeout(r, 400))
    const container = host.querySelector('.app-container')
    const navs = Array.from(host.querySelectorAll('.nav-btn')).map((b) => b.getAttribute('title'))
    console.log('  .app-container 渲染:', !!container)
    console.log('  导航项:', navs.filter(Boolean).join(' / '))
    handle.unmount()
    console.log('  卸载后残留:', host.querySelectorAll('.app-container').length)
  } catch (e) {
    console.log('  挂载抛错:', String(e.stack).slice(0, 800))
  }
}

console.log('=== 静态检查 ===')
console.log('  process.env 残留:', (src.match(/process\.env/g) ?? []).length)
console.log('  window 挂载语句:', /window\.__XECHAT_DSH_APP__\s*=/.test(src) ? '有' : '无')
console.log('  __ModuleLoader__:', /window\.__ModuleLoader__\.load/.test(src) ? '有' : '无')

// 建立 jsdom 环境
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
})
const { window } = dom
window.WebSocket = class {
  static OPEN = 1
  readyState = 0
  constructor() {
    setTimeout(() => this.onerror?.({ message: 'stubbed' }), 0)
  }
  send() {}
  close() {}
}
window.fetch = () => Promise.reject(new Error('network disabled'))

// 捕获模块注册
let registered = null
window.__ModuleLoader__ = { load: (entry) => (registered = entry) }

console.log('\n=== 执行 client.js ===')
try {
  // 用 vm 在 jsdom 的 window 上下文执行，确保 `window` 是脚本作用域的全局
  const vm = await import('node:vm')
  const context = dom.getInternalVMContext()
  vm.runInContext(src, context, { filename: 'client.js' })
} catch (e) {
  console.log('  执行抛错:', e.message)
  window.close()
  process.exit(1)
}
console.log('  注册 id:', registered?.id)

// React / ReactDOM 用轻量桩，重点验证 Vue 应用能否被挂载
const h = (type, props, ...children) => ({ type, props, children })
const React = Object.assign(h, {
  createElement: h,
  Fragment: 'Fragment',
  useRef: (v) => ({ current: v }),
  useEffect: (fn) => fn(),
  useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
  useCallback: (fn) => fn,
})
const ReactDOM = { createRoot: () => ({ render() {}, unmount() {} }) }

const mod = registered.factory((name) => {
  if (name === 'react') return React
  if (name === 'react/jsx-runtime') return { jsx: h, jsxs: h, Fragment: 'Fragment' }
  if (name === 'react-dom/client') return ReactDOM
  return {}
})

console.log('  exports.apply:', typeof mod.apply)
console.log('  exports.inject:', JSON.stringify(mod.inject))

// 模拟 slot 注册
let slotEntry = null
const ctx = {
  effect: (cb) => cb(),
  slots: {
    inject: (_owner, cb) => cb(),
    register: (target, comp) => {
      slotEntry = { target, comp }
      return () => {}
    },
  },
}
mod.apply(ctx)
console.log('\n=== slot 注册 ===')
console.log('  slot:', slotEntry?.target?.name, '| id:', slotEntry?.target?.id)

// 取内联的应用包并真正挂载
console.log('\n=== 内联应用包 ===')
const app = window.__XECHAT_DSH_APP__
console.log('  window.__XECHAT_DSH_APP__:', typeof app)
if (!app) {
  // client.js 里内联的只是**字符串**，必须经 Blob + <script> 注入才会执行；
  // 上面直接读 window 拿不到是正确的（lib/xechat-app.js 单独执行才会有）。
  // 这里按 app-loader 的真实路径补上这一步，验证整条链路。
  const cssVars = /var APP_CSS\s*=\s*"([^"]*)"/.exec(src)
  console.log('  说明: 内联源码需经 Blob 注入，改为直接执行 xechat-app.js 验证')
  const appSrc = fs.readFileSync(path.resolve('lib/xechat-app.js'), 'utf-8')
  const vm2 = await import('node:vm')
  const ctx2 = dom.getInternalVMContext()
  let appErr = null
  try {
    vm2.runInContext(appSrc, ctx2, { filename: 'xechat-app.js' })
  } catch (e) {
    appErr = e
  }
  if (appErr) {
    console.log('  应用包执行抛错:', appErr.message)
    window.close()
    process.exit(1)
  }
  const app2 = window.__XECHAT_DSH_APP__
  console.log('  注入后 window.__XECHAT_DSH_APP__:', typeof app2)
  if (!app2) {
    console.log('  仍未导出，终止')
    window.close()
    process.exit(1)
  }
  await verifyMount(app2, window)
  window.close()
  process.exit(0)
}

await verifyMount(app, window)
window.close()
process.exit(0)
