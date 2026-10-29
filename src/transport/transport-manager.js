import {WebSocketTransport} from './transport-websocket.js'

/**
 * Transport Manager — 纯 WebSocket 实现。
 *
 * xechat-dsh 运行在 DSH Web 宿主内（纯浏览器环境），没有 JCEF / JSBridge 通道，
 * 因此只保留 WebSocket 一种传输方式，服务端地址由设置面板或 #login 指定。
 */
class TransportManager {
  constructor() {
    this._transport = null
    this._handlers = {}
    this._mode = 'websocket'
  }

  async init(config) {
    config = config || {}

    const wsUrl = config.wsUrl || this._readStoredWsUrl() || 'ws://127.0.0.1:1025/xechat'

    /*
     * 幂等初始化。
     *
     * 面板收起/展开、插件热重载都会再次调用 init()。旧实现每次都 new 一个
     * WebSocketTransport 却从不关闭上一个，于是浏览器里同时挂着多条 WebSocket：
     * 旧连接上的账号会话仍然有效，服务端广播时会把同一条消息推给这个账号的
     * 每一条连接，再经共享的事件表重复投递到 UI —— 表现就是「每个人发的消息都显示两遍」。
     *
     * 因此：地址相同就复用现有实例（没连上则补一次 connect），地址变化才断开重建。
     */
    if (this._transport) {
      // 调用方显式指定了另一个地址才考虑重建；未指定时一律复用当前实例。
      //
      // 这一条很关键：应用挂载时 ChatPanel 会先按上次会话登录（连到鱼塘地址），
      // 紧接着 initXechat() 才调用 init({})。若这里拿「存储的地址」去比对，
      // 两个地址不一致就会把刚建立的登录连接关掉重建，登录直接白做。
      const sameTarget = !config.wsUrl || this._transport.wsUrl === wsUrl
      if (sameTarget) {
        if (!this._transport.isOpen) {
          console.log('[Transport][init] 复用已有实例并重新连接, url=' + this._transport.wsUrl)
          await this._transport.connect()
        } else {
          console.log('[Transport][init] 复用已有连接, url=' + this._transport.wsUrl)
        }
        return
      }
      console.log('[Transport][init] 地址变化，关闭旧连接: ' + this._transport.wsUrl + ' -> ' + wsUrl)
      try {
        this._transport.disconnect()
      } catch (e) {
        /* ignore */
      }
      this._transport = null
    }

    console.log('[Transport][init] 创建 WebSocketTransport, url=' + wsUrl)
    this._transport = new WebSocketTransport(wsUrl)

    const self = this
    this._transport.on('*', function (type, data) {
      if (self._handlers[type]) {
        self._handlers[type].forEach(function (fn) {
          try {
            fn(data)
          } catch (e) {
            console.error('[Transport] handler error for ' + type, e)
          }
        })
      }
      if (self._handlers['*']) {
        self._handlers['*'].forEach(function (fn) {
          try {
            fn(type, data)
          } catch (e) {
            console.error('[Transport] wildcard handler error', e)
          }
        })
      }
    })

    // 连接失败不应阻断 UI 启动：用户可在登录面板重新连接
    await this._transport.connect()
  }

  /** 固定为 websocket，保留 getter 以兼容既有调用方 */
  get mode() {
    return this._transport ? this._transport.name : 'none'
  }

  get configuredMode() {
    return 'websocket'
  }

  /**
   * 当前 WebSocket 连接地址（供前端推导 HTTP 图片下载地址）。
   */
  get wsUrl() {
    if (this._transport && this._transport.wsUrl) return this._transport.wsUrl
    return ''
  }

  /** 连接是否已就绪 */
  get isOpen() {
    return !!(this._transport && this._transport.isOpen)
  }

  /** 是否已登录（服务端侧存在本连接的在线会话） */
  get loggedIn() {
    return !!(this._transport && this._transport.loggedIn)
  }

  execCommand(cmd) {
    if (this._transport) this._transport.execCommand(cmd)
  }

  loginToServer(host, port, loginPayload) {
    if (this._transport && this._transport.loginToServer) {
      return this._transport.loginToServer(host, port, loginPayload)
    }
  }

  /**
   * 管理员管控（禁言/禁发图）。
   * @param {string} operate USER_PERMIT_ADD | USER_PERMIT_REMOVE
   * @param {string} permissions SPEAK | SEND_FILE
   * @param {string} uid 目标用户 id
   */
  adminReact(operate, permissions, uid) {
    if (this._transport && typeof this._transport.adminReact === 'function') {
      return this._transport.adminReact(operate, permissions, uid)
    }
    console.warn('[Transport] 不支持 adminReact')
    return false
  }

  /** 踢人：WS 走特殊指令聊天帧 */
  kickUser(username) {
    if (this._transport && typeof this._transport.kickUser === 'function') {
      return this._transport.kickUser(username)
    }
    console.warn('[Transport] 不支持 kickUser')
    return false
  }

  sendMessage(text, toUsers) {
    if (this._transport) this._transport.sendMessage(text, toUsers)
  }

  /**
   * 发起跨塘邀请（房主邀请外塘用户进房）。
   * @param {string} toUserId 被邀请人 uuid
   * @param {string} toUsername 被邀请人昵称
   */
  lobbyInvite(toUserId, toUsername) {
    if (this._transport && typeof this._transport.lobbyInvite === 'function') {
      return this._transport.lobbyInvite(toUserId, toUsername)
    }
  }

  /**
   * 跨塘邀请回执（受邀者同意/拒绝外塘房主的进房邀请）。
   * @param {string} inviteId 邀请单号
   * @param {boolean} accept true=同意 false=拒绝
   */
  lobbyInviteReply(inviteId, accept) {
    if (this._transport && typeof this._transport.lobbyInviteReply === 'function') {
      return this._transport.lobbyInviteReply(inviteId, accept)
    }
  }

  on(type, handler) {
    if (!this._handlers[type]) this._handlers[type] = []
    this._handlers[type].push(handler)
  }

  off(type, handler) {
    const h = this._handlers[type]
    if (h) {
      this._handlers[type] = h.filter(function (fn) {
        return fn !== handler
      })
    }
  }

  disconnect() {
    if (this._transport && typeof this._transport.disconnect === 'function') {
      this._transport.disconnect()
    }
  }

  /** 读取上次使用的 WS 地址 */
  _readStoredWsUrl() {
    if (typeof localStorage === 'undefined') return null
    try {
      const raw = localStorage.getItem('xechat_settings_v1')
      if (raw) {
        const parsed = JSON.parse(raw)
        return parsed.wsUrl || null
      }
    } catch (e) {
      /* ignore */
    }
    return null
  }
}

export const transport = new TransportManager()
