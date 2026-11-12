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
/**
 * 平台降级（老服务端兼容）
 *
 * 官方塘（-s 0 等）跑的是旧版服务端，它的 Platform 枚举只有 IDEA / WEB / COMMAND。
 * 本端固定上报 DSH，老服务端反序列化枚举会抛异常，回一句「消息内容解析异常!」——
 * 连接看着是通的，但永远登不进去。
 *
 * 处理办法：收到这句且尚未登录成功时，静默把 platform 换成 WEB 重发一次 LOGIN，
 * 并把该塘记进 localStorage，下次直接降级发，不再多一次往返。
 * 自己的塘（服务端枚举已含 DSH）不会命中，平台图标保持正确。
 */
const PLATFORM_FALLBACK = 'WEB'
const PLATFORM_FALLBACK_KEY = 'xechat_platform_fallback_v1'

function readFallbackKeys() {
  try {
    const arr = JSON.parse(localStorage.getItem(PLATFORM_FALLBACK_KEY) || '[]')
    return Array.isArray(arr) ? arr : []
  } catch (e) {
    return []
  }
}

function needsPlatformFallback(key) {
  return !!key && readFallbackKeys().indexOf(key) >= 0
}

function rememberPlatformFallback(key) {
  if (!key) return
  try {
    const keys = readFallbackKeys()
    if (keys.indexOf(key) >= 0) return
    keys.push(key)
    // 只留最近 50 个塘，避免 localStorage 无限增长
    localStorage.setItem(PLATFORM_FALLBACK_KEY, JSON.stringify(keys.slice(-50)))
  } catch (e) {
    /* ignore */
  }
}

/**
 * 是否需要做平台降级（纯判断，单独导出便于回归测试）。
 *
 * @param {{platform?:string, text?:string, acked?:boolean, downgraded?:boolean}} opts
 * @returns {boolean}
 */
export function shouldDowngradePlatform(opts) {
  const o = opts || {}
  if (o.downgraded) return false
  if (o.acked) return false
  if (!/消息内容解析异常/.test(String(o.text || ''))) return false
  const raw = String(o.platform || '').toUpperCase()
  if (!raw) return false
  if (raw === 'WEB' || raw === 'IDEA' || raw === 'COMMAND') return false
  return true
}

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
    // 本次连接是否已发出 LOGIN（服务端已把它算作一条在线会话）
    this._loggedIn = false
    // 最近一次 LOGIN 的载荷与目标塘标识（host:wsPort），平台降级需要重发同一个 body
    this._loginPayload = null
    this._loginKey = ''
    // 收到任何业务帧（非 SYSTEM）就认为登录已被服务端接受，此后不再尝试平台降级
    this._loginAcked = false
    this._platformDowngraded = false
  }

  /** 当前 WebSocket 连接地址（用于推导 HTTP 图片下载地址） */
  get wsUrl() { return this._url }

  /** 连接是否已就绪 */
  get isOpen() { return !!this._ws && this._ws.readyState === WebSocket.OPEN }

  /** 是否已登录（服务端侧存在本连接的用户会话） */
  get loggedIn() { return this._loggedIn && this.isOpen }

  async connect() {
    // CONNECTING 也算「已有连接在建立」：重复调用会再 new 一个 socket，
    // 把前一个孤儿化的同时，也会让服务端多算一条会话，广播随之重复投递
    if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) return
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
        self._loggedIn = false
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
    // 收到任何业务帧就说明这次 LOGIN 已被服务端接受，之后不再尝试平台降级
    if (type !== 'SYSTEM' && type !== 'HEARTBEAT') this._loginAcked = true
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
        // 老服务端不认 DSH：「消息内容解析异常!」是降级过程的中间态，吞掉并重发 LOGIN
        if (this._maybeDowngradePlatform(sysText)) break
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
    const prevUrl = this._url
    console.log('[WS][loginToServer] host=' + host + ', port=' + port + ', wsPort=' + wsPort + ', url=' + url + ', loginPayload=' + JSON.stringify(loginPayload))

    // 记住本次 LOGIN：万一目标塘是老服务端（不认识 DSH），要靠它原地降级重发
    this._loginPayload = loginPayload
    this._loginKey = host + ':' + wsPort
    this._loginAcked = false
    this._platformDowngraded = false
    // 这个塘以前被判定过不认 DSH：直接按降级值上报，省掉一次无谓的往返
    if (loginPayload && loginPayload.body && needsPlatformFallback(this._loginKey)) {
      console.log('[WS][loginToServer] 该塘曾因平台不支持降级，本次直接上报 ' + PLATFORM_FALLBACK)
      loginPayload.body.platform = PLATFORM_FALLBACK
      this._platformDowngraded = true
    }

    // 已经连在同一个地址上：直接复用连接补发 LOGIN，不要断开重连。
    // 断开重连会多一轮「服务端清理会话 → 重建会话」，刷新/恢复登录时尤其容易和
    // initXechat() 的连接互相打断，最终留下多条在线连接导致消息重复投递。
    if (this._ws && this._ws.readyState === WebSocket.OPEN && prevUrl === url) {
      console.log('[WS][loginToServer] 复用现有连接')
      this._intentionalClose = false
      if (loginPayload) this._send(loginPayload)
      return
    }

    // 断开旧连接
    this.disconnect()
    this._intentionalClose = false
    this._reconnectAttempts = 0
    this._url = url

    const self = this
    return new Promise(function(resolve, reject) {
      // 握手阶段失败必须 reject：旧实现在 onerror 里 resolve()，导致上层打印
      // 「已连接到 xxx，登录中...」并把状态置为在线，实际一帧都收不到，用户只能干等。
      let settled = false
      let opened = false
      let timer = null

      const fail = function (reason) {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        reject(new Error(reason))
      }
      const succeed = function () {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve()
      }

      // 握手上限：TCP 被丢包挂死时 onerror 可能迟迟不触发
      timer = setTimeout(function () {
        fail('连接 ' + url + ' 超时：10s 内未完成 WebSocket 握手')
        try { if (self._ws) self._ws.close() } catch (e) { /* ignore */ }
      }, 10000)

      const ws = new WebSocket(url)
      self._ws = ws
      console.log('[WS][loginToServer] WebSocket 实例已创建, url=' + url + ', readyState=' + ws.readyState)

      ws.onopen = function() {
        console.log('[WS][loginToServer] onopen 触发, connected to', url)
        opened = true
        self._everConnected = true
        self._startHeartbeat()
        self._emit('connected', {})

        // 连接成功后立即发送 LOGIN
        if (loginPayload) {
          self._send(loginPayload)
        }
        succeed()
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
        self._loggedIn = false
        // 还没 open 就 close = 握手根本没成功（端口不通 / 无 ws 入口 / 404）
        if (!opened) {
          fail('WebSocket 握手失败（close code=' + event.code + (event.reason ? ', ' + event.reason : '') + '）：' + url)
          return
        }
        if (!self._intentionalClose) self._scheduleReconnect()
      }

      ws.onerror = function(err) {
        const detail = err && err.message ? err.message : (err && err.type ? err.type : 'unknown')
        console.warn('[WS][loginToServer] onerror 触发, url=' + url + ', detail=' + detail)
        if (!opened) fail('无法建立 WebSocket 连接（' + detail + '）：' + url)
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
          body: { username: username, status: 'FISHING', platform: 'DSH', uuid: this._uuid(), pluginVersion: '', reconnected: false, token: this._adminToken() }
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

  /**
   * 老服务端不认识 DSH 时的静默降级。
   *
   * 触发条件（同时满足才降级）：
   *  1) 服务端回了「消息内容解析异常」，且这次登录还没收到任何业务帧（_loginAcked=false）；
   *  2) 本次上报的平台不是老枚举里已有的值（WEB / IDEA / COMMAND）；
   *  3) 同一个塘只降级一次，避免死循环。
   *
   * 命中后就地把 LOGIN 的 platform 改成 WEB 重发——第一次 LOGIN 在反序列化阶段就失败了，
   * 服务端并没有绑定这个 channel，所以同一连接重发不会撞「已登录」。同时记住这个塘，
   * 下次直接按降级值发。
   *
   * @returns {boolean} true 表示这条 SYSTEM 已被当作降级中间态吞掉，不要展示给用户
   */
  _maybeDowngradePlatform(sysText) {
    const payload = this._loginPayload
    if (!payload || !payload.body) return false
    const ok = shouldDowngradePlatform({
      platform: payload.body.platform,
      text: sysText,
      acked: this._loginAcked,
      downgraded: this._platformDowngraded
    })
    if (!ok) return false

    const raw = String(payload.body.platform || '').toUpperCase()
    console.log('[WS] 目标塘不认识平台 ' + raw + '，降级为 ' + PLATFORM_FALLBACK + ' 重发 LOGIN')
    this._platformDowngraded = true
    payload.body.platform = PLATFORM_FALLBACK
    rememberPlatformFallback(this._loginKey)
    this._send(payload)
    return true
  }

  _send(data) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      // 统一在这里标记登录态：无论走 loginToServer 还是 execCommand 的 LOGIN 帧
      if (data && data.action === 'LOGIN') this._loggedIn = true
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
    this._loggedIn = false
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
