/**
 * 内置浏览器的配色策略（纯函数，便于单测）。
 *
 * 为什么只能做到「容器级」：
 *  BrowserPanel 用 `<iframe src="...">` 承载网页，对 B 站、知乎这类**跨源**站点，
 *  同源策略禁止父页面读取 iframe 内部的 document，因此无法像 DarkReader
 *  那样逐元素反色。能稳定做到的是三件事：
 *
 *   1. iframe 容器与遮罩层跟随主题着色 —— 页面加载前的白底不再刺眼
 *   2. 加一层 `pointer-events:none` 的半透明遮罩压暗整块区域
 *   3. （可选）给 iframe 传 `color-scheme`，让**愿意配合**的站点走自己的暗色分支
 *
 * 第 3 条不保证生效：多数站点用媒体查询 `prefers-color-scheme` 判断深浅，
 * 这个偏好是浏览器/系统级的，父页面无法为单个 iframe 覆盖。
 */

/** 主题色板：与 App.vue 的 CSS 变量取值保持一致的兜底值 */
export const PALETTES = {
  dark: {
    /** iframe 背后的底色：页面加载中/空白时露出的颜色 */
    surface: '#1e1e1e',
    /** 遮罩颜色 */
    scrim: '#000000',
    /** 工具栏与边框 */
    chrome: '#252526',
    border: '#3c3c3c',
    text: '#cccccc',
    /** 传给 iframe 的 color-scheme 声明 */
    colorScheme: 'dark',
  },
  light: {
    surface: '#ffffff',
    scrim: '#000000',
    chrome: '#f5f5f5',
    border: '#dcdfe6',
    text: '#303133',
    colorScheme: 'light',
  },
}

/** 配色模式取值（与 settingsStore 的 BROWSER_THEMES 一致） */
export const THEME_MODES = ['auto', 'dark', 'light', 'off']

/**
 * 解析实际生效的主题。
 * @param {string} mode 'auto' | 'dark' | 'light' | 'off'
 * @param {boolean} isDarkMode 当前插件是否深色主题
 * @returns {'dark' | 'light' | 'off'}
 */
export function resolveTheme(mode, isDarkMode) {
  if (mode === 'dark' || mode === 'light' || mode === 'off') return mode
  return isDarkMode ? 'dark' : 'light'
}

/**
 * 把任意输入夹到允许的降亮区间。
 * 上限 0.6：再暗网页文字就看不清了，这不是负片滤镜该有的强度。
 */
export function clampDim(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(0.6, Math.max(0, Math.round(n * 100) / 100))
}

/**
 * 计算 iframe 容器的内联样式。
 *
 * 关键点：容器底色要先铺上，iframe 是透明覆盖在它上面的；
 * 页面加载期间 iframe 自身是白底的，遮罩层才是真正压住那片白的部分。
 */
export function buildStageStyle(theme, dim) {
  if (theme === 'off') {
    return { surface: '#ffffff', scrim: 'transparent', scrimOpacity: 0, colorScheme: 'normal' }
  }
  const palette = PALETTES[theme] || PALETTES.dark
  const opacity = clampDim(dim)
  return {
    surface: palette.surface,
    scrim: palette.scrim,
    scrimOpacity: opacity,
    colorScheme: palette.colorScheme,
  }
}

/**
 * 生成注入 iframe 的文档级样式（仅对**同源**页面有效）。
 *
 * 跨源时 `iframe.contentDocument` 是 null，调用方应先探测再注入，
 * 否则会被浏览器抛出 SecurityError。
 *
 * 这里不做逐元素反色，只做两件低风险的事：
 *  - 声明 `color-scheme`，让原生控件（滚动条、输入框）跟随深浅
 *  - 给根元素铺底色，减少纯白闪烁
 */
export function buildSameOriginCss(theme) {
  if (theme === 'off') return ''
  const palette = PALETTES[theme] || PALETTES.dark
  return [
    `html { color-scheme: ${palette.colorScheme}; }`,
    `html:not([data-xechat-colored]) { background: ${palette.surface}; }`,
  ].join('\n')
}

/** iframe 能否被注入（同源且可访问 contentDocument） */
export function canInject(frame) {
  if (!frame) return false
  try {
    return !!frame.contentDocument && !!frame.contentWindow
  } catch {
    // 跨源访问抛 SecurityError
    return false
  }
}
