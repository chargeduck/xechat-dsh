import {reactive, nextTick} from 'vue'
import {on, lobbyInviteReply} from './api.js'
import {ElMessage, ElMessageBox, ElNotification} from 'element-plus'
import {useOnlineUsersStore} from './stores/onlineUsersStore.js'
import {cleanShortRegion, stripSystemNullTag} from './utils/regionClean.js'
import {useMaskStore} from './stores/maskStore.js'
import {useServerStore} from './stores/serverStore.js'
import {useSettingsStore} from './stores/settingsStore.js'

// 状态映射
function _statusText(s) {
  switch (s) {
    case 'FISHING':
      return '鱼'
    case 'WORKING':
      return '忙'
    case 'PLAYING':
      return '玩'
    default:
      return s || ''
  }
}

// 平台图标
function _platformIcon(p) {
  switch (p) {
    case 'IDEA':
      return '☕'
    case 'WEB':
    case 'VSCODE':
      return '🌐'
    default:
      return ''
  }
}

/**
 * 格式化用户消息头：[时间][地区] 昵称 (状态) 平台：
 * 例如：[08/09 00:28][鲁] test (鱼) 🌐： 123
 */
function _formatUserMessageHead(data) {
  const time = data.time || ''
  const region = cleanShortRegion(data.user && data.user.shortRegion)
  const username = (data.user && data.user.username) || ''
  const status = (data.user && data.user.status) ? _statusText(data.user.status) : ''
  const platform = (data.user && data.user.platform) ? _platformIcon(data.user.platform) : ''

  const parts = []
  if (time) parts.push('[' + time + ']')
  if (region) parts.push('[' + region + ']')
  let userInfo = username
  if (status) userInfo += ' (' + status + ')'
  if (platform) userInfo += ' ' + platform
  parts.push(userInfo + '：')
  return parts.join(' ')
}

export const state = reactive({
  online: false,
  username: '',
  onlineCount: 0,
  toolOpen: false,
  currentTool: 0,
  currentRoute: 'chat',
  messages: [],
  tools: [],
  settingsOpen: false
})

window.addEventListener('hashchange', () => {
  state.currentRoute = location.hash.slice(2) || 'chat'
})
state.currentRoute = location.hash.slice(2) || 'chat'

// ---- 消息处理 ----
// 桥接器：set 后同时写入 Pinia chatStore
export let _chatStoreBridge = null
// 消息缓冲：桥接未建立时缓存 console 消息
let __pendingConsoleMessages = []

export function setChatStoreBridge(store) {
  _chatStoreBridge = store
  // 排空缓冲队列——解决 ChatPanel 挂载前 Java 已推送消息的时序竞态
  if (__pendingConsoleMessages.length > 0) {
    console.log('[store.js] 桥接已建立，排空 ' + __pendingConsoleMessages.length + ' 条缓存消息')
    _chatStoreBridge.addMessagesRaw(__pendingConsoleMessages)
    __pendingConsoleMessages = []
  }
}

on('toolOpen', () => {
  state.toolOpen = true
  refreshState()
})
on('toolClose', () => {
  state.toolOpen = false
  refreshState()
})

// 游戏相关事件（gameStart/gameOver/gameState/gameRoom）已随内置游戏一并移除：
// 单机游戏由 manager 游戏大厅下发，联机游戏由 manager 部署时注入的 MatchLobby SDK
// 在游戏页内自行处理房间/对局事件，宿主前端不再参与。

// 从文本中提取 markdown 图片地址（![]() 语法），无则返回空串
function _extractMdImageUrl(text) {
  if (!text) return ''
  const m = text.match(/!\[[^\]]*\]\(([^)]+)\)/)
  return m ? m[1].trim() : ''
}

on('message', (data) => {
  const isSystem = data.type === 'system'
  // mask 屏蔽过滤（仅用户消息；对齐 Java UserMessageHandler：-n 整条丢弃，否则替换为占位文案）
  let masked = false
  if (!isSystem) {
    const maskStore = useMaskStore()
    const hit = maskStore.masked(data.user)
    if (hit) {
      masked = true
      if (maskStore.notShow) return
      data.text = '已被禁言，无法发言'
      data.msgType = undefined
    }
  }

  // @ 提及提醒：实时用户消息、未被 mask 过滤、toUsers 含"自己"时按 settingsStore 通知等级提示。
  // 匹配语义对齐 Java UserMsgDTO.hasUser(DataCache.username, DataCache.pondName)：
  // 昵称必须相等；任一端无法确定塘名时降级为仅按昵称匹配（兼容老帧字符串 toUsers / 显式 -h -p 登录）；
  // 自己 @ 自己不提醒（对齐 UserMessageHandler）。
  // 等级分发：1 正常 → ElNotification 标准卡片；2 隐晦（默认）→ 右下角低调 3s；3 关闭 → 不提示。
  if (!isSystem && !masked && Array.isArray(data.toUsers) && data.toUsers.length > 0 && state.username) {
    const serverStore = useServerStore()
    const myPond = (serverStore.current && serverStore.current.pondName) || ''
    const atMe = data.toUsers.some(function (u) {
      const nickname = (typeof u === 'string') ? u : (u && u.nickname)
      if (!nickname || nickname !== state.username) return false
      const targetPond = (typeof u === 'string') ? '' : ((u && u.pond) || '')
      return !targetPond || !myPond || targetPond === myPond
    })
    const senderName = (data.user && data.user.username) || ''
    const notifyLevel = useSettingsStore().msgNotify
    if (atMe && senderName !== state.username && notifyLevel !== 3) {
      if (notifyLevel === 1) {
        // 正常提醒：标题带"鱼塘 用户"更醒目，正文展示被 @ 的那条消息内容
        const senderPond = _resolveSenderPond(data) || ''
        const who = (senderPond ? senderPond + '鱼塘 ' : '') + senderName
        _showAtMentionNormal(who, data.text || '')
      } else {
        // 隐晦提醒（默认）：右下角低调 3s
        _showAtMentionToast((senderName ? senderName + ' ' : '') + '@了你')
      }
    }
  }
  const isImage = data.msgType && String(data.msgType).toUpperCase() === 'IMAGE'
  const text = data.text || ''
  // TEXT 但含 markdown 图片：提取图片 URL，统一按图片消息处理（http 直链或相对文件名）
  const mdImageUrl = (!isSystem && !isImage) ? _extractMdImageUrl(text) : ''
  // 系统消息直接展示原文（清洗 null 来源标签）；用户消息格式化：[时间][地区] 昵称 (状态) 平台： 内容
  const displayText = isSystem
    ? stripSystemNullTag(text)
    : _formatUserMessageHead(data) + ((isImage || mdImageUrl) ? '' : text)
  const displayType = isSystem ? 'system' : undefined
  let extra = null
  if (isImage) {
    extra = {msgType: 'IMAGE', fileName: text}
  } else if (mdImageUrl) {
    extra = {msgType: 'IMAGE', fileName: mdImageUrl}
  }

  if (_chatStoreBridge) {
    _chatStoreBridge.addMessage(displayText, displayType, extra)
  }
  state.messages.push({
    text: displayText,
    time: new Date().toLocaleTimeString(),
    type: displayType,
    msgType: extra && extra.msgType,
    fileName: extra && extra.fileName
  })
  nextTick(() => {
    const el = document.querySelector('.message-list')
    if (el) el.scrollTop = el.scrollHeight
  })
})

// @ 提及提醒（等级 1 正常）：ElNotification 标准卡片，标题为"鱼塘 用户"，正文为被 @ 的消息内容
let __lastAtToast = null
function _showAtMentionNormal(title, message) {
  _closeLastAtToast()
  __lastAtToast = ElNotification({
    title: title,
    message: message,
    position: 'bottom-right',
    type: 'info',
    duration: 5000,
    showClose: true
  })
}

// @ 提及提醒（等级 2 隐晦，默认）：右下角低调小卡片，3s 自动关闭（摸鱼场景低调展示）
function _showAtMentionToast(text) {
  _closeLastAtToast()
  __lastAtToast = ElNotification({
    message: text,
    position: 'bottom-right',
    duration: 3000,
    showClose: false,
    customClass: 'at-mention-toast'
  })
}

// 新提醒顶掉旧提醒，避免多条在右下角堆叠
function _closeLastAtToast() {
  if (__lastAtToast && typeof __lastAtToast.close === 'function') {
    try { __lastAtToast.close() } catch (e) { /* ignore */ }
  }
}

/** 解析 @ 发送者所在鱼塘：优先取消息帧 user.pond，缺省时在在线列表按昵称反查；
 *  跨塘条目带源塘名直接命中；本塘条目 pond 为空串 → 回退当前登录塘名 */
function _resolveSenderPond(data) {
  const direct = (data.user && data.user.pond) || ''
  if (direct) return direct
  const senderName = (data.user && data.user.username) || ''
  if (!senderName) return ''
  const u = useOnlineUsersStore().users.find(x => x.username === senderName)
  return (u && u.pond) || useServerStore().current?.pondName || ''
}

on('history', (data) => {
  const msgList = data.msgList || []
  if (!msgList.length) return
  const parsed = []
  for (let i = 0; i < msgList.length; i++) {
    const item = msgList[i]
    if (item.type === 'SYSTEM') {
      parsed.push({text: stripSystemNullTag(item.body || ''), type: 'system'})
    } else if (item.type === 'USER') {
      // mask 屏蔽过滤（历史消息同样生效）
      const userObj = item.body && item.body.user
      const maskStore = useMaskStore()
      const hit = maskStore.masked(userObj)
      if (hit) {
        if (maskStore.notShow) continue
        if (item.body) {
          item.body.content = '已被禁言，无法发言'
          item.body.msgType = undefined
        }
      }
      const head = _formatUserMessageHead({
        time: item.time,
        user: item.body && item.body.user
      })
      const hText = (item.body && item.body.content) || ''
      const isImageMsg = item.body && item.body.msgType && String(item.body.msgType).toUpperCase() === 'IMAGE'
      const hMdUrl = (!isImageMsg && hText) ? _extractMdImageUrl(hText) : ''
      parsed.push(isImageMsg || hMdUrl
        ? {text: head, type: 'user', msgType: 'IMAGE', fileName: isImageMsg ? hText : hMdUrl}
        : {text: head + hText, type: 'user'})
    }
  }
  if (_chatStoreBridge) {
    _chatStoreBridge.addMessagesRaw(parsed)
  } else {
    __pendingConsoleMessages.push(...parsed)
  }
  parsed.forEach(function (m) {
    state.messages.push({
      text: m.text,
      time: new Date().toLocaleTimeString(),
      type: m.type,
      msgType: m.msgType,
      fileName: m.fileName
    })
  })
})

on('onlineUsers', (data) => {
  const userList = data.userList || []
  state.onlineCount = userList.length
  state.online = true

  const onlineStore = useOnlineUsersStore()
  onlineStore.setUsers(userList)

  if (!onlineStore.welcomeShown) {
    onlineStore.markWelcomeShown()
    const welcomeMsg = '系统公告：亲爱的鱼友，欢迎你来到鱼塘~ 倡导文明摸鱼、理性摸鱼，做个德才兼备的顶级摸鱼选手！\n本项目为开源项目，开源地址：[xechat-idea-webview](https://gitee.com/chargeduck/xechat-idea-webview)，[原项目地址xechat-idea](https://github.com/anlingyi/xechat-idea)\n插件使用有问题请进群反馈或是直接去GitHub提交issues，摸鱼技术交流群：754126966。'
    if (_chatStoreBridge) {
      _chatStoreBridge.addMessage(welcomeMsg, 'system')
    }
    state.messages.push({text: welcomeMsg, time: new Date().toLocaleTimeString(), type: 'system'})
  }
})

on('userState', (data) => {
  const user = data.user
  if (!user || !user.username) return
  const onlineStore = useOnlineUsersStore()
  const st = String(data.state || '').toUpperCase()
  if (st === 'OFFLINE') {
    onlineStore.removeUser(user.username)
  } else {
    onlineStore.upsertUser(user)
  }
  state.onlineCount = onlineStore.count
})

on('statusUpdate', (data) => {
  // 权限管控回执后服务端广播 STATUS_UPDATE：刷新该用户 permit/role，管控按钮状态即时同步
  const user = data.user
  if (!user || !user.username) return
  useOnlineUsersStore().upsertUser(user)
})

on('reactResult', (data) => {
  // 管控指令失败回执（如「没有权限！」）；成功时服务端另有系统消息广播，不重复提示
  const body = data.body || {}
  if (body.succeed) return
  const text = body.msg || '管控指令执行失败'
  if (_chatStoreBridge) {
    _chatStoreBridge.addMessage(text, 'system')
  }
  state.messages.push({ text: text, time: new Date().toLocaleTimeString(), type: 'system' })
})

on('disconnected', () => {
  state.online = false
  state.onlineCount = 0
  useOnlineUsersStore().clear()
  const msg = {text: '连接已断开', type: 'system'}
  if (_chatStoreBridge) {
    _chatStoreBridge.addMessage(msg.text, msg.type)
  }
  state.messages.push({text: msg.text, time: new Date().toLocaleTimeString(), type: msg.type})
})

// 跨塘邀请：外塘房主邀请进房 → 弹卡片，用户选择同意/拒绝后回执
on('lobbyInvite', (data) => {
  const d = data || {}
  if (!d.inviteId) return
  const from = d.fromUsername || '外塘玩家'
  const region = d.fromRegion ? '[' + d.fromRegion + '] ' : ''
  const game = d.gameName ? '（' + d.gameName + '）' : ''
  const expire = d.expireSeconds || 60
  ElMessageBox.confirm(
    region + from + ' 邀请你加入游戏房间' + game + '，' + expire + ' 秒内有效。',
    '跨塘邀请',
    {confirmButtonText: '接受', cancelButtonText: '拒绝', type: 'info', distinguishCancelAndClose: true}
  ).then(() => {
    lobbyInviteReply(d.inviteId, true)
  }).catch((action) => {
    // 点「拒绝」才回执；点右上角关闭视为忽略，不回执（等 hub 超时）
    if (action === 'cancel') lobbyInviteReply(d.inviteId, false)
  })
})

// 跨塘邀请结果回执（房主侧）：受邀者同意/拒绝/超时
on('lobbyInviteResult', (data) => {
  const d = data || {}
  const act = String(d.action || '').toUpperCase()
  const target = d.toUsername || '对方'
  const reason = d.reason ? '（' + d.reason + '）' : ''
  let text = '邀请状态更新'
  let level = 'info'
  if (act === 'ACCEPT') {
    text = d.joined ? target + ' 已进入房间！' : target + ' 已同意邀请，正在进入房间...'
    level = 'success'
  } else if (act === 'REJECT') {
    text = target + ' 拒绝了你的邀请' + reason
  } else if (act === 'TIMEOUT') {
    text = '邀请 ' + target + ' 已超时' + reason
  }
  ElMessage({message: text, type: level, duration: 4000, showClose: true, grouping: true})
})

/**
 * 状态刷新钩子。
 * 原实现在 JSBridge 模式下从 IDE 宿主同步 online/username/tools 等状态；
 * xechat-dsh 纯 WS 模式下这些字段全部由服务端事件驱动（见 on('message'/'userState' 等），
 * 因此这里保留为 no-op，仅为兼容既有调用点。
 */
export function refreshState() {
}

export function navigate(route) {
  state.currentRoute = route
}
