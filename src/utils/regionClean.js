/**
 * 鱼塘名/地区字面量清洗工具。
 * 服务端跨塘转发链路在源鱼塘名缺失时会拼出 "null -> 中国"、"null" 等字面量，
 * 前端统一在此兜底清洗，避免用户界面出现 null 字样。
 */

/**
 * 清洗 shortRegion：剔除 null/空段后按 " -> " 重组。
 * "null -> 中国"  → "中国"
 * "null -> null"  → ""
 * "江苏 -> 中国"  → "江苏 -> 中国"
 * "" / null       → ""
 */
export function cleanShortRegion(region) {
  if (typeof region !== 'string') return ''
  return region
    .split('->')
    .map((s) => (s || '').trim())
    .filter((s) => s && s.toLowerCase() !== 'null')
    .join(' -> ')
}

/**
 * 拆分 shortRegion 中的"源塘名 -> 地区"结构。
 * 服务端跨塘聚合后，外塘用户 shortRegion 带 "源塘名 -> 省" 前缀（见 forward-cross-pond §8.2），
 * 本塘用户无该前缀。前端据此做跨塘分组展示与 @ 候选区分。
 * "大菠萝鱼塘 -> 江苏" → { pond: '大菠萝鱼塘', region: '江苏' }
 * "江苏"              → { pond: '', region: '江苏' }
 * "" / null           → { pond: '', region: '' }
 */
export function splitRegion(region) {
  const cleaned = cleanShortRegion(region)
  if (!cleaned) return { pond: '', region: '' }
  const idx = cleaned.indexOf(' -> ')
  if (idx < 0) return { pond: '', region: cleaned }
  return { pond: cleaned.slice(0, idx), region: cleaned.slice(idx + 4) }
}

/**
 * 清洗系统提示文本中残留的 null 来源标签。
 * 仅处理方括号/书名号形式的来源标签；标签内容不含 null 时原样保留，
 * 避免误伤 markdown 链接等正常正文；标签清洗后为空则整个删除。
 * "[null] 用户 [xx] 上线了"        → "用户 [xx] 上线了"
 * "[null -> 中国] 用户 xx 上线了"  → "[中国] 用户 xx 上线了"（保留真实地区）
 */
export function stripSystemNullTag(text) {
  if (typeof text !== 'string') return text || ''
  return text.replace(/[\[【]([^\]】]*)[\]】]/g, (whole, inner) => {
    if (inner == null || inner.trim() === '') return whole
    const cleaned = cleanShortRegion(inner)
    // 标签内容清洗后为空（如 [null]、【null】）→ 整个标签删除
    if (!cleaned) return ''
    // 标签原本含 null（服务端拼接的来源链）才允许重写为清洗结果
    if (/\bnull\b/i.test(inner)) {
      return '[' + cleaned + ']'
    }
    return whole
  })
}
