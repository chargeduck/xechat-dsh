import { defineStore } from 'pinia'

const HISTORY_KEY = 'xechat_command_history_v1'
/** 命令历史最大保留条数 */
const MAX_HISTORY = 30

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(item => typeof item === 'string').slice(-MAX_HISTORY) : []
  } catch {
    return []
  }
}

/**
 * 命令历史 store：记录输入框使用过的命令/消息（terminal 风格）。
 * 保留最近 MAX_HISTORY 条，持久化到 localStorage，最新一条在数组末尾。
 */
export const useCommandHistoryStore = defineStore('commandHistory', {
  state: () => ({
    commands: loadHistory()
  }),

  actions: {
    /**
     * 记录一条输入：连续重复自动去重；超出上限时丢弃最旧条目。
     */
    push(cmd) {
      const text = (cmd || '').trim()
      if (!text) return
      if (this.commands[this.commands.length - 1] === text) return
      this.commands.push(text)
      if (this.commands.length > MAX_HISTORY) {
        this.commands.splice(0, this.commands.length - MAX_HISTORY)
      }
      this.persist()
    },

    clear() {
      this.commands = []
      this.persist()
    },

    persist() {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(this.commands))
      } catch (e) {
        console.warn('[commandHistory] 历史持久化失败:', e)
      }
    }
  }
})
