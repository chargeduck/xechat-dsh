import { defineStore } from 'pinia'

/**
 * helpStore - 预置 HELP 提示信息，不依赖 JSBridge 时序即可展示。
 * 匹配 HelpCommandHandler.java 输出格式。
 *
 * 命令帮助（#help 表格）与输入框 # 补全弹层共用同一份 COMMAND_DEFS 定义：
 * 新增/修改命令只需在 COMMAND_DEFS 加一行/改一行，帮助 md 与弹层列表自动生成，
 * 无需再手工维护两处（此前 helpText 手写表格 + ChatPanel 正则反解析的脆弱链路已废弃）。
 */

/**
 * @typedef {Object} HelpCommandDef
 * @property {string} command   命令名（不含 #），如 'login'
 * @property {string} [args]    参数占位，如 '{昵称} [-s 编号 -h IP -p 端口 -c]'；
 *                              可写裸 '|'（如 {0|1}），渲染 md 时自动转义
 * @property {string} desc      命令说明
 * @property {boolean} [inHelp] 是否展示在 #help 表格；默认 true，
 *                              false 时只出现在补全弹层（如 #loging 快捷登录）
 */

/**
 * 命令定义表（建议按 command 首字母升序维护；渲染时也会自动排序，顺序不敏感）
 * @type {HelpCommandDef[]}
 */
const COMMAND_DEFS = [
  { command: 'alive', args: '{0|1}', desc: '活着，0关闭 / 1开启' },
  { command: 'backgroundImage', desc: '切换背景图片' },
  { command: 'clean', desc: '清屏' },
  { command: 'exit', desc: '退出登录' },
  { command: 'help', desc: '显示此帮助' },
  { command: 'login', args: '{昵称} [-s 编号 -h IP -p 端口 -c]', desc: '登录鱼塘' },
  { command: 'loging', desc: '快速登录（默认服务器0）', inHelp: false },
  { command: 'mask', args: '[-@ -a -u 昵称 -r 省份 -i IP -c -n]', desc: '屏蔽管理，-c 解除所有 -a 屏蔽所有 -@ 被@禁止弹窗' },
  { command: 'mode', args: '{编号}', desc: '模式设置' },
  { command: 'moyu', desc: '摸鱼办生成' },
  { command: 'notify', args: '{1|2|3}', desc: '通知：1正常 / 2隐晦 / 3关闭' },
  { command: 'open', args: '[{编号}]', desc: '打开工具' },
  { command: 'setStatus', args: '{状态值}', desc: '设置当前状态' },
  { command: 'showGame', desc: '跳转游戏大厅' },
  { command: 'showKey', desc: '查看当前快捷键' },
  { command: 'showMode', desc: '查看模式选项' },
  { command: 'showServer', args: '[-c]', desc: '鱼塘列表，-c 清理缓存' },
  { command: 'showStatus', desc: '查看可用状态值' },
  { command: 'weather', args: '{地名} [-d 0|3|7]', desc: '天气查询' }
]

/** 拼完整命令串：#command [args] */
function buildFull(def) {
  return '#' + def.command + (def.args ? ' ' + def.args : '')
}

/** Markdown 表格单元格内容里的竖线转义，避免破坏表格列结构 */
function mdEscape(s) {
  return String(s).replace(/\|/g, '\\|')
}

/** 生成命令列表 md 表格（两列布局，按 command 升序） */
function buildHelpTable(defs) {
  const visible = defs
    .filter((d) => d.inHelp !== false)
    .sort((a, b) => (a.command.toLowerCase() < b.command.toLowerCase() ? -1 : 1))
  const rows = []
  for (let i = 0; i < visible.length; i += 2) {
    const l = visible[i]
    const r = visible[i + 1]
    const left = '| **' + mdEscape(buildFull(l)) + '** | ' + mdEscape(l.desc)
    rows.push(r ? left + ' | **' + mdEscape(buildFull(r)) + '** | ' + mdEscape(r.desc) + ' |' : left + ' | | |')
  }
  return rows.join('\n')
}

/** 生成补全弹层命令条目（全量，含 inHelp:false），含 name/full/desc 字段 */
function buildCommandItems(defs) {
  return defs
    .map((d) => ({ name: '#' + d.command, full: buildFull(d), desc: d.desc }))
    .sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1))
}

/** #help 表格之后的静态说明尾部 */
const HELP_TAIL = `## 快捷键说明

| 序号| 快捷键| 说明|
|------|------|------|
|1 | \`ctrl alt -\`| 降低透明度 |
|2 | \`ctrl alt =\`| 提高透明度（= 键） |
|3 | \`ctrl alt 0\`| 全透明 |
|4 | \`ctrl alt 9\`| 全不透明 |
|5 | \`ctrl alt L\`| 切换主题 |
|6 | \`ctrl alt P\`| 紧急模式（老板键）预设图片或网址一键覆盖摸鱼页面 |

> *Tips*: 录制了自定义快捷键则优先使用，未录制使用上表默认键位；输入 \`#showKey\` 可查看当前生效键位。

> *Tips*: \`{ }\` 必填参数，\`[ ]\` 可选参数，参数以空格分隔。

[开源](https://github.com/anlingyi/xechat-idea)  ·  [更多](https://xeblog.cn/?tag=xechat-idea)`

export const useHelpStore = defineStore('help', {
  getters: {
    /** 完整帮助 md（命令表自动生成 + 静态尾部） */
    helpText() {
      return '## 命令列表\n\n' +
        '| 命令 | 说明 | 命令 | 说明 |\n' +
        '|------|------|------|------|\n' +
        buildHelpTable(COMMAND_DEFS) + '\n\n' + HELP_TAIL
    },
    /** # 补全弹层数据源：{ name, full, desc }[]，按命令名升序 */
    commandItems() {
      return buildCommandItems(COMMAND_DEFS)
    }
  }
})
