import request from '@/utils/request'

/** 获取游戏分类列表（仅启用，扁平） */
export function getCategoryList() {
  return request({
    url: '/category/enabled',
    method: 'post'
  })
}
