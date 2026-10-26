import request from '@/utils/request'

/** 登录（返回 data.token，Sa-Token 体系） */
export function login(data) {
  return request({
    url: '/user/login',
    method: 'post',
    data
  })
}

/** 注册 */
export function register(data) {
  return request({
    url: '/user/register',
    method: 'post',
    data
  })
}

/** 获取当前用户信息 */
export function getUserInfo() {
  return request({
    url: '/user/userInfo',
    method: 'get'
  })
}
