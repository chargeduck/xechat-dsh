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

/* 拖拽调宽热区 */
.xds-resizer {
  pointer-events: auto;
  width: 5px;
  flex: 0 0 5px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
}
.xds-resizer:hover, .xds-resizer[data-dragging='true'] { background: var(--xds-accent); }

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
