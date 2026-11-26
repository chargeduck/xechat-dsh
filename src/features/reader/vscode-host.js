/**
 * VSCode webview 适配：把阅读内容同步到 IDE 原生状态栏，并接收扩展发来的翻行命令。
 *
 * 浏览器 / JCEF / OpenIDEA 里没有 acquireVsCodeApi，模块直接失活（返回 false）。
 */
import { ref, watch } from 'vue'
import { reader, currentLine, percent, nextLine, prevLine, toggleBar, toggleAuto } from './state.js'

let api = null
let inited = false
/** 扩展确认接管状态栏后才隐藏页面内底部条（否则两边都没有） */
export const hostBarReady = ref(false)

/** 是否运行在 VSCode webview 里 */
export function isVscodeHost() {
  return typeof acquireVsCodeApi === 'function' || !!window.__xechatVscodeApi
}

/**
 * 复用桥接脚本已经拿到的 api。
 *
 * acquireVsCodeApi 每个 webview 只能调用一次，第二次会抛
 * "An instance of the VS Code API has already been acquired" —— 之前就是这里抛了，
 * 导致状态栏握手（reader:hello）从来没发出去，底部条也不会隐藏。
 */
function getVsCodeApi() {
  if (window.__xechatVscodeApi) return window.__xechatVscodeApi
  try {
    const api = acquireVsCodeApi()
    window.__xechatVscodeApi = api
    return api
  } catch (e) {
    return null
  }
}

/**
 * 初始化：绑定 IDE → 页面 的命令，页面状态变化时回传一行文本给状态栏。
 * @returns {boolean} 是否启用
 */
export function initVscodeReader() {
  if (inited) return !!api
  inited = true
  if (!isVscodeHost()) return false
  api = getVsCodeApi()
  if (!api) return false

  window.addEventListener('message', (e) => {
    const m = e.data || {}
    if (m.type === 'reader:ack') { hostBarReady.value = true; return }
    if (m.type !== 'reader:cmd') return
    switch (m.cmd) {
      case 'next': nextLine(1); break
      case 'prev': prevLine(1); break
      case 'nextPage': nextLine(10); break
      case 'prevPage': prevLine(10); break
      case 'toggleBar': toggleBar(); break
      case 'auto': toggleAuto(); break
      default: break
    }
  })

  // 先问一句：扩展在不在？在的话它回 reader:ack
  try { api.postMessage({ type: 'reader:hello' }) } catch (e) {}

  // 阅读状态变化 → 推给扩展，由扩展更新原生状态栏
  watch(
    () => [
      reader.book ? reader.book.id : '',
      reader.book ? reader.book.name : '',
      reader.ch,
      reader.off,
      currentLine.value,
      percent.value
    ].join('\u0001'),
    () => {
      if (!reader.book) return
      try {
        api.postMessage({
          type: 'reader:update',
          text: currentLine.value,
          book: reader.book.name,
          chapter: (reader.book.chapters[reader.ch] || {}).title || '',
          percent: percent.value
        })
      } catch (e) {}
    },
    { immediate: true }
  )

  return true
}
