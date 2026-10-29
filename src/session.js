/**
 * 登录会话持久化。
 *
 * 面板收起不再销毁 Vue 应用，所以「收起→展开」本身不需要恢复登录；
 * 这里的持久化是为了覆盖真正会重建应用场景：宿主刷新页面、插件停用后重新启用、
 * 以及浏览器崩溃后重开。只保存恢复登录必需的最小信息（地址 + 昵称 + 塘名），
 * 不落 token —— 管理员 token 仍由 settingsStore 自己管理。
 */

const STORAGE_KEY = 'xechat_session_v1'

/**
 * 写入上次成功登录的会话。
 * @param {{host: string, port: string|number, username: string, pondName?: string|null, status?: string}} session
 */
export function saveSession(session) {
  if (typeof localStorage === 'undefined') return
  if (!session || !session.host || !session.port || !session.username) return
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        host: session.host,
        port: String(session.port),
        username: session.username,
        pondName: session.pondName || null,
        status: session.status || 'FISHING',
        ts: Date.now()
      })
    )
  } catch (e) {
    /* 隐私模式等场景写入失败不应影响登录 */
  }
}

/**
 * 读取上次登录的会话；存储损坏或字段缺失时返回 null。
 * @returns {{host:string, port:string, username:string, pondName:string|null, status:string, ts:number}|null}
 */
export function loadSession() {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw)
    if (!s || !s.host || !s.port || !s.username) return null
    return s
  } catch (e) {
    return null
  }
}

/** 清除会话（用户主动 #exit 退出鱼塘时调用）。 */
export function clearSession() {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch (e) {
    /* ignore */
  }
}
