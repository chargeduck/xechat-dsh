# ChangeLog

## 0.2.3

npm 上的 `xechat-dsh@0.2.2` 已由其他维护者基于提交 `9d41cd2` 发布；
`0.2.0` / `0.2.1` 从未发布到 npm（registry 里是 `0.1.1` → `0.2.2` 直接跳版）。
为避免覆盖已发布的 `0.2.2`，本批次以 **0.2.3** 发版。

本节合并自 `0.1.1` 以来的全部开发改动（含此前标记为 0.2.0 的内部测试批次），
`npm pack` 产物为 `xechat-dsh-0.2.3.tgz`。

### 修复

- **历史消息只有时间和正文**：服务端 `HISTORY_MSG` 的每条记录是
  `Response{user, body, type, time}`，昵称/地区/状态/平台都在**顶层 `user`**，
  而 `body` 是 `UserMsgDTO{content, msgType, toUsers}`。旧代码读 `item.body.user`
  恒为 `undefined`，`_formatUserMessageHead()` 只能拼出 `[时间] ：`。
  现改为 `item.user || item.body.user`（后者兼容老帧），mask 过滤也用同一对象。
  `xechat-web` 里同源的这段逻辑一并修正。
- **面板上沿往下拖，整个窗口缩到右上角**：`.xds-root` 是 top 锚定的
  （`top` 固定 + `bottom:auto` + 固定 `height`），旧实现拖上沿只减 `height`，
  结果动的是**底边**（往上缩），顶边反而不跟鼠标。现在布局模型新增
  `topOffset`（随 localStorage 持久化）：抓上沿时保持
  「底边位置 = topOffset + height」不变，同步改 `topOffset`，顶边才真正跟随鼠标；
  抓下沿时 `topOffset` 不变、顶边固定，底边跟随鼠标。恢复铺满时偏移清零，
  窗口变矮时按可用高度重新夹取。

### 新增

- **面板上沿也能 hover 出高度拖拽条**：此前只有贴在窗口最底部的一条（还带
  8px 内缩），极难发现。现在上沿、下沿各一条，上沿抓握线更长更亮；
  上沿向上拉变高、向下压变矮，下沿向下拉变高，双击都恢复铺满。
- **设置 → 面板尺寸**：Vue 应用内直接输入宽/高 px（无需再找活动栏齿轮），
  高度留空为铺满，另有「恢复默认」「在侧栏打开尺寸浮层」。
  设置页与外壳通过 `xechat-dsh:set-size` / `xechat-dsh:layout` 事件双向同步，
  拖拽后的实际值会回显到输入框。

### 平台来源图标

按平台区分来源，在线列表与消息头改用平台图标。

#### 变更

- 登录上报的 `platform` 从 `WEB` 改为 `DSH`（本前端只跑在 DeepSeek Harness 里），
  服务端与其它客户端据此区分用户是从浏览器、VS Code、IDEA 还是 DSH 进来的。
- 新增 `src/utils/platform.js`：服务端 `Platform` 枚举值 -> 内联 SVG 图标 + 中文名，
  图标使用 `currentColor`，明暗主题自动跟随文字色。
- 在线用户列表、聊天消息头都改为渲染对应平台图标（未知平台不显示图标）。
- 消息头用 `{{pf:XXX}}` 占位符，`MarkdownMessage` 渲染时替换为 SVG，避免经过
  markdown 转义与 XSS 白名单被吃掉。

### 拖拽把手与尺寸设置

修复 0.2.0 拖拽把手不可用，并补上像素级尺寸设置。

#### 修复

- **宽度把手失效**：0.2.0 把宽度热区放进 `.xds-panel` 并定位在 `left: -5px`，
  而面板有 `overflow: hidden`（圆角裁切需要），热区被整条裁掉 ——
  既看不见也拖不动。宽高两个把手现在都挂到 `.xds-root` 层（root 没有 overflow），
  彻底不受面板裁剪与内部 Vue 应用层级影响。
- **高度把手找不到**：6px 太窄且压在内容下方。加宽到 12px，
  常驻一条 46×3 的抓握线（hover 变强调色并加长到 76px）。
- 宽度把手补上常驻竖线提示，并支持双击恢复默认宽度 380px。

#### 新增

- **活动栏齿轮按钮 → 面板尺寸设置**：直接输入像素调整宽度与高度
  （宽度 280–720，高度 240–当前可用高度），高度留空等于铺满；
  回车或失焦生效，非法值自动回滚，另有「恢复默认」。
- 拖拽时捕获指针（`setPointerCapture`）并监听 `pointercancel`，
  拖到窗口外松手不会再卡在拖拽态；补 `touch-action: none` 与
  `user-select: none`，触控板拖拽不误触滚动、不选中文字。

## 0.2.0

> 内部测试批次，未发布到 npm；全部内容已并入 0.2.3。

侧边栏高度可调。

### 新增

- **面板高度可上下拖动**：面板底边新增一条 6px 高的抓握条（悬停出现短横线提示），
  按住上下拖动即可把面板拉高或压低，范围 240px ~ 当前视口可用高度。
  **双击抓握条恢复铺满**（回到跟随窗口的默认行为）。
  高度存进 `localStorage`（`xechat-dsh:layout` 的 `height` 字段，`null` = 铺满），
  刷新与重启后保持不变；窗口变矮时渲染高度会自动收敛，不会把面板顶出可视区，
  窗口拉回来后仍恢复成用户自己拖的那个高度。
- 宽度与高度两个拖拽条统一锚到面板自身（`.xds-panel { position: relative }`），
  左停靠时宽度热区不再偏到活动栏外侧。

### 说明

- 未拖过高度时行为与 0.1.x 完全一致（铺满可用高度），升级不会改变现有布局习惯。
- 新增 `tests/layout.test.ts` 中 `clampHeight` / `resolveHeight` / 持久化用例，
  以及 `tests/dock-size.test.ts` 中高度热区的契约用例。

## 0.1.1

修复侧边栏生命周期导致的两个连接层问题。

### 修复

- **收起再展开后登录态丢失**：旧实现收起即销毁面板 DOM 并卸载 Vue 应用，
  再次展开会重建 Pinia 与传输层，当前账号、在线列表、历史消息全部丢失。
  现在收起/暂停只做 `display:none` 隐藏，Vue 应用与 WebSocket 继续存活；
  真正重建应用的场景（宿主刷新、插件停用后重启）会按上次会话静默恢复登录
  （登录信息存 `xechat_session_v1`，`#exit` 主动退出时清除）。
- **消息重复显示（开关 N 次后同一条消息显示 N 条）**：`TransportManager.init()`
  每次挂载都 `new WebSocketTransport()` 却不关闭上一个，旧连接仍在服务端保持会话，
  一条广播被每条连接各投递一次，再经共享事件表重复进 UI。
  现在 `init()` 幂等复用现有实例（地址变化才重建），`connect()` 在
  `CONNECTING` 期间也不重复建 socket；`loginToServer()` 在连接已就绪且地址相同时
  直接补发 LOGIN，不再「断开-重连」。
- **插件热更新后仍运行旧应用包**：应用包以 Blob URL 缓存在 `window.__XECHAT_DSH_APP__`，
  旧实现无版本判断直接复用，导致升级后新代码不生效。现在按产物指纹校验，
  指纹变化即丢弃旧全局与旧 Blob URL 重新加载。

### 其他

- 插件卸载时主动断开传输层，避免服务端残留会话。
- 新增 `tests/transport-session.test.ts`：覆盖重复 init 复用连接、
  单条服务端帧只投递一次、连接中重复 connect 不叠加、地址变化重建。

## 0.1.0

首个 DSH 版本，由 `xechat-web` 改造而来。

### 改造要点

- **传输层**：移除 JSBridge（JCEF `CefMessageRouter`），仅保留 WebSocket 通道。
  删除 `transport-jsbridge.js`，`transport-manager.js` 简化为单一 WS 实现。
- **宿主解耦**：删除整个 `window.xechat` 命名空间依赖（`getState` / `getTools` /
  `httpGet` / `testConnection` / `openExternal` / `execCommand` / `ready`），
  外链改由浏览器 `window.open` 打开，HTTP 探测统一用 `fetch`。
- **工具面板下线**：原「工具」页依赖宿主下发的工具列表，纯 WS 模式无此数据源，故移除；
  「文字样式管理」入口迁移到设置面板。
- **插件化**：新增 React 壳（Dock 侧边栏）+ Vue 应用双运行时。
  Dock 可停靠左右两侧、拖拽调宽、自动隐藏，布局持久化到 `localStorage`。
- **构建**：Vue 应用产出 IIFE（`lib/xechat-app.js`），由插件 bundle 以字符串内联，
  运行期转 Blob URL 注入；插件 client 产物为 CJS 闭包，
  通过 `window.__ModuleLoader__.load` 注册。

### 已知限制

- 仅支持 DSH Web 客户端（`platform: web`），桌面端与 TUI 不可用。
- 服务端地址需通过 `#login -h <host> -p <port>` 指定，或从鱼塘列表 `#showServer` 选择。
- 游戏面板、内置浏览器面板行为与 `xechat-web` 一致，仍依赖 manager 侧能力。
