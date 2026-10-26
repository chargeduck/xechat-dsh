<template>
  <div class="chat-panel">
    <div class="message-list" ref="messageListRef" @scroll="onMessageScroll">
      <div v-for="(msg, idx) in chatStore.messages" :key="idx" class="message-item">
        <!-- 系统消息：VitePress 风格彩色容器块 -->
        <div v-if="msg.type === 'system'" :class="['system-msg-box', classifySystemMsg(msg.text)]">
          <span class="system-msg-icon">{{ systemMsgIcon(msg.text) }}</span>
          <div class="system-msg-body">
            <div class="system-msg-title">{{ systemMsgTitle(msg.text) }}</div>
            <div class="system-msg-text">{{ stripHtml(msg.text) }}</div>
          </div>
        </div>
        <!-- 普通消息：Markdown 渲染 -->
        <MarkdownMessage v-else :content="msg.text" :msg-type="msg.msgType" :file-name="msg.fileName" />
      </div>
      <div v-if="chatStore.isEmpty" class="empty-hint">
        暂无消息
      </div>
    </div>

    <!-- 右下角悬浮按钮：回到顶部 / 回到底部 -->
    <div class="scroll-float">
      <el-button v-if="showTopBtn" class="float-btn" title="回到顶部" circle size="small" @click="scrollToTop">
        <el-icon :size="14"><Top /></el-icon>
      </el-button>
      <el-button v-if="showBottomBtn" class="float-btn" title="回到底部" circle size="small" @click="scrollToBottom">
        <el-icon :size="14"><Bottom /></el-icon>
      </el-button>
    </div>

    <!-- 底部：命令行输入区域 -->
    <div class="input-area">
      <!-- @ 提及弹层 -->
      <div class="at-panel" v-if="atPanelVisible">
        <div v-if="atFilteredUsers.length === 0" class="at-empty">无匹配用户</div>
        <div
          v-for="(u, i) in atFilteredUsers"
          :key="u.username"
          class="at-item"
          :class="{ active: i === atActiveIndex }"
          @mousedown.prevent="selectAtUser(u)"
          @mouseenter="atActiveIndex = i"
        >
          <span class="at-status">{{ atStatusIcon(u.status) }}</span>
          <span class="at-name">{{ u.username }}</span>
          <span v-if="u.shortRegion" class="at-region">[{{ u.shortRegion }}]</span>
        </div>
      </div>
      <!-- # 命令提示弹层 -->
      <div class="cmd-panel" v-if="cmdPanelVisible">
        <div v-if="cmdFilteredCommands.length === 0" class="cmd-empty">无匹配命令</div>
        <div
          v-for="(c, i) in cmdFilteredCommands"
          :key="c.name"
          class="cmd-item"
          :class="{ active: i === cmdActiveIndex }"
          @mousedown.prevent="selectCmdCommand(c)"
          @mouseenter="cmdActiveIndex = i"
        >
          <span class="cmd-name">{{ c.full }}</span>
          <span class="cmd-desc">{{ c.desc }}</span>
        </div>
      </div>
      <div class="input-row">
        <StyleSelector @select="onStyleSelect" />
        <el-input
          ref="inputRef"
          v-model="inputText"
          placeholder="输入命令或消息，Enter 发送 / Shift+Enter 换行 / @ 提及在线用户"
          type="textarea"
          rows="1"
          @input="onInput"
          @keydown="onInputKeydown"
          @keydown.enter="onEnter"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          class="chat-input"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue'
import { useChatStore } from '@/stores/chatStore'
import { useDeviceStore } from '@/stores/deviceStore'
import { useHelpStore } from '@/stores/helpStore'
import { useServerStore } from '@/stores/serverStore'
import { useOnlineUsersStore } from '@/stores/onlineUsersStore'
import { useUserStatusStore } from '@/stores/userStatusStore'
import { useSettingsStore, formatShortcut } from '@/stores/settingsStore'
import { useCommandHistoryStore } from '@/stores/commandHistoryStore'
import { setChatStoreBridge, state } from '@/store.js'
import { transport } from '@/transport/transport-manager.js'
import MarkdownMessage from '@/components/MarkdownMessage.vue'
import StyleSelector from '@/components/StyleSelector.vue'
import { useMaskStore } from '@/stores/maskStore'
import { useModeStore } from '@/stores/modeStore'
import { useAliveStore } from '@/stores/aliveStore'
import { queryWeather } from '@/utils/weather.js'
import { getMoyuTips } from '@/utils/moyu.js'

const chatStore = useChatStore()
const deviceStore = useDeviceStore()
const helpStore = useHelpStore()
const serverStore = useServerStore()
const onlineUsersStore = useOnlineUsersStore()
const userStatusStore = useUserStatusStore()
const settingsStore = useSettingsStore()
const commandHistoryStore = useCommandHistoryStore()
const maskStore = useMaskStore()
const modeStore = useModeStore()
const aliveStore = useAliveStore()

const messageListRef = ref(null)
const inputRef = ref(null)
const inputText = ref('')

// ===== 命令历史浏览（terminal 风格 ↑↓）=====
const histIndex = ref(-1)  // -1 表示正在编辑新内容；否则为距最新一条的距离
const histDraft = ref('')  // 进入历史浏览前未发送的草稿

// 悬浮按钮显隐状态
const showTopBtn = ref(false)
const showBottomBtn = ref(false)

/** 消息列表滚动事件：根据位置控制悬浮按钮显隐 */
function onMessageScroll() {
  const el = messageListRef.value
  if (!el) return
  showTopBtn.value = el.scrollTop > 200
  showBottomBtn.value = el.scrollTop < el.scrollHeight - el.clientHeight - 200
}

/** 回到顶部 */
function scrollToTop() {
  const el = messageListRef.value
  if (el) el.scrollTop = 0
}

/** 回到底部（最新消息） */
function scrollToBottom() {
  const el = messageListRef.value
  if (!el) return
  requestAnimationFrame(() => {
    el.scrollTop = el.scrollHeight
  })
}

// 消息列表自动滚动到底部
watch(() => chatStore.messages.length, (newLen, oldLen) => {
  console.log('[ChatPanel] messages.length 变化: ' + oldLen + ' -> ' + newLen)
  nextTick(() => {
    // requestAnimationFrame 延迟到 JCEF 渲染管线完成后执行，避免同步 reflow 触发原生错误
    requestAnimationFrame(() => {
      const el = messageListRef.value
      if (el) el.scrollTop = el.scrollHeight
    })
  })
})

/**
 * 剥离 HTML 标签，获取纯文本
 */
function stripHtml(text) {
  return text.replace(/<[^>]+>/g, '')
}

/**
 * 根据系统消息内容分类，返回 CSS class 名
 * - error: 错误/警告类（版本过低、错误、失败、异常、超时、断开、拒绝）
 * - notice: 进入/离开通知类（进入、离开、加入、退出、上线、下线）
 * - info:  普通系统消息（公告、格言等）
 */
function classifySystemMsg(text) {
  const plain = stripHtml(text)
  if (/版本过低|错误|失败|异常|超时|断开|拒绝|禁止|无效|过期/.test(plain)) return 'error'
  if (/进入|离开|加入|退出|上线|下线|来到了|离开了/.test(plain)) return 'notice'
  return 'info'
}

/** 系统消息类型图标 */
function systemMsgIcon(text) {
  const cls = classifySystemMsg(text)
  if (cls === 'error') return '\u26A0'   // ⚠
  if (cls === 'notice') return '\u2192'  // →
  return '\u2139'                         // ℹ
}

/** 系统消息标题 */
function systemMsgTitle(text) {
  const cls = classifySystemMsg(text)
  if (cls === 'error') return '系统错误'
  if (cls === 'notice') return '系统通知'
  return '系统提示'
}

// 文字样式选中：将当前输入文本包裹为样式标签
function onStyleSelect(tag) {
  const text = inputText.value.trim()
  if (!text) {
    inputRef.value?.focus()
    return
  }
  inputText.value = tag.replace('{text}', text)
  inputRef.value?.focus()
}

/**
 * 处理 #login 命令。
 * JSBridge 模式：转发给 Java LoginCommandHandler（NettyClient）。
 * WebSocket 模式：解析服务器参数，重连 WS 并发送 LOGIN。
 */
async function handleLogin(rawText) {
  const parts = rawText.trim().split(/\s+/)
  let username = ''
  let host = ''
  let port = ''
  let sIdx = -1
  let hasExplicitHostPort = false

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i]
    if (p === '-s' && i + 1 < parts.length) { sIdx = parseInt(parts[++i]) }
    else if (p === '-h' && i + 1 < parts.length) { host = parts[++i]; hasExplicitHostPort = true }
    else if (p === '-p' && i + 1 < parts.length) { port = parts[++i]; hasExplicitHostPort = true }
    else if (p.charAt(0) !== '-') { username = p }
  }

  // 未指定服务器参数时默认连第 0 个
  if (sIdx === -1 && !host && !port) {
    sIdx = 0
  }
  console.log('[ChatPanel][handleLogin] 解析结果: rawText=' + rawText + ', username=' + username + ', host=' + host + ', port=' + port + ', sIdx=' + sIdx)

  // 前置解析服务器列表：-s / 默认 模式从 Pinia 服务器列表取地址（jsBridge 与 ws 共用）
  let srv = null
  if (sIdx >= 0 && !hasExplicitHostPort) {
    if (serverStore.servers.length === 0) {
      console.log('[ChatPanel] 正在获取鱼塘列表...')
      try {
        await serverStore.fetchServers(false)
      } catch (e) {
        console.error('[ChatPanel] 获取鱼塘列表失败: ' + e.message)
      }
    }
    srv = serverStore.servers[sIdx]
    if (srv) {
      host = srv.ip
      port = String(srv.port)
    }
  }

  // xechat-dsh 只有 WebSocket 一种传输，不再需要宿主桥接判定
  // 前置解析 #login：把当前登录服务器地址、协议与登录鱼塘名写入 Pinia（供图片下载 URL 推导与 @ 塘名区分）
  // port 存登录原始端口，protocol 固定 'websocket'；下载端口 = port + 1（下载服务在 ws 端口）
  // pondName：-s / 默认 取选中服务器 name；-h / -p 显式模式从列表反查唯一 ip+port 匹配，无法唯一确定时为 null
  let pondName = null
  if (srv) {
    pondName = srv.name || null
  } else {
    const matchedServers = (serverStore.servers || []).filter(function (x) {
      return x.ip === host && String(x.port) === String(port)
    })
    if (matchedServers.length === 1) pondName = matchedServers[0].name || null
  }
  if (host && port) {
    serverStore.setCurrentLogin(host, port, 'websocket', pondName)
  }

  // WebSocket 模式：前端解析服务器
  if (sIdx >= 0 && !hasExplicitHostPort) {
    if (!srv) {
      chatStore.addMessage('无效的服务器编号: ' + sIdx + '，有效范围 0~' + (serverStore.servers.length - 1))
      return
    }
    // Web 端：不再用 ws 探测结果拒绝登录，交由 WebSocket 自行连接（探测可能误报，线上 server 开启也会探测失败）
  }

  if (!host || !port) {
    chatStore.addMessage('请指定服务器： #login [-s 编号] 或 #login -h IP -p 端口 [昵称]')
    return
  }

  if (!username) username = 'User-' + Date.now().toString(36)

  console.log('[ChatPanel] 正在连接服务器 ' + host + ':' + port + ' ...')

  const loginPayload = {
    action: 'LOGIN',
    body: {
      username: username,
      status: 'FISHING',
      platform: 'WEB',
      uuid: deviceStore.uuid,
      pluginVersion: (srv && srv.version) || '',
      reconnected: false,
      // 管理员 Token：与服务端 token 一致时获得管理员权限（管控按钮可用）
      token: settingsStore.adminToken || ''
    }
  }

  try {
    await transport.loginToServer(host, port, loginPayload)
    state.online = true
    state.username = username
    chatStore.addMessage('已连接到 ' + host + ':' + port + '，登录中...')
  } catch (e) {
    console.error('[ChatPanel] 连接服务器失败: ' + (e.message || '未知错误'))
  }
}

// ===== @ 提及（类似微信 @ 人）=====
const atPanelVisible = ref(false)
const atActiveIndex = ref(0)
const atKeyword = ref('')
const atTokenStart = ref(-1)
const atComposing = ref(false)

// ===== # 命令提示 =====
const cmdPanelVisible = ref(false)
const cmdActiveIndex = ref(0)
const cmdKeyword = ref('')
const cmdTokenStart = ref(-1)

// 命令列表：直接来自 helpStore.commandItems（结构化 COMMAND_DEFS 派生，与 #help 表格同源）
const cmdList = computed(() => helpStore.commandItems)

// 过滤后的命令列表：按命令名包含匹配
const cmdFilteredCommands = computed(() => {
  const kw = cmdKeyword.value.toLowerCase().trim()
  if (!kw) return cmdList.value
  return cmdList.value.filter(c => c.name.toLowerCase().includes(kw))
})

// 过滤后的可 @ 用户列表：排除自己，支持按输入内容筛选
const atFilteredUsers = computed(() => {
  const kw = atKeyword.value.toLowerCase().trim()
  let list = onlineUsersStore.users.filter(u => u.username && u.username !== state.username)
  if (kw) {
    list = list.filter(u => (u.username || '').toLowerCase().includes(kw))
  }
  return list
})

function _atTextarea() {
  const el = inputRef.value && inputRef.value.$el
  return el ? el.querySelector('textarea') : null
}

/**
 * 检测光标前是否为 @ 触发状态：
 * 取光标所在 token（往前找空白符分隔），若以 @ 开头则进入提及模式。
 */
function detectAtMention() {
  if (atComposing.value) return
  const ta = _atTextarea()
  if (!ta) return
  const pos = ta.selectionStart
  const text = inputText.value
  let start = pos
  while (start > 0 && text[start - 1] !== ' ' && text[start - 1] !== '\n' && text[start - 1] !== '\t') start--
  const token = text.slice(start, pos)
  if (token.charAt(0) === '@') {
    atKeyword.value = token.slice(1)
    atTokenStart.value = start
    atActiveIndex.value = 0
    atPanelVisible.value = true
    cmdPanelVisible.value = false
  } else if (token.charAt(0) === '#') {
    cmdKeyword.value = token.slice(1)
    cmdTokenStart.value = start
    cmdActiveIndex.value = 0
    cmdPanelVisible.value = true
    atPanelVisible.value = false
  } else {
    atPanelVisible.value = false
    cmdPanelVisible.value = false
  }
}

function onInput() {
  if (atComposing.value) return
  // 手动输入视为离开历史浏览模式：以当前内容为新草稿，返回新输入状态
  if (histIndex.value !== -1) {
    histDraft.value = inputText.value
    histIndex.value = -1
  }
  detectAtMention()
}

function onCompositionStart() {
  atComposing.value = true
}

function onCompositionEnd() {
  atComposing.value = false
  detectAtMention()
}

/** 将光标移到输入框文本末尾并保持焦点 */
function setCaretToEnd() {
  nextTick(() => {
    const t = _atTextarea()
    if (!t) return
    const len = inputText.value.length
    t.focus()
    t.setSelectionRange(len, len)
  })
}

/** ↑：回看更早一条历史；首次按下时暂存当前未发送内容作为草稿 */
function historyBack() {
  const list = commandHistoryStore.commands
  if (!list.length) return
  if (histIndex.value === -1) histDraft.value = inputText.value
  if (histIndex.value < list.length - 1) histIndex.value++
  inputText.value = list[list.length - 1 - histIndex.value]
  setCaretToEnd()
}

/** ↓：前进到更新一条；越过最新一条后回到草稿 */
function historyForward() {
  const list = commandHistoryStore.commands
  if (histIndex.value === -1) return
  histIndex.value--
  if (histIndex.value === -1) {
    inputText.value = histDraft.value
  } else {
    inputText.value = list[list.length - 1 - histIndex.value]
  }
  setCaretToEnd()
}

/** 方向键 / Tab / Esc 处理：@ 与 # 弹层打开时用于面板选择，否则 ↑↓ 浏览命令历史 */
function onInputKeydown(e) {
  const panelOpen = atPanelVisible.value || cmdPanelVisible.value
  if (!panelOpen) {
    if (atComposing.value) return
    // 无修饰键的 ↑↓：terminal 风格浏览命令历史（避免与选区/光标跳转冲突）
    if (!e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        historyBack()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        historyForward()
      }
    }
    return
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    const isAt = atPanelVisible.value
    const count = isAt ? atFilteredUsers.value.length : cmdFilteredCommands.value.length
    if (!count) return
    const idx = isAt ? atActiveIndex.value : cmdActiveIndex.value
    const next = e.key === 'ArrowUp' ? (idx - 1 + count) % count : (idx + 1) % count
    if (isAt) atActiveIndex.value = next
    else cmdActiveIndex.value = next
    scrollActiveItem()
  } else if (e.key === 'Tab' && cmdPanelVisible.value && cmdFilteredCommands.value.length === 1) {
    // bash 风格：命令唯一匹配时 Tab 直接补全
    e.preventDefault()
    selectCmdCommand(cmdFilteredCommands.value[0])
  } else if (e.key === 'Escape') {
    e.preventDefault()
    atPanelVisible.value = false
    cmdPanelVisible.value = false
  }
}

/** 弹层选中项滚动到可见区域 */
function scrollActiveItem() {
  nextTick(() => {
    const atEl = document.querySelector('.at-item.active')
    if (atEl) atEl.scrollIntoView({ block: 'nearest' })
    const cmdEl = document.querySelector('.cmd-item.active')
    if (cmdEl) cmdEl.scrollIntoView({ block: 'nearest' })
  })
}

/** 选中用户：将 @关键字 替换为 @用户名，光标移到其后 */
function selectAtUser(u) {
  if (!u) return
  const text = inputText.value
  const ta = _atTextarea()
  const pos = ta ? ta.selectionStart : text.length
  let end = pos
  while (end < text.length && text[end] !== ' ' && text[end] !== '\n' && text[end] !== '\t') end++
  const replacement = '@' + u.username + ' '
  const newText = text.slice(0, atTokenStart.value) + replacement + text.slice(end)
  inputText.value = newText
  atPanelVisible.value = false
  nextTick(() => {
    const t = _atTextarea()
    if (t) {
      const caret = atTokenStart.value + replacement.length
      t.focus()
      t.setSelectionRange(caret, caret)
    }
  })
}

/** 选择 # 命令：替换当前 #token 为命令名并追加空格 */
function selectCmdCommand(cmd) {
  if (!cmd) return
  const text = inputText.value
  const ta = _atTextarea()
  const pos = ta ? ta.selectionStart : text.length
  let end = pos
  while (end < text.length && text[end] !== ' ' && text[end] !== '\n' && text[end] !== '\t') end++
  const replacement = cmd.full + ' '
  const newText = text.slice(0, cmdTokenStart.value) + replacement + text.slice(end)
  inputText.value = newText
  cmdPanelVisible.value = false
  nextTick(() => {
    const t = _atTextarea()
    if (t) {
      const caret = cmdTokenStart.value + replacement.length
      t.focus()
      t.setSelectionRange(caret, caret)
    }
  })
}

function atStatusIcon(s) {
  switch (s) {
    case 'FISHING': return '🎣'
    case 'WORKING': return '💼'
    case 'PLAYING': return '🎮'
    default: return '🟢'
  }
}

// ===== 命令分派 =====
// 所有 # 命令统一收敛到 dispatchChatCommand：按命令首词（不区分大小写）分发到
// 各自独立的 handler，互不影响、便于单独排查 BUG。handler 返回 false 表示
// 未识别（含带参但命令本身不支持参数等），由 send() 兜底转发 execCommand。

/** 仅接受精确命令名（大小写敏感，保持历史语义），带参数返回 false 交给 execCommand 兜底 */
function isExactCommand(text, cmd) {
  return text === cmd
}

/**
 * 处理 #help —— 纯前端帮助文本
 */
function handleHelpCmd(text) {
  if (!isExactCommand(text, '#help')) return false
  chatStore.addMessage(helpStore.helpText)
  return true
}

/**
 * 处理 #showKey —— 展示当前快捷键表
 */
function handleShowKeyCmd(text) {
  if (!isExactCommand(text, '#showKey')) return false
  const rows = [
    ['降低透明度', settingsStore.shortcutMinus],
    ['提高透明度', settingsStore.shortcutPlus],
    ['一键全透明', settingsStore.shortcutOpacity0],
    ['恢复不透明', settingsStore.shortcutOpacity1],
    ['切换主题', settingsStore.shortcutTheme],
    ['紧急模式', settingsStore.shortcutPanic]
  ]
  chatStore.addMessage(
    '## 当前快捷键\n\n| 功能 | 快捷键 |\n|------|--------|\n' +
    rows.map(([name, raw]) => `| ${name} | \`${formatShortcut(raw)}\` |`).join('\n') +
    '\n\n> 提示：可在设置面板录制自定义快捷键；未录制时显示默认键位。'
  )
  return true
}

/**
 * 处理 #clean —— 清空聊天记录
 */
function handleCleanCmd(text) {
  if (!isExactCommand(text, '#clean')) return false
  chatStore.clear()
  return true
}

/**
 * 处理 #exit —— 断开连接（jsbridge 转发 Java，websocket 断开本地 WS）。
 * 注意：只能断开不能销毁 transport（TransportManager.disconnect 已改为转发底层断开）。
 */
function handleExitCmd(text) {
  if (!isExactCommand(text, '#exit')) return false
  transport.disconnect()
  chatStore.addMessage('已断开连接')
  state.online = false
  return true
}

/**
 * 处理 #showGame —— 切到游戏面板
 */
function handleShowGameCmd(text) {
  if (!text.startsWith('#showGame')) return false
  state.currentRoute = 'games'
  return true
}

/**
 * 处理 #showServer —— 拉取并展示鱼塘列表（-c 强制刷新）
 */
async function handleShowServerCmd(text) {
  if (!text.startsWith('#showServer')) return false
  chatStore.addMessage('正在获取鱼塘列表...')
  const forceRefresh = text.includes('-c')
  try {
    await serverStore.fetchServers(forceRefresh)
    chatStore.addMessage(serverStore.serverTable)
  } catch (e) {
    chatStore.addMessage('鱼塘列表获取失败: ' + e.message)
  }
  return true
}

/**
 * 处理 #showStatus —— 展示用户状态
 */
function handleShowStatusCmd(text) {
  if (!text.startsWith('#showStatus')) return false
  chatStore.addMessage(userStatusStore.table)
  return true
}

/**
 * 处理 #loging —— 简化登录：#loging {nickname} → #login {nickname} -s 0
 * 注意：#login 分派用首词精确匹配，不会再像旧 startsWith 链那样把 #loging 吞进 #login。
 */
async function handleLogingCmd(text) {
  const nickname = text.slice('#loging'.length).trim()
  if (!nickname) {
    chatStore.addMessage('用法： #loging {昵称}，例如 #loging test')
    return true
  }
  await handleLogin('#login ' + nickname + ' -s 0')
  return true
}

/**
 * 占位实现模板说明：
 * 以下命令在纯 WebSocket 模式下尚无前端实现，先打印 log 占位，防止命令
 * 静默落进 execCommand 无反应；待前端真正实现后改为返回 true。
 */
function placeholderNotImplemented(cmd) {
  console.warn('[ChatPanel] #' + cmd + ' 暂未实现（WebSocket 前端占位），命令文本已消费')
}

/** #setStatus —— 后端命令（WebSocket→SET_STATUS / JSBridge→Java），保持转发 */
function handleSetStatusCmd() { return false }

/** 游戏命令（#play/#join/#over/#admin）已移除：单机游戏改由 manager 游戏大厅加载，
 *  联机游戏房间能力由 manager 部署时注入的 MatchLobby SDK 在游戏页内承载。 */

/**
 * 处理 #weather —— 纯前端实现（WebSocket/JSBridge 均直连 open-meteo 查询）。
 * WebSocket 模式直连 open-meteo 查询（免费、无需 key、支持 CORS）：
 *   #weather {地名} [-d 0|3|7]，0=当前实况（默认），3/7=未来预报天数
 */
async function handleWeatherCmd(text) {
  const parts = text.split(/\s+/).slice(1)
  let location = ''
  let days = 0
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]
    if (p === '-d' && i + 1 < parts.length) {
      const val = parseInt(parts[++i], 10)
      days = [0, 3, 7].includes(val) ? val : 0
    } else if (!p.startsWith('-') && !location) {
      location = p
    }
  }
  if (!location) {
    chatStore.addMessage('用法：#weather {地名} [-d 0|3|7]，例如：#weather 北京 -d 3')
    return true
  }
  chatStore.addMessage('正在获取 ' + location + ' 天气信息，请耐心等待...')
  try {
    chatStore.addMessage(await queryWeather(location, days))
  } catch (e) {
    chatStore.addMessage('天气查询失败！' + (e && e.message ? e.message : e))
  }
  return true
}

/**
 * 处理 #mode —— 纯前端模式设置：#mode {编号}，编号 0=默认 / 1=浑水摸鱼
 */
function handleModeCmd(text) {
  const arg = text.slice('#mode'.length).trim()
  if (!arg) {
    chatStore.addMessage(modeStore.table)
    chatStore.addMessage('用法：#mode {编号}，例如：#mode 1（编号见 #showMode 列表）')
    return true
  }
  if (!modeStore.setMode(parseInt(arg, 10))) {
    chatStore.addMessage('无效的模式编号：' + arg)
    return true
  }
  const name = modeStore.modes[modeStore.currentIndex].name
  chatStore.addMessage('【' + name + '】模式设置成功！')
  return true
}

/**
 * 处理 #moyu —— 纯前端摸鱼办文案（lunar-javascript 计算节假日距离）
 */
function handleMoyuCmd() {
  chatStore.addMessage(getMoyuTips())
  return true
}

/**
 * 处理 #alive —— 纯前端活着提醒：#alive 查看状态 / #alive 1 开启 / #alive 0 关闭
 */
function handleAliveCmd(text) {
  const arg = text.slice('#alive'.length).trim()
  if (arg !== '') {
    const num = parseInt(arg, 10)
    if (num !== 0 && num !== 1) {
      chatStore.addMessage('用法：#alive 0 关闭提醒 / #alive 1 开启提醒，不带参数查看当前状态')
      return true
    }
    aliveStore.setEnabled(num === 1)
  }
  if (!aliveStore.enabled) {
    chatStore.addMessage('**「活着」** 当前状态：**已关闭**\n\n> 输入 `#alive 1` 开启提醒（开启后每小时到点提醒一次）')
    return true
  }
  const updated = aliveStore.flushNextStartTime() ? '（已更新）' : ''
  chatStore.addMessage(
    '**「活着」** 当前状态：**已开启**\n\n下一次提醒时间：**' + aliveStore.nextStartText + '** ' + updated
  )
  return true
}

/**
 * 处理 #mask —— 纯前端实现（maskStore 管理屏蔽规则，localStorage 持久化）
*/
function handleMaskCmd(text) {
  const args = text.trim().split(/\s+/).slice(1)
  const collected = { u: [], r: [], i: [] }
  let clean = false
  let notShow = false
  for (let k = 0; k < args.length; k++) {
    const t = args[k]
    if (t === '-c') { clean = true; continue }
    if (t === '-n') { notShow = true; continue }
    const key = ['-u', '-r', '-i'].includes(t) ? t.slice(1) : null
    if (key) {
      const val = args[k + 1]
      if (val && !val.startsWith('-')) {
        collected[key].push(...val.split(','))
        k++
      }
      continue
    }
  }
  if (clean) {
    maskStore.clearAll()
    chatStore.addMessage('已解除所有屏蔽（昵称/地区/IP），"-n 不显示"已复位')
    renderMaskStatus()
    return true
  }
  if (collected.u.length) maskStore.addUsernames(collected.u)
  if (collected.r.length) maskStore.addRegions(collected.r)
  if (collected.i.length) maskStore.addIps(collected.i)
  if (notShow) maskStore.setNotShow(true)
  renderMaskStatus()
  return true
}

/** 输出当前屏蔽配置状态 */
function renderMaskStatus() {
  const fmt = (arr) => (arr.length ? arr.join('、') : '（空）')
  const desc = []
  if (maskStore.notShow) desc.push('-n 已开启：命中屏蔽的消息将完全不显示')
  if (!maskStore.usernames.length && !maskStore.regions.length && !maskStore.ips.length) {
    desc.push('当前无屏蔽规则')
  } else {
    desc.push('- 昵称：' + fmt(maskStore.usernames))
    desc.push('- 地区：' + fmt(maskStore.regions))
    desc.push('- IP：' + fmt(maskStore.ips))
  }
  chatStore.addMessage('**当前屏蔽配置**\n\n' + desc.join('\n'))
}

/**
 * 处理 #showMode —— 纯前端查看模式列表（modeStore 维护，localStorage 持久化当前模式）
 */
function handleShowModeCmd() {
  chatStore.addMessage(modeStore.table)
  return true
}

/**
 * 处理 #open —— TODO: 打开工具
 */
function handleOpenCmd(text) {
  placeholderNotImplemented('open')
  return true
}

/**
 * 处理 #notify —— @提醒通知等级（settingsStore 持久化）：
 *   #notify          查看当前通知类型
 *   #notify {1|2|3}  设置通知类型：1 正常（ElNotification 标准卡片）/ 2 隐晦（右下角低调 3s）/ 3 关闭
 */
const NOTIFY_TYPE_NAMES = {1: '正常通知', 2: '隐晦通知', 3: '关闭通知'}
function handleNotifyCmd(text) {
  const arg = text.slice('#notify'.length).trim()
  if (!arg) {
    chatStore.addMessage('当前通知类型[' + (NOTIFY_TYPE_NAMES[settingsStore.msgNotify] || '未知') + ']')
    chatStore.addMessage('用法：#notify {1|2|3}，1 正常 / 2 隐晦 / 3 关闭')
    return true
  }
  const level = parseInt(arg, 10)
  if (!settingsStore.setMsgNotify(level)) {
    chatStore.addMessage('非法的通知类型：' + arg)
    chatStore.addMessage('用法：#notify {1|2|3}，1 正常 / 2 隐晦 / 3 关闭')
    return true
  }
  chatStore.addMessage('【' + NOTIFY_TYPE_NAMES[level] + '】设置成功！')
  return true
}

/**
 * 处理 #backgroundImage —— TODO: 切换背景图片
 */
function handleBackgroundImageCmd(text) {
  placeholderNotImplemented('backgroundImage')
  return true
}

/**
 * 命令总入口：# 命令按首词分发；未识别返回 false 由调用方 execCommand 兜底。
 * 覆盖范围与 #help 命令表一一对应：
 *  - 已实现：help/showKey/clean/exit/showGame/showServer/showStatus/login/loging/mask/weather/mode/moyu/alive/showMode/notify
 *  - 后端命令（返回 false 转发 execCommand）：setStatus
 *  - 前端占位（暂未实现，打 log）：open/backgroundImage
 *  - 游戏命令（#play/#join/#over/#admin）已移除：单机游戏改由 manager 游戏大厅加载，
 *    联机游戏房间能力由 manager 部署时注入的 MatchLobby SDK 在游戏页内承载
*/
async function dispatchChatCommand(text) {
  const cmd = text.split(/\s+/)[0].toLowerCase()
  switch (cmd) {
    case '#help':          return handleHelpCmd(text)
    case '#showkey':       return handleShowKeyCmd(text)
    case '#clean':         return handleCleanCmd(text)
    case '#exit':          return handleExitCmd(text)
    case '#showgame':      return handleShowGameCmd(text)
    case '#showserver':    return await handleShowServerCmd(text)
    case '#showstatus':    return handleShowStatusCmd(text)
    case '#login':         await handleLogin(text); return true
    case '#loging':        return await handleLogingCmd(text)
    // 已前端实现命令：mask/weather/mode/moyu/alive/showMode/notify（本地或直连第三方，不再转发 Java）
    case '#mask':          return handleMaskCmd(text)
    case '#weather':       return await handleWeatherCmd(text)
    case '#mode':          return handleModeCmd(text)
    case '#moyu':          return handleMoyuCmd()
    case '#alive':         return handleAliveCmd(text)
    case '#showmode':      return handleShowModeCmd()
    case '#notify':        return handleNotifyCmd(text)
    // 后端命令：WebSocket 有对应 action，保持 execCommand 转发
    case '#setstatus':     return handleSetStatusCmd()
    // 前端占位命令：暂未实现，先打 log 便于排查
    case '#open':          return handleOpenCmd(text)
    case '#backgroundimage': return handleBackgroundImageCmd(text)
    default:               return false
  }
}

/**
 * 解析消息文本中的 @提及，生成协议 toUsers 列表（被 @ 的用户对象，含昵称与所属鱼塘）。
 * 语义：
 * - toUsers 填的是「被 @ 的人」，不是发送者自己；
 * - 匹配范围为聚合在线列表（onlineUsersStore.users，含外塘 pond 非空用户）：
 *   服务端 CHAT 一律全塘/跨塘广播、不对 toUsers 定向，toUsers 随帧原样转发到各塘，
 *   各端用 hasUser(自己昵称, 自己塘名) 判断"@我"提醒——本塘 @ 提醒本塘用户，
 *   跨塘 @ 只要目标在线列表可见，填进 toUsers 后广播到目标塘即可命中该端提醒；
 * - pond 规则：外塘用户取源塘名（在线条目 pond），本塘用户 pond 为空 → 补当前登录塘名
 *   （serverStore.current.pondName，登录 #login 时写入）；无法确定塘名时 pond 为 null，
 *   接收端降级为仅按昵称匹配（兼容老帧/显式 -h -p 登录）；
 * - 不在在线列表中的昵称不填（无人可提醒，仅文本可见）。
 * @param {string} text 待发送的文本
 * @returns {{nickname:string, pond:string|null}[]} toUsers 对象数组，无匹配时返回空数组
 */
function resolveAtToUsers(text) {
  const toUsers = []
  const onlineUsers = onlineUsersStore.users || []
  const tokens = text.match(/@([^\s]+)/g)
  if (!tokens) return toUsers

  const seen = new Set()
  for (const token of tokens) {
    const name = token.slice(1)
    if (!name || seen.has(name)) continue
    const matched = onlineUsers.find(u => u.username === name)
    if (!matched) continue
    seen.add(name)
    // pond：外塘用户取源塘名（u.pond 非空）；本塘用户 pond 为空串 → 补当前登录塘名
    const pond = matched.pond || serverStore.current?.pondName || null
    toUsers.push({nickname: name, pond: pond})
  }
  return toUsers
}

// 发送逻辑
async function send() {
  const text = inputText.value.trim()
  if (!text) return

  console.log('[ChatPanel] send() 触发, text=' + text.substring(0, 50))

  try {
    if (text.startsWith('#')) {
      // 先走命令分派，未识别的 # 命令再交给 transport 转发（如 #weather/#setStatus/#over 等后端命令）
      const handled = await dispatchChatCommand(text)
      if (!handled) {
        console.log('[ChatPanel] → execCommand: ' + text)
        transport.execCommand(text)
      }
    } else {
      const toUsers = resolveAtToUsers(text)
      console.log('[ChatPanel] → sendMessage: ' + text + (toUsers.length ? ' toUsers=' + JSON.stringify(toUsers) : ''))
      transport.sendMessage(text, toUsers)
    }
    console.log('[ChatPanel] send() 完成')
  } catch (e) {
    console.error('[ChatPanel] 发送失败', e)
  }

  // 记录命令历史（terminal 风格），并重置历史浏览状态
  commandHistoryStore.push(text)
  histIndex.value = -1
  histDraft.value = ''
  inputText.value = ''
}

// Enter 发送，Shift+Enter 换行；@ 弹层打开时 Enter 选中当前高亮用户
function onEnter(e) {
  if (e.shiftKey) {
    return
  }
  e.preventDefault()
  if (atPanelVisible.value) {
    if (atFilteredUsers.value.length > 0) {
      selectAtUser(atFilteredUsers.value[atActiveIndex.value])
    }
    return
  }
  if (cmdPanelVisible.value) {
    if (cmdFilteredCommands.value.length > 0) {
      selectCmdCommand(cmdFilteredCommands.value[cmdActiveIndex.value])
    }
    return
  }
  send()
}

// 键盘焦点默认在输入框; 无消息时自动注入 HELP 提示; 建立 JSBridge→chatStore 桥接
onMounted(() => {
  console.log('[ChatPanel] 组件挂载, chatStore.messages.length=' + chatStore.messages.length)
  setChatStoreBridge(chatStore)
  // 恢复活着提醒计时（若上次开启过，刷新/重挂后继续生效）
  aliveStore.startTicker()
  // 启动时静默拉取服务器列表（#showServer -c），写入 Pinia 供后续 #login / #loging 使用
  serverStore.fetchServers(true).catch(function(e) {
    console.warn('[ChatPanel] 初始化获取鱼塘列表失败:', e)
  })
  if (chatStore.isEmpty) {
    chatStore.addMessage(helpStore.helpText)
  }
  // 切换 tab 重新挂载后，默认滚动到最新消息（v-if 重建场景下 watch 不会触发）
  nextTick(() => {
    requestAnimationFrame(() => {
      const el = messageListRef.value
      if (el) {
        el.scrollTop = el.scrollHeight
        showTopBtn.value = false
        showBottomBtn.value = false
      }
    })
  })
  inputRef.value?.focus()
})
</script>

<style scoped>
.chat-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* ===== 消息列表 ===== */
.message-list {
  flex: 1;
  overflow-y: scroll;
  padding: 12px 16px;
  contain: layout style;
}

/* ===== 右下角悬浮按钮组 ===== */
.scroll-float {
  position: absolute;
  right: 14px;
  bottom: 68px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  z-index: 15;
}

.float-btn {
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.18);
  opacity: 0.92;
  transition: opacity 0.2s, border-color 0.2s, color 0.2s;
}

.float-btn:hover {
  opacity: 1;
  border-color: var(--accent-color);
  color: var(--accent-color);
  background: var(--bg-primary);
}

.message-item {
  padding: 4px 0;
  border-bottom: 1px solid var(--border-color);
}

/* ===== 系统消息：VitePress 风格彩色容器块 ===== */
.system-msg-box {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 4px 0;
  padding: 6px 12px 6px 10px;
  border-left: 4px solid;
  border-radius: 0 4px 4px 0;
  font-size: 12px;
  line-height: 1.5;
}

.system-msg-box .system-msg-icon {
  flex-shrink: 0;
  font-size: 13px;
  margin-top: 2px;
}

.system-msg-box .system-msg-body {
  flex: 1;
  min-width: 0;
}

.system-msg-box .system-msg-title {
  font-weight: 600;
  margin-bottom: 2px;
  font-size: 12px;
}

.system-msg-box .system-msg-text {
  word-break: break-word;
}

.system-msg-box.error {
  border-color: var(--danger-color);
  background: rgba(244, 71, 71, 0.08);
}
.system-msg-box.error .system-msg-icon { color: var(--danger-color); }
.system-msg-box.error .system-msg-title { color: var(--danger-color); }

.system-msg-box.notice {
  border-color: var(--success-color);
  background: rgba(78, 201, 176, 0.08);
}
.system-msg-box.notice .system-msg-icon { color: var(--success-color); }
.system-msg-box.notice .system-msg-title { color: var(--success-color); }

.system-msg-box.info {
  border-color: var(--accent-color);
  background: rgba(0, 122, 204, 0.08);
}
.system-msg-box.info .system-msg-icon { color: var(--accent-color); }
.system-msg-box.info .system-msg-title { color: var(--accent-color); }

/* 浅色主题下系统消息背景微调 */
:root.light .system-msg-box.error  { background: rgba(244, 71, 71, 0.06); }
:root.light .system-msg-box.notice { background: rgba(78, 201, 176, 0.06); }
:root.light .system-msg-box.info   { background: rgba(0, 120, 212, 0.06); }

.message-item:last-child {
  border-bottom: none;
}

.empty-hint {
  color: var(--text-muted);
  text-align: center;
  padding: 40px 0;
  font-size: 13px;
}

/* ===== 底部输入区域 ===== */
.input-area {
  position: relative;
  border-top: 1px solid var(--border-color);
  padding: 8px 12px;
  background: var(--bg-secondary);
}

.input-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.input-row .chat-input {
  flex: 1;
}

/* ===== @ 提及弹层 ===== */
.cmd-panel {
  position: absolute;
  bottom: 56px;
  left: 12px;
  right: 12px;
  z-index: 10;
  max-height: 200px;
  overflow-y: auto;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  padding: 4px 0;
  font-size: 13px;
}
.cmd-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  cursor: pointer;
  color: var(--text-primary);
  white-space: nowrap;
}
.cmd-item:hover,
.cmd-item.active {
  background: var(--bg-hover, rgba(128, 128, 128, 0.12));
}
.cmd-name {
  color: var(--accent-color);
  font-family: Consolas, Monaco, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cmd-desc {
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}
.cmd-empty {
  padding: 6px 12px;
  color: var(--text-secondary);
}
.at-panel {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: calc(100% + 4px);
  max-height: 200px;
  overflow-y: auto;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
  z-index: 20;
}

.at-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}

.at-item.active,
.at-item:hover {
  background: var(--bg-hover, rgba(128, 128, 128, 0.12));
}

.at-status {
  font-size: 13px;
  width: 18px;
  text-align: center;
}

.at-name {
  font-weight: 500;
}

.at-region {
  color: var(--text-secondary);
  font-size: 12px;
}

.at-empty {
  padding: 12px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
}
</style>
