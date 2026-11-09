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
  /**
   * 内容区高度，像素；`null` = 铺满可用高度（默认，跟随窗口）。
   *
   * 用户把底部边缘往上拖之后才会有具体数值。之所以用 null 而不是某个哨兵值，
   * 是为了让「铺满」在窗口缩放时继续自适应——存成像素反而会在换屏后留白或溢出。
   */
  height: number | null
  /**
   * 面板顶边相对「顶部安全距离」的向下偏移，像素。
   *
   * 只调高度不足以表达「抓住上沿往下拖」：容器是 `top` 锚定的，
   * 单纯改 height 会让**底边**往上跑（视觉上整个面板缩到右上角）。
   * 拖上沿时同步增大这个偏移，就能让顶边跟着鼠标走、底边保持不动；
   * 拖下沿或输入 px 时它保持不变，顶边自然固定。
   *
   * `height === null`（铺满）时该值恒为 0。
   */
  topOffset: number
  autoHide: AutoHideMode
}

export const MIN_WIDTH = 280
export const MAX_WIDTH = 720
export const DEFAULT_WIDTH = 380

/** 拖拽高度的下限：再矮就连输入框和消息都放不下了。 */
export const MIN_HEIGHT = 240
/**
 * 拖拽高度的硬上限。真实上限还要按视口高度再夹一次（见 resolveHeight），
 * 这里的值只用于拦住明显不可能的数字。
 */
export const MAX_HEIGHT = 4000

export const DEFAULT_LAYOUT: DockLayout = {
  side: 'right',
  open: true,
  visibility: 'open',
  width: DEFAULT_WIDTH,
  height: null,
  topOffset: 0,
  autoHide: 'off',
}

const STORAGE_KEY = 'xechat-dsh:layout'

/** 把任意输入夹到合法宽度区间。 */
export function clampWidth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_WIDTH
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)))
}

/**
 * 把任意输入夹到合法高度区间。
 *
 * `available` 是当前可用高度（视口减去标题栏与底部留白）。传 0 或不传时
 * 只按 MIN/MAX_HEIGHT 夹。返回值一定 ≥ MIN_HEIGHT —— 视口比下限还矮时
 * 宁可溢出也不把面板压成一条缝（此时面板本来也没法用）。
 */
export function clampHeight(value: number, available = MAX_HEIGHT): number {
  const upper = Number.isFinite(available) && available > 0 ? Math.max(MIN_HEIGHT, available) : MAX_HEIGHT
  if (!Number.isFinite(value)) return MIN_HEIGHT
  return Math.min(Math.min(MAX_HEIGHT, upper), Math.max(MIN_HEIGHT, Math.round(value)))
}

/**
 * 顶边偏移的合法区间：[0, 可用高度 - 面板高度]。
 *
 * 窗口变矮或用户把高度调大后，旧的偏移会把面板底边顶出可视区，
 * 渲染前必须重新夹一次（不改写存储值，窗口拉回来仍恢复用户的位置）。
 */
export function clampTopOffset(value: number, height: number, available: number): number {
  const upper = Math.max(0, available - height)
  if (!Number.isFinite(value)) return 0
  return Math.min(upper, Math.max(0, Math.round(value)))
}

/** 一次高度拖拽的起始快照。 */
export interface HeightDragStart {
  /** 按下时的指针 Y（视口坐标） */
  y: number
  /** 按下时面板的实际高度 */
  height: number
  /** 按下时面板顶边的偏移 */
  topOffset: number
  /** 抓住的是上沿还是下沿 */
  edge: 'top' | 'bottom'
}

/**
 * 按「抓住的那条边」计算新尺寸，纯函数，便于数值化回归。
 *
 * 容器是 top 锚定的（`top` + 固定 `height`，`bottom:auto`），因此：
 *  - 抓下沿：顶边固定，height += delta，底边跟着鼠标走；
 *  - 抓上沿：底边位置（`topOffset + height`）固定，height -= delta 且
 *    topOffset 同步增大，顶边才跟着鼠标走。
 *
 * 旧版抓上沿只减 height，动的是底边 —— 面板整体缩到右上角，
 * 与用户「抓哪条边就拖哪条边」的直觉相反。
 */
export function resizeFromEdge(start: HeightDragStart, delta: number, available: number) {
  if (start.edge === 'bottom') {
    return {
      height: clampHeight(start.height + delta, available),
      topOffset: start.topOffset,
    }
  }
  const height = clampHeight(start.height - delta, available)
  const bottomEdge = start.topOffset + start.height
  return {
    height,
    topOffset: clampTopOffset(bottomEdge - height, height, available),
  }
}

/**
 * 实际渲染高度：null 表示铺满（交给 CSS），数值则再按当前视口夹一次。
 * 窗口变小后旧的高度不能把面板顶出可视区，但也不改写存储值——
 * 用户把窗口拉回来时应当恢复成他自己拖的那个高度。
 */
export function resolveHeight(height: number | null, available: number): number | null {
  if (height === null) return null
  return clampHeight(height, available)
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
  // 旧版没有 height：缺省即「铺满」，与升级前行为一致
  const height = typeof source.height === 'number' ? clampHeight(source.height) : null
  // 旧版没有 topOffset：0 = 顶边贴着标题栏下沿，与升级前完全一致。
  // 铺满态忽略任何残留偏移，避免刷新后面板顶边悬在半空。
  const topOffset =
    height === null
      ? 0
      : typeof source.topOffset === 'number' && Number.isFinite(source.topOffset)
        ? Math.max(0, Math.round(source.topOffset))
        : 0
  return {
    side: source.side === 'left' ? 'left' : 'right',
    open: visibility !== 'collapsed',
    visibility,
    width: typeof source.width === 'number' ? clampWidth(source.width) : DEFAULT_LAYOUT.width,
    height,
    topOffset,
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
