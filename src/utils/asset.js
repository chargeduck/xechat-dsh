import { SERVER_ORIGIN } from './request'

/**
 * 统一资源地址解析：解决 file:// 环境下相对路径（如 /api/file/view/8）被解析为
 * file:///C:/api/file/view/8 导致加载失败的问题。
 * - 已是 http(s)/data:/blob: 绝对地址 → 原样返回
 * - 以 / 开头的相对路径 → 拼接线上域名（如 https://dld.lesscoding.net/api/file/view/8）
 * - 其它相对路径 → 同样拼接线上域名
 */
export function resolveAssetUrl(url) {
  if (!url || typeof url !== 'string') return url
  if (/^(https?:|data:|blob:)/i.test(url)) return url
  if (url.startsWith('/')) return SERVER_ORIGIN + url
  return SERVER_ORIGIN + '/' + url
}
