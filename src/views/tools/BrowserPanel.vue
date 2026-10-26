<template>
  <div class="browser-panel">
    <!-- 地址栏工具条 -->
    <div class="browser-bar">
      <button class="bar-btn" :disabled="!canGoBack" title="后退" @click="goBack">
        <el-icon><ArrowLeft/></el-icon>
      </button>
      <button class="bar-btn" :disabled="!canGoForward" title="前进" @click="goForward">
        <el-icon><ArrowRight/></el-icon>
      </button>
      <button class="bar-btn" :disabled="!currentUrl" title="刷新" @click="reload">
        <el-icon><RefreshRight/></el-icon>
      </button>
      <input
        v-model="inputUrl"
        class="url-input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="输入网址后回车，如 localhost:5173、example.com"
        @keydown.enter="navigate(inputUrl)"
      />
      <button class="bar-btn" title="前往" @click="navigate(inputUrl)">
        <el-icon><Right/></el-icon>
      </button>
      <button class="bar-btn" :disabled="!resolvedUrl" title="用系统浏览器打开（站点禁止被嵌入 / 视频播放时使用）" @click="openInSystem">
        <el-icon><TopRight/></el-icon>
      </button>
    </div>

    <!-- 预设条：内嵌地址预设 / 收藏，以及视频站点的系统浏览器快捷入口 -->
    <div class="preset-bar">
      <span class="group-label">内嵌</span>
      <button
        v-for="bm in bookmarks"
        :key="bm.url"
        class="preset-chip"
        :class="{ active: currentUrl === bm.url }"
        :title="bm.url"
        @click="navigate(bm.url)"
      >
        <span class="chip-text">{{ bm.name }}</span>
        <span class="chip-del" title="取消收藏" @click.stop="removeBookmark(bm)">×</span>
      </button>
      <button
        v-if="!bookmarks.length"
        class="preset-chip ghost"
        title="恢复默认预设"
        @click="resetBookmarks"
      >恢复默认</button>
      <button
        class="preset-chip ghost"
        :disabled="!currentUrl"
        title="把当前地址加入预设"
        @click="addBookmark"
      >＋ 收藏当前页</button>

      <span class="group-sep"></span>

      <span class="group-label">系统浏览器</span>
      <button
        v-for="p in EXTERNAL_PRESETS"
        :key="p.url"
        class="preset-chip external"
        :title="p.url + '（站点禁止被嵌入，用系统浏览器打开）'"
        @click="openExternal(p.url)"
      >{{ p.name }}</button>
      <button
        class="preset-chip external"
        title="按 BV 号打开 B 站视频（视频无法内嵌播放，走系统浏览器）"
        @click="tpl = BILIBILI_TPL"
      >B 站视频…</button>
      <button
        class="preset-chip ghost"
        title="实测本宿主支持哪些音视频编解码（两个宿主的支持矩阵不同）"
        @click="toggleCodecCheck"
      >编解码自检</button>
    </div>

    <!-- 编解码自检：IDEA(JCEF) 与 VS Code(Webview) 的支持矩阵不同，用本机实测取代推测 -->
    <div v-if="codecChecks" class="codec-row">
      <span
        v-for="item in codecChecks"
        :key="item.label"
        class="codec-tag"
        :class="{ ok: !!item.result }"
        :title="'canPlayType → ' + (item.result || '空（不支持）')"
      >{{ item.label }} {{ item.result ? '✓' : '✗' }}</span>
      <span class="codec-verdict">{{ codecVerdict }}</span>
      <button class="tip-close" title="关闭" @click="codecChecks = null">×</button>
    </div>

    <!-- 视频模板输入行：拼出地址后交系统浏览器（两个宿主的编解码支持都不完整） -->
    <div v-if="tpl" class="tpl-row">
      <span class="tpl-label">{{ tpl.name }}</span>
      <input
        v-model="tplValue"
        class="tpl-input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        :placeholder="tpl.placeholder"
        @keydown.enter="applyTemplate"
      />
      <button class="tpl-btn primary" :disabled="!tplValue.trim()" @click="applyTemplate">系统浏览器打开</button>
      <button class="tpl-btn" @click="closeTemplate">取消</button>
    </div>

    <!-- 框架策略 / 编解码提示：站点拒绝被 iframe 嵌入时页面会空白，这里给出兜底出口 -->
    <div v-if="tipVisible" class="browser-tip">
      <span class="tip-text">
        能内嵌的只有为嵌入而生的页面：多数站点（bilibili 主站 / 知乎 / 淘宝等）会用
        <code>X-Frame-Options</code> 或 CSP <code>frame-ancestors</code> 拒绝被内嵌，页面会空白。
        另外两端自带 webview 的编解码支持都不完整（IDEA 缺 H.264、VS Code 缺 AAC），
        <strong>视频一律用系统浏览器打开</strong>（右上角箭头）；想确认本宿主到底支持什么，点上方「编解码自检」。
      </span>
      <button class="tip-close" title="不再提示" @click="dismissTip">×</button>
    </div>

    <div
      class="browser-stage"
      :data-browser-theme="browserTheme"
      :style="{ background: stageTheme.surface }"
    >
      <iframe
        v-if="currentUrl"
        ref="frameRef"
        :key="reloadKey"
        :src="currentUrl"
        class="browser-frame"
        :style="{ colorScheme: stageTheme.colorScheme }"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-presentation allow-downloads allow-pointer-lock"
        allowfullscreen
      ></iframe>
      <div v-else class="browser-empty">
        <div class="empty-title">浏览器</div>
        <div class="empty-tip">在上方输入网址回车即可加载，地址会被记住。</div>
        <div class="empty-tip">也可以直接用上面的预设：内嵌地址（本地服务）或系统浏览器快捷入口。</div>
      </div>
      <!-- 降亮遮罩：压暗整块网页，缓解深色界面里的白屏刺眼感。
           pointer-events:none 保证页面内点击、滚动、拖选都不受影响。 -->
      <div
        v-if="currentUrl && stageTheme.scrimOpacity > 0"
        class="browser-scrim"
        :style="{ background: stageTheme.scrim, opacity: stageTheme.scrimOpacity }"
        aria-hidden="true"
      ></div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { openExternal } from '@/api.js'
import { isDark } from '@/composables/useTheme.js'
import { useSettingsStore } from '@/stores/settingsStore.js'
import { resolveTheme, buildStageStyle, buildSameOriginCss, canInject } from '@/composables/browserTheme.js'

/** 上次访问地址 / 提示条已关闭标记 / 收藏列表 */
const URL_KEY = 'xechat_browser_url'
const TIP_KEY = 'xechat_browser_tip_dismissed'
const BOOKMARK_KEY = 'xechat_browser_bookmarks'

/** 内嵌预设的出厂值：只放「一定允许被嵌入」的本地服务地址，避免塞入会被 XFO 拒绝的站点 */
const DEFAULT_BOOKMARKS = [
  { name: '本地 5173', url: 'http://localhost:5173' },
  { name: '本地 3000', url: 'http://localhost:3000' },
  { name: '本地 8080', url: 'http://localhost:8080' }
]

/** 视频站点：webview 无 H.264 编解码，内嵌播放不出画，只能走系统浏览器 */
const EXTERNAL_PRESETS = [
  { name: 'B 站', url: 'https://www.bilibili.com' },
  { name: '抖音', url: 'https://www.douyin.com' },
  { name: 'YouTube', url: 'https://www.youtube.com' }
]

/** BV 号 → 视频页地址（直链粘贴则原样使用） */
const BILIBILI_TPL = {
  name: 'B 站视频',
  placeholder: '如 BV1xx411c7mD，也可直接粘贴完整地址',
  build(value) {
    const s = (value || '').trim()
    if (!s) return ''
    if (/^https?:\/\//i.test(s)) return s
    return 'https://www.bilibili.com/video/' + (/^bv/i.test(s) ? s : 'BV' + s)
  }
}

function readStorage(key) {
  try {
    return localStorage.getItem(key) || ''
  } catch (e) {
    return ''
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value)
  } catch (e) { /* ignore */ }
}

function loadBookmarks() {
  const raw = readStorage(BOOKMARK_KEY)
  if (!raw) return DEFAULT_BOOKMARKS.slice()
  try {
    const list = JSON.parse(raw)
    if (Array.isArray(list)) {
      return list.filter(item => item && item.url)
    }
  } catch (e) { /* ignore */ }
  return DEFAULT_BOOKMARKS.slice()
}

const currentUrl = ref(readStorage(URL_KEY))
const inputUrl = ref(currentUrl.value)

/* ---------------- 配色 ---------------- */

const settingsStore = useSettingsStore()

/** 实际生效的主题：auto 跟随插件当前深浅色 */
const browserTheme = computed(() => resolveTheme(settingsStore.browserTheme, isDark.value))

/** 容器与遮罩的内联样式 */
const stageTheme = computed(() => buildStageStyle(browserTheme.value, settingsStore.browserDim))

/** iframe 元素引用，用于同源注入 */
const frameRef = ref(null)

/**
 * 给同源页面注入 `<html>` 的 color-scheme 与底色。
 *
 * 跨源站点访问 contentDocument 会抛 SecurityError，因此先探测；
 * 探测失败静默跳过——这不是错误，是浏览器的安全模型在正常工作。
 * 每次 iframe 重建（reloadKey 变化）都要重新注入，因为 iframe 换了新文档。
 */
function syncFrameColorScheme() {
  const frame = frameRef.value
  if (!canInject(frame)) return
  const doc = frame.contentDocument
  if (!doc || !doc.head) return
  const attr = 'data-xechat-color-scheme'
  let tag = doc.head.querySelector(`style[${attr}]`)
  if (!tag) {
    tag = doc.createElement('style')
    tag.setAttribute(attr, '')
    doc.head.appendChild(tag)
  }
  tag.textContent = buildSameOriginCss(browserTheme.value)
}

watch([browserTheme, reloadKey], () => {
  nextTick(syncFrameColorScheme)
})

onMounted(() => {
  syncFrameColorScheme()
})
const tipVisible = ref(readStorage(TIP_KEY) !== '1')
const bookmarks = ref(loadBookmarks())
const tpl = ref(null)
const tplValue = ref('')

/**
 * 编解码自检：两个宿主的支持矩阵不同，别用推测回答「能不能直接播放视频」——
 * IDEA 的 JCEF 默认构建不含 H.264（专利原因）；VS Code 的 Webview 支持 H.264 但缺 AAC 音频。
 * 这里用 canPlayType 在本机实测，空字符串 = 不支持，maybe / probably = 支持。
 */
const CODEC_PROBES = [
  { label: 'H.264', type: 'video/mp4; codecs="avc1.42E01E"' },
  { label: 'AAC', type: 'audio/mp4; codecs="mp4a.40.2"' },
  { label: 'VP8', type: 'video/webm; codecs="vp8"' },
  { label: 'VP9', type: 'video/webm; codecs="vp9"' },
  { label: 'Opus', type: 'audio/webm; codecs="opus"' },
  { label: 'HEVC', type: 'video/mp4; codecs="hvc1"' }
]
const codecChecks = ref(null)

function toggleCodecCheck() {
  if (codecChecks.value) {
    codecChecks.value = null
    return
  }
  const probe = document.createElement('video')
  codecChecks.value = CODEC_PROBES.map(item => ({
    label: item.label,
    result: probe.canPlayType(item.type) || ''
  }))
}

const codecVerdict = computed(() => {
  const list = codecChecks.value
  if (!list) return ''
  const has = label => {
    const item = list.find(i => i.label === label)
    return !!(item && item.result)
  }
  const h264 = has('H.264')
  const aac = has('AAC')
  if (h264 && aac) return '本宿主 H.264 / AAC 齐全，普通 MP4 可直接播放。'
  if (h264 && !aac) return '本宿主能解 H.264 但缺 AAC：MP4 有画面、无声音（VS Code Webview 属此类）。'
  if (!h264) return '本宿主缺 H.264：主流 MP4 / 播放器不出画，只能试 WebM(VP8/VP9) 或走系统浏览器（JCEF 属此类）。'
  return ''
})

/**
 * 自有导航历史栈。
 * 说明：iframe 内是跨源站点，`contentWindow.history` 不可访问，
 * 因此「后退/前进」只能覆盖本面板内的导航，站内点击无法感知——这是浏览器同源策略的硬限制。
 */
const history = ref(currentUrl.value ? [currentUrl.value] : [])
const cursor = ref(currentUrl.value ? 0 : -1)
/** 变更即强制重建 iframe，等价于整页刷新 */
const reloadKey = ref(0)

const canGoBack = computed(() => cursor.value > 0)
const canGoForward = computed(() => cursor.value >= 0 && cursor.value < history.value.length - 1)
/** 地址栏没回车的场景下也能按当前输入打开系统浏览器 */
const resolvedUrl = computed(() => currentUrl.value || normalizeUrl(inputUrl.value))

/** 规整输入：补全协议；localhost / 内网 IP 走 http，其余默认 https */
function normalizeUrl(raw) {
  const url = (raw || '').trim()
  if (!url) return ''
  if (/^(https?|about|data|blob):/i.test(url)) return url
  if (/^(localhost|127\.0\.0\.1|\[?::1\]?)(:\d+)?([/?#]|$)/i.test(url)) return 'http://' + url
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#]|$)/.test(url)) return 'http://' + url
  return 'https://' + url
}

/** 落地一个地址：更新状态 + 持久化 + 强制重建 iframe */
function apply(url) {
  currentUrl.value = url
  inputUrl.value = url
  reloadKey.value += 1
  writeStorage(URL_KEY, url)
}

function navigate(raw) {
  const url = normalizeUrl(raw)
  if (!url) return
  if (url === currentUrl.value) {
    reload()
    return
  }
  history.value = history.value.slice(0, cursor.value + 1)
  history.value.push(url)
  cursor.value = history.value.length - 1
  apply(url)
}

function goBack() {
  if (!canGoBack.value) return
  cursor.value -= 1
  apply(history.value[cursor.value])
}

function goForward() {
  if (!canGoForward.value) return
  cursor.value += 1
  apply(history.value[cursor.value])
}

function reload() {
  if (!currentUrl.value) return
  reloadKey.value += 1
}

/** 站点禁止被嵌入时的出口：宿主原生浏览器优先，纯 Web 回退 window.open */
function openInSystem() {
  const url = resolvedUrl.value
  if (!url) return
  openExternal(url)
}

/** 当前页加入预设：名字取主机名（含端口），去重 */
function addBookmark() {
  if (!currentUrl.value) return
  let name = currentUrl.value
  try {
    const u = new URL(currentUrl.value)
    name = u.host
  } catch (e) { /* 保持原样 */ }
  if (bookmarks.value.some(b => b.url === currentUrl.value)) return
  bookmarks.value = bookmarks.value.concat([{ name, url: currentUrl.value }])
  persistBookmarks()
}

function removeBookmark(target) {
  bookmarks.value = bookmarks.value.filter(b => b.url !== target.url)
  persistBookmarks()
}

function resetBookmarks() {
  bookmarks.value = DEFAULT_BOOKMARKS.slice()
  persistBookmarks()
}

function persistBookmarks() {
  writeStorage(BOOKMARK_KEY, JSON.stringify(bookmarks.value))
}

function closeTemplate() {
  tpl.value = null
  tplValue.value = ''
}

function applyTemplate() {
  if (!tpl.value) return
  const url = tpl.value.build(tplValue.value)
  if (!url) return
  openExternal(url)
  closeTemplate()
}

function dismissTip() {
  tipVisible.value = false
  writeStorage(TIP_KEY, '1')
}
</script>

<style lang="scss" scoped>
.browser-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
}

.browser-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex: none;
}

.bar-btn {
  width: 28px;
  height: 26px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    border-color: var(--accent-color);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}

.url-input {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  outline: none;

  &:focus {
    border-color: var(--accent-color);
  }
}

/* 预设条 */
.preset-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  padding: 5px 8px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex: none;
}

.group-label {
  font-size: 11px;
  color: var(--text-muted);
  flex: none;
}

.group-sep {
  width: 1px;
  height: 14px;
  margin: 0 2px;
  background: var(--border-color);
  flex: none;
}

.preset-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 180px;
  height: 22px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 1;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 11px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    border-color: var(--accent-color);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &.active {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  &.ghost {
    border-style: dashed;
    color: var(--text-muted);
  }

  &.external {
    color: var(--text-muted);
  }
}

.chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chip-del {
  flex: none;
  font-size: 13px;
  line-height: 1;
  color: var(--text-muted);

  &:hover {
    color: #f56c6c;
  }
}

/* 编解码自检结果 */
.codec-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  padding: 5px 8px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
  flex: none;
}

.codec-tag {
  flex: none;
  padding: 1px 6px;
  font-size: 11px;
  line-height: 16px;
  border-radius: 3px;
  color: var(--text-muted);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);

  &.ok {
    color: #67c23a;
    border-color: #67c23a;
  }
}

.codec-verdict {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-secondary);
}

/* 模板输入行 */
.tpl-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
  flex: none;
}

.tpl-label {
  flex: none;
  font-size: 11px;
  color: var(--text-secondary);
}

.tpl-input {
  flex: 1;
  min-width: 0;
  height: 24px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  outline: none;

  &:focus {
    border-color: var(--accent-color);
  }
}

.tpl-btn {
  flex: none;
  height: 24px;
  padding: 0 8px;
  font-size: 11px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;

  &:hover:not(:disabled) {
    border-color: var(--accent-color);
    color: var(--text-primary);
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &.primary {
    color: #fff;
    background: var(--accent-color);
    border-color: var(--accent-color);
  }
}

.browser-tip {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 10px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-muted);
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
  flex: none;

  code {
    font-size: 11px;
    color: var(--text-secondary);
  }

  strong {
    color: var(--text-secondary);
    font-weight: 600;
  }
}

.tip-text {
  flex: 1;
  min-width: 0;
}

.tip-close {
  flex: none;
  padding: 0 4px;
  font-size: 14px;
  line-height: 1;
  color: var(--text-muted);
  background: none;
  border: none;
  cursor: pointer;

  &:hover {
    color: var(--text-primary);
  }
}

.browser-stage {
  flex: 1;
  min-height: 0;
  position: relative;
  /* 底色由 stageTheme 内联给出：页面加载中/空白时不再露出纯白 */
  background: var(--bg-primary);
  transition: background-color 0.2s;
}

.browser-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
  /* 兜底：不设置时浏览器默认白底 */
  background: transparent;
}

/* 降亮遮罩：覆盖在 iframe 之上，不吃任何指针事件 */
.browser-scrim {
  position: absolute;
  inset: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}

.browser-empty {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 24px;
  text-align: center;
  color: var(--text-muted);
}

.empty-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-secondary);
}

.empty-tip {
  font-size: 12px;
  line-height: 1.6;
}
</style>
