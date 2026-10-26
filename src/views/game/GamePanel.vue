<template>
  <div class="game-panel">
    <div class="panel-header">
      <span>游戏</span>
      <span v-if="isLoggedIn" class="user-area">
        <span v-if="userInfo" class="user-name">{{ userInfo.nickname || userInfo.username }}</span>
        <button class="logout-btn" @click="handleLogout">退出</button>
      </span>
    </div>

    <GameLogin v-if="!isLoggedIn" @success="handleLoginSuccess" />
    <GameHall v-else-if="!playingGame" @play="handlePlay" />

    <!-- 游戏播放浮层（iframe 打开 playUrl） -->
    <div v-if="playingGame" class="game-player-mask" :style="{ opacity: settingsStore.gamePanelOpacity }">
      <div class="game-player">
        <div class="player-bar">
          <span class="player-title">{{ playingGame.gameNameZhCn || playingGame.gameName }}</span>
          <div class="bar-actions">
            <div class="opacity-control">
              <el-slider
                v-model="panelOpacity"
                :min="0.1"
                :max="1"
                :step="0.05"
                :show-tooltip="false"
                @change="settingsStore.setGamePanelOpacity(panelOpacity)"
                style="width: 90px"
              />
              <el-tag size="small" effect="dark">{{ Math.round(settingsStore.gamePanelOpacity * 100) }}%</el-tag>
            </div>
            <button class="close-btn" @click="playingGame = null">返回大厅</button>
          </div>
        </div>
        <div class="player-body">
          <iframe class="player-frame" :src="resolveAssetUrl(playingGame.playUrl)" allowfullscreen />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, computed } from 'vue'
import GameLogin from './GameLogin.vue'
import GameHall from './GameHall.vue'
import { AUTH_EXPIRED_EVENT } from '@/utils/request'
import { resolveAssetUrl } from '@/utils/asset'
import { useSettingsStore } from '@/stores/settingsStore.js'

const settingsStore = useSettingsStore()
const isLoggedIn = ref(!!localStorage.getItem('satoken'))
const userInfo = ref(null)
const playingGame = ref(null)

/** 游戏面板透明度：实时写入 state 生效，拖完由 @change persist */
const panelOpacity = computed({
  get: () => settingsStore.gamePanelOpacity,
  set: (val) => {
    settingsStore.gamePanelOpacity = val
  }
})

function handleLoginSuccess(user) {
  userInfo.value = user
  isLoggedIn.value = true
}

function handleLogout() {
  localStorage.removeItem('satoken')
  userInfo.value = null
  playingGame.value = null
  isLoggedIn.value = false
}

function handlePlay(game) {
  if (!game || !game.playUrl) return
  playingGame.value = game
}

function onAuthExpired() {
  userInfo.value = null
  playingGame.value = null
  isLoggedIn.value = false
}

onMounted(() => {
  window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired)
})

onBeforeUnmount(() => {
  window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired)
})
</script>

<style scoped>
.game-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  font-size: 14px;
  font-weight: 600;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.user-area {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-name {
  max-width: 120px;
  font-size: 12px;
  text-transform: none;
  letter-spacing: normal;
  color: var(--text-primary, #e8eaed);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.logout-btn {
  padding: 3px 10px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.logout-btn:hover {
  color: #f56c6c;
  border-color: #f56c6c;
}

/* 播放浮层 */
.game-player-mask {
  position: absolute;
  inset: 0;
  z-index: 50;
  background: var(--bg-primary, #1a1d23);
  display: flex;
}

.game-player {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.player-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.player-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #e8eaed);
}

.bar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.opacity-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.opacity-control :deep(.el-slider) {
  margin: 0;
}

.opacity-control :deep(.el-slider__runway) {
  margin: 0;
  height: 4px;
}

.opacity-control :deep(.el-slider__bar) {
  height: 4px;
}

.opacity-control :deep(.el-slider__button) {
  width: 12px;
  height: 12px;
}

.close-btn {
  padding: 4px 12px;
  font-size: 12px;
  color: #fff;
  background: var(--success-color);
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.player-body {
  flex: 1;
  position: relative;
  min-height: 0;
}

.player-frame {
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
}
</style>
