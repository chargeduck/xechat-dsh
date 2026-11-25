/**
 * 控制台风格表格 → Markdown 表格。
 *
 * 服务端有些系统消息（如 `#moyu`、在线统计）是用 ConsoleTable 画的纯文本表格：
 *
 *   ＋－－－－－＋－－－－－－＋
 *   ｜　省份　　｜　在线人数　｜
 *   ＋－－－－－＋－－－－－－＋
 *   ｜　山东省　｜　１　　　　｜
 *   ＋－－－－－＋－－－－－－＋
 *
 * markdown-it 不认识这种格式，会原样显示成一堆短横线。这里在渲染前把它
 * 转成标准 Markdown 表格，交给 markdown-it 正常出 <table>。
 *
 * 支持的边框字符：ASCII `-` `=` `|` `+` 与全角 `－` `｜` `＋` `─`，以及全角空格 U+3000。
 */

/** 边框行：+---+--- 或 ＋－－－＋－－－ */
const BORDER_RE = /^[+＋][\-－=_─]+(?:[+＋][\-－=_─]+)+[+＋]$/
/** 数据行：| a | b | 或 ｜ a ｜ b ｜ */
const ROW_RE = /^[|｜].*[|｜]$/

function splitCells(line) {
  return String(line)
    .replace(/^[|｜]/, '')
    .replace(/[|｜]$/, '')
    .split(/[|｜]/)
    .map((c) => c.replace(/[\u3000\s]+/g, ' ').trim())
}

function toMarkdownTable(rows) {
  const width = Math.max.apply(null, rows.map((r) => r.length))
  const pad = (r) => {
    const out = r.slice()
    while (out.length < width) out.push('')
    return '| ' + out.join(' | ') + ' |'
  }
  const header = pad(rows[0])
  const sep = '| ' + new Array(width).fill('---').join(' | ') + ' |'
  const body = rows.slice(1).map(pad)
  return [header, sep].concat(body).join('\n')
}

/** 文本里是否含控制台表格 */
/** 边框片段（不要求独占一行） */
const BORDER_ANY_RE = /[+＋][\-－=_─]+(?:[+＋][\-－=_─]+)+[+＋]/

export function hasConsoleTable(text) {
  if (!text || typeof text !== 'string') return false
  return BORDER_ANY_RE.test(text)
}

/**
 * 把「被压成一行」的表格还原成多行：
 *  - 边框 `+---+---+` 前后强制换行；
 *  - 行与行之间的 `| |`（管道 + 空白 + 管道）换成换行。
 * 服务端有时整段用空格拼接下发，不还原的话无法按行解析。
 */
function normalizeLayout(text) {
  return String(text)
    .replace(new RegExp(BORDER_ANY_RE.source, 'g'), '\n$&\n')
    .replace(/[|｜]([ \u3000]+)[|｜]/g, '|\n|')
    .replace(/\n{3,}/g, '\n\n')
}

/**
 * 把文本中的控制台表格块转成 Markdown 表格，其余内容原样保留。
 * @param {string} text
 * @returns {string}
 */
export function consoleTableToMarkdown(text) {
  if (!text || typeof text !== 'string' || !hasConsoleTable(text)) return text

  const lines = normalizeLayout(text).split(/\r?\n/)
  const out = []
  let rows = []

  const flush = () => {
    if (rows.length) {
      out.push('', toMarkdownTable(rows), '')
      rows = []
    }
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) {
      flush()
      out.push(raw)
      continue
    }
    if (BORDER_RE.test(line)) {
      // 边框只用于分隔，不参与内容
      continue
    }
    if (ROW_RE.test(line)) {
      rows.push(splitCells(line))
      continue
    }
    flush()
    out.push(raw)
  }
  flush()

  // 压缩连续空行，避免 markdown 段落间距过大
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}
