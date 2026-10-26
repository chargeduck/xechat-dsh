/**
 * 在真实 DOM 环境（jsdom）中执行应用包，复现插件里的加载过程。
 *
 * 目的：捕捉「IIFE 执行到一半抛错 → footer 没执行 → window 上是 undefined」这类问题。
 * 用法: node scripts/run-app-in-jsdom.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

/**
 * jsdom 装在隔离工作区（避免污染项目依赖树），用 require 走绝对路径解析。
 * 可用环境变量 JSDOM_HOME 覆盖。
 */
const JSDOM_HOME =
  process.env.JSDOM_HOME ||
  'C:/Users/24962/.workbuddy/binaries/node/workspace/node_modules'
const require = createRequire(path.join(JSDOM_HOME, 'noop.js'))
const { JSDOM } = require('jsdom')

const APP = path.resolve('lib/xechat-app.js')
if (!fs.existsSync(APP)) {
  console.error('缺少', APP, '请先 npm run build:vite')
  process.exit(1)
}

const dom = new JSDOM(
  `<!doctype html><html><head></head><body><div id="host"></div></body></html>`,
  {
    url: 'http://localhost/',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  },
)

const { window } = dom
const errors = []

// 模拟插件壳：脚本执行前写入嵌入标记
window.__XECHAT_DSH_EMBEDDED__ = true

// 捕获脚本内未处理异常
window.addEventListener('error', (e) => {
  errors.push('[window error] ' + (e.error?.stack || e.message))
})

// WebSocket / fetch 桩（避免真实网络）
window.WebSocket = class {
  static OPEN = 1
  readyState = 0
  constructor(url) {
    this.url = url
    // 模拟连接失败但不抛同步异常
    setTimeout(() => this.onerror?.({ message: 'stubbed' }), 0)
  }
  send() {}
  close() {}
}
window.fetch = () => Promise.reject(new Error('network disabled in jsdom test'))

const code = fs.readFileSync(APP, 'utf-8')

let threw = null
try {
  // 用 window.eval 在页面上下文执行，等价于 <script> 注入的语义
  window.eval(code)
} catch (e) {
  threw = e
}

console.log('=== 执行结果 ===')
console.log('同步抛错:', threw ? threw.message : '无')
console.log('window.__XECHAT_DSH_APP__ :', typeof window.__XECHAT_DSH_APP__)
if (window.__XECHAT_DSH_APP__) {
  const m = window.__XECHAT_DSH_APP__
  console.log('  mountXechat:', typeof m.mountXechat)
  console.log('  initXechat :', typeof m.initXechat)
} else {
  console.log('  keys:', Object.keys(window.__XECHAT_DSH_APP__ ?? {}).slice(0, 5))
}

if (errors.length) {
  console.log('\n=== 捕获到的错误 ===')
  errors.slice(0, 5).forEach((e) => console.log(e.slice(0, 800)))
}

if (threw) {
  console.log('\n=== 堆栈 ===')
  console.log(String(threw.stack).slice(0, 2000))
}

// 端到端：真正调用 mountXechat，确认 Vue 渲染出界面
const mod = window.__XECHAT_DSH_APP__
if (mod && typeof mod.mountXechat === 'function') {
  const host = window.document.getElementById('host')
  try {
    const handle = mod.mountXechat(host)
    await new Promise((r) => setTimeout(r, 300))
    const container = host.querySelector('.app-container')
    const navBtns = host.querySelectorAll('.nav-btn')
    console.log('\n=== 挂载结果 ===')
    console.log('  .app-container 渲染:', !!container)
    console.log('  导航按钮数量:', navBtns.length)
    const texts = Array.from(navBtns).map((b) => b.getAttribute('title')).filter(Boolean)
    console.log('  导航项:', texts.join(' / '))
    // 验证卸载可逆
    handle.unmount()
    console.log('  卸载后残留子节点:', host.querySelectorAll('.app-container').length)
  } catch (e) {
    console.log('\n=== 挂载抛错 ===')
    console.log(String(e.stack).slice(0, 1500))
  }
}

// jsdom 里的定时器（心跳/重连）会阻止进程退出，验证完直接结束
window.close()
process.exit(0)
