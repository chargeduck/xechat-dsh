# xechat-dsh

> XEChat 的 DeepSeek Harness 侧边栏客户端：可停靠的摸鱼聊天面板，写代码时鱼塘不掉线。

`xechat-dsh` 是 `xechat-web` 的 DSH 移植版。与原版不同，它不依赖任何 IDE 插件宿主，
作为 DSH Web UI 的独立插件运行，只用一条 WebSocket 连接 XEChat 服务端。

## 功能

- **可停靠侧边栏**：贴靠视口左侧或右侧，一键切换；面板宽度可拖拽调节（280–720px）。
- **聊天**：Markdown 渲染、图片消息、表情、@ 提醒分级通知、跨塘邀请。
- **鱼塘管理**：`#showServer` 拉取鱼塘列表并探测 TCP/WS 存活，`#login` 登录指定服务器。
- **在线列表**：查看当前鱼塘在线用户及状态。
- **游戏**：从 manager 游戏大厅加载，单机游戏 iframe 运行，联机游戏由 MatchLobby SDK 承载房间。
- **内置浏览器**：受限站点可切到系统浏览器打开；容器配色跟随主题，可叠加降亮遮罩。
- **摸鱼防护**：紧急模式快捷键全屏显示伪装内容、面板透明度调节、主题切换。
- **布局持久化**：停靠位置、宽度、可视状态存入 `localStorage`，刷新后恢复。

## 安装

已发布到 npm，一条命令装好（装的是预构建产物，不会触发任何构建脚本）：

```sh
dsh plugin --profile web add xechat-dsh

# 桌面端（Electron）把 profile 换成 desktop
dsh plugin --profile desktop add xechat-dsh
```

不经过 npm，也可以直接装 GitHub Release 里同一份 tarball：

```sh
dsh plugin --profile web add https://github.com/chargeduck/xechat-dsh/releases/download/v0.1.1/xechat-dsh.tgz
```

仓库根目录另有一键脚本，会校验环境并验证安装结果：

```sh
# macOS / Linux
./install.sh

# Windows
install.bat
```

从源码安装（构建产物已提交进仓库，拉下来即可运行）：

```sh
dsh plugin --profile web add https://github.com/chargeduck/xechat-dsh
```

本地开发时链接源码目录：

```sh
dsh plugin --profile web add link:/absolute/path/to/xechat-dsh
```

安装后**重启 `dsh web`**（桌面端重启应用）并刷新页面。侧边栏出现在视口右侧，点击活动栏第一条图标开合。

详细说明见 [INSTALL.md](./INSTALL.md)。

### 本地开发

```sh
npm install
npm run dev          # 独立浏览器预览 Vue 应用（无需 DSH）
npm run build        # 先构建 Vue 应用，再打包插件 bundle
```

`npm run build` 产出：

| 文件 | 说明 |
| --- | --- |
| `lib/xechat-app.js` | Vue + Element Plus 应用（IIFE，全局 `__XECHAT_DSH_APP__`） |
| `lib/xechat-app.css` | 应用样式 |
| `lib/client.js` | 插件客户端 bundle（CJS 闭包，`__ModuleLoader__.load` 注册） |
| `lib/index.js` | 宿主侧（空实现） |

## 使用

登录需要一个可达的 XEChat 服务端：

```sh
# 直接指定地址
#login <用户名> -h <host> -p <port>

# 或先从鱼塘列表选
#showServer
#login <用户名> -s 0
```

常用命令：`#exit` 断开、`#showStatus` 查看状态、`#mode` / `#notify` / `#alive` 摸鱼相关开关、`#help` 查看全部。

## 权限与网络

| 项目 | 说明 |
| --- | --- |
| WebSocket | 连接 `ws://<host>:<port+1>/xechat`（用户通过 `#login` 或鱼塘列表指定） |
| HTTPS 请求 | 拉取鱼塘列表（默认 `https://dld.lesscoding.net/api/server/list`） |
| localStorage | 保存登录信息、面板布局、快捷键等偏好 |
| 凭据 | 插件不收集、不外传任何凭据；管理员 Token 仅存于本地并在登录时随 `LOGIN` 帧上报 |

插件不含遥测，不向第三方发送数据。

## 兼容性

| 依赖 | 版本 |
| --- | --- |
| DSH Web 客户端 | `>= 0.2.0-rc.1` |
| 运行时 | 仅 Web（`dsh.client.platform = "web"`）；桌面端需装到 `desktop` profile，TUI 不可用 |
| Node（构建期） | `>= 20` |
| react / react-dom | `^18.2.0`（peer，由 DSH Web shell 提供） |

DSH 处于 developer preview，接口可能变动。以上兼容性声明基于 2026-10 的公开文档，
宿主升级后请重新验证。

## 与原版（xechat-web）的差异

| 方面 | xechat-web | xechat-dsh |
| --- | --- | --- |
| 宿主 | IntelliJ 插件 / VSCode 扩展 | DSH Web 插件 |
| 传输 | JSBridge（JCEF）+ WebSocket | **仅 WebSocket** |
| 宿主通信 | `window.xechat.*`（getState/getTools/httpGet…） | 无，全部走 WS 或 `fetch` |
| 工具面板 | 有（宿主下发工具列表） | 已移除（纯 WS 无数据源） |
| 文字样式管理 | 工具面板进入 | 设置面板进入 |
| 外链打开 | 宿主原生浏览器 | `window.open` 新标签 |
| 图标资源 | 随插件打包 | 同左，样式与 DSH 令牌对齐 |

## 已知限制

- 面板内容区在打开时才挂载 Vue 应用；关闭面板即卸载，重新打开会重建 store（登录态保留在 localStorage 中，但当前会话需重连）。
- 自动隐藏（`edge` 模式）目前仅在布局层预留，未在 UI 暴露开关。
- 移动端窄视口下面板宽度受 `calc(100vw - 44px)` 限制。
- 游戏与浏览器面板依赖 manager 侧接口，离线环境下不可用。

## 许可

MIT，见 [LICENSE](./LICENSE)。
