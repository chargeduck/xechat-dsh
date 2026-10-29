/**
 * Dock 尺寸契约测试（纯静态断言）。
 *
 * 回归目标：侧边栏**不得覆盖宿主窗口的标题栏**，且必须在高度受限时仍可操作。
 *
 * 真实故障（2026-10-22 实测）：
 *   DSH 桌面端（Windows）把标题栏做成覆盖层，并给 AppFrame 加了
 *   `padding-top: var(--dsh-windows-titlebar-height)`。但 `shell.overlay`
 *   是 frame 的**兄弟节点**（`position:absolute; inset:0`），不继承那份
 *   padding，所以它的 0 点就在窗口最顶端。
 *   我们的 dock 原本 `top: 0; bottom: 0` 铺满，44px 宽的活动栏直接压在
 *   Windows 的最小化/最大化/关闭按钮上，系统按钮点不动。
 *
 * 修复要点（本测试逐条锁定）：
 *   1. 顶部内缩到 DSH 发布的 `--dsh-frame-top-clearance`
 *   2. 左侧内缩到 `--dsh-frame-leading-clearance`（macOS 折叠侧栏占位）
 *   3. 限制最大高度，不超出 overlay 层减去内缩后的可用区域
 *   4. 活动栏可滚动，按钮不被压扁（否则小窗口下按钮仍点不到）
 *
 * 用法: node --experimental-strip-types --test tests/dock-size.test.ts
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const CSS_TS = path.join(ROOT, 'src/plugin/styles.ts')

const cssSource = fs.readFileSync(CSS_TS, 'utf-8')

/** 取某个选择器规则块的正文（只支持平铺规则，够用）。 */
function ruleBody(selector: string): string {
  const idx = cssSource.indexOf(selector)
  assert.ok(idx >= 0, `未找到选择器 ${selector}`)
  const open = cssSource.indexOf('{', idx)
  const close = cssSource.indexOf('}', open)
  return cssSource.slice(open + 1, close)
}

test('顶部安全距离取自 DSH 发布的标题栏令牌', () => {
  // 变量声明在 [data-xechat-dsh] 作用域块里，不在 :root
  assert.match(
    cssSource,
    /--xds-inset-top:\s*var\(--dsh-frame-top-clearance,\s*0px\)/,
    '顶部内缩必须引用 --dsh-frame-top-clearance：overlay 层不吃 frame 的 padding-top，' +
      '不自己下移会盖住 Windows 的最小化/最大化/关闭按钮',
  )
})

test('左侧安全距离取自 leading 占位令牌（macOS 折叠侧栏）', () => {
  assert.match(
    cssSource,
    /--xds-inset-left:\s*var\(--dsh-frame-leading-clearance,\s*0px\)/,
    '缺少 leading 占位：macOS 折叠侧栏后 dock 会压住重开/New Session 控件',
  )
  assert.match(
    cssSource,
    /\.xds-root\[data-side='left'\]\s*\{\s*left:\s*var\(--xds-inset-left\)/,
    '左侧停靠时未应用安全距离',
  )
})

test('dock 容器不再铺满整个 overlay 高度', () => {
  const body = ruleBody('.xds-root')
  assert.match(body, /top:\s*var\(--xds-inset-top\)/, '.xds-root 的 top 未内缩到标题栏下方')
  assert.match(body, /bottom:\s*var\(--xds-inset-bottom\)/, '.xds-root 的 bottom 未留出边距')
  assert.doesNotMatch(body, /^\s*top:\s*0;/m, '.xds-root 的 top 仍为 0，会覆盖标题栏')
})

test('容器最大高度受限于可用区域', () => {
  const body = ruleBody('.xds-root')
  assert.match(
    body,
    /max-height:\s*calc\(100%\s*-\s*var\(--xds-inset-top\)\s*-\s*var\(--xds-inset-bottom\)\)/,
    '缺少 max-height 约束：窗口变矮时 dock 会溢出或把按钮挤出可视区',
  )
})

test('活动栏高度受限时可滚动，按钮不被压缩', () => {
  const activity = ruleBody('.xds-activity')
  assert.match(activity, /overflow-y:\s*auto/, '活动栏未设置 overflow-y，按钮多时会溢出到可视区外')
  const btn = ruleBody('.xds-activity-btn')
  assert.match(btn, /flex:\s*0 0 32px/, '按钮未锁定高度，flex 收缩会把按钮压扁导致点不到')
})

test('内容面板允许在容器内收缩（min-height: 0）', () => {
  const panel = ruleBody('.xds-panel')
  assert.match(panel, /min-height:\s*0/, 'panel 缺少 min-height: 0，flex 子项无法收缩会撑破容器')
})

test('运行时也会写入 top（令牌晚于挂载发布时兜底）', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'src/plugin/DockShell.tsx'), 'utf-8')
  assert.match(
    shell,
    /--dsh-frame-top-clearance/,
    'DockShell 未读取 --dsh-frame-top-clearance：宿主可能在全屏切换后才写入该令牌',
  )
  assert.match(shell, /addEventListener\('resize'/, '未监听 resize，全屏切换后顶部偏移不会更新')
})

/**
 * 回归：点击宿主侧边栏的按钮后，插件必须能让位。
 *
 * 真实故障（2026-10-22）：面板展开时宽度 380px 常驻，宿主的
 * 折叠/新建等控件被压或在层级上抢不过 overlay 层，点了没反应。
 * 修复是引入三态 visibility：收起/暂停时宽度归零、面板不占位置。
 *
 * 注意（2026-10-29）：让位只靠隐藏实现，不再销毁面板 DOM —— 销毁会连带
 * 卸载 Vue 应用，重建时丢登录态并新开 WebSocket，导致消息重复投递。
 */
test('收起/暂停只隐藏面板，不占宽度（DOM 保留）', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'src/plugin/DockShell.tsx'), 'utf-8')
  assert.match(shell, /const expanded = layout\.open && layout\.visibility === 'open'/, 'expanded 判定缺失')
  // 面板始终渲染，收起时靠 display:none 让出位置
  assert.match(shell, /const panel = createElement\(/, '面板应始终渲染（收起时隐藏），否则会连带卸载 Vue 应用')
  assert.match(
    shell,
    /expanded \? null : \{ display: 'none' \}/,
    '收起时未隐藏面板：不做 display:none 面板会继续占宽度',
  )
  // 暂停态整块隐藏，但保留恢复入口
  assert.match(shell, /paused \? \{ display: 'none' \} : null/, '暂停态未隐藏 dock')
  assert.match(shell, /className: 'xds-restore'/, '缺少暂停态的恢复入口')
})

test('暂停态保留一个恢复入口（否则藏起来再也调不回来）', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'src/plugin/DockShell.tsx'), 'utf-8')
  assert.match(shell, /className: 'xds-restore'/, '缺少恢复热区')
  assert.match(shell, /visibility: 'open'/, '恢复按钮未把状态切回 open')
  const restore = ruleBody('.xds-restore-btn')
  assert.match(restore, /pointer-events:\s*auto/, '恢复按钮未恢复指针事件，点不到')
  assert.match(restore, /opacity:\s*0\.35/, '恢复按钮底色应弱化，避免视觉上挡内容')
})

/**
 * 回归（2026-10-29）：收起/展开**不得**卸载 Vue 应用。
 *
 * 卸载会丢掉当前登录账号与在线列表，并且下次挂载会重新 init 传输层，
 * 在服务端留下多条同账号会话 —— 表现就是「每个人发的消息都显示两遍」。
 * 因此挂载 effect 只依赖 module，cleanup 仅在插件停用/重载时执行。
 */
test('收起/展开不卸载 Vue 应用（保留登录态与 WebSocket）', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'src/plugin/DockShell.tsx'), 'utf-8')
  const mountEffect = shell.slice(shell.indexOf('// 把 Vue 应用挂到宿主节点'))
  assert.doesNotMatch(mountEffect, /if \(!expanded/, '挂载 effect 不应依赖 expanded：收起会触发卸载')
  assert.match(mountEffect, /\}, \[module\]\)/, 'effect 依赖应为 [module]：dep 里带 expanded 会导致收起即卸载')
  // 仍需保证插件卸载时能干净退出
  assert.match(mountEffect, /handleRef\.current\?\.unmount\(\)/, '插件卸载时仍需卸载 Vue 应用')
  // 防重入：StrictMode 下 effect 会跑两遍
  assert.match(mountEffect, /if \(handleRef\.current\) return/, '缺少重复挂载保护，StrictMode 下会挂两次')
})

test('左侧停靠时监听宿主侧栏收起状态', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'src/plugin/DockShell.tsx'), 'utf-8')
  assert.match(shell, /MutationObserver/, '未监听宿主 DOM 变化，宿主侧栏收起时无法自动让位')
  assert.match(
    shell,
    /data-sidebar-collapsed/,
    '未观察 data-sidebar-collapsed：DSH 折叠侧栏后其控件会变成 fixed，会与本插件抢层级',
  )
})
