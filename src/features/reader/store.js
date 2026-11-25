/**
 * 阅读器存储：IndexedDB。
 *
 * 为什么不用 localStorage：
 *  - 整本小说（几 MB）会直接撑爆 5MB 配额；
 *  - localStorage 只能存字符串，正文要反复 JSON 序列化，导入/切换都卡。
 *
 * 为什么不「只存文件路径」：
 *  - webview 里的 <input type=file> 拿不到真实磁盘路径（`file.path` 是 Electron 私有字段），
 *    浏览器把 File 当作一次性句柄，页面重开即失效；
 *  - File System Access API 能在 Chromium 保留句柄，但要求安全上下文、每次启动重新授权，
 *    在 JCEF / VSCode webview / OpenIDEA 里表现不一致。
 * 这里把**解析后的章节文本**存进 IndexedDB（容量几十 MB 起），需要时按需取出，
 * 效果等价于「存本地、用时读」，但四端行为一致。
 */

const DB_NAME = 'xechat_reader'
const DB_VERSION = 1
const ST_BOOKS = 'books'
const ST_PROGRESS = 'progress'
const KEY_CURRENT = 'xechat_reader_current'

let dbPromise = null

function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(ST_BOOKS)) {
        db.createObjectStore(ST_BOOKS, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(ST_PROGRESS)) {
        db.createObjectStore(ST_PROGRESS, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('打开本地书库失败'))
  })
  return dbPromise
}

/** 单条读写：返回 request 的结果 */
function withStore(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
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

/** 书架列表（不含正文章节，避免一次读几十 MB） */
export async function listBooks() {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const t = db.transaction(ST_BOOKS, 'readonly')
    const out = []
    t.objectStore(ST_BOOKS).openCursor().onsuccess = (e) => {
      const cur = e.target.result
      if (cur) {
        const b = cur.value
        out.push({
          id: b.id,
          name: b.name,
          format: b.format,
          chapters: (b.chapters || []).length,
          size: b.size || 0,
          addedAt: b.addedAt || 0
        })
        cur.continue()
      } else {
        resolve(out.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)))
      }
    }
    t.onerror = () => reject(t.error)
  })
}

/** 取整本书（含章节正文） */
export function getBook(id) {
  return withStore(ST_BOOKS, 'readonly', (os) => os.get(id))
}

/** 新增书籍，返回 id */
export async function addBook(book) {
  const id = 'bk_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const entry = {
    id,
    name: book.name || '未命名',
    format: book.format || 'txt',
    chapters: book.chapters,
    size: book.size || 0,
    addedAt: Date.now()
  }
  await withStore(ST_BOOKS, 'readwrite', (os) => os.put(entry))
  await setProgress(id, 0, 0)
  setCurrentBookId(id)
  return id
}

export async function removeBook(id) {
  await withStore(ST_BOOKS, 'readwrite', (os) => os.delete(id))
  await withStore(ST_PROGRESS, 'readwrite', (os) => os.delete(id))
  if (getCurrentBookId() === id) {
    const rest = await listBooks()
    setCurrentBookId(rest.length ? rest[0].id : '')
  }
}

/** 当前书 id 放 localStorage：只是个小字符串，要同步、高频读写 */
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
  const p = await withStore(ST_PROGRESS, 'readonly', (os) => os.get(id))
  return p ? { ch: p.ch || 0, off: p.off || 0 } : { ch: 0, off: 0 }
}

export async function setProgress(id, ch, off) {
  try {
    await withStore(ST_PROGRESS, 'readwrite', (os) => os.put({
      id, ch: Math.max(0, ch | 0), off: Math.max(0, off | 0), at: Date.now()
    }))
  } catch (e) {
    // 进度写入失败不应影响阅读
  }
}
