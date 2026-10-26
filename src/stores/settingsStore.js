import { defineStore } from 'pinia'

const SETTINGS_KEY = 'xechat_settings_v1'

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function saveSettings(data) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(data))
}

/** 提高透明度默认快捷键：Ctrl+Alt+'+'（物理 = 键，无需 Shift，避免键位漂移） */
export const DEFAULT_SHORTCUT_PLUS = { ctrl: true, alt: true, shift: false, key: '=' }
/** 降低透明度默认快捷键：Ctrl+Alt+'-' */
export const DEFAULT_SHORTCUT_MINUS = { ctrl: true, alt: true, shift: false, key: '-' }
/** 一键切换主题默认快捷键：Ctrl+Alt+T */
export const DEFAULT_SHORTCUT_THEME = { ctrl: true, alt: true, shift: false, key: 'L' }
export const DEFAULT_SHORTCUT_OPACITY_0 = { ctrl: true, alt: true, shift: false, key: '0' }
/** 全不透明默认快捷键：Ctrl+Alt+9（与 0 相邻，避免 0/1 跨键盘两端） */
export const DEFAULT_SHORTCUT_OPACITY_1 = { ctrl: true, alt: true, shift: false, key: '9' }
/** 紧急模式默认快捷键：Ctrl+Alt+P */
export const DEFAULT_SHORTCUT_PANIC = { ctrl: true, alt: true, shift: false, key: 'P' }

const defaults = {
  /** 插件整体透明度：0.1 ~ 1，默认 1（不透明） */
  pluginOpacity: 1,
  /** 游戏面板透明度：0.1 ~ 1，默认 1（不透明），GamePanel 播放浮层使用，与设置面板联动 */
  gamePanelOpacity: 1,
  /** 提高透明度快捷键：Ctrl+Alt+'+'（= 键） */
  shortcutPlus: DEFAULT_SHORTCUT_PLUS,
  /** 降低透明度快捷键：Ctrl+Alt+'-' */
  shortcutMinus: DEFAULT_SHORTCUT_MINUS,
  /** 一键切换主题快捷键：Ctrl+Alt+T */
  shortcutTheme: DEFAULT_SHORTCUT_THEME,
  /** 透明度 0% 快捷键：Ctrl+Alt+0 */
  shortcutOpacity0: DEFAULT_SHORTCUT_OPACITY_0,
  /** 透明度 100% 快捷键：Ctrl+Alt+9 */
  shortcutOpacity1: DEFAULT_SHORTCUT_OPACITY_1,
  /** 紧急模式快捷键：Ctrl+Alt+P */
  shortcutPanic: DEFAULT_SHORTCUT_PANIC,
  /** 紧急模式内容：图片 URL 或网页地址，空则不展示内容 */
  panicUrl: '',
  /** @提醒通知等级：1 正常（ElNotification 标准卡片）/ 2 隐晦（右下角低调轻提示 3s）/ 3 关闭；默认 2（摸鱼场景低调优先） */
  msgNotify: 2,
  /** 管理员 Token：登录时作为 LOGIN 的 token 字段上报，与服务端 application.yml 的 token 一致即获得管理员权限 */
  adminToken: '',
  /**
   * 内置浏览器配色模式：
   *  - 'auto'  跟随当前主题（深色主题下套深色外壳，亮色主题下套亮色外壳）
   *  - 'dark'  始终深色外壳
   *  - 'light' 始终浅色外壳
   *  - 'off'   不做任何处理（旧行为，页面未加载时白底）
   *
   * 注意：内置浏览器是 `<iframe>`，跨源站点受同源策略保护，
   * 插件无法读写其内部 DOM，因此这里只能是**容器级**配色 +
   * 加载前底色，无法像 DarkReader 那样逐元素反色。
   */
  browserTheme: 'auto',
  /**
   * 网页降亮强度：0 ~ 0.6。
   * 通过半透明遮罩压暗 iframe 区域，缓解深色界面里整块白屏的刺眼感。
   * 0 关闭。遮罩 pointer-events: none，不影响页面内点击与滚动。
   */
  browserDim: 0.25
}

/** 合法的浏览器配色模式 */
export const BROWSER_THEMES = ['auto', 'dark', 'light', 'off']

/** 规整浏览器配色模式，非法回落到 'auto' */
export function normalizeBrowserTheme(raw) {
  return BROWSER_THEMES.includes(raw) ? raw : 'auto'
}

/** 规整降亮强度到 0 ~ 0.6 */
export function normalizeBrowserDim(raw) {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0.25
  return Math.min(0.6, Math.max(0, Math.round(n * 100) / 100))
}

/** 解析辅助：将存储值规整为 { ctrl, alt, shift, key }，非法返回 null */
export function normalizeShortcut(raw) {
  if (!raw || typeof raw !== 'object') return null
  return {
    ctrl: !!raw.ctrl,
    alt: !!raw.alt,
    shift: !!raw.shift,
    key: typeof raw.key === 'string' && raw.key ? raw.key : ''
  }
}

/** 解析辅助：格式化组合键用于展示，如 "Ctrl+Alt+Shift+-" */
export function formatShortcut(raw) {
  const s = normalizeShortcut(raw)
  if (!s || !s.key) return '未设置'
  const parts = []
  if (s.ctrl) parts.push('Ctrl')
  if (s.alt) parts.push('Alt')
  if (s.shift) parts.push('Shift')
  parts.push(s.key === ' ' ? 'Space' : s.key)
  return parts.join('+')
}

/** 解析辅助：判断 keydown 事件是否命中某组合键（修饰键严格匹配，主键忽略纯修饰键） */
export function matchShortcut(raw, event) {
  const s = normalizeShortcut(raw)
  if (!s || !s.key) return false
  if (s.key === 'Control' || s.key === 'Alt' || s.key === 'Shift' || s.key === 'Meta') return false
  if (!!event.ctrlKey !== s.ctrl) return false
  if (!!event.altKey !== s.alt) return false
  if (!!event.shiftKey !== s.shift) return false
  if (event.key === s.key) return true
  // 数字键兼容：Ctrl+Alt+Shift 组合下 event.key 可能变为符号（如 ')' 对应 0），用 e.code 兜底
  if (/^[0-9]$/.test(s.key) && event.code === 'Digit' + s.key) return true
  return false
}

/** 解析辅助：规整 @提醒通知等级，仅 1（正常）/ 2（隐晦）/ 3（关闭）合法，非法返回 null */
export function normalizeNotifyLevel(raw) {
  const lv = Number(raw)
  if (lv !== 1 && lv !== 2 && lv !== 3) return null
  return lv
}

export const useSettingsStore = defineStore('settings', {
  state: () => {
    const saved = loadSettings() || {}
    return {
      pluginOpacity: saved.pluginOpacity ?? defaults.pluginOpacity,
      gamePanelOpacity: saved.gamePanelOpacity ?? defaults.gamePanelOpacity,
      shortcutPlus: normalizeShortcut(saved.shortcutPlus) || defaults.shortcutPlus,
      shortcutMinus: normalizeShortcut(saved.shortcutMinus) || defaults.shortcutMinus,
      shortcutTheme: normalizeShortcut(saved.shortcutTheme) || defaults.shortcutTheme,
      shortcutOpacity0: normalizeShortcut(saved.shortcutOpacity0) || defaults.shortcutOpacity0,
      shortcutOpacity1: normalizeShortcut(saved.shortcutOpacity1) || defaults.shortcutOpacity1,
      shortcutPanic: normalizeShortcut(saved.shortcutPanic) || defaults.shortcutPanic,
      panicUrl: saved.panicUrl ?? defaults.panicUrl,
      msgNotify: normalizeNotifyLevel(saved.msgNotify) ?? defaults.msgNotify,
      adminToken: saved.adminToken ?? defaults.adminToken,
      browserTheme: normalizeBrowserTheme(saved.browserTheme),
      browserDim: normalizeBrowserDim(saved.browserDim)
    }
  },

  actions: {
    setPluginOpacity(value) {
      this.pluginOpacity = value
      this.persist()
    },
    setGamePanelOpacity(value) {
      this.gamePanelOpacity = value
      this.persist()
    },
    setShortcutPlus(value) {
      this.shortcutPlus = normalizeShortcut(value) || this.shortcutPlus
      this.persist()
    },
    setShortcutMinus(value) {
      this.shortcutMinus = normalizeShortcut(value) || this.shortcutMinus
      this.persist()
    },
    setShortcutTheme(value) {
      this.shortcutTheme = normalizeShortcut(value) || this.shortcutTheme
      this.persist()
    },
    setShortcutOpacity0(value) {
      this.shortcutOpacity0 = normalizeShortcut(value) || this.shortcutOpacity0
      this.persist()
    },
    setShortcutOpacity1(value) {
      this.shortcutOpacity1 = normalizeShortcut(value) || this.shortcutOpacity1
      this.persist()
    },
    setShortcutPanic(value) {
      this.shortcutPanic = normalizeShortcut(value) || this.shortcutPanic
      this.persist()
    },
    setPanicUrl(value) {
      this.panicUrl = (value || '').trim()
      this.persist()
    },
    /** 设置 @提醒通知等级：1 正常 / 2 隐晦 / 3 关闭，非法值不生效并返回 false */
    setMsgNotify(level) {
      const lv = normalizeNotifyLevel(level)
      if (lv === null) return false
      this.msgNotify = lv
      this.persist()
      return true
    },
    /** 设置管理员 Token（去首尾空白），登录时随 LOGIN 帧上报 */
    setAdminToken(value) {
      this.adminToken = (value || '').trim()
      this.persist()
    },
    /** 设置内置浏览器配色模式 */
    setBrowserTheme(value) {
      this.browserTheme = normalizeBrowserTheme(value)
      this.persist()
    },
    /** 设置网页降亮强度（0 ~ 0.6） */
    setBrowserDim(value) {
      this.browserDim = normalizeBrowserDim(value)
      this.persist()
    },
    persist() {
      saveSettings({
        pluginOpacity: this.pluginOpacity,
        gamePanelOpacity: this.gamePanelOpacity,
        shortcutPlus: this.shortcutPlus,
        shortcutMinus: this.shortcutMinus,
        shortcutTheme: this.shortcutTheme,
        shortcutOpacity0: this.shortcutOpacity0,
        shortcutOpacity1: this.shortcutOpacity1,
        shortcutPanic: this.shortcutPanic,
        panicUrl: this.panicUrl,
        msgNotify: this.msgNotify,
        adminToken: this.adminToken,
        browserTheme: this.browserTheme,
        browserDim: this.browserDim
      })
    }
  }
})
