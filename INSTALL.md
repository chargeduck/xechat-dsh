# xechat-dsh 安装说明

DSH（DeepSeek Harness）侧边栏聊天插件。本文分「普通用户安装」「开发者本地安装」「发布与上架」三部分。

---

## 一、先确认环境

| 项目 | 要求 |
| --- | --- |
| DSH 版本 | **0.2.0-rc.1 及以上**（`package.json` 的 `engines.dsh` 声明） |
| 平台 | **仅 DSH Web 客户端**（`dsh.client.platform: "web"`）。桌面端 Electron 走的是 `desktop` profile，需单独安装，见第四节 |
| Node | ≥ 20（只有源码安装/本地构建时才需要） |
| 网络 | 需要能连到 XEChat 服务端（默认端口在插件设置里指定） |

---

## 二、普通用户安装（推荐：预构建包）

预构建包已把 Vue 应用、CSS 与插件壳全部打进去，**安装时不需要执行任何构建脚本**，
因此可以跳过 pnpm ≥10 的 `allowBuilds` 构建授权步骤。

### 最快方式：npm

包里已经是预构建产物，装的时候不会跑任何构建脚本：

```sh
dsh plugin --profile web add xechat-dsh        # Web
dsh plugin --profile desktop add xechat-dsh    # 桌面端（Electron）
```

### 次快方式：一键脚本

仓库根目录有三个等价脚本，按你的系统选一个。它们会**先检查环境、再安装、最后用
dsh 自己的解析器验证**，任何一步失败都会明确告诉你要改什么。

**Windows：**

```bat
install.bat
```

双击也可以（会停在窗口里让你看结果）。它只是 `install.ps1` 的启动器——
逻辑只写一份，避免两种语言各自实现后行为漂移。

**Windows（直接调 PowerShell）：**

```powershell
.\install.ps1
```

若提示脚本被禁止运行，加 `-ExecutionPolicy Bypass`（只对本次进程生效，不改系统设置）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

**macOS / Linux：**

```sh
chmod +x install.sh
./install.sh
```

三个脚本都支持这些参数（sh 用 `--`，PowerShell 用 `-`）：

| 用途 | sh | PowerShell / bat |
| --- | --- | --- |
| 装到桌面端 | `--profile desktop` | `-Profile desktop` |
| 指定本地包 | `--tgz a.tgz` | `-Tgz a.tgz` |
| 从仓库装 | `--repo owner/repo` | `-Repo owner/repo` |
| 只检查环境 | `--dry-run` | `-DryRun` |
| 卸载 | `--uninstall` | `-Uninstall` |
| 跳过确认 | `--yes` | `-Yes` |

脚本的验证逻辑值得单独说明：它不只看 pnpm 是否报成功（那个结论**不可靠**，
dsh 的 reconcile 早于 pnpm 写入完成，会误报失败；反过来也曾出现报成功但目录为空），
而是逐项检查四个关键文件是否存在、`dsh.profile.bundles` 是否注册，
最后跑一次 `dsh --dump-config` 当作终审。

> ⚠️ 如果终审报 `failed to parse overlay ... YAMLException`，那是 **profile 的
> `cordis.patch.yml` 本身坏了**（多根节点），不是插件问题。脚本会明确指出来。

### 方式 A：从 GitHub Release 安装

把 `xechat-dsh.tgz` 下载到本地后：

```sh
dsh plugin --profile web add file:/绝对路径/xechat-dsh.tgz
```

或者直接用 Release 的在线地址（DSH 支持 `https:` 直链）：

```sh
dsh plugin --profile web add https://github.com/chargeduck/xechat-dsh/releases/latest/download/xechat-dsh.tgz
```

### 方式 B：从插件市场一键安装

收录通过后，在 DSH 里安装市场应用：

```sh
dsh plugin --profile web add dshmarket
```

重启 `dsh web`，打开 **Settings → Plugin Market**，搜索 `xechat`，点安装。
市场会优先选用预构建 tarball，效果与方式 A 相同。

### 方式 C：从源码安装

源码安装会触发 pnpm 的构建脚本审批（pnpm ≥10 默认阻止），需要你逐包放行：

```sh
dsh plugin --profile web add https://github.com/chargeduck/xechat-dsh
```

如果卡在 `allowBuilds` 提示，按终端给出的提示逐个批准后重试即可。

---

## 三、安装后

1. **重启 DSH Web 服务**，然后刷新浏览器页面。
2. 侧边栏出现在视口**右侧**，是一条 44px 宽的图标条。
3. 点最上面的箭头展开面板；面板顶部有：

| 按钮 | 作用 |
| --- | --- |
| ◀ / ▶（第一条） | 收起 / 展开面板 |
| 聊天气泡 | 回到聊天页 |
| 方框图标 | 左右停靠切换 |
| 双箭头（最后一条） | **完全隐藏**，只在侧边留一条 14px 细条，点细条恢复 |

4. 面板宽度可拖拽左边缘调整（280–720px），停靠位置与宽度存入 `localStorage`，刷新后保持。

### 登录 XEChat 服务器

插件**不带默认服务器**，首次使用需要在聊天输入框里登录：

```
#showServer                      拉取鱼塘列表并探测存活
#login <鱼塘名>                  登录指定鱼塘
#login -h 1.2.3.4 -p 9000        直接指定地址与端口
#exit                            断开连接
```

图片下载走 WebSocket 端口 + 1（例如 ws 用 9000，图片服务在 9001）。

### 常见问题

**内置浏览器的白色页面和暗色主题不搭？**
设置里有两个选项：
- **浏览器配色**：跟随主题 / 深色 / 浅色 / 不做处理。控制 iframe 外框与加载前后露出的底色。
- **网页降亮**：0–60%，给网页盖一层半透明遮罩，缓解整块白屏的刺眼感。设为 0 即关闭。

两者都**只作用于容器与遮罩**，不改写网页内部样式。原因是内置浏览器用 `<iframe>` 承载页面，
对 B 站、知乎这类跨源站点，同源策略禁止父页面读写其内部 DOM，所以做不到 DarkReader
那种逐元素反色。遮罩是 `pointer-events: none`，页面内的点击、滚动、拖选都不受影响。

如果你内嵌的是**自己的本地服务**（同源），插件会额外给它注入 `color-scheme`，
让原生滚动条、输入框跟随深浅色。

**侧边栏挡住了窗口的最小化/最大化/关闭按钮？**
已在 0.1.0 修复：面板高度会避开窗口标题栏（读取 DSH 发布的 `--dsh-frame-top-clearance`）。
如果仍被遮挡，说明你的 DSH 版本没有发布这个令牌，请反馈 DSH 版本号。

**点活动栏的关闭按钮没反应？**
把插件「完全隐藏」后，恢复入口是侧边一条淡化的细条，鼠标移上去会变亮。

**面板打开后内容区空白 / 提示「xechat 应用包加载失败」？**
多半是产物问题，按 F12 看 Console 里以 `xechat-dsh` 开头的报错。开发者可运行
`npm run verify:bundle` 自查。

**macOS 上折叠左侧栏后插件位置不对？**
插件会读取 `--dsh-frame-leading-clearance` 避让；左侧停靠时，宿主折叠侧栏还会自动把插件收成图标条。

---

## 四、桌面端（Electron）安装

**先试一键脚本**，它已包含本节的全部步骤：

```powershell
.\install.ps1 -Profile desktop
```

如果脚本走到最后一步报 `managed exclusively by the Electron application`，
说明该 profile 由应用独占管理，CLI 无法验证加载结果——**这不算失败**，
直接用应用重启确认即可。

如果 pnpm 在该 profile 下误判「已安装」并静默跳过（实测会遇到），
改用目录联接（junction）：

```powershell
# 1. 先完全退出 DeepSeek Harness（否则写入会被静默丢弃）
New-Item -ItemType Junction `
  -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\xechat-dsh" `
  -Target "E:\path\to\xechat-dsh"
```

```jsonc
// 2. 编辑 %USERPROFILE%\.dsh\profiles\desktop\package.json，追加两处
{
  "dependencies": { "xechat-dsh": "link:E:/path/to/xechat-dsh" },
  "dsh": { "profile": { "bundles": ["...", "xechat-dsh"] } }
}
```

重启 DeepSeek Harness 即可。用 junction 的好处是改完源码重新 `npm run build` 就生效，不用重装。

---

## 五、开发者：本地构建

```sh
npm install

npm run build        # 两步：vite 打 Vue 应用 → tsdown 打包插件
npm test             # 36 项测试
npm run verify:dock  # 真实渲染验证三态（open / collapsed / paused）
npm run verify:bundle # 端到端验证 client.js 加载链路

npm pack             # 产出 xechat-dsh-0.1.0.tgz
```

构建产物：

| 文件 | 说明 |
| --- | --- |
| `lib/xechat-app.js` | Vue 应用 IIFE，约 3.9 MB |
| `lib/xechat-app.css` | 应用样式，约 446 KB |
| `lib/client.js` | 插件客户端 bundle（CJS 闭包，内联了上面两个），约 4.5 MB |
| `lib/index.js` | host half，ESM，Node 侧空实现 |

> `lib/client.js` 是**构建产物，必须提交到仓库**。市场走源码安装时不会为你跑构建，
> 而且仓库里没有 `node_modules` 也跑不了。
