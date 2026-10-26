import { defineStore } from 'pinia'

const STORAGE_KEY = 'xechat_text_styles'

const BUILTIN_STYLES = [
  { id: 'red',           name: '红色文字',   tag: '<span style="color:#ff4444">{text}</span>' },
  { id: 'blue',          name: '蓝色文字',   tag: '<span style="color:#3498db">{text}</span>' },
  { id: 'green',         name: '绿色文字',   tag: '<span style="color:#2ecc71">{text}</span>' },
  { id: 'purple',        name: '紫色文字',   tag: '<font color="#9b59b6">{text}</font>' },
  { id: 'orange',        name: '橙色文字',   tag: '<span style="color:#e67e22">{text}</span>' },
  { id: 'yellow',        name: '黄色文字',   tag: '<span style="color:#f1c40f">{text}</span>' },
  { id: 'gradient',      name: '彩虹渐变',   tag: '<span style="background:linear-gradient(90deg,red,orange,yellow,green,blue,purple);-webkit-background-clip:text;color:transparent;font-weight:bold;">{text}</span>' },
  { id: 'glow',          name: '发光文字',   tag: '<span style="text-shadow:0 0 6px #fff,0 0 12px #0cf;color:#0cf;font-weight:bold;">{text}</span>' },
  { id: 'stroke',        name: '白字黑描边', tag: '<span style="text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000;color:#fff;">{text}</span>' }
]

function loadCustom() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveCustom(styles) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(styles))
}

export const useTextStyleStore = defineStore('textStyle', {
  state: () => ({
    customStyles: loadCustom()
  }),

  getters: {
    /** 合并内置 + 自定义，下拉选择用 */
    allStyles(state) {
      return [
        ...BUILTIN_STYLES,
        ...state.customStyles.map(s => ({
          id: s.id,
          name: s.name,
          tag: `<span style="${s.css}">{text}</span>`
        }))
      ]
    },

    /** 编辑器预览用（仅自定义） */
    customOnly(state) {
      return state.customStyles
    }
  },

  actions: {
    addStyle(name, css) {
      const id = 'custom_' + Date.now()
      this.customStyles.push({ id, name, css })
      saveCustom(this.customStyles)
      return id
    },

    updateStyle(id, name, css) {
      const idx = this.customStyles.findIndex(s => s.id === id)
      if (idx >= 0) {
        this.customStyles[idx] = { id, name, css }
        saveCustom(this.customStyles)
      }
    },

    removeStyle(id) {
      this.customStyles = this.customStyles.filter(s => s.id !== id)
      saveCustom(this.customStyles)
    }
  }
})
