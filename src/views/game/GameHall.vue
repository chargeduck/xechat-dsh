<template>
  <div class="game-hall">
    <!-- 分类导航 -->
    <div v-if="categories.length" class="category-nav">
      <span
        class="category-item"
        :class="{ active: activeCategory === null }"
        @click="switchCategory(null)"
      >全部</span>
      <span
        v-for="cat in categories"
        :key="cat.id"
        class="category-item"
        :class="{ active: activeCategory === cat.id }"
        @click="switchCategory(cat.id)"
      >{{ cat.name }}</span>
    </div>

    <!-- 游戏卡片网格 -->
    <div v-if="loading" class="empty-hint">加载中...</div>
    <div v-else-if="games.length === 0" class="empty-hint">暂无可用游戏</div>
    <div v-else class="game-grid">
      <div v-for="game in games" :key="game.id" class="game-card">
        <div class="game-icon" :style="iconStyle(game)">
          <img v-if="game.iconUrl" :src="resolveAssetUrl(game.iconUrl)" alt="游戏图标" />
          <span v-else class="icon-placeholder">{{ placeholderText(game) }}</span>
        </div>
        <div class="game-name">{{ game.gameNameZhCn || game.gameName || '-' }}</div>
        <div v-if="game.description" class="game-desc">{{ game.description }}</div>
        <button
          class="play-btn"
          :disabled="!game.playUrl"
          @click.stop="emit('play', game)"
        >{{ game.playUrl ? '开始游戏' : '无试玩地址' }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { getGameList } from '@/api/game'
import { getCategoryList } from '@/api/category'
import { resolveAssetUrl } from '@/utils/asset'

const emit = defineEmits(['play'])

const loading = ref(false)
const categories = ref([])
const activeCategory = ref(null)
const games = ref([])

/** 无图标时的渐变占位色池 */
const gradientPool = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)'
]

function iconStyle(game) {
  if (game.iconUrl) return {}
  const hash = String(game.id || game.gameName || '').length
  return { background: gradientPool[hash % gradientPool.length] }
}

function placeholderText(game) {
  const name = game.gameNameZhCn || game.gameName || ''
  if (name.length === 2) return name.split('').join(' ')
  return name
}

async function loadCategories() {
  try {
    const res = await getCategoryList()
    categories.value = res.data || []
  } catch {
    categories.value = []
  }
}

async function loadGames() {
  loading.value = true
  try {
    const params = { pageSize: 500, status: 1 }
    if (activeCategory.value !== null) {
      params.gameType = activeCategory.value
    }
    const res = await getGameList(params)
    games.value = (res.data && res.data.records) || []
  } catch (e) {
    games.value = []
  } finally {
    loading.value = false
  }
}

function switchCategory(id) {
  if (activeCategory.value === id) return
  activeCategory.value = id
  loadGames()
}

onMounted(() => {
  loadCategories()
  loadGames()
})
</script>

<style scoped>
.game-hall {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.category-nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color);
}

.category-item {
  padding: 4px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  cursor: pointer;
  user-select: none;
  transition: all 0.15s;
}

.category-item:hover {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.category-item.active {
  color: #fff;
  background: var(--success-color);
  border-color: var(--success-color);
  font-weight: 600;
}

.game-grid {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 12px;
  align-content: start;
}

.game-card {
  padding: 14px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 6px;
  transition: all 0.15s;
}

.game-card:hover {
  border-color: var(--accent-color);
  background: var(--bg-tertiary);
}

.game-icon {
  width: 48px;
  height: 48px;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.game-icon img {
  width: 48px;
  height: 48px;
  object-fit: cover;
  display: block;
}

.icon-placeholder {
  font-size: 16px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  letter-spacing: 2px;
}

.game-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary, #e8eaed);
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.game-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.play-btn {
  margin-top: auto;
  padding: 5px 16px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: var(--success-color);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.play-btn:hover:not(:disabled) {
  opacity: 0.88;
}

.play-btn:disabled {
  background: var(--bg-tertiary);
  color: var(--text-muted);
  cursor: not-allowed;
}

.empty-hint {
  flex: 1;
  color: var(--text-muted);
  text-align: center;
  padding: 40px 0;
  font-size: 13px;
}
</style>
