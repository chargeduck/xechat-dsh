<template>
  <!-- IMAGE 类型消息：展示下载图片按钮，点击后才加载展示 -->
  <div v-if="msgType === 'IMAGE' && fileName" class="image-msg">
    <div v-if="content" class="image-msg-head">{{ content }}</div>
    <div v-if="!imageLoaded" class="image-msg-actions">
      <el-button size="small" type="primary" @click="loadImage">{{ isDirectImage ? '查看图片' : '下载图片' }}</el-button>
    </div>
    <div v-else class="image-msg-preview">
      <img :src="imageSrc" alt="图片" @click="previewImage(imageSrc)" />
      <span class="image-msg-close" title="收起图片" @click="imageLoaded = false">×</span>
    </div>
  </div>

  <!-- TEXT 消息含 markdown 图片：默认折叠为查看图片 -->
  <div v-else-if="hasMarkdownImage && !showImage" class="image-only-placeholder">
    <el-button size="small" @click="showImage = true">查看图片</el-button>
  </div>
  <!-- TEXT 消息含 markdown 图片：展开后右上角可收起 -->
  <div v-else-if="hasMarkdownImage && showImage" class="markdown-image-expanded">
    <div class="markdown-body message-markdown" v-html="renderedHtml" @click="onContentClick"></div>
    <span class="image-msg-close" title="收起图片" @click="showImage = false">×</span>
  </div>
  <div v-else class="markdown-body message-markdown" v-html="renderedHtml" @click="onContentClick"></div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import MarkdownIt from 'markdown-it'
import container from 'markdown-it-container'
import { full as markdownItEmoji } from 'markdown-it-emoji'
import { ElMessageBox } from 'element-plus'
import { transport } from '../transport/transport-manager.js'
import { useServerStore } from '../stores/serverStore.js'

const props = defineProps({
  content: { type: String, required: true },
  msgType: { type: String, default: '' },
  fileName: { type: String, default: '' }
})

const showImage = ref(false)
const imageLoaded = ref(false)
const serverStore = useServerStore()

// 内容变化时重置图片展开状态
watch(() => props.content, () => { showImage.value = false; imageLoaded.value = false })

const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false
})

// ===== XSS 净化（白名单策略，与后端 XssFilterUtil 对齐）=====
const SAFE_TAGS = new Set(['b', 'i', 'u', 's', 'em', 'strong', 'span', 'font', 'code', 'pre',
  'p', 'br', 'hr', 'blockquote', 'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const SAFE_CSS_PROPS = new Set(['color', 'background', 'background-color', 'background-image',
  'text-shadow', 'font-weight', 'font-style', 'font-size', 'font-family',
  'text-decoration', 'line-height', 'letter-spacing', 'border',
  'border-radius', 'padding', 'margin', 'text-align'])
const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?\s*\/?)?>/g
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g

function escapeHtmlText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttrValue(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function isSafeUrl(url) {
  const u = String(url || '').trim().toLowerCase()
  return !u.includes('javascript:') && !u.includes('vbscript:') && !u.includes('data:') && !u.startsWith('file:')
}

function isAllowedAttr(tag, name) {
  switch (tag) {
    case 'font': return name === 'color'
    case 'span': return name === 'style' || name === 'title'
    case 'a': return name === 'href' || name === 'title'
    case 'img': return name === 'src' || name === 'alt' || name === 'title' || name === 'width' || name === 'height'
    case 'td':
    case 'th': return name === 'colspan' || name === 'rowspan' || name === 'align'
    case 'table': return name === 'border' || name === 'align'
    case 'ul':
    case 'ol': return name === 'type' || name === 'start'
    default: return name === 'title'
  }
}

function sanitizeStyle(style) {
  const raw = String(style || '')
  const out = []
  for (const part of raw.split(';')) {
    const idx = part.indexOf(':')
    if (idx <= 0) continue
    const prop = part.slice(0, idx).trim().toLowerCase()
    const val = part.slice(idx + 1).trim()
    if (!SAFE_CSS_PROPS.has(prop)) continue
    const vl = val.toLowerCase()
    if (vl.includes('expression') || vl.includes('javascript:') || vl.includes('url(')
        || vl.includes('@import') || vl.includes('behavior')) continue
    out.push(prop + ': ' + val)
  }
  return out.join('; ')
}

// 白名单净化原始 HTML 片段：白名单标签/属性保留，其余转义为实体
function sanitizeHtml(html) {
  if (!html) return ''
  return String(html).replace(TAG_RE, (full, slash, tag, attrsRaw) => {
    const t = tag.toLowerCase()
    if (!SAFE_TAGS.has(t)) return escapeHtmlText(full)
    if (slash) return '</' + t + '>'
    const selfClose = full.trim().endsWith('/>')
    let attrs = ''
    ATTR_RE.lastIndex = 0
    let am
    while ((am = ATTR_RE.exec(attrsRaw || '')) !== null) {
      const name = am[1].toLowerCase()
      const value = am[2] != null ? am[2] : (am[3] != null ? am[3] : (am[4] != null ? am[4] : ''))
      if (name.startsWith('on')) continue
      if (name === 'style') {
        const safe = sanitizeStyle(value)
        if (safe) attrs += ' style="' + escapeAttrValue(safe) + '"'
        continue
      }
      if (name === 'href' || name === 'src') {
        if (!isSafeUrl(value)) continue
        attrs += ' ' + name + '="' + escapeAttrValue(value) + '"'
        continue
      }
      if (!isAllowedAttr(t, name)) continue
      attrs += ' ' + name + '="' + escapeAttrValue(value) + '"'
    }
    return '<' + t + attrs + (selfClose ? '/>' : '>')
  })
}

// 原始 HTML 通道（html:true 透传）统一走白名单净化
md.renderer.rules.html_inline = (tokens, idx) => sanitizeHtml(tokens[idx].content)
md.renderer.rules.html_block = (tokens, idx) => sanitizeHtml(tokens[idx].content)

// VitePress 风格提示块：::: info / ::: warn / ::: error
function createContainer(type, defaultLabel) {
  md.use(container, type, {
    render: (tokens, idx) => {
      const token = tokens[idx]
      if (token.nesting === 1) {
        // 从 info 中提取自定义标题：::: info XEChat → 标题为 XEChat
        const infoParts = token.info.trim().split(' ')
        const label = infoParts.length > 1 ? infoParts.slice(1).join(' ') : defaultLabel
        return `<div class="admonition ${type}">\n<p class="admonition-title">${label}</p>\n`
      }
      return '</div>\n'
    }
  })
}
createContainer('info', 'INFO')
createContainer('warn', 'WARN')
createContainer('error', 'ERROR')

// emoji shortcode 支持 :smile: → 😄
md.use(markdownItEmoji)

// 链接渲染：统一标记 md-external-link；[] 内无文本时展示“⚠️未知网站谨慎打开”
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  // 协议白名单：拦截 javascript:/data:/vbscript: 等危险链接
  const href = tokens[idx].attrGet('href') || ''
  if (!isSafeUrl(href)) {
    tokens[idx].attrSet('href', '#')
    tokens[idx].attrSet('data-blocked-link', '1')
  }
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('class', 'md-external-link')
  // 判断链接内是否有可见文本（[] 是否填写了内容）
  let hasText = false
  for (let i = idx + 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'link_close') break
    if (t.type === 'text' && t.content.trim()) { hasText = true; break }
  }
  let html = self.renderToken(tokens, idx, options)
  if (!hasText) {
    html += '<span class="unknown-link-tip">⚠️未知网站谨慎打开</span>'
  }
  return html
}

// 图片渲染：拦截危险协议的 src
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const src = tokens[idx].attrGet('src') || ''
  if (!isSafeUrl(src)) {
    tokens[idx].attrSet('src', '')
    tokens[idx].attrSet('alt', (tokens[idx].attrGet('alt') || '') + ' [已拦截不安全图片]')
  }
  return self.renderToken(tokens, idx, options)
}

function preprocessFont(text) {
  return text.replace(/<font\s+color=([\'"]?)(\w+)\1\s*>(.*?)<\/font>/g,
    (_, _q, color, content) => `<span style="color:${color}">${content}</span>`
  )
}

// 解析 markdown 图片地址：相对文件名（uuid.png）拼 ip:port/download 完整地址，http(s) 直链原样返回
function resolveImageUrl(rawUrl) {
  const trimmed = (rawUrl || '').trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  const base = getDownloadBase()
  if (!base) return trimmed
  return base + '/download/' + encodeURIComponent(trimmed)
}

const renderedHtml = computed(() => {
  if (!props.content) return ''
  // TEXT 消息中 markdown 图片：把相对文件名修正为 ip:port/download/xxx 完整地址
  const processed = props.content.replace(/!\[([^]]*)\]\(([^)]+)\)/g, (m, alt, url) => {
    return `![${alt}](${resolveImageUrl(url)})`
  })
  return md.render(preprocessFont(processed))
})

// IMAGE 消息：http(s) 直链原样展示；相对文件名由当前登录服务器推导 http 下载地址
const isDirectImage = computed(() => {
  if (!props.fileName) return false
  return /^https?:\/\//i.test(props.fileName)
})

const imageSrc = computed(() => {
  if (props.msgType !== 'IMAGE' || !props.fileName) return ''
  if (/^https?:\/\//i.test(props.fileName)) return props.fileName
  const base = getDownloadBase()
  if (!base) return ''
  return base + '/download/' + encodeURIComponent(props.fileName)
})

// 点击“下载图片”按钮后加载展示
function loadImage() {
  if (!imageSrc.value) return
  imageLoaded.value = true
}

// TEXT 消息含 markdown 图片 ![]() 时折叠为“查看图片”
const hasMarkdownImage = computed(() => {
  if (!props.content) return false
  return /!\[[^]]*\]\([^)]+\)/.test(props.content)
})

function getDownloadBase() {
  // 优先取 Pinia 中 #login 前置解析的当前登录服务器
  const cur = serverStore.current
  if (cur && cur.host && cur.port) {
    // 纯 WebSocket 模式：图片下载服务在 ws 端口 = 登录端口 + 1
    const port = parseInt(cur.port) + 1
    return 'http://' + cur.host + ':' + port
  }
  // 兜底：ws 模式未设置时从 transport.wsUrl 推导
  const wsUrl = transport.wsUrl
  if (!wsUrl) return ''
  return wsUrl.replace(/^ws:\/\//, 'http://').replace(/\/xechat.*$/, '')
}

function previewImage(url) {
  if (url) window.open(url, '_blank')
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// markdown 内容点击：链接弹风险确认框，确认后才跳转；图片点击新窗口查看原图
function onContentClick(e) {
  const link = e.target.closest('a.md-external-link')
  if (link) {
    e.preventDefault()
    e.stopPropagation()
    const url = link.getAttribute('href') || ''
    if (link.getAttribute('data-blocked-link') || !isSafeUrl(url)) {
      ElMessageBox.alert('该链接协议不安全，已阻止跳转。', '⚠️ 链接已被拦截', { type: 'warning' }).catch(() => {})
      return
    }
    ElMessageBox.confirm(
      `<div class="link-risk-tip">
        <p>该链接指向外部网站，可能存在风险，请确认是否继续访问：</p>
        <p class="link-risk-url">${escapeHtml(url)}</p>
      </div>`,
      '⚠️ 外部链接风险提示',
      {
        dangerouslyUseHTMLString: true,
        confirmButtonText: '确认跳转',
        cancelButtonText: '取消',
        type: 'warning'
      }
    ).then(() => {
      window.open(url, '_blank')
    }).catch(() => {})
    return
  }
  const img = e.target.closest('img')
  if (img && img.src) {
    window.open(img.src, '_blank')
  }
}
</script>

<style scoped>
.image-msg-head {
  font-size: 12px;
  color: #909399;
  margin-bottom: 6px;
}
.image-msg-preview {
  position: relative;
  display: inline-block;
}
.image-msg-preview img {
  max-width: 260px;
  max-height: 260px;
  border-radius: 6px;
  cursor: zoom-in;
  display: block;
}
.image-msg-close {
  position: absolute;
  top: -8px;
  right: -8px;
  width: 20px;
  height: 20px;
  line-height: 18px;
  text-align: center;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  border-radius: 50%;
  cursor: pointer;
  font-size: 14px;
  user-select: none;
}
.image-msg-close:hover {
  background: rgba(0, 0, 0, 0.75);
}
.markdown-image-expanded {
  position: relative;
  display: inline-block;
  max-width: 100%;
}
</style>

<!-- v-html 渲染内容与 ElMessageBox（body 下挂载）不受 scoped 约束，样式放全局 -->
<style>
.unknown-link-tip {
  color: #e6a23c;
  font-size: 12px;
  border-bottom: 1px dashed #e6a23c;
  cursor: pointer;
}
.markdown-body .md-external-link {
  color: #409eff;
  text-decoration: none;
}
.link-risk-tip {
  font-size: 14px;
  line-height: 1.6;
}
.link-risk-tip .link-risk-url {
  margin-top: 8px;
  padding: 8px 10px;
  background: #f5f7fa;
  border-radius: 4px;
  color: #606266;
  word-break: break-all;
  user-select: all;
  font-family: monospace;
}
</style>
