/**
 * 聊天通道地址推导。
 *
 * 2026-11-11 修复：旧实现在 HTTPS 页面里无条件 `return 'wss://' + location.host + '/xechat'`，
 * 把 #login -s 编号 / -h IP / -p 端口 解析出来的目标鱼塘整个丢掉，
 * 用户以为连的是 A 塘，实际始终连到部署站点自己反代的那个塘（只有自己在线）。
 *
 * 现在的优先级：
 *  1) explicitUrl —— 服务器列表项 wsUrl / 运维显式配置，最高优先级，原样采用。
 *  2) 非安全上下文（http://、file://、IDE/VSCode webview）—— 严格按 host:(port+1) 直连
 *     `ws://`。这些上下文浏览器允许明文 WS，参数必须完全生效。
 *  3) HTTPS 页面 —— 浏览器按「混合内容」直接拦掉 ws://，聊天服务明文端口也没有 TLS：
 *     a) 目标就是当前站点自己反代的本塘 → 同源 `wss://<location.host>/xechat`（保持兼容）；
 *     b) 目标为其它鱼塘且配置了同源中继 → `wss://<location.host><relayBase><host>/<wsPort>`，
 *        由 nginx 按塘反代到对应明文 WS 端口（见 deploy/nginx-xechat-relay.conf）；
 *     c) 未配中继 → `wss://<host>/xechat`（尊重目标域名，对方站点若提供 wss 反代即可连通）。
 *     **绝不回落到 a)**：连不上可以明确失败/提示，静默连错鱼塘是数据层面的错误。
 */

/** 当前页面是否 HTTPS（webview / file:// / localhost 都是 false） */
export function isSecurePage() {
  return typeof location !== 'undefined' && location.protocol === 'https:'
}

const RELAY_BASE_KEY = 'xechat_ws_relay_base'
const LOCAL_POND_HOSTS_KEY = 'xechat_local_pond_hosts'
/**
 * 非安全上下文（VSCode / IDEA webview、file://）里没有可用的 location.host，
 * 同源路径 `/xechat/relay/` 拼不出地址。这里用一个完整的 wss origin 走主站 Go 中继：
 *   ws://<pond>:33859/xechat → wss://xechat.lesscoding.net/xechat/relay/<pond>/33859
 * 与 DSH(transport-websocket.js) 和 openidea(openidea-bridge.js) 的默认值保持一致。
 * 中继端按塘白名单转发，并且会把超过 64KB 的大帧分帧——发图必须走它。
 */
const RELAY_ORIGIN_KEY = 'xechat_ws_relay_origin'
const DEFAULT_RELAY_ORIGIN = 'wss://xechat.lesscoding.net'

function readStorage(key) {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key)
  } catch (e) {
    // file:// / 隐私模式下 localStorage 可能抛错
  }
  return null
}

/**
 * 同源 WS 中继路径前缀（仅 HTTPS 跨塘时使用）。
 * 配置优先级：运行时 localStorage > 构建时 VITE_WS_RELAY_BASE > 空（不启用）。
 * 部署了 nginx 按塘反代后，构建时注入 `VITE_WS_RELAY_BASE=/xechat/relay/` 即可全局生效；
 * 也可在站点控制台 `localStorage.setItem('xechat_ws_relay_base','/xechat/relay/')` 临时开启，
 * 设为 '' 表示显式关闭。
 */
export function getWsRelayBase() {
  const runtime = readStorage(RELAY_BASE_KEY)
  if (runtime !== null) return runtime
  // vite.config.js 的 define 会把它替换成字符串字面量；Node 单测环境为 undefined
  const fromBuild = typeof __XECHAT_WS_RELAY_BASE__ !== 'undefined' ? __XECHAT_WS_RELAY_BASE__ : ''
  return fromBuild || ''
}

/**
 * 非安全上下文用的中继站点完整 origin。
 * 优先级：localStorage['xechat_ws_relay_origin'] > 构建注入的完整 URL > 默认值。
 * 注意 relay base（同源路径 /xechat/relay/）只是开/关信号，不是这里的 origin。
 */
export function getRelayOrigin() {
  const runtime = readStorage(RELAY_ORIGIN_KEY)
  if (runtime) return runtime.replace(/\/+$/, '')
  // 运维也可能把完整 wss URL 直接写进 relay base（历史用法），兼容识别
  const base = getWsRelayBase()
  if (/^wss?:\/\//i.test(base)) return base.replace(/\/+$/, '')
  return DEFAULT_RELAY_ORIGIN
}

/** 回环地址始终直连，不经中继（本地调试塘） */
function isLoopbackHost(host) {
  const h = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '')
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.indexOf('127.') === 0
}

/**
 * 目标鱼塘是否就是当前 HTTPS 站点自己反代的那个塘。
 * 只认「地址与页面域名相同」或运维显式声明的别名（xechat_local_pond_hosts，逗号分隔），
 * 不做同主域猜测——dld.lesscoding.net 与 xechat.lesscoding.net 是两个不同的鱼塘。
 */
export function isLocalPond(host) {
  const h = String(host || '').trim().toLowerCase()
  if (!h) return true
  if (typeof location === 'undefined') return false
  const here = location.hostname.toLowerCase()
  if (h === here || h === location.host.toLowerCase()) return true
  const extra = readStorage(LOCAL_POND_HOSTS_KEY) || ''
  return extra.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).indexOf(h) >= 0
}

/** 生成同源中继地址；host 做 URL 编码避免破坏路径分段，端口传 ws 端口（port+1） */
function buildRelayUrl(host, port) {
  const raw = getWsRelayBase()
  const base = (raw.charAt(0) === '/' ? raw : '/' + raw).replace(/\/+$/, '')
  const wsPort = (parseInt(port, 10) || 0) + 1
  return 'wss://' + location.host + base + '/' + encodeURIComponent(host) + '/' + wsPort
}

/**
 * @param {string} host #login 解析出的服务器地址（-s 编号反查的 ip，或 -h 显式值）
 * @param {string|number} port 登录端口（聊天服务 TCP 端口，WS 端口为 port+1）
 * @param {string} [explicitUrl] 服务器列表项 wsUrl 等显式 ws/wss 地址，优先使用
 * @returns {string}
 */
export function buildChatWsUrl(host, port, explicitUrl) {
  if (explicitUrl) return explicitUrl

  // 非安全上下文（VSCode / IDEA webview / file://）—— 这里过去无条件直连，
  // 导致「中继连接」开关形同虚设：describeWsRoute 报 relay:true，实际却直连明文 ws。
  // 明文 ws 在宿主里受限制，且直连会被鱼塘 Netty 64KB 单帧上限断连（发图必挂）。
  // 现在让开关真正生效：
  //   开启（默认）→ wss://<relayOrigin>/xechat/relay/<host>/<wsPort>（主站 Go 中继，能分帧）
  //   关闭        → ws://host:<wsPort>/xechat 原样直连（尊重用户选择）
  // 回环地址本地调试塘始终直连，不绕主站。
  if (!isSecurePage()) {
    const wsPort = (parseInt(port, 10) || 0) + 1
    if (!getWsRelayBase() || isLoopbackHost(host)) {
      return 'ws://' + host + ':' + wsPort + '/xechat'
    }
    return getRelayOrigin() + '/xechat/relay/' + encodeURIComponent(host) + '/' + wsPort
  }

  // 本塘：保持原有同源反代行为
  if (isLocalPond(host)) {
    return 'wss://' + location.host + '/xechat'
  }

  // 跨塘：宁可明确失败，也不能静默连回本站
  if (getWsRelayBase()) return buildRelayUrl(host, port)
  return 'wss://' + host + '/xechat'
}

/**
 * 描述本次连接的路由情况，供 UI 给出明确提示（尤其是 HTTPS 跨塘的浏览器限制）。
 * @returns {{url:string, secure:boolean, crossPond:boolean, relay:boolean, needsSetup:boolean, explicit:boolean}}
 */
export function describeWsRoute(host, port, explicitUrl) {
  const secure = isSecurePage()
  const local = isLocalPond(host)
  const relayOn = !!getWsRelayBase()
  const explicit = !!explicitUrl
  const url = buildChatWsUrl(host, port, explicitUrl)
  return {
    url,
    secure,
    crossPond: secure && !local,
    // relay 表示「本次实际是否走了中继」，直接从最终 URL 判定，保证与 url 一致。
    // 不能再只报开关状态：非安全上下文过去报 relay:true 却直连，误导排查。
    relay: url.indexOf('/xechat/relay/') >= 0,
    explicit,
    // HTTPS 跨塘、既没有显式 wss 地址、也没部署中继：只能尝试目标域名自己的 wss 反代，
    // 明文鱼塘通常连不上，需要提示用户
    needsSetup: secure && !local && !relayOn && !explicit
  }
}

/**
 * 图片下载服务的基础地址（下载服务与 ws 服务同端口）。
 *
 * HTTPS 页面同样无法加载 `http://...:33859` 的图片，本塘取站点自身 origin。
 * 注意：跨塘时这里仍回落到 location.origin，图片可能取不到（与聊天连接是两套链路），
 * 如需完整支持跨塘图片，应由运维给目标塘配置同源图片反代，或让列表项显式给出 httpBase。
 *
 * @param {{host:string, port:string|number, protocol:string}|null} current serverStore.current
 * @param {string} [fallbackWsUrl] transport.wsUrl 兜底
 * @returns {string} 形如 `https://xechat.example.com` 或 `http://1.2.3.4:33859`
 */
export function chatHttpBase(current, fallbackWsUrl) {
  // 走中继时地址形如 wss://<站点>/xechat/relay/<塘IP>/<wsPort>：
  // 图片是存在那台塘上的，下载必须按中继路径里的 <塘IP>:<wsPort> 拼，
  // 不能退回页面 origin —— 那是主站，/download 必然 404。
  const relayUrl = (fallbackWsUrl || (current && current.ws) || '')
  const relay = /\/xechat\/relay\/([^/]+)\/(\d+)/.exec(relayUrl)
  if (relay) {
    const host = relay[1]
    const port = relay[2]
    // 目标塘就是当前站点：直接用同源 /download/（nginx 已反代到本机塘的 HTTP 端口），
    // 既能命中文件，也不会被浏览器当成混合内容拦掉。
    if (typeof location !== 'undefined' && location.hostname === host) {
      return location.origin
    }
    // 跨塘（别的 IP / 域名）
    // HTTPS 页面下浏览器会把 http:// 图片当混合内容拦掉，改走同源反代：
    //   /xechat/pond/<host>/<port>/download/<file>  → nginx 转发到那台塘的 HTTP 端口
    if (typeof location !== 'undefined' && location.protocol === 'https:') {
      return location.origin + '/xechat/pond/' + host + '/' + port
    }
    return 'http://' + host + ':' + port
  }
  if (current && current.host && current.port) {
    if (isSecurePage()) return location.origin
    // 图片下载 HTTP 服务固定监听 ws 端口 = 登录端口 + 1（见 XEChatServer.bind(port+1)）。
    // 三端都遵循这个约定：vscode/dsh 是 websocket 模式，IDEA 是 jsbridge 模式，
    // 但 current.port 存的都是登录 TCP 端口（如 33858），下载都该连 33859。
    // 旧逻辑只对 websocket 做 +1，导致 IDEA 下拼成 33858（TCP 端口，非 HTTP），下载必失败。
    const port = parseInt(current.port, 10) + 1
    return 'http://' + current.host + ':' + port
  }
  if (!fallbackWsUrl) return ''
  return fallbackWsUrl
    .replace(/^wss:\/\//, 'https://')
    .replace(/^ws:\/\//, 'http://')
    .replace(/\/xechat.*$/, '')
}
