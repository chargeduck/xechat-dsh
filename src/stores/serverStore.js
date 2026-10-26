import {defineStore} from 'pinia'

const STORAGE_KEY = 'xechat_server_cache'
const CACHE_VERSION = 2  // v2: 增加 wsAlive 字段
// 服务端列表 API 地址（可配置：localStorage 'xechat_server_list_url' 可覆盖，默认走 dld.lesscoding.net/api/server/list）
const SERVER_LIST_API_URL = (typeof localStorage !== 'undefined' && localStorage.getItem('xechat_server_list_url')) || 'https://dld.lesscoding.net/api/server/list'

function loadCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const cached = JSON.parse(raw)
    // 版本不匹配则丢弃旧缓存，避免编码格式变更导致乱码残留
    if (cached._v !== CACHE_VERSION) return null
    return cached.data
  } catch {
    return null
  }
}

function saveCache(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({_v: CACHE_VERSION, data}))
}

/**
 * HTTP GET JSON。纯浏览器环境直接 fetch。
 */
function httpGetJson(url) {
  return fetch(url).then(function (resp) {
    if (!resp.ok) throw new Error('HTTP ' + resp.status)
    return resp.json()
  })
}

/**
 * 测试 TCP 连通性：用 fetch no-cors 探针。
 * @returns {Promise<boolean>} true 存活 / false 不可达
 */
function testConnection(host, port, timeout) {
  // 非 HTTP 服务器（如聊天服务）不返回 HTTP 响应会触发 ERR_EMPTY_RESPONSE，
  // 此时 TCP 握手已建立，应视为存活；仅主动超时（AbortError）判定为不可达
  const controller = new AbortController()
  const timer = setTimeout(function () {
    controller.abort()
  }, timeout)
  return fetch('http://' + host + ':' + port, {
    mode: 'no-cors',
    signal: controller.signal
  }).then(function () {
    clearTimeout(timer)
    return true
  }).catch(function (err) {
    clearTimeout(timer)
    return err.name !== 'AbortError'
  })
}

/**
 * 测试 WebSocket 连通性：尝试连接 ws://host:(port+1)/xechat，2s 超时。
 * @returns {Promise<boolean>} true 握手成功 / false 不可达
 */
function testWsConnection(host, port) {
  return new Promise(function (resolve) {
    const wsPort = parseInt(port) + 1
    const wsUrl = 'ws://' + host + ':' + wsPort + '/xechat'
    let ws = null
    let done = false
    const timer = setTimeout(function () {
      if (done) return
      done = true
      if (ws) {
        try {
          ws.close()
        } catch (e) {
        }
      }
      resolve(false)
    }, 2000)
    try {
      ws = new WebSocket(wsUrl)
      ws.onopen = function () {
        if (done) return
        done = true
        clearTimeout(timer)
        ws.close()
        resolve(true)
      }
      ws.onerror = function () {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(false)
      }
      ws.onclose = function () {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(false)
      }
    } catch (e) {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(false)
    }
  })
}

/**
 * serverStore - 服务列表的获取与缓存。
 * 首次加载从 localStorage 恢复；#showServer 从 gitee API 拉取；-c 强制刷新。
 */
export const useServerStore = defineStore('server', {
  state: () => ({
    servers: loadCache() || [],
    loading: false,
    // 当前登录服务器地址（前端前置解析 #login 维护，供图片下载 URL 推导与 @ 塘名区分）
    // 结构：{ host, port, protocol, pondName }，port 为登录时解析出的原始端口（TCP），
    // protocol 为 'jsbridge' | 'websocket'；pondName 为登录鱼塘名（-s 选中服务器 name，无法确定时 null）
    // 下载端口规则：websocket 模式 = port + 1（下载服务在 ws 端口），jsbridge 模式 = port（原值）
    current: null
  }),

  getters: {
    /** 渲染为 Markdown 表格 */
    serverTable(state) {
      if (!state.servers.length) return '暂无鱼塘数据，输入 #showServer 获取。'
      let md = '| 编号 | 鱼塘 | 地址 | TCP | WS |\n|------|------|------|-----|-----|\n'
      state.servers.forEach((s, i) => {
        const tcp = s.alive === true ? '存活' : s.alive === false ? '离线' : '探测中'
        const ws = s.wsAlive === true ? '存活' : s.wsAlive === false ? '离线' : '探测中'
        md += '| ' + i + ' | ' + (s.name || s.ip) + ' | ' + s.ip + ':' + s.port + ' | ' + tcp + ' | ' + ws + ' |\n'
      })
      return md
    }
  },

  actions: {
    /** 记录当前登录服务器（供图片下载地址推导与 @ 塘名区分），port 为登录原始端口，protocol 为 'jsbridge' | 'websocket'，pondName 为登录鱼塘名（可空） */
    setCurrentLogin(host, port, protocol, pondName) {
      this.current = {host: host, port: String(port), protocol: protocol || '', pondName: pondName || null}
      console.log('[serverStore] setCurrentLogin:', this.current)
    },

    async fetchServers(forceRefresh) {
      if (!forceRefresh && this.servers.length > 0) {
        return
      }
      this.loading = true
      try {
        const data = await httpGetJson(SERVER_LIST_API_URL)
        // 兼容两种返回格式：裸数组，或后端 Result 包装 {code,msg,data:[...]}
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : null)
        if (!list) throw new Error('API 返回格式异常，期望 JSON 数组或 {data:[...]}')
        this.servers = list
        saveCache(list)
        // 纯 WS 模式下服务列表仅存于前端缓存（localStorage），
        // 无需同步到 IDE 宿主 DataCache；#login -s 直接读取本 store。
        // 等待 TCP 探测完成后再结束 loading
        await this.testServerConnections()
      } catch (e) {
        console.error('[serverStore] 获取服务列表失败', e)
        throw e
      } finally {
        this.loading = false
      }
    },

    /** 并行测试所有服务器 TCP + WebSocket 连通性，全部完成后一次性写回 */
    async testServerConnections() {
      const list = this.servers
      if (!list.length) return
      // TCP 探测
      const tcpTasks = list.map(function (s) {
        return testConnection(s.ip, s.port, 500)
      })
      // WS 探测（ws://host:(port+1)/xechat，2s 超时）
      const wsTasks = list.map(function (s) {
        return testWsConnection(s.ip, s.port)
      })
      const tcpResults = await Promise.allSettled(tcpTasks)
      const wsResults = await Promise.allSettled(wsTasks)
      // 全部探测完成后一次性替换
      const updated = list.map(function (s, idx) {
        const tcpR = tcpResults[idx]
        const wsR = wsResults[idx]
        return Object.assign({}, s, {
          alive: tcpR.status === 'fulfilled' ? tcpR.value : false,
          wsAlive: wsR.status === 'fulfilled' ? wsR.value : false
        })
      })
      this.servers = updated
      saveCache(updated)
    }
  }
})
