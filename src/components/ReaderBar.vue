<template>
  <div v-if="visible" class="reader-bar" :title="'《' + reader.book.name + '》' + chapterTitle">
    <span class="rb-book">{{ reader.book.name }}</span>
    <span class="rb-sep">·</span>
    <span class="rb-line">{{ line || '（空行）' }}</span>
    <span class="rb-stat">{{ percent }}%</span>
  </div>
</template>

<script setup>
import { computed, onMounted, onBeforeUnmount } from 'vue'
import { reader, percent, currentLine, nextLine, prevLine } from '@/features/reader/state.js'

const visible = computed(() => !!reader.book && reader.barVisible)
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

function onKey(e) {
  if (!reader.book || !reader.barVisible) return
  if (inEditable(e.target)) return
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

onMounted(() => window.addEventListener('keydown', onKey, true))
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
.rb-stat { opacity: .6; }
</style>
