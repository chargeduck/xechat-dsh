<template>
  <el-dropdown trigger="click" @command="onSelect">
    <span class="style-trigger" title="文字样式">
      <el-icon :size="16"><MagicStick /></el-icon>
    </span>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item
          v-for="s in styleStore.allStyles"
          :key="s.id"
          :command="s"
        >
          <span v-html="s.tag.replace('{text}', escapeHtml(s.name))"></span>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup>
import { MagicStick } from '@element-plus/icons-vue'
import { useTextStyleStore } from '../stores/textStyleStore'

const styleStore = useTextStyleStore()

const emit = defineEmits(['select'])

function onSelect(style) {
  emit('select', style.tag)
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
</script>

<style scoped>
.style-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 4px;
  cursor: pointer;
  color: var(--text-muted);
  transition: all 0.15s;
}
.style-trigger:hover {
  background: var(--bg-tertiary);
  color: var(--accent-color);
}
</style>
