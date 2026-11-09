/**
 * Dock 外壳 React 组件（slot 版）。
 *
 * 与上一版的区别：不再自己往 document.body 上挂根节点，而是作为一个
 * 普通 React 组件渲染在 DSH 提供的 `shell.overlay` slot 里，由宿主负责
 * 挂载与卸载。这样符合 DSH 官方插件规范：
 *   - 不 append 到 document.body
 *   - 不替换应用根节点
 *   - 样式随组件卸载一起移除
 *
 * 内部用 absolute 定位贴在 overlay 层侧边（overlay 本身是定位容器，
 * `top` 还要让出窗口标题栏高度，见 readTopInset）。
 *
 * 三态：open / collapsed / paused。
 * 收起与暂停只做视觉隐藏（面板 display:none、宽度归零），把位置还给宿主内容区，
 * 但面板 DOM 与内部的 Vue 应用继续存活——卸载重建会丢登录态并新开 WebSocket，
 * 同账号出现多条在线连接时服务端广播会被重复投递（表现为每条消息显示两遍）。
 */
import { createElement, useEffect, useRef, useState } from 'react'
import type { DockLayout, DockSide, HeightDragStart } from './layout.ts'
import {
  clampHeight,
  clampTopOffset,
  clampWidth,
  DEFAULT_WIDTH,
  dockGeometry,
  loadLayout,
  MAX_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  resolveHeight,
  resizeFromEdge,
  saveLayout,
} from './layout.ts'
import { loadXechatApp, type XechatAppHandle, type XechatAppModule } from './app-loader.ts'
import { DOCK_CSS } from './styles.ts'

/** 与 CSS 的 --xds-inset-bottom 保持一致：拖拽高度时按同一份余量算可用空间。 */
const BOTTOM_INSET = 8

/** 活动栏图标（stroke 风格，跟随 currentColor）。 */
function Icon({ path }: { path: string }) {
  return createElement(
    'svg',
    {
      width: 18,
      height: 18,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.9,
      strokeLinecap: 'round' as const,
      strokeLinejoin: 'round' as const,
      'aria-hidden': true,
    },
    createElement('path', { d: path }),
  )
}

const CHAT_ICON = 'M21 11.5a8.4 8.4 0 0 1-9 8.4 9.9 9.9 0 0 1-3.6-.6L3 21l1.7-4.8A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z'
const SWAP_ICON = 'M4 4h16v16H4z M4 4v16 M14 4v16'
const COLLAPSE_ICON = 'M15 6l-6 6 6 6'
const EXPAND_ICON = 'M9 6l6 6-6 6'
/** 完全隐藏：向右收起的双箭头，语义上区别于「收起面板」的单箭头 */
const CLOSE_ICON = 'M13 6l6 6-6 6 M4 6l6 6-6 6'
/** 尺寸设置：齿轮 */
const SETTINGS_ICON =
  'M12 9.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z M12 2.6v2.6 M12 18.8v2.6 M2.6 12h2.6 M18.8 12h2.6 M5.3 5.3l1.9 1.9 M16.8 16.8l1.9 1.9 M18.7 5.3l-1.9 1.9 M7.2 16.8l-1.9 1.9'

/**
 * 组件内样式：以 React 元素形式渲染，卸载时随节点一起移除
 * （官方规范推荐的做法，无需手动管理 <style> 生命周期）。
 */
function DockStyle() {
  return createElement('style', { 'data-plugin': 'xechat-dsh' }, DOCK_CSS)
}

/**
 * 从宿主发布的 CSS 变量读出顶部安全距离（窗口标题栏 / macOS 菜单条）。
 *
 * DSH 在 html 根元素上发布 `--dsh-frame-top-clearance`，但 overlay 层是
 * `position:absolute; inset:0` 的兄弟节点，**不吃 frame 的 padding-top**，
 * 所以必须自己下移，否则 dock 会盖住窗口的最小化/最大化/关闭按钮。
 *
 * 优先读计算值（令牌可能来自 html 而非 frame），读不到时回落到常量。
 */
function readTopInset(): number {
  if (typeof window === 'undefined' || typeof getComputedStyle === 'undefined') return 0
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--dsh-frame-top-clearance')
      .trim()
    if (!raw) return 0
    const px = Number.parseFloat(raw)
    return Number.isFinite(px) && px > 0 ? px : 0
  } catch {
    return 0
  }
}

export interface DockShellProps {
  /** slot 注入的布局上下文（如有），用于避开宿主侧边栏 */
  hostInsets?: { left?: number; right?: number }
}

export function DockShell(_props: DockShellProps) {
  const [layout, setLayout] = useState<DockLayout>(() => loadLayout())
  const [module, setModule] = useState<XechatAppModule | null>(null)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  /**
   * 顶部安全距离（窗口标题栏高度）。
   * 宿主可能在挂载后才写入该令牌（全屏切换、平台标记就绪），
   * 因此监听 resize 重新读取，而不是只在初始化时算一次。
   */
  const [topInset, setTopInset] = useState<number>(readTopInset)
  /**
   * 视口高度。拖拽高度时要用它算「最矮/最高能拖到哪」，
   * 窗口缩放后已存的像素高度也可能超出可用区，所以同样跟着 resize 走。
   */
  const [viewportHeight, setViewportHeight] = useState<number>(() =>
    typeof window === 'undefined' ? 0 : window.innerHeight,
  )
  const hostRef = useRef<HTMLDivElement | null>(null)
  /** dock 根节点：拖拽高度时量它当前的实际高度（铺满态没有存像素值）。 */
  const rootRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<XechatAppHandle | null>(null)
  const dragStart = useRef<{ x: number; width: number } | null>(null)
  /** edge 决定拖拽方向：底边向下拖变高，顶部向下拖变矮。 */
  const heightDragStart = useRef<HeightDragStart | null>(null)
  const [resizingHeight, setResizingHeight] = useState(false)
  /**
   * 尺寸设置面板。拖拽适合「大致调一下」，要精确到像素时直接输数字更快，
   * 也顺手解决了「拖动条太细找不到」的问题（有明确的入口和数值）。
   */
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [widthDraft, setWidthDraft] = useState<string>(String(layout.width))
  const [heightDraft, setHeightDraft] = useState<string>(layout.height === null ? '' : String(layout.height))
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  /**
   * 可用的最大高度 = 视口高度 - 标题栏下移量 - 底部留白。
   * 已经比 MIN_HEIGHT 还矮时按下限算（面板再压就没法用了）。
   */
  const availableHeight = Math.max(
    MIN_HEIGHT,
    (viewportHeight || 800) - topInset - BOTTOM_INSET,
  )

  /** 面板是否真正展开（收起/暂停时为 false，此时面板只是 display:none）。 */
  const expanded = layout.open && layout.visibility === 'open'
  /** 整块是否可见（collapsed 时保留活动栏；paused 时整块隐藏）。 */
  const mounted = layout.visibility !== 'paused'

  const patch = (next: Partial<DockLayout>) => {
    const merged = { ...layoutRef.current, ...next }
    // 高度变化时把顶边偏移一起收敛，避免「拖出可视区 / 铺满后残留偏移」。
    // 铺满（null）时偏移必须归零，否则恢复铺满后面板顶边仍悬在半空。
    if (next.height !== undefined) {
      merged.topOffset =
        next.height === null
          ? 0
          : clampTopOffset(merged.topOffset, next.height, availableHeight)
    }
    // open 与 visibility 必须同步，避免两者矛盾导致面板画不出来
    if (next.visibility !== undefined) merged.open = next.visibility !== 'collapsed'
    if (next.open !== undefined && next.visibility === undefined) {
      merged.visibility = next.open ? 'open' : 'collapsed'
    }
    saveLayout(merged)
    setLayout(merged)
  }

  /**
   * 开始拖拽高度。
   *
   * 两条把手抓的是**不同的边**：
   *   - 底边：顶边固定，底边跟着鼠标走（改 height）
   *   - 顶边：底边固定，顶边跟着鼠标走（同时改 height 与 topOffset）
   * 只改 height 的话顶边把手往下拖会让底边上移，面板整体缩到右上角，
   * 与用户「抓住哪条边就拖哪条边」的直觉相反。
   * 铺满态没有像素值，按下时先量一次实际高度作为起点，避免第一次拖动跳变。
   */
  const startHeightDrag = (e: React.PointerEvent<HTMLDivElement>, edge: 'top' | 'bottom') => {
    e.preventDefault()
    e.stopPropagation()
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* 老环境不支持就算了，window 监听仍能兜住 */
    }
    const rect = rootRef.current?.getBoundingClientRect()
    heightDragStart.current = {
      y: e.clientY,
      height: rect ? Math.round(rect.height) : availableHeight,
      topOffset: layoutRef.current.topOffset,
      edge,
    }
    setResizingHeight(true)
  }

  /** 把宽度输入框的像素值落到布局上；空值/非法值回滚成当前值。 */
  const commitWidth = () => {
    const value = Number.parseFloat(widthDraft.trim())
    if (!Number.isFinite(value)) {
      setWidthDraft(String(layoutRef.current.width))
      return
    }
    const next = clampWidth(value)
    setWidthDraft(String(next))
    patch({ width: next })
  }

  /** 高度留空 = 铺满（跟随窗口），与拖拽把手的 null 语义保持一致。 */
  const commitHeight = () => {
    const raw = heightDraft.trim()
    if (raw === '') {
      setHeightDraft('')
      patch({ height: null })
      return
    }
    const value = Number.parseFloat(raw)
    if (!Number.isFinite(value)) {
      const cur = layoutRef.current.height
      setHeightDraft(cur === null ? '' : String(cur))
      return
    }
    const next = clampHeight(value, availableHeight)
    setHeightDraft(String(next))
    patch({ height: next })
  }

  // 打开设置时用当前布局回填输入框（拖完之后再打开要显示实际值，而不是旧草稿）
  useEffect(() => {
    if (!settingsOpen) return
    const cur = layoutRef.current
    setWidthDraft(String(cur.width))
    setHeightDraft(cur.height === null ? '' : String(cur.height))
  }, [settingsOpen])

  // 首次展开时加载 Vue 应用包
  useEffect(() => {
    if (!expanded || module) return
    let cancelled = false
    loadXechatApp()
      .then((mod) => {
        if (!cancelled) setModule(mod)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [expanded, module])

  // 把 Vue 应用挂到宿主节点。只挂一次，之后收起/展开不再卸载重建：
  // 这里不依赖 expanded，cleanup 仅在 DockShell 自身卸载（插件停用/重载）时执行，
  // 届时 Vue 应用会连同 WebSocket 一起干净退出。
  useEffect(() => {
    if (!module || !hostRef.current) return
    if (handleRef.current) return
    const el = hostRef.current
    let cancelled = false

    /**
     * 顺序：先初始化传输层，再挂载 Vue。
     *
     * ChatPanel 的 onMounted 会按上次会话发起登录，若此时传输层还没 init 完，
     * init() 里的默认地址会把刚建立的登录连接顶掉，导致「刚恢复登录就又掉线」。
     * init 最多等 3 秒（目标地址不可达时浏览器 TCP 超时很长），超时也照常挂载，
     * 用户仍可在登录面板手动重连。
     */
    const boot = async () => {
      try {
        await Promise.race([
          Promise.resolve(module.initXechat?.()),
          new Promise((resolve) => setTimeout(resolve, 3000)),
        ])
      } catch (e) {
        console.warn('[xechat-dsh] 传输层初始化失败', e)
      }
      if (cancelled) return
      el.innerHTML = ''
      try {
        handleRef.current = module.mountXechat(el)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    void boot()

    return () => {
      cancelled = true
      try {
        handleRef.current?.unmount()
      } catch (e) {
        console.warn('[xechat-dsh] Vue 卸载异常', e)
      }
      handleRef.current = null
      el.innerHTML = ''
    }
  }, [module])

  // 顶部安全距离与视口高度随窗口状态变化（进入/退出全屏、标题栏高度改变、窗口缩放）
  useEffect(() => {
    const sync = () => {
      setTopInset(readTopInset())
      if (typeof window !== 'undefined') setViewportHeight(window.innerHeight)
    }
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  /**
   * 与内部 Vue 应用「设置 → 面板尺寸」双向同步。
   *
   * Vue 应用由 app-loader 以 Blob URL 注入，和 DockShell 同一个 window、
   * 同一份 localStorage（不是 iframe），用 CustomEvent 通信即可，
   * 不必在两侧引入共享模块或让 React 去碰 Vue 的 DOM。
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onSetSize = (e: Event) => {
      const detail = (e as CustomEvent<{ width?: unknown; height?: unknown }>).detail || {}
      const next: Partial<DockLayout> = {}
      if (detail.width !== undefined) {
        const w = Number.parseFloat(String(detail.width))
        if (Number.isFinite(w)) next.width = clampWidth(w)
      }
      if (detail.height !== undefined) {
        const raw = String(detail.height).trim()
        if (detail.height === null || raw === '') {
          next.height = null
        } else {
          const h = Number.parseFloat(raw)
          if (Number.isFinite(h)) next.height = clampHeight(h, availableHeight)
        }
      }
      if (Object.keys(next).length > 0) patch(next)
    }
    const onOpenSettings = () => setSettingsOpen(true)
    window.addEventListener('xechat-dsh:set-size', onSetSize)
    window.addEventListener('xechat-dsh:open-size-settings', onOpenSettings)
    return () => {
      window.removeEventListener('xechat-dsh:set-size', onSetSize)
      window.removeEventListener('xechat-dsh:open-size-settings', onOpenSettings)
    }
    // patch 依赖 layoutRef，无需列入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableHeight])

  /** 布局变化（拖拽 / 齿轮浮层 / 设置页输入）广播给设置页回显真实生效值 */
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.dispatchEvent(new window.CustomEvent('xechat-dsh:layout', {
      detail: {
        width: layout.width,
        height: layout.height,
        minWidth: MIN_WIDTH,
        maxWidth: MAX_WIDTH,
        minHeight: MIN_HEIGHT,
        maxHeight: Math.round(availableHeight),
      },
    }))
  }, [layout.width, layout.height, availableHeight])

  /**
   * 宿主收起侧边栏时自动让出位置。
   *
   * DSH 的左侧栏收起后，展开/新建等按钮会变成 `position: fixed` 浮在
   * 左上角（`left: 12px` / `left: 48px`，位于标题栏高度内）。若此时
   * `shell.overlay` 里有铺满的浮层，就会和这些 fixed 控件抢层级、抢点击。
   *
   * 做法：观察根元素上 DSH 自己维护的 `data-sidebar-collapsed`，
   * 左侧停靠且面板展开时自动折叠（只留活动栏），重新展开侧边栏时恢复。
   * 用 MutationObserver 而不是轮询，避免无谓开销。
   */
  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    if (layoutRef.current.side !== 'left') return

    const sync = () => {
      const hostCollapsed = document.documentElement.hasAttribute('data-sidebar-collapsed')
      const cur = layoutRef.current
      if (hostCollapsed && cur.side === 'left' && cur.visibility === 'open') {
        patch({ visibility: 'collapsed' })
      }
    }
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-sidebar-collapsed'],
    })
    sync()
    return () => observer.disconnect()
    // patch 依赖 layoutRef，无需列入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.side])

  // 拖拽调宽
  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => {
      const start = dragStart.current
      if (!start) return
      e.preventDefault()
      const delta = layoutRef.current.side === 'left' ? e.clientX - start.x : start.x - e.clientX
      patch({ width: clampWidth(start.width + delta) })
    }
    const onUp = () => {
      dragStart.current = null
      setDragging(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // 指针被系统抢走（切换窗口、右键菜单）时也要收尾，否则会卡在拖拽态
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    // patch 依赖 layoutRef，无需列入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])

  /**
   * 拖拽调高。
   *
   * 容器是 `top` 锚定的（top + 固定 height，bottom:auto），所以：
   *   - 底边把手：保持 topOffset 不变，height += delta → 底边跟着鼠标；
   *   - 顶边把手：保持「底边位置 = topOffset + height」不变，
   *     height -= delta 且 topOffset += delta → 顶边跟着鼠标。
   *     只减 height 而不加 topOffset，就是旧版「往下拖整个面板缩到右上角」的 bug。
   * 高度被上下限夹住时按夹取后的实际高度反算偏移，抓握点不会脱离鼠标太远。
   */
  useEffect(() => {
    if (!resizingHeight) return
    const onMove = (e: PointerEvent) => {
      const start = heightDragStart.current
      if (!start) return
      const delta = e.clientY - start.y
      patch(resizeFromEdge(start, delta, availableHeight))
    }
    const onUp = () => {
      heightDragStart.current = null
      setResizingHeight(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    // patch 依赖 layoutRef，无需列入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizingHeight, availableHeight])

  const side: DockSide = layout.side
  const activityWidth = 44
  // 用户在底部拖过就按存下来的像素高度，否则铺满（height=null 交给 CSS）。
  // resolveHeight 还会按当前视口再夹一次，窗口变矮时不会把面板顶出可视区。
  const renderedHeight = resolveHeight(layout.height, availableHeight)
  // 顶边偏移也要按当前视口夹一次：窗口变矮 / 用户把高度调大后，
  // 旧偏移不能把面板底边顶出可视区（存储值不改，窗口拉回来会恢复原位）。
  const renderedTopOffset =
    renderedHeight === null
      ? 0
      : clampTopOffset(layout.topOffset, renderedHeight, availableHeight)
  // 贴在 slot 容器的左/右边缘（容器铺满视口，position:absolute 生效）。
  // dockGeometry 同时给出宽度与贴边方向，保持与单测一致的单一真相。
  // 再叠加顶部安全距离：运行时读到的值优先于静态 CSS 声明，
  // 保证标题栏令牌在挂载后才写入时也能正确下移。
  const geometry: React.CSSProperties = {
    ...(dockGeometry(layout, activityWidth) as React.CSSProperties),
    ...(renderedHeight !== null
      ? {
          // 固定高度时取消 bottom 拉伸：top = 标题栏下沿 + 顶边偏移，
          // 这样拖上沿时顶边能跟着鼠标移动，拖下沿时顶边保持不动。
          top: (topInset > 0 ? topInset : 0) + renderedTopOffset,
          bottom: 'auto',
          height: renderedHeight,
        }
      : {
          ...(topInset > 0 ? { top: topInset } : null),
        }),
  }

  // 暂停态：dock 整块隐藏，只在侧边留一份恢复条，
  // 否则用户把面板藏起来后没有任何入口能调回来。
  // 注意：这里只做视觉隐藏，面板 DOM 与 Vue 应用继续存活（见下方 mount effect）。
  const paused = !mounted
  const restoreEntry = paused
    ? createElement(
        'div',
        {
          className: 'xds-restore',
          'data-side': side,
          style: {
            ...(topInset > 0 ? { top: topInset } : null),
            ...(side === 'left' ? { left: 0 } : { right: 0 }),
          },
        },
        createElement(
          'button',
          {
            type: 'button',
            className: 'xds-restore-btn',
            title: '打开 xechat',
            'aria-label': '打开 xechat',
            onClick: () => patch({ visibility: 'open' }),
          },
          createElement(Icon, { path: EXPAND_ICON }),
        ),
      )
    : null

  const activity = createElement(
    'div',
    { className: 'xds-activity' },
    createElement(
      'button',
      {
        type: 'button',
        className: 'xds-activity-btn',
        title: expanded ? '收起 xechat' : '打开 xechat',
        'aria-label': expanded ? '收起 xechat' : '打开 xechat',
        onClick: () => patch({ visibility: expanded ? 'collapsed' : 'open' }),
      },
      createElement(Icon, { path: expanded ? COLLAPSE_ICON : EXPAND_ICON }),
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'xds-activity-btn',
        'data-active': expanded ? 'true' : 'false',
        title: '聊天',
        'aria-label': '聊天',
        onClick: () => patch({ visibility: 'open' }),
      },
      createElement(Icon, { path: CHAT_ICON }),
    ),
    createElement('div', { className: 'xds-activity-spacer' }),
    createElement(
      'button',
      {
        type: 'button',
        className: 'xds-activity-btn',
        'data-active': settingsOpen ? 'true' : 'false',
        title: '面板尺寸设置',
        'aria-label': '面板尺寸设置',
        onClick: () => setSettingsOpen((v) => !v),
      },
      createElement(Icon, { path: SETTINGS_ICON }),
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'xds-activity-btn',
        title: `切换到${side === 'right' ? '左' : '右'}侧`,
        'aria-label': `切换到${side === 'right' ? '左' : '右'}侧`,
        onClick: () => patch({ side: side === 'right' ? 'left' : 'right' }),
      },
      createElement(Icon, { path: SWAP_ICON }),
    ),
    createElement(
      'button',
      {
        type: 'button',
        className: 'xds-activity-btn',
        title: '完全隐藏 xechat',
        'aria-label': '完全隐藏 xechat',
        onClick: () => patch({ visibility: 'paused' }),
      },
      createElement(Icon, { path: CLOSE_ICON }),
    ),
  )

  // 面板始终渲染，收起时仅隐藏。
  //
  // 旧实现用 `expanded ? panel : null`，收起就把面板 DOM 连同 Vue 应用一起销毁，
  // 再次展开时重新 mount → 重建 Pinia、重新 init 传输层。后果有两个：
  //   1. 登录态（在内存里的当前账号、在线列表、历史消息）全部丢失；
  //   2. 每次重挂都新开一条 WebSocket，旧连接仍在服务端保留会话，
  //      同账号出现多条在线连接，服务端广播时每条连接都收到一次 → 消息重复显示。
  // 现在收起只是 display:none：位置照样让给宿主内容区，状态与连接都留着。
  const panel = createElement(
    'div',
    {
      className: 'xds-panel',
      style: {
        width: layout.width,
        maxWidth: 'calc(100vw - 44px)',
        ...(expanded ? null : { display: 'none' }),
      },
    },
    createElement(
      'div',
      { className: 'xds-panel-body' },
      error
        ? createElement(
            'div',
            { className: 'xds-status' },
            createElement('div', null, 'xechat 加载失败', createElement('code', null, error)),
          )
        : createElement('div', {
            ref: hostRef,
            style: { width: '100%', height: '100%' },
            'data-xechat-host': '',
          }),
    ),
  )

  /**
   * 两个拖拽把手：作为 `.xds-root` 的直接子元素绝对定位，**不放面板里**。
   *
   * 面板自带 overflow:hidden（圆角裁切），把手贴边外溢会被裁掉——
   * 0.2.0 的宽度把手就是这么失效的（left:-5px 被裁，鼠标永远命中不到）。
   * 挂到 root 上还有一个好处：root 没有 overflow，也不受面板内部 Vue 应用
   * 层级影响，把手一定在内容上层。
   */
  const widthResizer = expanded
    ? createElement('div', {
        className: 'xds-resizer',
        role: 'separator',
        'aria-orientation': 'vertical' as const,
        'aria-label': '拖动调整宽度',
        title: '拖动调整宽度（双击恢复默认 380px）',
        'data-dragging': dragging ? 'true' : 'false',
        // side=right 时面板在最左，把手贴 root 左缘（即面板左缘）；
        // side=left 时面板在最右，贴 root 右缘。
        style: (side === 'right'
          ? { left: 0, top: 0, bottom: 0 }
          : { right: 0, top: 0, bottom: 0 }) as React.CSSProperties,
        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
          e.preventDefault()
          e.stopPropagation()
          // 捕获指针：拖到窗口外再松手也能收到 pointerup，不会卡住
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* 老环境不支持就算了，window 监听仍能兜住 */
          }
          dragStart.current = { x: e.clientX, width: layoutRef.current.width }
          setDragging(true)
        },
        onDoubleClick: () => patch({ width: DEFAULT_WIDTH }),
      })
    : null

  // 横向覆盖面板宽度：side=right 时面板从 0 到 (宽-44)，side=left 时从 44 到右缘。
  // 顶部与底部把手共用这份范围，避免两条边各自算一遍导致错位。
  const heightResizerInset = side === 'right'
    ? { left: 0, right: activityWidth }
    : { left: activityWidth, right: 0 }

  /**
   * 顶部把手：用户习惯在面板「上沿」找调高的拖拽条，只在窗口最底部放一条
   * 太难发现。向上拉高、向下压低，双击恢复铺满。
   */
  const topHeightResizer = expanded
    ? createElement('div', {
        className: 'xds-resizer-h',
        'data-edge': 'top',
        role: 'separator',
        'aria-orientation': 'horizontal' as const,
        'aria-label': '拖动调整高度',
        title: '拖动调整高度（顶边跟随鼠标：向下拖变矮 / 向上拖变高；双击恢复铺满）',
        'data-dragging': resizingHeight ? 'true' : 'false',
        style: { top: 0, ...heightResizerInset } as React.CSSProperties,
        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => startHeightDrag(e, 'top'),
        onDoubleClick: () => patch({ height: null }),
      })
    : null

  /** 底部把手：向下拉高（面板顶边固定，与 geometry 的锚点一致） */
  const heightResizer = expanded
    ? createElement('div', {
        className: 'xds-resizer-h',
        'data-edge': 'bottom',
        role: 'separator',
        'aria-orientation': 'horizontal' as const,
        'aria-label': '拖动调整高度',
        title: '拖动调整高度（底边跟随鼠标；双击恢复铺满）',
        'data-dragging': resizingHeight ? 'true' : 'false',
        style: { bottom: 0, ...heightResizerInset } as React.CSSProperties,
        onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => startHeightDrag(e, 'bottom'),
        onDoubleClick: () => patch({ height: null }),
      })
    : null

  /**
   * 尺寸设置面板：精确输入 px。
   * 空的高度表示「铺满」；宽度/高度都会按当前视口夹一次再写回输入框，
   * 让用户直接看到实际生效的值。
   */
  const settings = settingsOpen
    ? createElement(
        'div',
        {
          className: 'xds-settings',
          'data-side': side,
          style: (side === 'right' ? { right: 52 } : { left: 52 }) as React.CSSProperties,
        },
        createElement('p', { className: 'xds-settings-title' }, '面板尺寸'),
        createElement(
          'div',
          { className: 'xds-field' },
          createElement('label', { htmlFor: 'xds-width-input' }, '宽度 (px)'),
          createElement('input', {
            id: 'xds-width-input',
            type: 'number',
            inputMode: 'numeric' as const,
            min: MIN_WIDTH,
            max: MAX_WIDTH,
            step: 10,
            value: widthDraft,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setWidthDraft(e.target.value),
            onBlur: commitWidth,
            onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitWidth()
              }
            },
          }),
        ),
        createElement(
          'div',
          { className: 'xds-field' },
          createElement('label', { htmlFor: 'xds-height-input' }, '高度 (px)'),
          createElement('input', {
            id: 'xds-height-input',
            type: 'number',
            inputMode: 'numeric' as const,
            min: MIN_HEIGHT,
            max: Math.round(availableHeight),
            step: 10,
            placeholder: '铺满',
            value: heightDraft,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setHeightDraft(e.target.value),
            onBlur: commitHeight,
            onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitHeight()
              }
            },
          }),
        ),
        createElement(
          'p',
          { className: 'xds-hint' },
          `宽度 ${MIN_WIDTH}–${MAX_WIDTH}，高度 ${MIN_HEIGHT}–${Math.round(availableHeight)}；高度留空为铺满。回车或失焦生效。`,
        ),
        createElement(
          'div',
          { className: 'xds-actions' },
          createElement(
            'button',
            {
              type: 'button',
              className: 'xds-btn',
              onClick: () => {
                patch({ width: DEFAULT_WIDTH, height: null })
                setWidthDraft(String(DEFAULT_WIDTH))
                setHeightDraft('')
              },
            },
            '恢复默认',
          ),
          createElement(
            'button',
            { type: 'button', className: 'xds-btn', 'data-primary': 'true', onClick: () => setSettingsOpen(false) },
            '完成',
          ),
        ),
      )
    : null

  return createElement(
    'div',
    { 'data-xechat-dsh': '' },
    createElement(DockStyle),
    restoreEntry,
    createElement(
      'div',
      {
        className: 'xds-root',
        ref: rootRef,
        'data-side': side,
        // paused 时整块不显示，但节点保留，避免 Vue 应用被连带移出文档
        style: { ...geometry, ...(paused ? { display: 'none' } : null) } as React.CSSProperties,
      },
      activity,
      panel,
      widthResizer,
      topHeightResizer,
      heightResizer,
      settings,
    ),
  )
}
