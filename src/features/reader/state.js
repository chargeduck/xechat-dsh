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
  error: ''
})

const KEY_COLS = 'xechat_reader_columns'
try {
  const c = parseInt(localStorage.getItem(KEY_COLS) || '', 10)
  if (c > 10 && c < 400) reader.columns = c
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
}

export function setColumns(n) {
  const cols = Math.min(400, Math.max(10, n | 0))
  reader.columns = cols
  try { localStorage.setItem(KEY_COLS, String(cols)) } catch (e) {}
  repaginate()
  save()
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
  save()
}

export function toggleBar() {
  reader.barVisible = !reader.barVisible
}
