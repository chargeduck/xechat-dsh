import { defineStore } from 'pinia'
import { nextTick } from 'vue'

/**
 * chatStore - 消息列表状态管理（Pinia）
 * 替代旧 store.js 中的 messages 相关逻辑。
 */
export const useChatStore = defineStore('chat', {
  state: () => ({
    messages: []
  }),

  getters: {
    isEmpty(state) {
      return state.messages.length === 0
    }
  },

  actions: {
    /**
     * 添加单条消息
     */
    addMessage(text, type, extra) {
      this.messages.push({
        text,
        time: new Date().toLocaleTimeString(),
        type: type || undefined,
        msgType: (extra && extra.msgType) || undefined,
        fileName: (extra && extra.fileName) || undefined
      })
      if (this.messages.length > 1000) {
        this.messages.splice(0, this.messages.length - 1000)
      }
    },

    /**
     * 批量添加消息
     */
    addMessages(texts) {
      texts.forEach(t => {
        this.messages.push({
          text: t,
          time: new Date().toLocaleTimeString()
        })
      })
      if (this.messages.length > 1000) {
        this.messages.splice(0, this.messages.length - 1000)
      }
    },

    /**
     * 批量添加带类型标记的消息（来自 JSBridge console，已由 store.js 解析 type）
     * @param {Array<{text: string, type: string|undefined}>} parsed
     */
    addMessagesRaw(parsed) {
      parsed.forEach(p => {
        this.messages.push({
          text: p.text,
          time: new Date().toLocaleTimeString(),
          type: p.type,
          msgType: p.msgType,
          fileName: p.fileName
        })
      })
      if (this.messages.length > 1000) {
        this.messages.splice(0, this.messages.length - 1000)
      }
    },

    /**
     * 清空消息
     */
    clear() {
      this.messages = []
    }
  }
})
