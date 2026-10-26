import request from '@/utils/request'

/**
 * 游戏列表（分页查询已上线的游戏）
 * 入参：{ pageSize, status, gameType, page }
 * 后端 GameInfoQuery(page, gameName, gameType, status, versionTime)，分页走 page.current / page.size
 */
export function getGameList(data) {
  const { page, pageSize, ...rest } = data
  return request({
    url: '/gameInfo/list',
    method: 'post',
    data: { ...rest, page: { current: page || 1, size: pageSize } }
  })
}

/** 游戏详情（按 id） */
export function getGameDetail(id) {
  return request({
    url: `/gameInfo/detail/${id}`,
    method: 'get'
  })
}
