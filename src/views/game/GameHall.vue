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
          <img v-if="hasIcon(game)" :src="resolveAssetUrl(game.iconUrl)" alt=""
               @error="onIconError(game)" />
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
/** 图标文件加载失败的游戏（文件记录被删后 iconUrl 仍是旧地址，会显示破图） */
const failedIcons = ref(new Set())

/** 无图标时的渐变占位色池 */
const gradientPool = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)'
]

function iconKey(game) {
  return String(game.id ?? game.gameName ?? '')
}

/** 有可用图标才画 <img>；加载失败后回落到默认文字图标 */
function hasIcon(game) {
  return !!game.iconUrl && !failedIcons.value.has(iconKey(game))
}

/** 图标记录被删 / 文件 404 时隐藏破图（新 Set 赋值才能触发响应式更新） */
function onIconError(game) {
  const next = new Set(failedIcons.value)
  next.add(iconKey(game))
  failedIcons.value = next
}

function iconStyle(game) {
  if (hasIcon(game)) return {}
  const hash = String(game.id || game.gameName || '').length
  return { background: gradientPool[hash % gradientPool.length] }
}

/** 默认文字图标：中文取前两字，英文取缩写，长名不再挤爆 48px 的图标框 */
function placeholderText(game) {
  const name = String(game.gameNameZhCn || game.gameName || '?').trim()
  const chars = Array.from(name)
  if (chars.length <= 2) return chars.join(' ')
  if (/^[\x00-\x7F]+$/.test(name)) {
    const words = name.split(/[\s_\-]+/).filter(Boolean)
    const abbr = words.length > 1 ? words.map(w => w[0]).join('') : name.slice(0, 2)
    return abbr.slice(0, 2).toUpperCase()
  }
  return chars.slice(0, 2).join('')
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
  // 重新拉列表时清掉旧的失败记录，换过图标的游戏要重新尝试加载
  failedIcons.value = new Set()
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
  font-size: 17px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  letter-spacing: 1px;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
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
