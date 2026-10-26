<template>
  <div class="settings-panel">
    <div class="panel-header">
      <span class="panel-title">设置</span>
    </div>
    <div class="settings-body">
      <div class="setting-row">
        <span>主题</span>
        <el-switch
          :model-value="isDark"
          @change="toggleTheme()"
          active-text="暗色"
          inactive-text="亮色"
        />
      </div>
      <div class="setting-row">
        <span>文字样式</span>
        <el-button size="small" @click="state.currentRoute = 'style-editor'">
          管理
        </el-button>
      </div>
      <div class="setting-row">
        <span>浏览器配色</span>
        <el-radio-group v-model="browserTheme" size="small" @change="onBrowserThemeChange">
          <el-radio-button value="auto">跟随主题</el-radio-button>
          <el-radio-button value="dark">深色</el-radio-button>
          <el-radio-button value="light">浅色</el-radio-button>
          <el-radio-button value="off">不做处理</el-radio-button>
        </el-radio-group>
      </div>
      <div class="setting-row">
        <span>网页降亮</span>
        <div class="slider-wrap">
          <el-slider
            v-model="browserDim"
            :min="0"
            :max="0.6"
            :step="0.05"
            :format-tooltip="(v) => (v === 0 ? '关闭' : Math.round(v * 100) + '%')"
          />
        </div>
      </div>
      <div class="setting-hint">
        内置浏览器是 iframe，跨源站点受同源策略保护，插件无法改写其内部元素，
        因此这里只能给容器着色并加一层降亮遮罩，无法像 DarkReader 那样逐元素反色。
      </div>
      <div class="setting-row">
        <span>插件透明度</span>
        <div class="slider-wrap">
          <el-slider
            v-model="pluginOpacity"
            :min="0"
            :max="1"
            :step="0.05"
            :format-tooltip="(v) => Math.round(v * 100) + '%'"
            style="width: 130px"
          />
          <span class="slider-value">{{ Math.round(pluginOpacity * 100) }}%</span>
        </div>
      </div>
      <div class="setting-row">
        <span>游戏面板透明度</span>
        <div class="slider-wrap">
          <el-slider
            v-model="gamePanelOpacity"
            :min="0.1"
            :max="1"
            :step="0.05"
            :format-tooltip="(v) => Math.round(v * 100) + '%'"
            style="width: 130px"
          />
          <span class="slider-value">{{ Math.round(gamePanelOpacity * 100) }}%</span>
        </div>
        <div style="font-size: 11px; color: var(--el-text-color-secondary); margin-top: 4px; width: 100%; text-align: right">
          游戏播放时面板透明度
        </div>
      </div>
      <div class="setting-block">
        <div class="block-title">快捷键</div>
        <div v-for="item in shortcutItems" :key="item.type" class="shortcut-row">
          <span>{{ item.label }}</span>
          <div class="shortcut-actions">
            <button
              class="shortcut-btn"
              :class="{ recording: recordingShortcut === item.type }"
              @click="startRecording(item.type)"
            >
              {{ recordingShortcut === item.type ? '按下新组合键...' : formatShortcut(settingsStore[item.getter]) }}
            </button>
            <button class="shortcut-reset" title="恢复默认" @click="settingsStore[item.setter](DEFAULT_SHORTCUTS[item.type])">默认</button>
          </div>
        </div>
        <div v-if="recordingShortcut" class="shortcut-hint">
          请按下新的组合键（建议 Ctrl+Alt+主键，避免使用 Shift 以免键位漂移），按 Esc 取消
        </div>
      </div>
      <div class="setting-block">
        <div class="setting-inline">
          <div class="inline-label">
            <span>紧急模式</span>
            <el-tooltip placement="top" effect="dark">
              <el-icon class="info-icon"><InfoFilled /></el-icon>
              <template #content>
                按下快捷键全屏显示伪装内容（图片或网页），再按一次恢复摸鱼页面<br />
                以 .png/.jpg/.gif/.webp 等图片扩展名结尾的地址按图片展示，其余按网页加载
              </template>
            </el-tooltip>
          </div>
          <el-input
            v-model="localPanicUrl"
            placeholder="图片 URL / 网页地址"
            clearable
            @change="onPanicUrlChange"
          />
        </div>
        <div class="setting-inline">
          <div class="inline-label">
            <span>管理员 Token</span>
            <el-tooltip placement="top" effect="dark">
              <el-icon class="info-icon"><InfoFilled /></el-icon>
              <template #content>
                与服务端 application.yml 的 token 一致时，登录后获得管理员权限<br />
                登录时随 LOGIN 帧上报；修改后需重新登录（#login）生效
              </template>
            </el-tooltip>
          </div>
          <el-input
            v-model="localAdminToken"
            type="password"
            show-password
            clearable
            placeholder="留空即普通用户"
            @change="onAdminTokenChange"
          />
        </div>
      </div>
      <el-form-item label="通信方式">
        <el-tag type="success" size="small">WebSocket</el-tag>
        <div style="font-size: 11px; color: var(--el-text-color-secondary); margin-top: 4px">
          xechat-dsh 仅支持 WebSocket，服务端地址由 #login 指定
        </div>
      </el-form-item>
      <div class="setting-row">
        <span>在线状态</span>
        <el-tag :type="state.online ? 'success' : 'info'" size="small">
          {{ state.online ? '已连接' : '未连接' }}
        </el-tag>
      </div>
      <div v-if="state.username" class="setting-row">
        <span>用户名</span>
        <span style="color:var(--text-secondary)">{{ state.username }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { state } from '@/store.js'
import { isDark, toggleTheme } from '@/composables/useTheme.js'
import {
  useSettingsStore,
  formatShortcut,
  normalizeShortcut,
  DEFAULT_SHORTCUT_PLUS,
  DEFAULT_SHORTCUT_MINUS,
  DEFAULT_SHORTCUT_THEME,
  DEFAULT_SHORTCUT_OPACITY_0,
  DEFAULT_SHORTCUT_OPACITY_1,
  DEFAULT_SHORTCUT_PANIC
} from '@/stores/settingsStore.js'

const settingsStore = useSettingsStore()

const pluginOpacity = computed({
  get: () => settingsStore.pluginOpacity,
  set: (val) => settingsStore.setPluginOpacity(val)
})

const gamePanelOpacity = computed({
  get: () => settingsStore.gamePanelOpacity,
  set: (val) => settingsStore.setGamePanelOpacity(val)
})

/** 内置浏览器配色模式与降亮强度 */
const browserTheme = computed(() => settingsStore.browserTheme)
const browserDim = computed({
  get: () => settingsStore.browserDim,
  set: (val) => settingsStore.setBrowserDim(val)
})

function onBrowserThemeChange(val) {
  settingsStore.setBrowserTheme(val)
}

/** 快捷键配置驱动表：类型数组驱动录制 UI 与默认值，避免复制粘贴 */
const DEFAULT_SHORTCUTS = {
  minus: DEFAULT_SHORTCUT_MINUS,
  plus: DEFAULT_SHORTCUT_PLUS,
  theme: DEFAULT_SHORTCUT_THEME,
  opacity0: DEFAULT_SHORTCUT_OPACITY_0,
  opacity1: DEFAULT_SHORTCUT_OPACITY_1,
  panic: DEFAULT_SHORTCUT_PANIC
}

const shortcutItems = [
  { type: 'minus', label: '降低透明度', getter: 'shortcutMinus', setter: 'setShortcutMinus' },
  { type: 'plus', label: '提高透明度', getter: 'shortcutPlus', setter: 'setShortcutPlus' },
  { type: 'opacity0', label: '透明度 0%（全透明）', getter: 'shortcutOpacity0', setter: 'setShortcutOpacity0' },
  { type: 'opacity1', label: '透明度 100%', getter: 'shortcutOpacity1', setter: 'setShortcutOpacity1' },
  { type: 'theme', label: '切换主题', getter: 'shortcutTheme', setter: 'setShortcutTheme' },
  { type: 'panic', label: '紧急模式（老板键）', getter: 'shortcutPanic', setter: 'setShortcutPanic' }
]

/** 快捷键录制态：null | 'minus' | 'plus' | 'opacity0' | 'opacity1' | 'theme' | 'panic' */
const recordingShortcut = ref(null)

function startRecording(type) {
  if (recordingShortcut.value === type) {
    stopRecording()
    return
  }
  recordingShortcut.value = type
  window.__xechatShortcutRecording = true
}

function stopRecording() {
  recordingShortcut.value = null
  window.__xechatShortcutRecording = false
}

function onShortcutKeydown(e) {
  if (!recordingShortcut.value) return
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    stopRecording()
    return
  }
  // 忽略纯修饰键（等待用户按下主键）
  if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta') return
  const shortcut = {
    ctrl: e.ctrlKey,
    alt: e.altKey,
    shift: e.shiftKey,
    key: e.key
  }
  // 至少保留一个修饰键，避免覆盖系统默认按键
  if (!shortcut.ctrl && !shortcut.alt && !shortcut.shift) return
  const normalized = normalizeShortcut(shortcut)
  if (!normalized || !normalized.key) return
  const item = shortcutItems.find(i => i.type === recordingShortcut.value)
  if (item) settingsStore[item.setter](normalized)
  stopRecording()
}

onMounted(() => {
  window.addEventListener('keydown', onShortcutKeydown, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onShortcutKeydown, true)
  window.__xechatShortcutRecording = false
})

/** 紧急模式内容 URL：本地输入框绑定，change 时落库 */
const localPanicUrl = ref(settingsStore.panicUrl)

function onPanicUrlChange(val) {
  settingsStore.setPanicUrl(val || '')
}

/** 管理员 Token：本地输入框绑定，change 时落库（登录帧读取 settingsStore.adminToken） */
const localAdminToken = ref(settingsStore.adminToken)

function onAdminTokenChange(val) {
  settingsStore.setAdminToken(val || '')
}
</script>

<style scoped>
.settings-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color);
}

.panel-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.settings-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  overflow-y: auto;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  flex-wrap: wrap;
  gap: 4px;
}

.slider-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 说明性文字：比正文更弱，解释能力边界而不是报警 */
.setting-hint {
  font-size: 11px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
  padding: 2px 0 6px;
}

.slider-value {
  min-width: 36px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  text-align: right;
}

.setting-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 紧急模式 / 管理员 Token 各占一行：标签+图标在左，输入框在右 */
.setting-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.inline-label {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 104px;
  font-size: 12px;
  color: var(--el-text-color-regular);
  white-space: nowrap;
}

.setting-inline .el-input {
  flex: 1;
  min-width: 0;
}

.info-icon {
  font-size: 13px;
  color: var(--el-text-color-secondary);
  cursor: help;
}

.block-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-secondary);
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  gap: 8px;
}

.shortcut-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.shortcut-btn {
  min-width: 130px;
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text-primary, #e8eaed);
  background: var(--bg-tertiary, #2a2e35);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: center;
}

.shortcut-btn:hover {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.shortcut-btn.recording {
  border-color: #e6a23c;
  color: #e6a23c;
  animation: shortcut-blink 1s infinite;
}

.shortcut-reset {
  padding: 4px 8px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
  background: transparent;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.shortcut-reset:hover {
  color: var(--accent-color);
  border-color: var(--accent-color);
}

.shortcut-hint {
  font-size: 11px;
  color: #e6a23c;
}

@keyframes shortcut-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
</style>
