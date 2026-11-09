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

/**
 * 回归（2026-11-09）：面板尺寸必须能让用户自己拖。
 *
 * 第一版把两条把手放在 `.xds-panel` 里，结果宽度把手（left:-5px 外溢）
 * 被面板的 overflow:hidden 裁得一点不剩，高度把手 6px 又被 Vue 内容压住——
 * 实测「悬停没有、拖不动」。现在两条把手都提到 `.xds-root` 层。
 */
test('尺寸把手挂在 root 层，不被面板的 overflow 裁剪', () => {
  const resizer = ruleBody('.xds-resizer')
  assert.match(resizer, /position:\s*absolute/, '宽度把手应为绝对定位')
  assert.match(resizer, /cursor:\s*col-resize/, '宽度把手缺少列向缩放光标')
  assert.doesNotMatch(
    resizer,
    /flex:\s*0 0/,
    '宽度把手不能作为 flex 子项：它贴在面板边缘，会被面板 overflow:hidden 裁掉',
  )

  const resizerH = ruleBody('.xds-resizer-h')
  assert.match(resizerH, /position:\s*absolute/, '高度把手应为绝对定位')
  assert.match(resizerH, /cursor:\s*row-resize/, '高度把手缺少行向缩放光标')
  assert.match(resizerH, /height:\s*1[0-9]px/, '高度把手至少 10px 高，6px 在桌面端根本点不到')

  const shell = fs.readFileSync(path.join(ROOT, 'src/plugin/DockShell.tsx'), 'utf-8')
  const panelStart = shell.indexOf('const panel = createElement(')
  const resizerStart = shell.indexOf('const widthResizer')
  assert.ok(panelStart > 0 && resizerStart > panelStart, '把手应在面板之后单独定义')
  assert.doesNotMatch(
    shell.slice(panelStart, resizerStart),
    /xds-resizer/,
    '把手不能放进 .xds-panel：面板 overflow:hidden（圆角裁切）会把贴边把手裁没',
  )
  assert.match(shell, /className: 'xds-resizer'/, '缺少宽度拖拽把手')
  assert.match(shell, /className: 'xds-resizer-h'/, '缺少高度拖拽把手')
  assert.match(shell, /patch\(\{ height: null \}\)/, '缺少「双击恢复铺满」的入口')
  assert.match(shell, /patch\(\{ width: DEFAULT_WIDTH \}\)/, '缺少「双击恢复默认宽度」的入口')
  assert.match(shell, /resolveHeight\(layout\.height/, '渲染高度未按当前视口夹取，窗口变矮会把面板顶出可视区')
  // 拖到窗口外松手时也要收尾，否则会卡在拖拽态
  assert.match(shell, /setPointerCapture/, '拖拽未捕获指针，移出窗口后 pointerup 会丢')
  assert.match(shell, /pointercancel/, '缺少 pointercancel 兜底')
})

/**
 * 回归（2026-11-09）：设置面板支持直接输入像素。
 *
 * 拖拽只能粗略调，且把手始终不够显眼；给一个能输数字的入口，
 * 宽/高都能精确到 px，高度留空表示铺满。
 */
test('设置面板可直接输入宽高 px', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'src/plugin/DockShell.tsx'), 'utf-8')
  assert.match(shell, /className: 'xds-settings'/, '缺少尺寸设置面板')
  assert.match(shell, /type: 'number'/, '尺寸输入框应为 number 类型')
  assert.match(shell, /clampWidth\(value\)/, '宽度输入未经过 clampWidth，可以写入非法值')
  assert.match(shell, /clampHeight\(value, availableHeight\)/, '高度输入未按可用高度夹取')
  assert.match(shell, /placeholder: '铺满'/, '高度留空的语义（铺满）未在 UI 上说明')

  const input = ruleBody('.xds-field input')
  assert.match(input, /width:/, '输入框缺少宽度，数字会挤在一起')
  assert.match(input, /text-align:\s*right/, '数字右对齐更易读')
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

/**
 * 回归（2026-11-09）：只在窗口最底部放一条高度把手，用户在面板上沿找不到。
 * 上沿补一条对称把手；两条把手各自抓自己那条边。
 *
 * 第二轮实测故障：上沿往下拖时整个面板「缩到右上角」——因为容器是 top 锚定，
 * 旧代码只减 height，动的是**底边**。现在顶边把手同步改 topOffset，
 * 保持底边位置不变，顶边才真正跟着鼠标走。
 */
test('面板上沿与下沿都有高度拖拽把手，且各拖各的边', () => {
  const shell = fs.readFileSync(path.join(ROOT, 'src/plugin/DockShell.tsx'), 'utf-8')
  assert.match(shell, /'data-edge': 'top'/, '缺少顶部高度把手')
  assert.match(shell, /'data-edge': 'bottom'/, '缺少底部高度把手')
  assert.match(shell, /topHeightResizer,/, '顶部把手未挂到 .xds-root 的子节点里')
  assert.match(
    shell,
    /resizeFromEdge\(start, delta, availableHeight\)/,
    '拖拽计算未走按边处理的纯函数（layout.ts 有数值化回归用例）',
  )
  assert.match(
    shell,
    /top: \(topInset > 0 \? topInset : 0\) \+ renderedTopOffset/,
    '渲染时未应用顶边偏移，拖动结果不会体现在面板位置上',
  )
  assert.match(shell, /next\.height === null\s*\?\s*0/, '恢复铺满时未清零顶边偏移，面板会悬在半空')
  assert.match(cssSource, /\.xds-resizer-h\[data-edge='top'\] \{ top: 0; \}/, '顶部把手未贴在面板上沿')
})

/** 回归：设置页（Vue 应用内）也要有宽高输入框，不能只藏在活动栏齿轮里。 */
test('设置页提供宽高 px 输入并与外壳双向同步', () => {
  const panel = fs.readFileSync(path.join(ROOT, 'src/views/settings/SettingsPanel.vue'), 'utf-8')
  assert.match(panel, /面板尺寸/, '设置页缺少「面板尺寸」区块')
  assert.match(panel, /宽度 \(px\)/, '设置页缺少宽度输入框')
  assert.match(panel, /高度 \(px\)/, '设置页缺少高度输入框')
  assert.match(panel, /xechat-dsh:set-size/, '设置页未把尺寸写给外壳')
  assert.match(panel, /xechat-dsh:layout/, '设置页未回显外壳布局')

  const shell = fs.readFileSync(path.join(ROOT, 'src/plugin/DockShell.tsx'), 'utf-8')
  assert.match(shell, /addEventListener\('xechat-dsh:set-size'/, '外壳未监听尺寸设置事件')
  assert.match(shell, /dispatchEvent\(new window\.CustomEvent\('xechat-dsh:layout'/, '外壳未广播布局')
})

/**
 * 回归：历史消息只有时间和正文，丢掉了昵称/地区/状态/平台。
 * 服务端 HISTORY_MSG 每条是 Response{user, body, type, time}，
 * user 在顶层；旧代码读 item.body.user 恒为 undefined。
 */
test('历史消息从 Response 顶层 user 读取昵称与平台', () => {
  const store = fs.readFileSync(path.join(ROOT, 'src/store.js'), 'utf-8')
  const history = store.slice(store.indexOf("on('history'"))
  assert.match(
    history,
    /const userObj = item\.user \|\| \(item\.body && item\.body\.user\)/,
    '历史消息未从顶层 user 取用户信息，消息头会只剩 [时间]',
  )
  assert.match(history, /user: userObj/, '消息头未使用解析出的用户对象')
  assert.doesNotMatch(history, /user: item\.body && item\.body\.user/, '仍在读不存在的 item.body.user')
})
