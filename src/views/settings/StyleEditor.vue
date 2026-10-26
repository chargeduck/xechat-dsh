<template>
  <div class="style-editor">
    <div class="editor-header">
      <div class="header-left">
        <el-button text size="small" @click="state.currentRoute = 'settings'">
          <el-icon :size="16"><ArrowLeft /></el-icon>
        </el-button>
        <span class="editor-title">文字样式管理</span>
      </div>
      <el-button type="primary" size="small" @click="showAddDialog = true">
        <el-icon :size="14"><Plus /></el-icon>
        新增样式
      </el-button>
    </div>

    <div class="editor-body">
      <!-- 左侧：样式列表 -->
      <div class="style-list">
        <div class="list-title">内置样式（仅预览）</div>
        <div
          v-for="s in builtin"
          :key="s.id"
          class="style-item builtin"
        >
          <span class="style-name">{{ s.name }}</span>
          <span class="style-preview" v-html="s.tag.replace('{text}', '测试文字')"></span>
        </div>

        <div class="list-title" style="margin-top: 16px">我的样式</div>
        <div
          v-for="s in store.customStyles"
          :key="s.id"
          class="style-item custom"
          :class="{ active: editingId === s.id }"
          @click="startEdit(s)"
        >
          <span class="style-name">{{ s.name }}</span>
          <span class="style-preview" :style="s.css">测试文字</span>
        </div>
        <div v-if="store.customStyles.length === 0" class="empty-hint">
          暂无自定义样式，点击「新增样式」开始
        </div>
      </div>

      <!-- 右侧：编辑 + 预览 -->
      <div class="edit-area" v-if="editingId">
        <div class="edit-section">
          <label>样式名称</label>
          <el-input v-model="editName" size="small" placeholder="例如：大号红字" />
        </div>
        <div class="edit-section">
          <label>CSS 样式（仅内容，如 <code>color:red;font-size:20px</code>）</label>
          <el-input
            v-model="editCss"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            placeholder="color: red; font-size: 20px;"
          />
        </div>

        <div class="edit-section">
          <label>预览</label>
          <div class="preview-box">
            <span :style="editCss">测试文字</span>
          </div>
        </div>

        <div class="edit-actions">
          <el-button type="primary" size="small" @click="saveEdit">保存</el-button>
          <el-button size="small" @click="cancelEdit">取消</el-button>
          <el-popconfirm title="确认删除此样式？" @confirm="doDelete">
            <template #reference>
              <el-button type="danger" size="small" plain>删除</el-button>
            </template>
          </el-popconfirm>
        </div>
      </div>

      <div class="edit-area empty-edit" v-else>
        点击左侧自定义样式进行编辑，或点击「新增样式」
      </div>
    </div>

    <!-- 新增样式弹窗 -->
    <el-dialog v-model="showAddDialog" title="新增自定义样式" width="420px" :close-on-click-modal="false">
      <el-form label-position="top">
        <el-form-item label="样式名称">
          <el-input v-model="addName" placeholder="例如：大号红字" />
        </el-form-item>
        <el-form-item label="CSS 样式">
          <el-input
            v-model="addCss"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 5 }"
            placeholder="color: red; font-size: 24px; font-weight: bold;"
          />
        </el-form-item>
        <el-form-item label="预览">
          <div class="preview-box">
            <span :style="addCss">测试文字</span>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showAddDialog = false">取消</el-button>
        <el-button type="primary" @click="doAdd">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import { Plus, ArrowLeft } from '@element-plus/icons-vue'
import { useTextStyleStore } from '@/stores/textStyleStore'
import { state } from '@/store.js'

const store = useTextStyleStore()

const builtin = [
  { id: 'red',     name: '红色文字',   tag: '<span style="color:#ff4444">{text}</span>' },
  { id: 'blue',    name: '蓝色文字',   tag: '<span style="color:#3498db">{text}</span>' },
  { id: 'green',   name: '绿色文字',   tag: '<span style="color:#2ecc71">{text}</span>' },
  { id: 'purple',  name: '紫色文字',   tag: '<span style="color:#9b59b6">{text}</span>' },
  { id: 'orange',  name: '橙色文字',   tag: '<span style="color:#e67e22">{text}</span>' },
  { id: 'yellow',  name: '黄色文字',   tag: '<span style="color:#f1c40f">{text}</span>' },
  { id: 'gradient',name: '彩虹渐变',   tag: '<span style="background:linear-gradient(90deg,red,orange,yellow,green,blue,purple);-webkit-background-clip:text;color:transparent;font-weight:bold;">{text}</span>' },
  { id: 'glow',    name: '发光文字',   tag: '<span style="text-shadow:0 0 6px #fff,0 0 12px #0cf;color:#0cf;font-weight:bold;">{text}</span>' },
  { id: 'stroke',  name: '白字黑描边', tag: '<span style="text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000;color:#fff;">{text}</span>' }
]

const showAddDialog = ref(false)
const addName = ref('')
const addCss = ref('')

const editingId = ref(null)
const editName = ref('')
const editCss = ref('')

function doAdd() {
  if (!addName.value.trim() || !addCss.value.trim()) return
  store.addStyle(addName.value.trim(), addCss.value.trim())
  addName.value = ''
  addCss.value = ''
  showAddDialog.value = false
}

function startEdit(s) {
  editingId.value = s.id
  editName.value = s.name
  editCss.value = s.css
}

function saveEdit() {
  if (!editName.value.trim() || !editCss.value.trim()) return
  store.updateStyle(editingId.value, editName.value.trim(), editCss.value.trim())
}

function cancelEdit() {
  editingId.value = null
  editName.value = ''
  editCss.value = ''
}

function doDelete() {
  store.removeStyle(editingId.value)
  cancelEdit()
}
</script>

<style scoped>
.style-editor {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 4px;
}

.editor-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.editor-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 左侧列表 */
.style-list {
  width: 220px;
  min-width: 220px;
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
  padding: 8px;
}

.list-title {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  padding: 4px 8px;
  margin-bottom: 4px;
}

.style-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  margin-bottom: 2px;
  transition: background 0.1s;
}

.style-item.builtin {
  cursor: default;
  opacity: 0.7;
}

.style-item.custom:hover,
.style-item.custom.active {
  background: var(--bg-tertiary);
}

.style-name {
  font-size: 12px;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 90px;
}

.style-preview {
  font-size: 12px;
  white-space: nowrap;
}

.empty-hint {
  font-size: 12px;
  color: var(--text-muted);
  padding: 8px;
}

/* 右侧编辑区 */
.edit-area {
  flex: 1;
  padding: 16px;
  overflow-y: auto;
}

.edit-area.empty-edit {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  font-size: 13px;
}

.edit-section {
  margin-bottom: 16px;
}

.edit-section label {
  display: block;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.edit-section code {
  font-size: 11px;
  color: var(--accent-color);
  background: var(--bg-tertiary);
  padding: 0 4px;
  border-radius: 3px;
}

.preview-box {
  padding: 12px 16px;
  border: 1px dashed var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  font-size: 18px;
  min-height: 48px;
  display: flex;
  align-items: center;
}

.edit-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
</style>
