/**
 * 屏蔽管理 store —— #mask 命令的前端实现（对齐 Java MaskCommandHandler / UserMessageHandler）。
 *
 * 语义（与 webview Java 端一致，并修正其"反直觉包含匹配"为实用方向）：
 *  - -u 昵称   ：模糊屏蔽，用户名包含该规则即命中（规则按逗号分隔可多条）
 *  - -r 省份   ：屏蔽地区，清洗后的 shortRegion 包含该规则即命中（兼容 "山东" 与 "山东 -> 中国"）
 *  - -i IP     ：屏蔽 IP（服务端暂不下发 ip 时该维度空转，规则保留）
 *  - -n        ：命中屏蔽时不渲染整条消息；默认渲染"已被禁言，无法发言"占位
 *  - -c        ：解除所有屏蔽（同时复位 -n）
 * 状态持久化到 localStorage，刷新/重开页面后仍然生效。
 */
import { defineStore } from 'pinia'
import { cleanShortRegion } from '@/utils/regionClean.js'

const STORAGE_KEY = 'xechat_mask_config_v1'

/** 被屏蔽消息的占位文案（与 Java UserMessageHandler 一致） */
export const MASKED_PLACEHOLDER = '已被禁言，无法发言'

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw)
    return {
      usernames: Array.isArray(o.usernames) ? o.usernames : [],
      regions: Array.isArray(o.regions) ? o.regions : [],
      ips: Array.isArray(o.ips) ? o.ips : [],
      notShow: !!o.notShow
    }
  } catch (e) {
    return null
  }
}

function pushUnique(list, values) {
  for (const raw of values) {
    const v = String(raw == null ? '' : raw).trim()
    if (v && !list.includes(v)) {
      list.push(v)
    }
  }
}

const saved = loadSaved()

export const useMaskStore = defineStore('mask', {
  state: () => ({
    usernames: saved ? saved.usernames : [],
    regions: saved ? saved.regions : [],
    ips: saved ? saved.ips : [],
    notShow: saved ? saved.notShow : false
  }),

  actions: {
    /** 持久化当前状态 */
    persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          usernames: this.usernames,
          regions: this.regions,
          ips: this.ips,
          notShow: this.notShow
        }))
      } catch (e) {
        console.warn('[maskStore] persist 失败:', e)
      }
    },

    /** 添加昵称屏蔽规则，支持逗号分隔多条 */
    addUsernames(list) {
      pushUnique(this.usernames, list)
      this.persist()
    },

    /** 添加省份/地区屏蔽规则，支持逗号分隔多条 */
    addRegions(list) {
      pushUnique(this.regions, list)
      this.persist()
    },

    /** 添加 IP 屏蔽规则，支持逗号分隔多条 */
    addIps(list) {
      pushUnique(this.ips, list)
      this.persist()
    },

    /** 设置命中后是否完全不显示（-n） */
    setNotShow(v) {
      this.notShow = !!v
      this.persist()
    },

    /** 解除所有屏蔽（-c），同时复位 notShow */
    clearAll() {
      this.usernames = []
      this.regions = []
      this.ips = []
      this.notShow = false
      this.persist()
    },

    /**
     * 判断用户消息是否命中屏蔽规则。
     * @returns {null | {kind: 'username'|'region'|'ip', rule: string}}
     */
    masked(user) {
      if (!user) return null
      const uname = user.username ? String(user.username) : ''
      for (const rule of this.usernames) {
        if (uname && uname.includes(rule)) {
          return { kind: 'username', rule }
        }
      }
      const region = cleanShortRegion(user.shortRegion)
      for (const rule of this.regions) {
        if (region && (region === rule || region.includes(rule))) {
          return { kind: 'region', rule }
        }
      }
      if (user.ip) {
        const ip = String(user.ip)
        for (const rule of this.ips) {
          if (ip === rule) {
            return { kind: 'ip', rule }
          }
        }
      }
      return null
    }
  }
})
