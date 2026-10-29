# ChangeLog

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
