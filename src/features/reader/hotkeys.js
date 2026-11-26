/**
 * 阅读器全局快捷键：键位来自设置页「快捷键」区块（可录制），不是硬编码。
 *
 * 覆盖浏览器 / IDEA webview / DSH 三种环境：
 *   - 面板收起（display:none）时依然有效；
 *   - 输入框内不劫持；
 *   - 老板键额外通知 DSH 外壳收起面板（`xechat:dsh-toggle-panel`）。
 */
import { matchShortcut, useSettingsStore } from '@/stores/settingsStore.js'
import { reader, currentLine, nextLine, prevLine, toggleAuto, toggleDisguise } from './state.js'

let inited = false

function inEditable(el) {
  if (!el) return false
  const tag = (el.tagName || '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || el.isContentEditable
}

/** 打开「摸鱼阅读」并弹出导入选择框 */
function openReaderImport() {
  try {
    const input = document.querySelector('.reader-panel input[type="file"][accept*=".txt"]')
    if (input) { input.click(); return }
    window.dispatchEvent(new CustomEvent('xechat:open-reader'))
    setTimeout(() => {
      const again = document.querySelector('.reader-panel input[type="file"][accept*=".txt"]')
      if (again) again.click()
    }, 220)
  } catch (e) {}
}

export function initReaderHotkeys() {
  if (inited) return
  inited = true
  const store = useSettingsStore()

  window.addEventListener('keydown', function (e) {
    // 正在录制快捷键 / 正在输入：不处理
    if (window.__xechatShortcutRecording) return
    if (inEditable(e.target)) return

    if (matchShortcut(store.readerNext, e)) {
      e.preventDefault(); e.stopPropagation(); nextLine(1); return
    }
    if (matchShortcut(store.readerPrev, e)) {
      e.preventDefault(); e.stopPropagation(); prevLine(1); return
    }
    if (matchShortcut(store.readerNextPage, e)) {
      e.preventDefault(); e.stopPropagation(); nextLine(10); return
    }
    if (matchShortcut(store.readerPrevPage, e)) {
      e.preventDefault(); e.stopPropagation(); prevLine(10); return
    }
    if (matchShortcut(store.readerAuto, e)) {
      e.preventDefault(); e.stopPropagation(); toggleAuto(); return
    }
    if (matchShortcut(store.readerBoss, e)) {
      e.preventDefault(); e.stopPropagation()
      toggleDisguise()
      // DSH：顺便收起/展开侧栏面板（浏览器里没人监听，无副作用）
      try { window.dispatchEvent(new CustomEvent('xechat:dsh-toggle-panel')) } catch (err) {}
      return
    }
    if (matchShortcut(store.readerImport, e)) {
      e.preventDefault(); e.stopPropagation(); openReaderImport(); return
    }
  }, true)
}

/** 当前是否有书（给设置页/状态栏判断用） */
export function hasBook() {
  return !!(reader.book && reader.book.chapters && reader.book.chapters.length)
}

/** 当前行文本（伪装态返回 Hello world） */
export function displayLine() {
  return reader.disguised ? 'Hello, world!' : (currentLine.value || '')
}
