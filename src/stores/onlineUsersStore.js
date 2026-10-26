import { defineStore } from 'pinia'
import { cleanShortRegion, splitRegion } from '@/utils/regionClean'

/**
 * onlineUsersStore - 在线用户列表状态管理
 * 由 store.js 的 on('onlineUsers') / on('userState') 事件驱动更新
 *
 * 跨塘聚合（xechat-server 已合并本塘 UserCache + 外塘 ForwardUserCache 下发）：
 * 每条用户附带 pond（源塘名，本塘为空串）与 displayRegion（去掉塘前缀后的地区），
 * 供在线列表跨塘分组与 @ 候选区分。
 */
export const useOnlineUsersStore = defineStore('onlineUsers', {
  state: () => ({
    users: [],
    welcomeShown: false
  }),

  getters: {
    count(state) {
      return state.users.length
    }
  },

  actions: {
    /** 统一归一化单条在线用户：清洗地区 + 拆分源塘前缀 */
    _normalize(user) {
      const shortRegion = cleanShortRegion(user.shortRegion)
      const { pond, region } = splitRegion(shortRegion)
      return {
        uuid: user.uuid || '',
        // id/role/permit 用于管控按钮：id 是服务端 UserCache 的键（AdminReact.uid 需传该值）
        id: user.id || '',
        username: user.username || '',
        status: user.status || '',
        platform: user.platform || '',
        shortRegion,
        pond,
        displayRegion: region,
        role: user.role || '',
        permit: Number(user.permit) || 0
      }
    },

    /** 全量替换用户列表（ONLINE_USERS） */
    setUsers(userList) {
      this.users = (userList || []).map(u => this._normalize(u))
    },

    /** 添加或更新一个用户（USER_STATE） */
    upsertUser(user) {
      if (!user || !user.username) return
      const entry = this._normalize(user)
      const idx = this.users.findIndex(u => u.username === entry.username)
      if (idx >= 0) {
        this.users[idx] = entry
      } else {
        this.users.push(entry)
      }
    },

    /** 移除一个用户（USER_STATE 下线） */
    removeUser(username) {
      if (!username) return
      this.users = this.users.filter(u => u.username !== username)
    },

    markWelcomeShown() {
      this.welcomeShown = true
    },

    clear() {
      this.users = []
      this.welcomeShown = false
    }
  }
})
