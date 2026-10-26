/**
 * xechat 前端 API — 纯 WebSocket 实现。
 *
 * 原 xechat-web 通过 window.xechat（JCEF CefMessageRouter）与 IDE 宿主通信；
 * xechat-dsh 运行在 DSH Web 宿主内，没有该桥接层，因此全部走 WebSocket，
 * 外链一律交给浏览器 window.open。
 */

import { transport } from './transport/transport-manager.js'

/**
 * 用浏览器新标签页打开外链。
 * 用于目标站点以 X-Frame-Options / CSP frame-ancestors 拒绝被 iframe 内嵌的场景。
 * @param {string} url 绝对地址（http/https）
 * @returns {boolean} 是否已发起打开
 */
export function openExternal(url) {
  const target = (url || '').trim()
  if (!target) return false
  window.open(target, '_blank', 'noopener')
  return true
}

/**
 * 发起跨塘邀请：房主邀请外塘在线用户进房。
 * @param {string} toUserId 被邀请人 uuid
 * @param {string} toUsername 被邀请人昵称
 */
export function lobbyInvite(toUserId, toUsername) {
  return transport.lobbyInvite(toUserId, toUsername)
}

/**
 * 跨塘邀请回执：受邀者同意/拒绝外塘房主的进房邀请。
 * @param {string} inviteId 邀请单号
 * @param {boolean} accept true=同意 false=拒绝
 */
export function lobbyInviteReply(inviteId, accept) {
  return transport.lobbyInviteReply(inviteId, accept)
}

// === Transport 集成 API ===
export async function init(config) {
  console.log('[api.js][init] config=' + JSON.stringify(config) + ', userAgent=' + navigator.userAgent)
  return transport.init(config)
}

export function getMode() {
  return transport.mode
}

export function getConfiguredMode() {
  return transport.configuredMode
}

export function on(type, handler) {
  transport.on(type, handler)
}

export function off(type, handler) {
  transport.off(type, handler)
}

export function execCommand(cmd) {
  transport.execCommand(cmd)
}

export function loginToServer(host, port, loginPayload) {
  return transport.loginToServer(host, port, loginPayload)
}

export function sendMessage(text) {
  transport.sendMessage(text)
}

export function disconnect() {
  transport.disconnect()
}
