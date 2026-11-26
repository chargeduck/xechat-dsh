<template>
  <div v-if="visible" class="reader-bar" :title="'《' + reader.book.name + '》' + chapterTitle">
    <span class="rb-book">{{ reader.book.name }}</span>
    <span class="rb-sep">·</span>
    <span class="rb-line">{{ line || '（空行）' }}</span>
    <span class="rb-stat">{{ percent }}%</span>
    <!-- 自动阅读：播放/暂停 + 间隔（点数字换 2/3/5/8 秒） -->
    <button class="rb-btn" :class="{ on: reader.autoPlay }"
            :title="reader.autoPlay ? '暂停自动阅读（Ctrl+Alt+A）' : '开始自动阅读（Ctrl+Alt+A）'"
            @click.stop="toggleAuto()">
      {{ reader.autoPlay ? '⏸' : '▶' }}
    </button>
    <button class="rb-speed" :title="'自动阅读间隔：' + reader.autoSec + ' 秒，点击切换'"
            @click.stop="cycleSpeed">{{ reader.autoSec }}s</button>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { reader, percent, currentLine, nextLine, prevLine, toggleAuto, setAutoSec } from '@/features/reader/state.js'
import { initVscodeReader, hostBarReady } from '@/features/reader/vscode-host.js'

/** VSCode 里扩展接管状态栏后才隐藏页面内这条，避免两边都空 */
const visible = computed(() => !!reader.book && reader.barVisible && !hostBarReady.value)
const line = computed(() => currentLine.value)
const chapterTitle = computed(() => {
  const c = reader.book && reader.book.chapters[reader.ch]
  return c ? c.title : ''
})

/** 是否正在输入框里打字：此时不要抢快捷键 */
function inEditable(el) {
  if (!el) return false
  const tag = (el.tagName || '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || el.isContentEditable
}

const SPEEDS = [2, 3, 5, 8, 12]
function cycleSpeed() {
  const i = SPEEDS.indexOf(reader.autoSec)
  setAutoSec(SPEEDS[(i + 1) % SPEEDS.length])
}

function onKey(e) {
  if (inEditable(e.target)) return
  // 自动阅读开关：Ctrl+Alt+A（面板是否显示都管用）
  if (e.ctrlKey && e.altKey && !e.shiftKey && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault(); e.stopPropagation(); toggleAuto(); return
  }
  if (!reader.book || !reader.barVisible) return
  const lineStep = e.ctrlKey && !e.shiftKey && !e.altKey
  const pageStep = e.shiftKey && !e.ctrlKey
  if (!lineStep && !pageStep) return
  const step = pageStep ? 10 : 1
  if (e.key === 'ArrowDown') {
    e.preventDefault(); e.stopPropagation(); nextLine(step)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation(); prevLine(step)
  }
}

onMounted(() => {
  initVscodeReader()
  window.addEventListener('keydown', onKey, true)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true))
</script>

<style scoped>
.reader-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 24px;
  padding: 0 10px;
  font-size: 12px;
  line-height: 24px;
  border-top: 1px solid var(--border-color, #3c3c3c);
  background: var(--bg-secondary, #252526);
  color: var(--text-secondary, #bbb);
  white-space: nowrap;
  overflow: hidden;
  flex-shrink: 0;
}
.rb-book { color: var(--accent-color, #007acc); max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
.rb-sep { opacity: .4; }
.rb-line { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.rb-btn, .rb-speed {
  flex: none;
  height: 18px;
  padding: 0 6px;
  font-size: 11px;
  line-height: 16px;
  color: inherit;
  background: transparent;
  border: 1px solid var(--border-color, #3c3c3c);
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.75;
}
.rb-btn:hover, .rb-speed:hover { opacity: 1; }
.rb-btn.on {
  opacity: 1;
  border-color: var(--el-color-primary, #409eff);
  color: var(--el-color-primary, #409eff);
}
.rb-stat { opacity: .6; }
</style>
