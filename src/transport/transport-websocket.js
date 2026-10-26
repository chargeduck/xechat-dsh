/**
 * WebSocket Transport — connects to XEChat Netty server.
 * Protocol: ws://127.0.0.1:1025/xechat
 *
 * Command → WS action mapping:
 *   #login → LOGIN    #setStatus → SET_STATUS
 *   #weather → WEATHER
 *   #exit → disconnect    plain text → CHAT
 *   #help/#clean/#moyu/#showStatus/#showMode/#showGame/#showServer
 *   #mode/#notify/#alive/#mask/#backgroundImage/#open
 *   → client-side only (not sent via WebSocket)
 *
 * 游戏命令（#play/#join/#over/#admin）已移除：单机游戏改由 manager 游戏大厅（/gameInfo/list）
 * 下发并 iframe 运行，联机游戏房间能力由 manager 部署时注入的 MatchLobby SDK 在游戏页内承载。
 */
export class WebSocketTransport {
  constructor(url) {
    this.name = 'websocket'
    this._url = url || 'ws://127.0.0.1:1025/xechat'
    this._ws = null
    this._handlers = {}
    this._heartbeatTimer = null
    this._reconnectTimer = null
    this._reconnectDelay = 3000
    this._reconnectAttempts = 0
    this._maxReconnectAttempts = 3
    this._intentionalClose = false
    // 是否曾成功建立过连接：从未连接成功时 onclose 属存活探测失败，不触发 disconnected 提示
    this._everConnected = false
  }

  /** 当前 WebSocket 连接地址（用于推导 HTTP 图片下载地址） */
  get wsUrl() { return this._url }

  async connect() {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) return
    this._intentionalClose = false
    const self = this

    console.log('[WS][connect] 尝试连接 url=' + this._url + ', readyState=' + (this._ws ? this._ws.readyState : '(none)'))

    return new Promise(function(resolve, reject) {
      const ws = new WebSocket(self._url)
      self._ws = ws
      console.log('[WS][connect] WebSocket 实例已创建, url=' + self._url + ', readyState=' + ws.readyState)

      ws.onopen = function() {
        console.log('[WS][connect] onopen 触发, connected to', self._url)
        self._reconnectAttempts = 0
        self._everConnected = true
        self._startHeartbeat()
        self._emit('connected', {})
        resolve()
      }

      ws.onmessage = function(event) {
        try {
          const msg = JSON.parse(event.data)
          self._dispatch(msg)
        } catch(e) {
          console.error('[WS] JSON parse error:', e)
        }
      }

      ws.onclose = function(event) {
        // 握手失败(如 302)时 onerror 先触发、onclose 随后触发，event 里带 close code
        console.log('[WS][connect] onclose 触发, code=' + event.code + ', reason=' + event.reason + ', wasClean=' + event.wasClean)
        self._stopHeartbeat()
        // 存活探测失败（从未连接成功过）静默，不弹"连接已断开"；真正在线后掉线才提示
        if (self._everConnected) self._emit('disconnected', { code: event.code })
        if (!self._intentionalClose) self._scheduleReconnect()
      }

      ws.onerror = function(err) {
        // 初始化连接失败不阻断 app 启动（浏览器环境通常无后端服务）
        // 重连由 onclose → _scheduleReconnect 处理，或用户通过 #login 手动连接
        console.warn('[WS][connect] onerror 触发, url=' + self._url, err && err.message ? err.message : err)
        resolve()
      }
    })
  }

  _dispatch(msg) {
    // 服务端协议使用 action 字段（LOGIN/CHAT/SYSTEM/...），兼容 type 兜底
    const type = msg.action || msg.type
    switch (type) {
      case 'USER':
      case 'CHAT':
        this._emit('message', {
          type: 'user',
          user: msg.user, text: msg.body && msg.body.content,
          msgType: msg.body && msg.body.msgType, toUsers: msg.body && msg.body.toUsers, time: msg.time
        })
        break
      case 'SYSTEM':
        const sysText = typeof msg.body === 'string' ? msg.body : (msg.body && msg.body.content) || ''
        this._emit('message', { type: 'system', text: sysText, time: msg.time })
        this._emit('system', { text: sysText, time: msg.time })
        break
      case 'ONLINE_USERS':
        this._emit('onlineUsers', { userList: (msg.body && msg.body.userList) || [], time: msg.time })
        break
      case 'USER_STATE':
        this._emit('userState', { user: msg.body && msg.body.user, state: msg.body && msg.body.state, time: msg.time })
        break
      case 'HISTORY_MSG':
        this._emit('history', { msgList: (msg.body && msg.body.msgList) || [], time: msg.time })
        break
      case 'STATUS_UPDATE':
        this._emit('statusUpdate', { user: msg.user, time: msg.time })
        break
      case 'LOBBY_INVITE': {
        // 跨塘邀请：INVITE=收到外塘房主邀请（弹卡片）；ACCEPT/REJECT/TIMEOUT=邀请结果回执
        const body = msg.body || {}
        const act = String(body.action || '').toUpperCase()
        if (act === 'INVITE') {
          this._emit('lobbyInvite', body)
        } else {
          this._emit('lobbyInviteResult', body)
        }
        break
      }
      case 'HEARTBEAT':
        break
      case 'REACT': {
        // 管控指令回执（AdminReact）：body.succeed + body.msg，失败时若服务端拒绝会带「没有权限！」等提示
        this._emit('reactResult', { body: msg.body || {}, time: msg.time })
        break
      }
      default:
        console.log('[WS] unknown message type:', type, msg)
    }
  }

  execCommand(cmdStr) {
    const parsed = this._parseCommand(cmdStr)
    if (parsed) this._send(parsed)
    return !!parsed
  }

  /**
   * 断开当前连接，重连到指定 host:port 的 WebSocket（port+1），
   * 连接成功后自动发送 LOGIN。
   * @param {string} host
   * @param {number} port
   * @param {object} loginPayload - LOGIN action body
   */
  async loginToServer(host, port, loginPayload) {
    const wsPort = parseInt(port) + 1
    const url = 'ws://' + host + ':' + wsPort + '/xechat'
    this._url = url
    console.log('[WS][loginToServer] host=' + host + ', port=' + port + ', wsPort=' + wsPort + ', url=' + url + ', loginPayload=' + JSON.stringify(loginPayload))

    // 断开旧连接
    this.disconnect()
    this._intentionalClose = false
    this._reconnectAttempts = 0

    const self = this
    return new Promise(function(resolve, reject) {
      const ws = new WebSocket(url)
      self._ws = ws
      console.log('[WS][loginToServer] WebSocket 实例已创建, url=' + url + ', readyState=' + ws.readyState)

      ws.onopen = function() {
        console.log('[WS][loginToServer] onopen 触发, connected to', url)
        self._everConnected = true
        self._startHeartbeat()
        self._emit('connected', {})

        // 连接成功后立即发送 LOGIN
        if (loginPayload) {
          self._send(loginPayload)
        }
        resolve()
      }

      ws.onmessage = function(event) {
        try {
          const msg = JSON.parse(event.data)
          self._dispatch(msg)
        } catch(e) {
          console.error('[WS] JSON parse error:', e)
        }
      }

      ws.onclose = function(event) {
        console.log('[WS][loginToServer] onclose 触发, code=' + event.code + ', reason=' + event.reason + ', wasClean=' + event.wasClean)
        self._stopHeartbeat()
        if (!self._intentionalClose) self._scheduleReconnect()
      }

      ws.onerror = function(err) {
        // 服务端 WS 未开启/握手失败时不做前端拒绝，交由 onclose → _scheduleReconnect 自行重试连接
        console.warn('[WS][loginToServer] onerror 触发, url=' + url + '，交由重连机制处理', err && err.message ? err.message : err)
        resolve()
      }
    })
  }

  /**
   * 发送文本消息。
   * @param {string} text 消息内容
   * @param {{nickname:string, pond:string|null}[]} [toUsers] 协议 @提及对象数组（可空）：
   *   [{nickname: 被@昵称, pond: 所属鱼塘名}]；pond 为 null 表示无法确定塘名（老帧 / 显式 -h -p 登录），
   *   服务端 CHAT 一律广播，toUsers 仅供各端 hasUser(昵称, 塘名) 判断"@我"提醒。
   */
  sendMessage(text, toUsers) {
    const body = { content: text, msgType: 'TEXT' }
    if (Array.isArray(toUsers) && toUsers.length > 0) {
      body.toUsers = toUsers
    }
    this._send({ action: 'CHAT', body: body })
  }

  /**
   * 管理员管控：上行 Action.REACT + React.ADMIN 帧（禁言/禁发图）。
   * 帧结构对齐服务端 ReactRequest：{ react: 'ADMIN', body: AdminReact{ operate, permissions, uid } }，
   * uid 必须是服务端 UserCache 的键（在线列表的 user.id），不是 uuid。
   * @param {string} operate USER_PERMIT_ADD | USER_PERMIT_REMOVE
   * @param {string} permissions SPEAK | SEND_FILE
   * @param {string} uid 目标用户 id
   */
  adminReact(operate, permissions, uid) {
    if (!uid) {
      console.warn('[WS][adminReact] uid 为空，丢弃管控指令')
      return false
    }
    this._send({
      action: 'REACT',
      body: {
        react: 'ADMIN',
        body: { operate: operate, permissions: permissions, uid: uid }
      }
    })
    return true
  }

  /**
   * 踢人：走服务端特殊指令聊天帧（服务端 FORCE_DISCONNECTION 识别「踢人:::{用户名}」，仅管理员生效）。
   * @param {string} username 目标用户昵称
   */
  kickUser(username) {
    if (!username) return false
    this.sendMessage('踢人:::' + username)
    return true
  }

  /** 读取持久化的管理员 Token（settingsStore 落盘于 localStorage） */
  _adminToken() {
    try {
      const raw = localStorage.getItem('xechat_settings_v1')
      return raw ? (JSON.parse(raw).adminToken || '') : ''
    } catch (e) {
      return ''
    }
  }

  /**
   * 发起跨塘邀请（WS 模式）：上行 LOBBY_INVITE 帧（action=INVITE），
   * 由鱼塘 server 转发 hub，hub 生成 inviteId 并定向投递到被邀请人所在塘。
   * @param {string} toUserId 被邀请人 uuid
   * @param {string} toUsername 被邀请人昵称
   */
  lobbyInvite(toUserId, toUsername) {
    if (!toUserId && !toUsername) return
    this._send({
      action: 'LOBBY_INVITE',
      body: { action: 'INVITE', toUserId: toUserId || '', toUsername: toUsername || '' }
    })
  }

  /**
   * 跨塘邀请回执（WS 模式）：上行 LOBBY_INVITE 帧，由鱼塘 server 转发 hub。
   * @param {string} inviteId 邀请单号
   * @param {boolean} accept true=同意 false=拒绝
   */
  lobbyInviteReply(inviteId, accept) {
    if (!inviteId) return
    this._send({
      action: 'LOBBY_INVITE',
      body: { inviteId: String(inviteId), action: accept ? 'ACCEPT' : 'REJECT' }
    })
  }

  _parseCommand(cmdStr) {
    const trimmed = cmdStr.trim()
    if (!trimmed || trimmed.charAt(0) !== '#') {
      return { action: 'CHAT', body: { content: trimmed, msgType: 'TEXT' } }
    }
    const parts = trimmed.split(/\s+/)
    const cmd = parts[0].slice(1).toLowerCase()

    switch (cmd) {
      case 'login':
        let username = ''
        const args = { s: 0, h: '', p: '', c: false }
        for (let i = 1; i < parts.length; i++) {
          const p = parts[i]
          if (p.charAt(0) === '-' && i + 1 < parts.length) {
            const key = p.slice(1)
            if (key === 'c') { args.c = true; continue }
            args[key] = parts[++i]
          } else if (p && p.charAt(0) !== '-') {
            username = p
          }
        }
        if (!username) username = 'User-' + Date.now().toString(36)
        return {
          action: 'LOGIN',
          body: { username: username, status: 'FISHING', platform: 'WEB', uuid: this._uuid(), pluginVersion: '', reconnected: false, token: this._adminToken() }
        }
      case 'setstatus':
        const raw = parts[1]
        const map = { working: 'WORKING', fishing: 'FISHING', playing: 'PLAYING' }
        const val = map[raw && raw.toLowerCase()] || (raw && raw.toUpperCase()) || 'FISHING'
        return { action: 'SET_STATUS', body: val }
      case 'weather':
        let location = '', type = ''
        for (let j = 1; j < parts.length; j++) {
          if (parts[j] === '-d' && j + 1 < parts.length) type = parts[++j]
          else if (parts[j].charAt(0) !== '-') location = parts[j]
        }
        return { action: 'WEATHER', body: { location: location || '', type: type } }
      case 'exit':
        this.disconnect()
        return null
      case 'help': case 'clean': case 'moyu': case 'showstatus':
      case 'showmode': case 'showgame': case 'showserver':
      case 'mode': case 'notify': case 'alive':
      case 'mask': case 'backgroundimage': case 'open':
        return null
      default:
        return null
    }
  }

  _send(data) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(data))
    }
  }

  _startHeartbeat() {
    this._stopHeartbeat()
    const self = this
    this._heartbeatTimer = setInterval(function() { self._send({ action: 'HEARTBEAT' }) }, 15000)
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) { clearInterval(this._heartbeatTimer); this._heartbeatTimer = null }
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) return
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      console.log('[WS] Max reconnect attempts (' + this._maxReconnectAttempts + ') reached, waiting for manual connect')
      if (this._everConnected) this._emit('disconnected', { code: -1, exhausted: true })
      return
    }
    this._reconnectAttempts++
    const self = this
    console.log('[WS] reconnecting in', this._reconnectDelay, 'ms (attempt ' + this._reconnectAttempts + '/' + this._maxReconnectAttempts + ')')
    this._reconnectTimer = setTimeout(function() { self._reconnectTimer = null; self.connect().catch(function(){}) }, this._reconnectDelay)
  }

  _uuid() {
    let uuid = localStorage.getItem('xechat_uuid')
    if (!uuid) {
      uuid = 'web-' + Math.random().toString(36).substring(2) + Date.now().toString(36)
      localStorage.setItem('xechat_uuid', uuid)
    }
    return uuid
  }

  disconnect() {
    this._intentionalClose = true
    this._stopHeartbeat()
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null }
    if (this._ws) { this._ws.close(); this._ws = null }
  }

  _emit(type, data) {
    const h = this._handlers[type]
    if (h) { h.forEach(function(fn) { try { fn(data) } catch(e) {} }) }
    const w = this._handlers['*']
    if (w && type !== '*') { w.forEach(function(fn) { try { fn(type, data) } catch(e) {} }) }
  }

  on(type, handler) {
    if (!this._handlers[type]) this._handlers[type] = []
    this._handlers[type].push(handler)
  }

  off(type, handler) {
    const h = this._handlers[type]
    if (h) { this._handlers[type] = h.filter(function(fn) { return fn !== handler }) }
  }
}
