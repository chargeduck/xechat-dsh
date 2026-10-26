# ChangeLog

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
