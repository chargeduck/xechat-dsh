/**
 * 阅读器存储：**三档降级**。
 *
 *   1. IndexedDB —— 首选。容量大（几十 MB），二进制/大字符串都行。
 *   2. localStorage —— 宿主禁用 IndexedDB 时用（openIDEA 的沙箱就是这种情况：
 *      `IDBFactory.open()` 直接抛 "access to the Indexed Database API is denied"）。
 *      容量约 5MB，超了会退到第 3 档并提示。
 *   3. 内存 —— 上面两种都写不进去时的兜底：本次会话可读，刷新即丢。
 *
 * 为什么不「只存文件路径」：webview 的 `<input type=file>` 拿不到真实磁盘路径
 * （`file.path` 是 Electron 私有字段），File 对象在页面重开后就失效；
 * File System Access API 在 JCEF / openIDEA 里支持度不一致。
 */

const DB_NAME = 'xechat_reader'
const DB_VERSION = 1
const ST_BOOKS = 'books'
const ST_PROGRESS = 'progress'
const KEY_CURRENT = 'xechat_reader_current'

/** localStorage 模式的键前缀 */
const LS_INDEX = 'xechat_reader_ls_index'
const LS_BOOK = 'xechat_reader_ls_book_'
const LS_PROG = 'xechat_reader_ls_progress'

let dbPromise = null
/** 探测结果：'idb' | 'ls' */
let mode = ''
/** 内存兜底：id → book */
const memBooks = new Map()
/** 哪些书只能留在内存（localStorage 写不下） */
const memOnly = new Set()

/* ============================ IndexedDB ============================ */

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'))
      return
    }
    let settled = false
    const fail = (e) => {
      if (settled) return
      settled = true
      reject(e || new Error('IndexedDB 不可用'))
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(ST_BOOKS)) db.createObjectStore(ST_BOOKS, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(ST_PROGRESS)) db.createObjectStore(ST_PROGRESS, { keyPath: 'id' })
      }
      req.onsuccess = () => {
        if (settled) return
        settled = true
        resolve(req.result)
      }
      req.onerror = () => fail(req.error)
      req.onblocked = () => fail(new Error('IndexedDB 被其它窗口占用'))
      // 沙箱里 open() 可能既不 success 也不 error，加个超时兜底
      setTimeout(() => fail(new Error('IndexedDB 打开超时')), 1500)
    } catch (e) {
      fail(e)
    }
  })
  return dbPromise
}

/** 探测一次：IDB 能用就用，不能用就走 localStorage */
async function ensureMode() {
  if (mode) return mode
  try {
    await openDB()
    mode = 'idb'
  } catch (e) {
    console.warn('[reader] IndexedDB 不可用，降级到 localStorage：' + (e && e.message))
    mode = 'ls'
  }
  return mode
}

function withStore(store, txMode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, txMode)
    const os = t.objectStore(store)
    let request
    try {
      request = fn(os)
    } catch (e) {
      reject(e)
      return
    }
    t.oncomplete = () => resolve(request ? request.result : undefined)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

/* ============================ localStorage ============================ */

function lsIndex() {
  try {
    const raw = localStorage.getItem(LS_INDEX)
    return raw ? JSON.parse(raw) : []
  } catch (e) {
    return []
  }
}

function lsIndexWrite(list) {
  localStorage.setItem(LS_INDEX, JSON.stringify(list))
}

function lsBook(id) {
  if (memBooks.has(id)) return memBooks.get(id)
  try {
    const raw = localStorage.getItem(LS_BOOK + id)
    return raw ? JSON.parse(raw) : null
  } catch (e) {
    return null
  }
}

function lsProgress() {
  try {
    const raw = localStorage.getItem(LS_PROG)
    return raw ? JSON.parse(raw) : {}
  } catch (e) {
    return {}
  }
}

/* ============================ 对外 API ============================ */

/** 书架列表（不含正文） */
export async function listBooks() {
  const m = await ensureMode()
  let list
  if (m === 'idb') {
    const db = await openDB()
    list = await new Promise((resolve, reject) => {
      const t = db.transaction(ST_BOOKS, 'readonly')
      const out = []
      t.objectStore(ST_BOOKS).openCursor().onsuccess = (e) => {
        const cur = e.target.result
        if (cur) {
          const b = cur.value
          out.push({ id: b.id, name: b.name, format: b.format, chapters: (b.chapters || []).length, size: b.size || 0, addedAt: b.addedAt || 0 })
          cur.continue()
        } else {
          resolve(out)
        }
      }
      t.onerror = () => reject(t.error)
    })
  } else {
    list = lsIndex().slice()
    // 内存里可能有 LS 写不下的书
    memBooks.forEach((b, id) => {
      if (!list.some((x) => x.id === id)) {
        list.push({ id, name: b.name, format: b.format, chapters: (b.chapters || []).length, size: b.size || 0, addedAt: b.addedAt || 0 })
      }
    })
  }
  return list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
}

/** 取整本书（含章节正文） */
export async function getBook(id) {
  const m = await ensureMode()
  if (m === 'idb') return withStore(ST_BOOKS, 'readonly', (os) => os.get(id))
  return lsBook(id)
}

/** 新增书籍，返回 id */
export async function addBook(book) {
  const m = await ensureMode()
  const id = 'bk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const entry = {
    id,
    name: book.name || '未命名',
    format: book.format || 'txt',
    chapters: book.chapters,
    size: book.size || 0,
    addedAt: Date.now()
  }

  if (m === 'idb') {
    await withStore(ST_BOOKS, 'readwrite', (os) => os.put(entry))
  } else {
    // 先试着写 localStorage；写不下（配额超限）就退到内存
    try {
      localStorage.setItem(LS_BOOK + id, JSON.stringify(entry))
      const idx = lsIndex()
      idx.push({ id, name: entry.name, format: entry.format, chapters: entry.chapters.length, size: entry.size, addedAt: entry.addedAt })
      lsIndexWrite(idx)
    } catch (e) {
      console.warn('[reader] localStorage 写不下整本（' + (entry.chapters || []).length + ' 章），本次会话放内存：' + (e && e.name))
      memBooks.set(id, entry)
      memOnly.add(id)
    }
  }

  await setProgress(id, 0, 0)
  setCurrentBookId(id)
  return id
}

export async function removeBook(id) {
  const m = await ensureMode()
  if (m === 'idb') {
    await withStore(ST_BOOKS, 'readwrite', (os) => os.delete(id))
    await withStore(ST_PROGRESS, 'readwrite', (os) => os.delete(id))
  } else {
    memBooks.delete(id)
    memOnly.delete(id)
    try { localStorage.removeItem(LS_BOOK + id) } catch (e) {}
    lsIndexWrite(lsIndex().filter((b) => b.id !== id))
    const pr = lsProgress()
    delete pr[id]
    try { localStorage.setItem(LS_PROG, JSON.stringify(pr)) } catch (e) {}
  }
  if (getCurrentBookId() === id) {
    const rest = await listBooks()
    setCurrentBookId(rest.length ? rest[0].id : '')
  }
}

/** 当前书 id 放 localStorage：只是个短字符串 */
export function getCurrentBookId() {
  try { return localStorage.getItem(KEY_CURRENT) || '' } catch (e) { return '' }
}

export function setCurrentBookId(id) {
  try {
    if (id) localStorage.setItem(KEY_CURRENT, id)
    else localStorage.removeItem(KEY_CURRENT)
  } catch (e) {}
}

export async function getProgress(id) {
  const m = await ensureMode()
  if (m === 'idb') {
    const p = await withStore(ST_PROGRESS, 'readonly', (os) => os.get(id))
    return p ? { ch: p.ch || 0, off: p.off || 0 } : { ch: 0, off: 0 }
  }
  const pr = lsProgress()
  return pr[id] ? { ch: pr[id].ch || 0, off: pr[id].off || 0 } : { ch: 0, off: 0 }
}

export async function setProgress(id, ch, off) {
  const m = await ensureMode()
  const value = { ch: Math.max(0, ch | 0), off: Math.max(0, off | 0) }
  try {
    if (m === 'idb') {
      await withStore(ST_PROGRESS, 'readwrite', (os) => os.put({ id, ...value, at: Date.now() }))
    } else {
      const pr = lsProgress()
      pr[id] = { ...value, at: Date.now() }
      localStorage.setItem(LS_PROG, JSON.stringify(pr))
    }
  } catch (e) {
    // 进度写入失败不影响阅读
  }
}

/** 当前存储模式（设置页/诊断用） */
export async function storageMode() {
  return ensureMode()
}

/** 只存在内存、刷新会丢的书 id 列表 */
export function memoryOnlyIds() {
  return Array.from(memOnly)
}

/* ============================ 备份 / 迁移 ============================ */

export async function exportAll() {
  const books = await listBooks()
  const out = []
  for (const meta of books) {
    const full = await getBook(meta.id)
    if (!full) continue
    out.push({
      name: full.name,
      format: full.format,
      size: full.size || 0,
      addedAt: full.addedAt || 0,
      chapters: full.chapters,
      progress: await getProgress(full.id)
    })
  }
  return { version: 1, exportedAt: Date.now(), books: out, current: getCurrentBookId() }
}

export async function importAll(data) {
  if (!data || !Array.isArray(data.books)) throw new Error('不是有效的书库备份文件')
  const existing = new Set((await listBooks()).map((b) => b.name))
  let added = 0
  let skipped = 0
  for (const b of data.books) {
    if (!b || !b.name || !Array.isArray(b.chapters) || !b.chapters.length) { skipped++; continue }
    if (existing.has(b.name)) { skipped++; continue }
    const id = await addBook({ name: b.name, format: b.format || 'txt', chapters: b.chapters, size: b.size || 0 })
    if (b.progress) await setProgress(id, b.progress.ch || 0, b.progress.off || 0)
    existing.add(b.name)
    added++
  }
  return { added, skipped }
}
