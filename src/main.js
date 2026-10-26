import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import zhCn from 'element-plus/dist/locale/zh-cn.mjs'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import App from './App.vue'
import './styles/global.scss'
import { init as initTransport } from './api.js'

/**
 * 挂载 xechat Vue 应用到指定容器。
 * 由 DSH 插件的 React 壳在 Dock 面板打开时调用，容器由宿主管控。
 * @param {HTMLElement} el 挂载点
 * @returns {{ unmount: () => void }} 用于卸载的句柄
 */
export function mountXechat(el) {
  const app = createApp(App)
  app.use(createPinia())
  app.use(ElementPlus, { locale: zhCn })

  // 注册所有 Element Plus 图标
  for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
    app.component(key, component)
  }

  app.mount(el)
  console.log('[main.js] Vue 应用已挂载')

  return {
    unmount() {
      app.unmount()
      console.log('[main.js] Vue 应用已卸载')
    }
  }
}

/** 初始化传输层（纯 WebSocket） */
export async function initXechat() {
  try {
    await initTransport({})
  } catch (e) {
    // 连接失败不阻断 UI：用户可在登录面板手动重连
    console.warn('[main.js] 传输层初始化失败', e)
  }
}

// 独立浏览器预览（vite dev / 直接打开 index.html）时自举；
// DSH 插件环境下由 React 壳调用 mountXechat，不自动挂载。
// 判定依据：存在 DSH 插件宿主标记（由插件 shell 在注入脚本前写入）。
if (typeof window !== 'undefined' && !window.__XECHAT_DSH_EMBEDDED__) {
  ;(async function () {
    await initXechat()
    const el = document.getElementById('app')
    if (el) el.innerHTML = ''
    mountXechat(el || document.body)
  })()
}
