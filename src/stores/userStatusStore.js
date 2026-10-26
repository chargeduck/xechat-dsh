import { defineStore } from 'pinia'

/**
 * userStatusStore - 用户状态定义（写死在前端，替代后端 ShowStatusCommandHandler）
 * 与后端 cn.xeblog.commons.enums.UserStatus 枚举保持一致：
 *   WORKING=0（工作中）、FISHING=1（摸鱼中）、PLAYING=2（游戏中）
 * #setStatus 的编号即 statuses 数组下标。
 */
export const useUserStatusStore = defineStore('userStatus', {
  state: () => ({
    statuses: [
      { value: 'WORKING', short: '工', alias: '工作中' },
      { value: 'FISHING', short: '鱼', alias: '摸鱼中' },
      { value: 'PLAYING', short: '戏', alias: '游戏中' }
    ]
  }),

  getters: {
    /**
     * MD 表格：供 #showStatus 命令直接展示
     */
    table(state) {
      const rows = state.statuses.map((s, i) => `| ${i} | ${s.alias} | ${s.value} |`)
      return [
        '## 可用状态',
        '',
        '| 编号 | 状态 | 值 |',
        '|------|------|-----|',
        ...rows,
        '',
        '> 使用 `#setStatus {编号}` 设置当前状态；编号 `2`（游戏中）不可手动设置。',
        ''
      ].join('\n')
    },

    /**
     * 根据状态值取别名（供 @ 弹层等 UI 使用）
     */
    aliasOf(state) {
      return (value) => {
        const s = state.statuses.find(i => i.value === value)
        return s ? s.alias : value || ''
      }
    },

    /**
     * 根据编号取状态定义（供 #setStatus 前端校验）
     */
    byIndex(state) {
      return (index) => state.statuses[index] || null
    }
  }
})
