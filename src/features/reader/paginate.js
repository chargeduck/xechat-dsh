/**
 * 阅读分页：把章节正文按「显示宽度」切成定宽的行，供状态栏一行一行翻。
 *
 * 中文按 2 列、英文数字按 1 列，这样中英混排也不会错位。
 * 行数不预先生成整章（长章节几万行会卡），按需计算：给出行宽和起点，返回接下来的 N 行。
 */

/** 单个字符占几列 */
export function charWidth(code) {
  if (code === 9) return 4
  if (code < 0x20) return 0
  if (code < 0x7f) return 1
  // 全角/中文/日韩
  if (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  ) return 2
  return 1
}

/**
 * 把一段文字切成宽度为 columns 的行
 * @param {string} text
 * @param {number} columns 一行多少「列」
 * @returns {string[]}
 */
export function paginate(text, columns) {
  const cols = Math.max(10, columns | 0)
  const src = String(text || '').replace(/\r\n?/g, '\n')
  const lines = []
  for (const para of src.split('\n')) {
    if (!para) { lines.push(''); continue }
    let buf = ''
    let w = 0
    for (const ch of para) {
      const cw = charWidth(ch.codePointAt(0))
      if (w + cw > cols) {
        lines.push(buf)
        buf = ''
        w = 0
      }
      buf += ch
      w += cw
    }
    if (buf) lines.push(buf)
  }
  // 连续空行压成一个，避免状态栏出现大片空白
  const out = []
  for (const l of lines) {
    if (!l && out.length && !out[out.length - 1]) continue
    out.push(l)
  }
  return out
}

/** 章节的总行数（按 columns 估算，用于进度显示） */
export function countLines(text, columns) {
  return paginate(text, columns).length
}
