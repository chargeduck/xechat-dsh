import axios from 'axios'

/**
 * 统一请求封装（axios 版）
 * - baseURL 固定指向 manager 后端 /api（nginx 反代 https://dld.lesscoding.net/api -> /xeManager）
 * - 请求拦截器：从 localStorage 读 token（key: satoken）写入 satoken 头
 * - 响应拦截器：按 {code, message, data} 解包，code !== 200 抛错；401 清 token 并派发登录态失效事件
 */
/** 线上服务根域名（资源相对路径 resolveAssetUrl 也基于此拼接） */
export const SERVER_ORIGIN = 'https://dld.lesscoding.net'

const service = axios.create({
  baseURL: import.meta.env.DEV ? '/api' : `${SERVER_ORIGIN}/api`,
  timeout: 30000
})

/** 登录态失效事件名（GamePanel 监听后切回登录表单） */
export const AUTH_EXPIRED_EVENT = 'xechat:auth-expired'

service.interceptors.request.use(
  config => {
    const token = localStorage.getItem('satoken')
    if (token) {
      config.headers.satoken = token
    }
    return config
  },
  error => Promise.reject(error)
)

service.interceptors.response.use(
  response => {
    const res = response.data
    if (res.code !== 200) {
      return Promise.reject(new Error(res.msg || res.message || '请求失败'))
    }
    return res
  },
  error => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('satoken')
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
      }
    }
    return Promise.reject(error)
  }
)

export default service
