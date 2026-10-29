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
import type { DockLayout, DockSide } from './layout.ts'
import { clampWidth, dockGeometry, loadLayout, saveLayout } from './layout.ts'
import { loadXechatApp, type XechatAppHandle, type XechatAppModule } from './app-loader.ts'
import { DOCK_CSS } from './styles.ts'

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
  const hostRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<XechatAppHandle | null>(null)
  const dragStart = useRef<{ x: number; width: number } | null>(null)
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  /** 面板是否真正展开（收起/暂停时为 false，此时面板只是 display:none）。 */
  const expanded = layout.open && layout.visibility === 'open'
  /** 整块是否可见（collapsed 时保留活动栏；paused 时整块隐藏）。 */
  const mounted = layout.visibility !== 'paused'

  const patch = (next: Partial<DockLayout>) => {
    const merged = { ...layoutRef.current, ...next }
    // open 与 visibility 必须同步，避免两者矛盾导致面板画不出来
    if (next.visibility !== undefined) merged.open = next.visibility !== 'collapsed'
    if (next.open !== undefined && next.visibility === undefined) {
      merged.visibility = next.open ? 'open' : 'collapsed'
    }
    saveLayout(merged)
    setLayout(merged)
  }

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

  // 顶部安全距离随窗口状态变化（进入/退出全屏、标题栏高度改变）
  useEffect(() => {
    const sync = () => setTopInset(readTopInset())
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

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
      const delta = layoutRef.current.side === 'left' ? e.clientX - start.x : start.x - e.clientX
      patch({ width: clampWidth(start.width + delta) })
    }
    const onUp = () => {
      dragStart.current = null
      setDragging(false)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    // patch 依赖 layoutRef，无需列入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging])

  const side: DockSide = layout.side
  const activityWidth = 44
  // 贴在 slot 容器的左/右边缘（容器铺满视口，position:absolute 生效）。
  // dockGeometry 同时给出宽度与贴边方向，保持与单测一致的单一真相。
  // 再叠加顶部安全距离：运行时读到的值优先于静态 CSS 声明，
  // 保证标题栏令牌在挂载后才写入时也能正确下移。
  const geometry: React.CSSProperties = {
    ...(dockGeometry(layout, activityWidth) as React.CSSProperties),
    ...(topInset > 0 ? { top: topInset } : null),
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
    createElement('div', {
      className: 'xds-resizer',
      style: {
        position: 'absolute',
        left: side === 'right' ? -5 : undefined,
        right: side === 'left' ? -5 : undefined,
        top: 0,
        bottom: 0,
      },
      'data-dragging': dragging ? 'true' : 'false',
      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault()
        dragStart.current = { x: e.clientX, width: layout.width }
        setDragging(true)
      },
    }),
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

  return createElement(
    'div',
    { 'data-xechat-dsh': '' },
    createElement(DockStyle),
    restoreEntry,
    createElement(
      'div',
      {
        className: 'xds-root',
        'data-side': side,
        // paused 时整块不显示，但节点保留，避免 Vue 应用被连带移出文档
        style: { ...geometry, ...(paused ? { display: 'none' } : null) } as React.CSSProperties,
      },
      activity,
      panel,
    ),
  )
}
