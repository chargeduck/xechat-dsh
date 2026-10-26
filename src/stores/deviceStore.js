import { defineStore } from 'pinia'

const UUID_KEY = 'xechat_uuid'

function generateUuid() {
  return 'web-' + Math.random().toString(36).substring(2) + Date.now().toString(36)
}

function loadUuid() {
  const stored = localStorage.getItem(UUID_KEY)
  if (stored) return stored
  const uuid = generateUuid()
  localStorage.setItem(UUID_KEY, uuid)
  return uuid
}

export const useDeviceStore = defineStore('device', {
  state: () => ({
    uuid: loadUuid()
  }),

  getters: {
    /** 短标识，日志/UI 展示用 */
    shortId(state) {
      return state.uuid.substring(0, 8)
    }
  }
})
