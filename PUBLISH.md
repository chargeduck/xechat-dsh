# 上架插件市场（收录指南）

## 先纠正一个前提

你要推的 `https://github.com/dsh-market/dsh-market` **不接受插件条目 PR**。

它是**市场应用本身**——一个装在 DSH 里的插件（包名 `dshmarket`），负责浏览、搜索、一键安装。
它的 README 原话：

> **This repo is the market app, not the catalog.**
> Please don't PR plugin entries against this repo.

它展示的 4200+ 插件全部来自另一个仓库：

```
https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
```

数据流转是这样的：

```
你提 PR ──▶ awesome-dsh-plugin/data/plugins/<owner>__<repo>.yml
                          │
                    CI 校验 + 维护者评审 + 合并
                          │
                          ▼
              https://awesome-dsh-plugin.com/plugins.json
                          │
              ┌───────────┴───────────┐
              ▼                       ▼
       dsh-market 市场应用        官网列表页
```

所以：**向 awesome-dsh-plugin 提交一条 YAML，市场和官网都会自动收录，通常一天内生效。**
向 dsh-market 提交 PR 只会被关闭。

---

## 前置条件清单

提交前逐条对一遍，这些都是 CI 会机器校验的：

| # | 条件 | 你的当前状态 |
| --- | --- | --- |
| 1 | `package.json` 声明 `dsh.bundle`（**只有 `dsh.client` 不可安装**） | ✅ 已有，见下 |
| 2 | 仓库根目录有 `cordis.patch.yml` | ✅ 已有 |
| 3 | 仓库真实可用，非占位/纯 README | ✅ |
| 4 | **仓库创建满 1 天** | ⚠️ 需要先建仓库并等待 |
| 5 | 仓库添加 `dsh-plugin` topic | ⚠️ 建仓库时加 |
| 6 | 描述只讲功能，不带营销词、数字须与代码相符 | ✅ 已按实际功能写 |
| 7 | 预构建包（可选但强烈推荐） | ✅ `xechat-dsh.tgz` 已产出 |

`dsh.bundle` 部分当前内容：

```jsonc
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },   // ← 这一行决定能不能装
  "client": { "platform": "web" }                 // ← 只带前端 UI 才需要
}
```

---

## 完整操作步骤

### 步骤 1：把代码推上 GitHub

插件目录目前**还不是 git 仓库**（没有 `.git`）。先初始化并推送：

```sh
cd E:/private/javaCode/xechat/xechat-dsh

git init
git add .
git commit -m "feat: DSH 侧边栏聊天插件首个版本"

# 替换成你自己的地址
git remote add origin https://github.com/chargeduck/xechat-dsh.git
git branch -M main
git push -u origin main
```

**必须提交的产物**（`lib/` 已在 `.gitignore` 里被忽略的话要放开）：

| 文件 | 为什么必须提交 |
| --- | --- |
| `lib/client.js` | 市场走源码安装时不会替你构建，仓库里没产物就装不上 |
| `lib/xechat-app.js` · `lib/xechat-app.css` | 被内联进 `client.js` 的源，重装/重构建时才用得到，一并提交更稳 |

同时把 `package.json` 里的仓库地址改成真实地址（现在是占位符 `xechat/xechat-dsh`）：

```jsonc
"repository": { "type": "git", "url": "git+https://github.com/chargeduck/xechat-dsh.git" }
```

> 这个字段很重要：条目文件本身不写 owner，市场的「仓库 ↔ 条目」配对靠的就是它。
> 地址写错会导致 entry 与仓库关联不上。

### 步骤 2：在仓库设置里加 topic

仓库主页 → 右侧 About 齿轮 → Topics 填 `dsh-plugin`。

### 步骤 3：发 GitHub Release 并附上 tarball

```sh
# 在项目目录执行，产物是 xechat-dsh-0.1.0.tgz
npm pack
```

到仓库 **Releases → Draft a new release**：

1. Tag 填 `v0.1.0`
2. 把 `xechat-dsh-0.1.0.tgz` 拖进附件区
3. **把附件重命名为 `xechat-dsh.tgz`**（去掉版本号）

第 3 步不能省。清单里的 tarball 链接用 `latest/download/`，它只在**请求时**解析 `latest`，
**文件名是照字面取的**。带版本号的文件名在下次发版后会 404，而且不会有人发现。

如果你更想保留版本号，就改用钉死 tag 的形式：

```yaml
tarball: https://github.com/chargeduck/xechat-dsh/releases/download/v0.1.0/xechat-dsh-0.1.0.tgz
```

### 步骤 4：Fork 并提交条目文件

Fork `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`，然后加**一个文件**：

```
data/plugins/chargeduck__xechat-dsh.yml
```

内容直接复制项目里的 `SUBMIT.yml`（已是最终版，无需修改）：

```yaml
url: https://github.com/chargeduck/xechat-dsh
name: chargeduck/xechat-dsh
category: ui
tarball: https://github.com/chargeduck/xechat-dsh/releases/latest/download/xechat-dsh.tgz
description:
  en: 'Dockable side panel that keeps an XEChat chat session connected over a single WebSocket: ...'
  zh: '可停靠的侧边面板，用一条 WebSocket 保持 XEChat 聊天在线：...'
```

几个易错点：

- **文件名格式**是 `<owner>__<repo>.yml`，两个下划线。大小写以 GitHub 实际为准。
- **不要手工编辑 README**。两个 README 由脚本从 YAML 生成，你改 README 会和别人冲突。
- **描述里有 `: `（冒号加空格）必须加引号**，否则 YAML 会把它解析成嵌套键。已备好引号。
- **一个 PR 最多 3 条**。你只提 1 条，不用担心。
- **只改自己的条目**，别动别人的描述，否则 gate 会把它们列出来质问。

然后开 PR，标题写清楚，例如：

```
Add xechat-dsh: dockable XEChat sidebar for the web client
```

### 步骤 5：等 CI 与评审

CI 依次检查：条目数 → `dsh.bundle` 是否存在 → 仓库年龄 → `awesome-lint` 与站点构建。
失败会指出具体原因，**在同一分支推修复即可，不用重开 PR**。

CI 绿了之后维护者会实际读一遍源码，核对描述里的每句话（尤其是数字和 API 名）。
所以描述写得越具体准确越好，别写「强大」「最佳」这类词。

---

## 关于分类

清单的合法分类有：

```
agi ui usage theme model identity session memory tools wsl browser
vision voice docs skill workflow git notify dev security remote market fun
```

你的是侧边栏聊天面板，选 **`ui`**。

分类**不会成为被打回的理由**——选得不够准，维护者会直接改。挑最接近的即可。

---

## 关于截图（可选）

市场详情页会展示 AppStore 式截图。规范要求在**你自己的仓库**里放 `screenshots.json`：

```jsonc
// <repo>/screenshots.json
["docs/screenshot-1.png", "docs/screenshot-2.png"]
```

规则：1–8 张；相对路径不能以 `/` 开头、不能含 `..`；也接受 `raw.githubusercontent.com` 等 GitHub 托管链接。

**当前项目里这个文件已被置空 `[]`** —— 因为原来指向的两张图并不存在，
留着会让市场显示 404 图片。等你真正截好图，再把路径填回去，推自己的仓库即生效，
不需要再来提 PR。

---

## 发布到 npm（可选）

想让市场显示下载量并按热度排序时再做。约束只有一条：
**已发布包的 `repository` 字段必须指回清单收录的那个仓库**，否则两者不会关联。

不需要通知任何人——映射从 registry 自动采集，条目里也没有 `npm:` 字段可填（手写会被校验拒绝）。

---

## 一页速查

```sh
# 1. 打包
cd E:/private/javaCode/xechat/xechat-dsh && npm pack

# 2. 推仓库（改掉 chargeduck）
git init && git add . && git commit -m "feat: init"
git remote add origin https://github.com/chargeduck/xechat-dsh.git
git push -u origin main

# 3. 加 topic: dsh-plugin（在 GitHub 网页上）

# 4. 发 Release v0.1.0，附件重命名为 xechat-dsh.tgz

# 5. Fork awesome-dsh-plugin，添加
#    data/plugins/chargeduck__xechat-dsh.yml
#    内容 = 项目里的 SUBMIT.yml，替换 chargeduck

# 6. 开 PR，等 CI，等合并（约 1 天）
```

**记住：PR 提到 `awesome-dsh-plugin`，不是 `dsh-market`。**
