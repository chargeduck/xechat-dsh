/**
 * DSH 端快捷键：DSH 没有 VSCode 那种扩展级 keybinding，
 * 所以在这里挂一个 window 级 keydown，行为对齐 VSCode 说明书里的那套键位。
 *
 *   Ctrl+M                 老板键：伪装成 Hello World + 收起面板（再按一次恢复）
 *   Ctrl+Alt+↑ / ↓         上一行 / 下一行
 *   Ctrl+Alt+Shift+↑ / ↓   上一页 / 下一页
 *   Ctrl+Alt+A             自动阅读开 / 关
 *   Ctrl+Alt+O             打开「摸鱼阅读」并弹出导入文件选择
 *
 * 面板收起时 Vue 应用仍在文档里（仅 display:none），window 上的监听照样收得到事件。
 */
import { nextLine, prevLine, toggleAuto, toggleDisguise } from './state.js'

let inited = false

function inEditable(el) {
  if (!el) return false
  const tag = (el.tagName || '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || el.isContentEditable
}

/** 触发面板里的「导入 txt/epub」文件选择框 */
function openFilePicker() {
  const input = document.querySelector('.reader-panel input[type="file"][accept*=".txt"]')
  if (input) {
    input.click()
    return true
  }
  // 不在阅读页：先切页，再点
  try {
    const app = window.__xechatDshState
    if (app) app.currentRoute = 'reader'
  } catch (e) {}
  setTimeout(() => {
    const again = document.querySelector('.reader-panel input[type="file"][accept*=".txt"]')
    if (again) again.click()
  }, 200)
  return false
}

export function initDshShortcuts() {
  if (inited) return
  inited = true

  window.addEventListener('keydown', function (e) {
    const mod = e.ctrlKey || e.metaKey
    if (!mod) return
    if (inEditable(e.target)) return

    // Ctrl+M：老板键
    if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'm') {
      e.preventDefault()
      e.stopPropagation()
      toggleDisguise()
      try { window.dispatchEvent(new CustomEvent('xechat:dsh-toggle-panel')) } catch (err) {}
      return
    }

    // Ctrl+Alt+O：导入
    if (e.ctrlKey && e.altKey && !e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      e.stopPropagation()
      openFilePicker()
      return
    }

    if (!e.altKey) return

    // Ctrl+Alt+A：自动阅读
    if (!e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault()
      e.stopPropagation()
      toggleAuto()
      return
    }

    // 翻行 / 翻页
    const step = e.shiftKey ? 10 : 1
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      nextLine(step)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      prevLine(step)
    }
  }, true)
}
