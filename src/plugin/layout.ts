/**
 * Dock 布局模型：停靠位置、开合状态、尺寸与自动隐藏。
 * 状态持久化在 localStorage（DSH Web 客户端是浏览器环境，刷新后恢复）。
 */

/** 停靠边。 */
export type DockSide = 'left' | 'right'

/** 自动隐藏模式：off 常显 / edge 贴边滑出。 */
export type AutoHideMode = 'off' | 'edge'

/**
 * 显示状态。
 *
 * 三态而非布尔，是为了区分「收起」与「暂停」：
 *  - open     正常显示
 *  - collapsed 收起：只留活动栏，面板不渲染（不占宽度、不加载 Vue 应用）
 *  - paused   暂停：整个 dock 不渲染，保留原有宽度等设置，便于一键恢复
 *
 * `paused` 是为「点了别的侧边栏工具/按钮、希望暂时让出位置」准备的：
 * 面板展开时宽度可达 380px，如果只是置灰或遮挡，右侧内容仍会被压窄。
 */
export type DockVisibility = 'open' | 'collapsed' | 'paused'

export interface DockLayout {
  side: DockSide
  /** 面板是否展开（活动栏始终可见） */
  open: boolean
  /** 显示状态：open / collapsed / paused */
  visibility: DockVisibility
  /** 内容区宽度，像素 */
  width: number
  autoHide: AutoHideMode
}

export const MIN_WIDTH = 280
export const MAX_WIDTH = 720
export const DEFAULT_WIDTH = 380

export const DEFAULT_LAYOUT: DockLayout = {
  side: 'right',
  open: true,
  visibility: 'open',
  width: DEFAULT_WIDTH,
  autoHide: 'off',
}

const STORAGE_KEY = 'xechat-dsh:layout'

/** 把任意输入夹到合法宽度区间。 */
export function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)))
}

/**
 * 从存储值还原布局。
 * 任何非法字段都回落到默认值——存储损坏不应让插件挂掉。
 */
export function parseLayout(raw: unknown): DockLayout {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_LAYOUT }
  const source = raw as Record<string, unknown>
  // 兼容旧版存储：只有 open 布尔值，没有 visibility
  const visibility: DockVisibility =
    source.visibility === 'collapsed' || source.visibility === 'paused'
      ? source.visibility
      : source.open === false
        ? 'collapsed'
        : 'open'
  return {
    side: source.side === 'left' ? 'left' : 'right',
    open: visibility !== 'collapsed',
    visibility,
    width: typeof source.width === 'number' ? clampWidth(source.width) : DEFAULT_LAYOUT.width,
    autoHide: source.autoHide === 'edge' ? 'edge' : 'off',
  }
}

/** 读取持久化布局；存储不可用或数据损坏时返回默认值。 */
export function loadLayout(storage?: Storage): DockLayout {
  const store = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
  if (!store) return { ...DEFAULT_LAYOUT }
  try {
    const raw = store.getItem(STORAGE_KEY)
    if (raw === null) return { ...DEFAULT_LAYOUT }
    return parseLayout(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_LAYOUT }
  }
}

/** 写入持久化布局；失败静默（隐私模式等场景不应阻断 UI）。 */
export function saveLayout(layout: DockLayout, storage?: Storage): void {
  const store = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage)
  if (!store) return
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch {
    /* ignore */
  }
}

/**
 * 计算 dock 容器相对定位容器的样式。
 *
 * - open      ：活动栏 + 内容区
 * - collapsed ：只保留活动栏（面板 DOM 不存在）
 * - paused    ：宽度 0，交给 `.xds-restore` 热区，不占任何布局
 */
export function dockGeometry(layout: DockLayout, activityWidth: number) {
  const width =
    layout.visibility === 'paused'
      ? 0
      : layout.visibility === 'collapsed' || !layout.open
        ? activityWidth
        : layout.width + activityWidth
  const offset = layout.side === 'left' ? { left: 0 } : { right: 0 }
  return { width, ...offset }
}
