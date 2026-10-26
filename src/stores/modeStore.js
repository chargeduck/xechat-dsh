/**
 * modeStore —— #mode / #showMode 的前端实现（替代 Java ShowModeCommandHandler / ModeCommandHandler）。
 *
 * 语义对齐后端 cn.xeblog.plugin.mode.ModeEnum：
 *  - 0：默认
 *  - 1：浑水摸鱼
 * 当前选择持久化到 localStorage，刷新/重开页面后保持"已设置"状态展示。
 */
import { defineStore } from 'pinia'

const STORAGE_KEY = 'xechat_mode_v1'

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return 0
    const index = parseInt(raw, 10)
    return index >= 0 && index < 2 ? index : 0
  } catch (e) {
    return 0
  }
}

export const useModeStore = defineStore('mode', {
  state: () => ({
    modes: [
      { name: '默认', value: 'DEFAULT' },
      { name: '浑水摸鱼', value: 'TROUBLED_WATERS' }
    ],
    currentIndex: loadSaved()
  }),

  getters: {
    /** MD 模式列表：供 #showMode 命令直接展示 */
    table(state) {
      const rows = state.modes.map((m, i) => {
        const marked = i === state.currentIndex ? '（已设置）' : ''
        return i + '. **' + m.name + '**' + marked
      })
      return '### 模式列表\n\n' + rows.join('\n')
    }
  },

  actions: {
    /**
     * 设置当前模式（按编号）。
     * @returns {boolean} 编号有效且已切换返回 true
     */
    setMode(index) {
      const idx = parseInt(index, 10)
      if (isNaN(idx) || idx < 0 || idx >= this.modes.length) {
        return false
      }
      this.currentIndex = idx
      try {
        localStorage.setItem(STORAGE_KEY, String(idx))
      } catch (e) {
        console.warn('[modeStore] persist 失败:', e)
      }
      return true
    }
  }
})
