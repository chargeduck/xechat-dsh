/**
 * Dock 外壳样式。
 *
 * 全部挂在 `[data-xechat-dsh]` 作用域下，避免污染 DSH 自身的样式；
 * 颜色跟随 DSH 的 `--dsw-*` 设计令牌，缺失时回落到中性色。
 */
export const DOCK_CSS = `
[data-xechat-dsh] {
  --xds-bg: var(--dsw-surface, #1e1e1e);
  --xds-bg-alt: var(--dsw-surface-raised, #252526);
  --xds-border: var(--dsw-border, #3c3c3c);
  --xds-text: var(--dsw-text, #cccccc);
  --xds-text-dim: var(--dsw-text-secondary, #8b8b8b);
  --xds-accent: var(--dsw-accent, #4f8cff);
  --xds-shadow: 0 8px 32px rgba(0, 0, 0, 0.36);
  /*
   * 顶部安全距离。DSH 桌面端（Windows）把标题栏做成覆盖层：
   *   - [data-windows-titlebar] Frame 自身 padding-top = 标题栏高度（40px）
   *   - 但 shell.overlay 层是 position:absolute; inset:0 的兄弟节点，
   *     **不继承 frame 的 padding**，因此它的 0 点就在窗口最顶端，
   *     正好压在 Windows 的最小化/最大化/关闭按钮上。
   * 复用 DSH 自己发布的令牌：Windows 下等于标题栏高度，macOS 48px，
   * 原生全屏时 --dsh-frame-top-clearance 不存在，回落到 0。
   */
  --xds-inset-top: var(--dsh-frame-top-clearance, 0px);
  /*
   * 左右安全距离。macOS 折叠左侧栏后，重开按钮与 New Session 占据 frame
   * 左上角的 leading 带（--dsh-frame-leading-clearance，160px / 全屏 84px）。
   * Windows 侧未发布该值，回落 0。
   */
  --xds-inset-left: var(--dsh-frame-leading-clearance, 0px);
  /* 底部留一点呼吸，避免贴着边框 */
  --xds-inset-bottom: 8px;
  font-family: var(--dsw-font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif);
  color: var(--xds-text);
}

/*
 * 容器：贴住 overlay 层的左/右边缘，但**不覆盖窗口标题栏**。
 * overlay 层本身是 'position:absolute; inset:0; pointer-events:none'，
 * 子元素默认 pointer-events:auto —— 所以一旦我们铺满整个高度，
 * 标题栏右侧那 44px 宽的区域就会被活动栏吃掉，系统按钮点不动。
 * 这里把 top/bottom 都内缩，鼠标事件就不会落在标题栏上。
 */
.xds-root {
  position: absolute;
  top: var(--xds-inset-top);
  bottom: var(--xds-inset-bottom);
  z-index: 60;
  display: flex;
  flex-direction: row;
  pointer-events: none; /* 容器本身不挡点击，只有内部元素接管 */
  /* 高度不可超出 overlay 层（去掉标题栏后的剩余区域） */
  max-height: calc(100% - var(--xds-inset-top) - var(--xds-inset-bottom));
}
/* 左侧停靠时避开 macOS 折叠侧栏的 leading 带 */
.xds-root[data-side='left'] { left: var(--xds-inset-left); }
/* 活动栏之外再留一小段余量，保证圆角和阴影不被裁掉 */
.xds-root[data-side='right'] { right: 6px; flex-direction: row-reverse; }

/*
 * 暂停态：面板整体不渲染，只在侧边留一个 6px 的热区。
 * 热区内是展开按钮，避免「藏起来后再没有入口调回来」。
 */
.xds-restore {
  position: absolute;
  z-index: 60;
  top: var(--xds-inset-top);
  display: flex;
  align-items: center;
  padding: 0 2px;
  pointer-events: none;
}
.xds-restore[data-side='left'] { left: 0; }
.xds-restore[data-side='right'] { right: 0; }
.xds-restore-btn {
  pointer-events: auto;
  width: 14px;
  height: 56px;
  padding: 0;
  border: 1px solid var(--xds-border);
  border-radius: 7px;
  background: var(--xds-bg-alt);
  color: var(--xds-text-dim);
  cursor: pointer;
  opacity: 0.35;
  transition: opacity 0.15s, color 0.15s;
}
.xds-restore-btn:hover {
  opacity: 1;
  color: var(--xds-accent);
}

/* 活动栏：细长图标条 */
.xds-activity {
  pointer-events: auto;
  width: 44px;
  flex: 0 0 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  background: var(--xds-bg-alt);
  border-left: 1px solid var(--xds-border);
  border-right: 1px solid var(--xds-border);
  border-radius: 10px;
  /* 图标多于可用高度时允许滚动，而不是把按钮挤出可视区 */
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
}
.xds-activity::-webkit-scrollbar { width: 0; height: 0; }
.xds-root[data-side='right'] .xds-activity { border-left: 1px solid var(--xds-border); }

.xds-activity-btn {
  width: 32px;
  height: 32px;
  /* 高度受限时不被压缩，配合 overflow-y 滚动保证可点 */
  flex: 0 0 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  border: none;
  background: transparent;
  color: var(--xds-text-dim);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.xds-activity-btn:hover { background: rgba(127, 127, 127, 0.16); color: var(--xds-text); }
.xds-activity-btn[data-active='true'] {
  background: rgba(79, 140, 255, 0.16);
  color: var(--xds-accent);
}
.xds-activity-spacer { flex: 1 1 auto; }

/* 内容区 */
.xds-panel {
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  background: var(--xds-bg);
  box-shadow: var(--xds-shadow);
  overflow: hidden;
  border-left: 1px solid var(--xds-border);
  border-radius: 10px;
  /* 高度由容器给，内部再按 flex 分配（见 .xds-panel-body 的 min-height:0） */
  min-height: 0;
}
.xds-root[data-side='right'] .xds-panel { border-left: 1px solid var(--xds-border); }
.xds-root[data-side='left'] .xds-panel { border-right: 1px solid var(--xds-border); }

.xds-panel-body {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

/* 左侧边栏内部再嵌套 xechat 自己的导航条时，去掉重复的左边框 */
.xds-panel-body .app-sidebar { border-right: 1px solid var(--xds-border); }

/*
 * 拖拽把手（宽度 + 高度），两者都挂在 .xds-root 上，**不放进 .xds-panel**。
 *
 * 之前放在面板里踩了两个坑：
 *   1. .xds-panel 有 overflow:hidden（圆角裁切需要），宽度把手定位在
 *      left:-5px 外溢，被裁得一点不剩 → 完全看不到、也拖不动；
 *   2. 面板内部是 xechat 自己的 Vue 应用，层级不可控，高度条会被内容压住。
 * 提到 root 层后 root 没有 overflow，把手一定可见、一定在内容之上。
 */
.xds-resizer {
  pointer-events: auto;
  position: absolute;
  z-index: 62;
  width: 7px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
  /* 触控板/触屏拖拽时不要触发滚动或文本选择 */
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
/* 常驻一条淡淡的竖线，暗示「这里能抓」；hover 才变粗变亮 */
.xds-resizer::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 2px;
  height: 30px;
  transform: translate(-50%, -50%);
  border-radius: 1px;
  background: var(--xds-text-dim);
  opacity: 0.24;
  transition: opacity 0.15s, background 0.15s, height 0.15s;
}
.xds-resizer:hover,
.xds-resizer[data-dragging='true'] { background: rgba(79, 140, 255, 0.22); }
.xds-resizer:hover::after,
.xds-resizer[data-dragging='true']::after {
  background: var(--xds-accent);
  opacity: 1;
  height: 48px;
}

/*
 * 高度把手：12px 横条，贴在面板底边。
 * 从 6px 加宽到 12px —— 6px 在桌面端实在太细，用户根本找不到（0.2.0 实测反馈）。
 */
.xds-resizer-h {
  pointer-events: auto;
  position: absolute;
  z-index: 62;
  height: 12px;
  cursor: row-resize;
  background: transparent;
  transition: background 0.15s;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.xds-resizer-h::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 46px;
  height: 3px;
  transform: translate(-50%, -50%);
  border-radius: 2px;
  background: var(--xds-text-dim);
  opacity: 0.5;
  transition: opacity 0.15s, background 0.15s, width 0.15s;
}
.xds-resizer-h:hover,
.xds-resizer-h[data-dragging='true'] { background: rgba(79, 140, 255, 0.22); }
.xds-resizer-h:hover::after,
.xds-resizer-h[data-dragging='true']::after {
  background: var(--xds-accent);
  opacity: 1;
  width: 76px;
}

/*
 * 顶部把手：用户习惯在面板「上沿」找调高的拖拽条，只在底边给一条
 * （贴在窗口最底部、还带 8px 内缩）太难发现。复用 .xds-resizer-h 的
 * 全部交互样式，这里只补定位与更醒目的常驻抓握线。
 * 不外溢到 root 上方：那边紧邻 Windows 标题栏的窗口按钮，
 * 一旦 pointer-events:auto 盖过去，最小化/关闭就点不动了。
 */
.xds-resizer-h[data-edge='top'] { top: 0; }
.xds-resizer-h[data-edge='top']::after { width: 76px; opacity: 0.6; }
.xds-resizer-h[data-edge='top']:hover::after,
.xds-resizer-h[data-edge='top'][data-dragging='true']::after { width: 120px; }

/* 尺寸设置面板：直接输入 px，比拖拽精确 */
.xds-settings {
  pointer-events: auto;
  position: absolute;
  top: 8px;
  z-index: 70;
  width: 218px;
  padding: 12px;
  box-sizing: border-box;
  border: 1px solid var(--xds-border);
  border-radius: 10px;
  background: var(--xds-bg-alt);
  box-shadow: var(--xds-shadow);
  font-size: 12px;
  line-height: 1.5;
  color: var(--xds-text);
}
.xds-settings-title {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
}
.xds-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.xds-field > label { color: var(--xds-text-dim); }
.xds-field input {
  width: 82px;
  height: 26px;
  padding: 0 8px;
  box-sizing: border-box;
  border: 1px solid var(--xds-border);
  border-radius: 6px;
  background: var(--xds-bg);
  color: var(--xds-text);
  font: inherit;
  text-align: right;
}
.xds-field input:focus {
  outline: none;
  border-color: var(--xds-accent);
}
.xds-hint {
  margin: 4px 0 10px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--xds-text-dim);
}
.xds-actions { display: flex; gap: 8px; }
.xds-btn {
  flex: 1 1 0;
  height: 28px;
  padding: 0;
  border: 1px solid var(--xds-border);
  border-radius: 6px;
  background: transparent;
  color: var(--xds-text);
  font: inherit;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.xds-btn:hover { background: rgba(127, 127, 127, 0.16); }
.xds-btn[data-primary='true'] {
  border-color: var(--xds-accent);
  background: var(--xds-accent);
  color: #fff;
}


/* 加载/错误占位 */
.xds-status {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 24px;
  text-align: center;
  font-size: 13px;
  line-height: 1.7;
  color: var(--xds-text-dim);
}
.xds-status code {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  background: rgba(127, 127, 127, 0.16);
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--xds-text);
}

/* 缩窄视口时收敛宽度 */
@media (max-width: 720px) {
  .xds-root[data-side] .xds-panel { max-width: calc(100vw - 44px); }
}
`

/**
 * 样式以 CSS 文本常量导出，由 DockStyle 组件渲染成 <style> 元素。
 * 选择这条路径而非手动 append 到 head：DSH 官方规范要求插件自己的
 * 资源随组件卸载一起消失，React 元素天然满足。
 */
