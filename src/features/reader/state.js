/**
 * 阅读器共享状态：当前书、章节、行偏移、列宽。
 * ReaderPanel（工具页）与 ReaderBar（底部状态栏）都读写这里。
 */
import { reactive, computed } from 'vue'
import { paginate } from './paginate.js'
import { getBook, getCurrentBookId, setCurrentBookId, getProgress, setProgress } from './store.js'

export const reader = reactive({
  book: null,          // { id, name, chapters: [...] }
  ch: 0,               // 章节下标
  off: 0,              // 章节内行偏移
  columns: 50,         // 一行多少列
  lines: [],           // 当前章节分页后的行
  barVisible: true,    // 底部条是否显示
  autoPlay: false,     // 自动阅读：按固定间隔自动翻行
  autoMs: 1500,        // 自动阅读间隔（毫秒，默认 1.5 秒）
  error: ''
})

const KEY_COLS = 'xechat_reader_columns'
const KEY_AUTO_MS = 'xechat_reader_auto_ms'
try {
  const c = parseInt(localStorage.getItem(KEY_COLS) || '', 10)
  if (c > 10 && c < 400) reader.columns = c
} catch (e) {}
try {
  const a = parseInt(localStorage.getItem(KEY_AUTO_MS) || '', 10)
  if (a >= 200 && a <= 60000) reader.autoMs = a
} catch (e) {}

/** 统计用：全书进度百分比 */
export const percent = computed(() => {
  if (!reader.book || !reader.book.chapters.length) return 0
  const total = reader.book.chapters.length
  const inCh = reader.lines.length ? reader.off / reader.lines.length : 0
  return Math.min(100, Math.round(((reader.ch + inCh) / total) * 100))
})

/** 当前行文本（底部条展示） */
export const currentLine = computed(() => reader.lines[reader.off] || '')

function repaginate() {
  const ch = reader.book && reader.book.chapters[reader.ch]
  reader.lines = ch ? paginate(ch.content, reader.columns) : []
  if (reader.off >= reader.lines.length) reader.off = Math.max(0, reader.lines.length - 1)
  settleOff()
}

/** 当前行是空行就顺延到下一个非空行（末尾回退） */
function settleOff() {
  const blank = (i) => {
    const l = reader.lines[i]
    return l === undefined || !String(l).trim()
  }
  let i = reader.off
  while (i < reader.lines.length && blank(i)) i++
  if (i >= reader.lines.length) {
    i = Math.max(0, reader.off)
    while (i > 0 && blank(i)) i--
  }
  reader.off = Math.max(0, Math.min(i, Math.max(0, reader.lines.length - 1)))
}

export function setColumns(n) {
  // 交给 vscode-host 转发给扩展
  const cols = Math.min(400, Math.max(10, n | 0))
  reader.columns = cols
  try { localStorage.setItem(KEY_COLS, String(cols)) } catch (e) {}
  repaginate()
  save()
  if (typeof notifyHost === 'function') notifyHost('columns')
}

/** 打开一本书并从上次进度继续（异步读 IndexedDB） */
export async function openBook(id) {
  const book = await getBook(id)
  if (!book) return false
  reader.book = book
  const p = await getProgress(id)
  reader.ch = Math.min(p.ch, book.chapters.length - 1)
  reader.off = p.off || 0
  setCurrentBookId(id)
  repaginate()
  reader.off = Math.min(reader.off, Math.max(0, reader.lines.length - 1))
  reader.error = ''
  restartAutoTimer()
  return true
}

/** 启动时恢复上次的书 */
export async function restore() {
  const id = getCurrentBookId()
  if (id) await openBook(id)
}

let saveTimer = null
/** 进度落库：翻行很频繁，节流 400ms */
function save() {
  if (!reader.book) return
  const id = reader.book.id
  const ch = reader.ch
  const off = reader.off
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => { saveTimer = null; setProgress(id, ch, off) }, 400)
}

export function gotoChapter(idx) {
  if (!reader.book) return
  const n = Math.min(Math.max(0, idx | 0), reader.book.chapters.length - 1)
  reader.ch = n
  reader.off = 0
  repaginate()
  save()
}

export function nextLine(step = 1) {
  if (!reader.book) return
  const target = reader.off + step
  if (target >= reader.lines.length) {
    if (reader.ch < reader.book.chapters.length - 1) {
      reader.ch += 1
      reader.off = 0
      repaginate()
    } else {
      reader.off = Math.max(0, reader.lines.length - 1)
    }
  } else {
    reader.off = Math.max(0, target)
  }
  settleOff()
  save()
}

export function prevLine(step = 1) {
  if (!reader.book) return
  const target = reader.off - step
  if (target < 0) {
    if (reader.ch > 0) {
      reader.ch -= 1
      repaginate()
      reader.off = Math.max(0, reader.lines.length - 1)
    } else {
      reader.off = 0
    }
  } else {
    reader.off = target
  }
  settleOff()
  save()
}

export function toggleBar() {
  reader.barVisible = !reader.barVisible
}

// ---------------------------------------------------------------- 自动阅读

let autoTimer = null

/** 自动阅读定时器：只有开了自动 + 有书才跑；间隔变了就重建 */
function restartAutoTimer() {
  if (autoTimer) {
    clearInterval(autoTimer)
    autoTimer = null
  }
  if (!reader.autoPlay || !reader.book) return
  const ms = Math.max(200, reader.autoMs || 1500)
  autoTimer = setInterval(() => {
    if (!reader.autoPlay || !reader.book) return
    // 到了最后一章最后一行就停下，别空转
    const lastCh = reader.book.chapters.length - 1
    if (reader.ch >= lastCh && reader.off >= reader.lines.length - 1) {
      reader.autoPlay = false
      restartAutoTimer()
      return
    }
    nextLine(1)
  }, ms)
}

/** 开/关自动阅读，返回切换后的状态 */
let localAutoTimer = null
export function stopLocalAuto() {
  if (localAutoTimer) { clearInterval(localAutoTimer); localAutoTimer = null }
}

export function toggleAuto() {
  reader.autoPlay = !reader.autoPlay
  notifyHost('auto')
  restartAutoTimer()
  return reader.autoPlay
}

/** 设置自动阅读间隔（秒） */
export function setAutoMs(n) {
  reader.autoMs = Math.min(60000, Math.max(200, n | 0))
  try { localStorage.setItem(KEY_AUTO_MS, String(reader.autoMs)) } catch (e) {}
  restartAutoTimer()
  notifyHost('autoMs')
}

/* ===================== VSCode 宿主同步 ===================== */
/** 由 vscode-host 注册：面板状态变化时通知扩展 */
let hostNotifier = null
export function setHostNotifier(fn) { hostNotifier = fn }
function notifyHost(kind) {
  if (!hostNotifier) return
  try { hostNotifier(kind, { autoPlay: reader.autoPlay, intervalMs: reader.autoMs, columns: reader.columns, ch: reader.ch, off: reader.off }) } catch (e) {}
}

/**
 * 宿主（扩展）状态 → 面板：让面板的自动阅读开关/间隔/位置跟着扩展走。
 * 仅在书名一致时应用位置，避免把 A 书的进度套到 B 书上。
 */
export function applyHostState(st) {
  if (!st) return
  if (typeof st.auto === 'boolean') reader.autoPlay = st.auto
  if (st.intervalMs > 0) reader.autoMs = Math.min(60000, Math.max(200, st.intervalMs | 0))
  if (st.columns > 0 && st.columns !== reader.columns) {
    reader.columns = st.columns
    repaginate()
  }
  if (reader.book && st.book && st.book === reader.book.name && Number.isInteger(st.ch)) {
    const ch = Math.min(Math.max(0, st.ch), reader.book.chapters.length - 1)
    if (ch !== reader.ch) { reader.ch = ch; repaginate() }
    if (Number.isInteger(st.off)) {
      reader.off = Math.min(Math.max(0, st.off), Math.max(0, reader.lines.length - 1))
    }
  }
  // 面板自己的定时器交给宿主控制：宿主开着就停本地面板计时，避免双倍翻行
  if (reader.autoPlay) stopLocalAuto()
}
