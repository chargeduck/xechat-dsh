<template>
  <el-container class="app-container" :style="{ opacity: pluginOpacity }">
    <!-- 极简模式下整条侧栏隐藏（v-show 保留实例，切回来不需要重建 DOM） -->
    <el-aside v-show="!minimalMode" width="48px" class="app-sidebar">
      <div class="nav-buttons">
        <div
            class="nav-btn"
            :class="{ active: currentRoute === 'chat' }"
            @click="state.currentRoute = 'chat'"
            title="聊天"
        >
          <el-icon :size="20">
            <ChatDotRound/>
          </el-icon>
        </div>
        <div
            class="nav-btn"
            :class="{ active: currentRoute === 'browser' }"
            @click="state.currentRoute = 'browser'"
            title="浏览器"
        >
          <el-icon :size="20">
            <Monitor/>
          </el-icon>
        </div>
        <div
            class="nav-btn"
            :class="{ active: currentRoute === 'games' }"
            @click="state.currentRoute = 'games'"
            title="游戏"
        >
          <el-icon :size="20">
            <Trophy/>
          </el-icon>
        </div>
        <div
            class="nav-btn"
            :class="{ active: currentRoute === 'users' }"
            @click="state.currentRoute = 'users'"
            title="在线列表"
        >
          <el-icon :size="20">
            <UserFilled/>
          </el-icon>
        </div>
      </div>
      <div class="nav-bottom">
        <div class="nav-btn" :class="{ active: currentRoute === 'settings' }" @click="state.currentRoute = 'settings'" title="设置">
          <el-icon :size="18">
            <Setting/>
          </el-icon>
        </div>
      </div>
    </el-aside>

    <el-main class="app-main" :class="{ 'is-minimal': minimalMode }">
      <!--
        keep-alive：切换 tab 时缓存页面实例，不再用 v-if 反复销毁重建。
        DSH 的 Dock 面板里每次重建都要重新拉数据、重建游戏/浏览器 iframe，
        是切页卡顿的主要来源；缓存后切回只是把旧 DOM 挂回去。
        各页面若需要"重新激活时刷新"的逻辑，请用 onActivated，不要依赖 onMounted（只会触发一次）。
      -->
      <keep-alive>
        <component :is="currentView"/>
      </keep-alive>
    </el-main>
  </el-container>

  <!--
    界面模式悬浮开关：极简 / 普通。
    两种模式下都显示——极简模式没有侧栏，必须留一个能切回普通模式的入口。
    极简模式打开其它页面时额外给一个「返回聊天」按钮（等价 #chat）。
  -->
  <div class="mode-float">
    <button
        v-if="minimalMode && currentRoute !== 'chat'"
        class="mode-btn"
        title="返回聊天（#chat）"
        @click="goRoute('chat')"
    >
      <el-icon :size="14"><ChatDotRound/></el-icon>
    </button>
    <button
        class="mode-btn"
        :title="minimalMode ? '切换到普通模式（#ui 0）' : '切换到极简模式（#ui 1）'"
        @click="toggleMinimal"
    >
      <el-icon :size="14">
        <ScaleToOriginal v-if="minimalMode"/>
        <FullScreen v-else/>
      </el-icon>
    </button>
  </div>

  <!-- 紧急模式覆盖层：fixed 全屏，不受插件透明度影响，再次按下快捷键恢复 -->
  <div v-if="isPanicMode" class="panic-overlay" tabindex="-1" @click="focusPanicOverlay">
    <img v-if="isPanicImage" :src="panicUrl" class="panic-image" alt=""/>
    <iframe v-else-if="panicUrl" :src="panicUrl" class="panic-frame" allowfullscreen></iframe>
    <div v-else class="panic-empty">
      <p class="panic-empty-title">紧急模式已开启</p>
      <p class="panic-empty-tip">在「设置」中配置紧急内容（图片 URL 或网页地址），按快捷键即可切换显示</p>
    </div>
  </div>
</template>

<script setup>
import {computed, ref, onBeforeUnmount, onMounted} from 'vue'
import {state} from './store.js'
import {isDark, toggleTheme} from '@/composables/useTheme.js'
import { useSettingsStore, matchShortcut } from '@/stores/settingsStore.js'
import ChatPanel from '@/views/chat/ChatPanel.vue'
import BrowserPanel from '@/views/tools/BrowserPanel.vue'
import GamePanel from '@/views/game/GamePanel.vue'
import OnlineUsersPanel from '@/views/chat/OnlineUsersPanel.vue'
import StyleEditor from '@/views/settings/StyleEditor.vue'
import SettingsPanel from '@/views/settings/SettingsPanel.vue'

const currentRoute = computed(() => state.currentRoute)
const settingsStore = useSettingsStore()
const pluginOpacity = computed(() => settingsStore.pluginOpacity)

/** 极简模式：隐藏侧栏，主区域只留聊天区（消息列表 + 输入框） */
const minimalMode = computed(() => settingsStore.minimalMode)

/**
 * 路由 → 组件映射。配合 <keep-alive> 使用：同一个路由始终复用同一个实例。
 * 注意：这里必须用「静态对象」而不是模板里的 v-if 链，否则 keep-alive 无法缓存。
 * DSH 端没有独立的「工具页」——内置浏览器即 BrowserPanel。
 */
const VIEW_MAP = {
  chat: ChatPanel,
  browser: BrowserPanel,
  games: GamePanel,
  users: OnlineUsersPanel,
  'style-editor': StyleEditor,
  settings: SettingsPanel
}
const currentView = computed(() => VIEW_MAP[currentRoute.value] || ChatPanel)

/** 跳到指定页面（极简模式的「返回聊天」按钮与 #chat 命令共用） */
function goRoute(route) {
  state.currentRoute = route || 'chat'
}

/** 切换极简 / 普通模式；切入极简时先回聊天页，避免落在没有侧栏的空页面上 */
function toggleMinimal() {
  const next = !settingsStore.minimalMode
  settingsStore.setMinimalMode(next)
  if (next) state.currentRoute = 'chat'
}

/** 紧急模式：开启后全屏覆盖显示配置的图片/网页，再次按键恢复摸鱼页面 */
const isPanicMode = ref(false)
const panicUrl = computed(() => settingsStore.panicUrl)
const isPanicImage = computed(() => {
  const url = (panicUrl.value || '').trim()
  if (!url) return false
  if (/^data:image\//i.test(url)) return true
  return /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)(\?.*)?(#.*)?$/i.test(url)
})

/** 点击覆盖层夺回焦点，避免 iframe 内部键盘事件拦截快捷键 */
function focusPanicOverlay(e) {
  if (e && e.target && e.target.tagName === 'IFRAME') return
  if (document.activeElement && document.activeElement.blur) {
    document.activeElement.blur()
  }
  const el = e && e.currentTarget
  if (el && el.focus) el.focus()
}

/** 全局快捷键：长按连续调节插件透明度（每次 ±0.05，节流 60ms） */
const SHORTCUT_STEP = 0.05
const SHORTCUT_INTERVAL = 60
let lastShortcutAdjustTime = 0

function clampOpacity(value) {
  return Math.min(1, Math.max(0, Math.round(value * 100) / 100))
}

function isEditableTarget(el) {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true
}

/** 一键隐藏插件：已移除，隐藏/显示由 IDE 自身 Keymap 处理（IDEA: ToolWindow Action，VSCode: Keybinding） */
function onGlobalKeydown(e) {
  // 快捷键录制期间（设置面板）不响应
  if (window.__xechatShortcutRecording) return
  // 输入/可编辑区域聚焦时不触发
  if (isEditableTarget(document.activeElement)) return

  // 紧急模式：切换全屏伪装页（优先级最高）
  if (matchShortcut(settingsStore.shortcutPanic, e)) {
    e.preventDefault()
    isPanicMode.value = !isPanicMode.value
    return
  }
  // 紧急模式下不响应其他快捷键
  if (isPanicMode.value) return

  // 一键切换主题：直接响应一次，不节流
  if (matchShortcut(settingsStore.shortcutTheme, e)) {
    e.preventDefault()
    toggleTheme()
    return
  }

  // 透明度一键置为 0%（全透明）
  if (matchShortcut(settingsStore.shortcutOpacity0, e)) {
    e.preventDefault()
    settingsStore.setPluginOpacity(0)
    return
  }

  // 透明度一键置为 100%（不透明）
  if (matchShortcut(settingsStore.shortcutOpacity1, e)) {
    e.preventDefault()
    settingsStore.setPluginOpacity(1)
    return
  }

  let delta = 0
  if (matchShortcut(settingsStore.shortcutMinus, e)) delta = -SHORTCUT_STEP
  else if (matchShortcut(settingsStore.shortcutPlus, e)) delta = SHORTCUT_STEP
  if (!delta) return

  // 节流：模拟 Windows 音量键的长按连续调节
  const now = Date.now()
  if (now - lastShortcutAdjustTime < SHORTCUT_INTERVAL) return
  lastShortcutAdjustTime = now

  e.preventDefault()
  settingsStore.setPluginOpacity(clampOpacity(settingsStore.pluginOpacity + delta))
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown)
})
</script>

<style lang="scss" scoped>
.app-container {
  height: 100%;
  background: var(--bg-primary);
}

.app-sidebar {
  width: 48px !important;
  min-width: 48px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 8px 0;
  overflow: hidden;
}

.nav-buttons {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.nav-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.nav-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text-secondary);
  transition: all 0.15s;

  &:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  &.active {
    background: var(--bg-tertiary);
    color: var(--accent-color);
  }
}

.app-main {
  flex: 1;
  padding: 0;
  overflow: hidden;
}

/* 极简模式：侧栏不占位，聊天区铺满整宽 */
.app-main.is-minimal {
  width: 100%;
}

/* ===== 界面模式悬浮球（极简 / 普通） ===== */
.mode-float {
  position: fixed;
  top: 8px;
  right: 10px;
  z-index: 60;
  display: flex;
  gap: 8px;
  /* 半透明玻璃球：平时就能看见，鼠标移上去才完全清晰 */
  opacity: 0.55;
  transition: opacity 0.18s;
}

.mode-float:hover {
  opacity: 1;
}

.mode-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.28);
  transition: color 0.15s, border-color 0.15s, transform 0.15s;
}

.mode-btn:hover {
  color: var(--accent-color);
  border-color: var(--accent-color);
  transform: scale(1.08);
}

.mode-btn:active {
  transform: scale(0.94);
}

/* 紧急模式覆盖层 */
.panic-overlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: var(--bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.panic-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.panic-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}

.panic-empty {
  text-align: center;
  padding: 24px;
}

.panic-empty-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px;
}

.panic-empty-tip {
  font-size: 13px;
  color: var(--text-secondary);
  margin: 0;
}
</style>
