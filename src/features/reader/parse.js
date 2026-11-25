/**
 * 小说解析：txt 与 epub。
 *
 * 设计目标：不引入第三方依赖（插件包里不想再塞 jszip）。
 * - txt：尝试 UTF-8（严格解码），失败回退 GBK（国内小说绝大多数是 GBK/GB18030）。
 * - epub：手写最小 ZIP 读取（本地文件头 + DecompressionStream 解 deflate），
 *   按 OPF 的 spine 顺序取出 xhtml，剥标签拼成纯文本。
 */

/** 字节 → 文本：优先 UTF-8，解码失败回退 GBK */
export function decodeText(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  // BOM
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (e) {
    try {
      return new TextDecoder('gbk').decode(bytes)
    } catch (e2) {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}

/** 章节标题正则：第X章/节/回/卷、序章、楔子、Chapter N */
const CHAPTER_RE = /^[\s\u3000]*(第[〇零一二三四五六七八九十百千0-9]{1,8}[章节回卷篇][^\n]{0,40}|序章[^\n]{0,40}|楔子[^\n]{0,40}|前言[^\n]{0,40}|后记[^\n]{0,40}|Chapter\s+\d+[^\n]{0,40})$/im

/** 无章节标记时，按字符数切节 */
const FALLBACK_SIZE = 3000

/**
 * txt → 章节数组
 * @param {string} text
 * @returns {{title:string, content:string}[]}
 */
export function splitChapters(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/\u3000/g, '  ').trim()
  if (!src) return []

  const lines = src.split('\n')
  const chapters = []
  let cur = null

  const push = () => {
    if (!cur) return
    const content = cur.lines.join('\n').trim()
    if (content) chapters.push({ title: cur.title, content })
    cur = null
  }

  for (const line of lines) {
    const isTitle = CHAPTER_RE.test(line) && line.trim().length <= 60
    if (isTitle) {
      push()
      cur = { title: line.trim(), lines: [] }
    } else {
      if (!cur) cur = { title: '开篇', lines: [] }
      cur.lines.push(line)
    }
  }
  push()

  // 一个章节都没识别出来：按字数硬切
  if (chapters.length <= 1 && src.length > FALLBACK_SIZE) {
    const out = []
    for (let i = 0, n = 1; i < src.length; i += FALLBACK_SIZE, n++) {
      out.push({ title: '第 ' + n + ' 节', content: src.slice(i, i + FALLBACK_SIZE) })
    }
    return out
  }
  // 首个章节只有标题、内容为空时丢弃
  return chapters.filter((c) => c.content && c.content.length > 0)
}

/* ============================ epub ============================ */

/** 读取 ZIP 中央目录里指定文件的字节（支持 store / deflate） */
async function readZipEntry(bytes, wantName) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // 从尾部找 End of Central Directory (0x06054b50)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 epub（找不到 ZIP 目录）')

  const count = dv.getUint16(eocd + 10, true)
  let off = dv.getUint32(eocd + 16, true)

  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break
    const method = dv.getUint16(off + 10, true)
    const compSize = dv.getUint32(off + 20, true)
    const nameLen = dv.getUint16(off + 28, true)
    const extraLen = dv.getUint16(off + 30, true)
    const commentLen = dv.getUint16(off + 32, true)
    const localOff = dv.getUint32(off + 42, true)
    const name = new TextDecoder('utf-8').decode(bytes.subarray(off + 46, off + 46 + nameLen))

    if (name === wantName) {
      // 本地文件头的名字/扩展字段长度可能不同，按本地头重新算
      const lNameLen = dv.getUint16(localOff + 26, true)
      const lExtraLen = dv.getUint16(localOff + 28, true)
      const dataStart = localOff + 30 + lNameLen + lExtraLen
      const raw = bytes.subarray(dataStart, dataStart + compSize)
      if (method === 0) return raw
      if (typeof DecompressionStream === 'undefined') throw new Error('当前环境不支持解压 epub')
      const ds = new DecompressionStream('deflate-raw')
      const stream = new Blob([raw]).stream().pipeThrough(ds)
      return new Uint8Array(await new Response(stream).arrayBuffer())
    }
    off += 46 + nameLen + extraLen + commentLen
  }
  return null
}

/** 列目录（只取文件名，用于定位 opf） */
function listNames(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return []
  const count = dv.getUint16(eocd + 10, true)
  let off = dv.getUint32(eocd + 16, true)
  const names = []
  for (let i = 0; i < count; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break
    const nameLen = dv.getUint16(off + 28, true)
    const extraLen = dv.getUint16(off + 30, true)
    const commentLen = dv.getUint16(off + 32, true)
    names.push(new TextDecoder('utf-8').decode(bytes.subarray(off + 46, off + 46 + nameLen)))
    off += 46 + nameLen + extraLen + commentLen
  }
  return names
}

function stripHtml(html) {
  return String(html)
    .replace(/<\s*(script|style)[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|h\d|li|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * epub → 章节数组：按 OPF spine 顺序，每个 xhtml 一节（标题取 h1/h2 或文件名）
 * @param {ArrayBuffer} buffer
 */
export async function parseEpub(buffer) {
  const bytes = new Uint8Array(buffer)
  const names = listNames(bytes)
  if (!names.length) throw new Error('不是有效的 epub')

  // 1) container.xml → opf 路径
  let opfPath = names.find((n) => /\.opf$/i.test(n)) || ''
  const containerRaw = await readZipEntry(bytes, 'META-INF/container.xml')
  if (containerRaw) {
    const xml = new TextDecoder('utf-8').decode(containerRaw)
    const m = /full-path="([^"]+)"/i.exec(xml)
    if (m) opfPath = m[1]
  }
  if (!opfPath) throw new Error('epub 缺少 OPF 文件')

  const opfXml = new TextDecoder('utf-8').decode(await readZipEntry(bytes, opfPath))
  const baseDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''

  // 2) manifest id → href；spine 决定顺序
  const manifest = {}
  const itemRe = /<item\b[^>]*>/gi
  let im
  while ((im = itemRe.exec(opfXml))) {
    const tag = im[0]
    const id = /id="([^"]+)"/i.exec(tag)
    const href = /href="([^"]+)"/i.exec(tag)
    if (id && href) manifest[id[1]] = href[1]
  }
  const order = []
  const refRe = /<itemref\b[^>]*idref="([^"]+)"[^>]*>/gi
  let rm
  while ((rm = refRe.exec(opfXml))) {
    const href = manifest[rm[1]]
    if (href) order.push(href)
  }
  if (!order.length) order.push(...Object.values(manifest).filter((h) => /\.x?html?$/i.test(h)))

  // 3) 逐个取正文
  const chapters = []
  for (const href of order) {
    const path = decodeURIComponent(href.charAt(0) === '/' ? href.slice(1) : baseDir + href)
    const raw = await readZipEntry(bytes, path)
    if (!raw) continue
    const html = new TextDecoder('utf-8').decode(raw)
    const text = stripHtml(html)
    if (!text) continue
    const t = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(html)
    const title = t ? stripHtml(t[1]).slice(0, 40) : '第 ' + (chapters.length + 1) + ' 节'
    // 正文首行往往就是标题，去掉避免重复
    const body = text.indexOf(title) === 0 ? text.slice(title.length).replace(/^\s+/, '') : text
    chapters.push({ title, content: body || text })
  }
  if (!chapters.length) throw new Error('epub 中没有可读文本')
  return chapters
}
