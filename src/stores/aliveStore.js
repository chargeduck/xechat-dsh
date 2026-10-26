/**
 * aliveStore —— #alive 活着提醒的前端实现（替代 Java AliveAction + AliveCommandHandler）。
 *
 * 语义对齐 Java 版并适配纯前端场景：
 *  - #alive         ：查看当前状态与下一次提醒时间
 *  - #alive 0       ：关闭提醒
 *  - #alive 1       ：开启提醒（若上次时间已过期则重置为 1 小时后）
 *  - 开启后按工作周期（默认 1 小时）触发一次提醒：到点向聊天区推一条消息，
 *    并自动续上下一轮提醒（对齐 Java 确认"继续工作"后的行为，无需人工确认）。
 * 状态持久化到 localStorage，刷新页面后提醒继续生效；计时器由本 store 模块级持有，
 * 不依赖具体组件生命周期，ChatPanel 挂载时只需 startTicker() 一次。
 */
import { defineStore } from 'pinia'
import { useChatStore } from './chatStore'

const STORAGE_KEY = 'xechat_alive_v1'

/** 默认工作周期（秒）= 1 小时 */
export const ALIVE_WORK_SECONDS = 60 * 60

function nowSec() {
  return Math.floor(Date.now() / 1000)
}

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    return {
      enabled: !!o.enabled,
      nextStartTime: Number(o.nextStartTime) || 0
    }
  } catch (e) {
    return null
  }
}

const saved = loadSaved()

let tickerTimer = null

export const useAliveStore = defineStore('alive', {
  state: () => ({
    enabled: saved ? saved.enabled : false,
    nextStartTime: saved ? saved.nextStartTime : 0,
    workSeconds: ALIVE_WORK_SECONDS
  }),

  getters: {
    /** 下一次提醒时间的展示文本（yyyy/MM/dd HH:mm:ss），未开启时为空串 */
    nextStartText(state) {
      if (!state.nextStartTime) return ''
      const d = new Date(state.nextStartTime * 1000)
      const p = (n) => String(n).padStart(2, '0')
      return (
        d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) +
        ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
      )
    }
  },

  actions: {
    persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          enabled: this.enabled,
          nextStartTime: this.nextStartTime
        }))
      } catch (e) {
        console.warn('[aliveStore] persist 失败:', e)
      }
    },

    /**
     * 开启/关闭提醒。
     * 开启时会自动续上过期的时间点；关闭后计时器轮询保留但不再触发。
     */
    setEnabled(enabled) {
      this.enabled = !!enabled
      if (this.enabled) {
        const now = nowSec()
        if (!this.nextStartTime || now > this.nextStartTime) {
          this.nextStartTime = now + this.workSeconds
        }
      }
      this.persist()
    },

    /**
     * 若已过预期提醒时间则重置下一轮（对齐 Java flushNextStartTime）。
     * @returns {boolean} 是否发生了重置
     */
    flushNextStartTime() {
      const now = nowSec()
      if (now > this.nextStartTime) {
        this.nextStartTime = now + this.workSeconds
        this.persist()
        return true
      }
      return false
    },

    /**
     * 启动秒级轮询（幂等，模块级单例 timer）。
     * 建议在 ChatPanel 挂载后调用一次；关闭提醒后轮询仍驻留但每秒空转，开销可忽略。
     */
    startTicker() {
      if (tickerTimer) return
      tickerTimer = setInterval(() => this.tick(), 1000)
    },

    /** 到点检查：命中则推送提醒并续下一轮 */
    tick() {
      if (!this.enabled) return
      const now = nowSec()
      if (now >= this.nextStartTime) {
        // 定时回调不在组件上下文，显式传 $pinia 实例以安全获取 store
        useChatStore(this.$pinia).addMessage(
          '**「活着」** 摸鱼时间到！站起来活动一下，看看远方～\n\n' +
          '> 输入 `#alive 0` 可关闭提醒，`#alive 1` 重新开启。'
        )
        this.nextStartTime = now + this.workSeconds
        this.persist()
      }
    }
  }
})
