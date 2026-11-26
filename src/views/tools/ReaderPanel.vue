<template>
  <div class="reader-panel">
    <div class="panel-header">
      <span>摸鱼阅读</span>
      <div class="header-ops">
        <label class="upload-btn">
          导入 txt / epub
          <input type="file" accept=".txt,.epub" multiple @change="onPick" />
        </label>
        <button class="upload-btn" title="导出书库与进度，换机器后可导入继续读" @click="onExport">导出书库</button>
        <label class="upload-btn" title="导入之前导出的书库备份">
          导入书库
          <input type="file" accept=".json" @change="onImport" />
        </label>
      </div>
    </div>

    <div v-if="error" class="reader-error">{{ error }}</div>

    <div class="reader-body">
      <!-- 书架 -->
      <aside class="shelf">
        <div class="shelf-title">书架（{{ books.length }}）</div>
        <div
          v-for="b in books"
          :key="b.id"
          class="shelf-item"
          :class="{ active: reader.book && reader.book.id === b.id }"
          @click="select(b.id)"
        >
          <span class="shelf-name" :title="b.name">{{ b.name }}</span>
          <span class="shelf-meta">{{ b.chapters }} 章</span>
          <span class="shelf-del" title="移出书架" @click.stop="del(b.id)">×</span>
        </div>
        <div v-if="!books.length" class="empty-hint">还没有书，点右上角导入</div>
      </aside>

      <!-- 正文 -->
      <section class="reading">
        <template v-if="reader.book">
          <div class="chapter-bar">
            <el-select
              :model-value="reader.ch"
              size="small"
              filterable
              class="chapter-select"
              @change="(v) => gotoChapter(v)"
            >
              <el-option
                v-for="(c, i) in reader.book.chapters"
                :key="i"
                :label="(i + 1) + '. ' + c.title"
                :value="i"
              />
            </el-select>
            <span class="reading-progress">{{ percent }}% · 第 {{ reader.off + 1 }}/{{ reader.lines.length }} 行</span>
          </div>

          <div class="reading-text">
            <div
              v-for="(line, i) in pageLines"
              :key="i"
              class="reading-line"
              :class="{ current: i === cursorInPage }"
              @click="jumpLine(i)"
            >{{ line || '\u00a0' }}</div>
          </div>

          <div class="reading-ops">
            <el-button size="small" @click="prevLine(1)">上一行</el-button>
            <el-button size="small" @click="nextLine(1)">下一行</el-button>
            <el-button size="small" @click="prevLine(10)">上一页</el-button>
            <el-button size="small" @click="nextLine(10)">下一页</el-button>
            <span class="key-hint">Ctrl+↑/↓ 行 · Shift+↑/↓ 翻页 · Ctrl+R 开关底部条</span>
          </div>
        </template>
        <div v-else class="empty-hint">选择或导入一本书开始阅读</div>
      </section>
    </div>

    <div class="reader-settings">
      <span>每行字数</span>
      <!-- 左右分列步进：面板很窄，Element Plus 默认的上下堆叠按钮不好点 -->
      <div class="stepper">
        <button class="step-btn" title="减少" @click="bumpColumns(-1)">−</button>
        <el-input
          :model-value="String(reader.columns)"
          size="small"
          class="step-input"
          @change="(v) => setColumns(parseInt(v, 10) || reader.columns)"
        />
        <button class="step-btn" title="增加" @click="bumpColumns(1)">+</button>
      </div>
      <el-switch :model-value="reader.barVisible" @change="toggleBar" active-text="底部阅读条" />
      <el-switch :model-value="reader.autoPlay" @change="onToggleAuto" active-text="自动阅读" />
      <template v-if="reader.autoPlay">
        <span>每</span>
        <div class="stepper">
          <button class="step-btn" title="减少" @click="bumpAuto(-100)">−</button>
          <el-input
            :model-value="String(reader.autoMs)"
            size="small"
            class="step-input"
            @change="(v) => setAutoMs(parseInt(v, 10) || reader.autoMs)"
          />
          <button class="step-btn" title="增加" @click="bumpAuto(100)">+</button>
        </div>
        <span>毫秒翻一行</span>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { decodeText, splitChapters, parseEpub } from '@/features/reader/parse.js'
import { listBooks, addBook, removeBook, exportAll, importAll } from '@/features/reader/store.js'
import { publishBookToHost } from '@/features/reader/vscode-host.js'
import {
  reader, percent, restore, openBook, gotoChapter,
  nextLine, prevLine, setColumns, toggleBar, toggleAuto, setAutoMs
} from '@/features/reader/state.js'

const books = ref([])
const error = ref('')
/** 正文窗口展示的行数（不是状态栏那一行） */
const PAGE = 40

/** 自动阅读开关（element-plus 的 change 给的是新值，这里直接切） */
function onToggleAuto() {
  const on = toggleAuto()
  if (on && !reader.lines.length) ElMessage.info('先选一本书再开自动阅读')
}

const pageStart = computed(() => Math.max(0, reader.off - Math.floor(PAGE / 2)))
const pageLines = computed(() => reader.lines.slice(pageStart.value, pageStart.value + PAGE))
const cursorInPage = computed(() => reader.off - pageStart.value)

async function refresh() {
  books.value = await listBooks()
}

async function select(id) {
  if (await openBook(id)) error.value = ''
}

function del(id) {
  ElMessageBox.confirm('确定把这本从书架移除？阅读进度也会一起删除。', '移除书籍', {
    type: 'warning', confirmButtonText: '移除', cancelButtonText: '取消'
  }).then(async () => {
    await removeBook(id)
    if (reader.book && reader.book.id === id) {
      reader.book = null
      reader.lines = []
    }
    await refresh()
  }).catch(() => {})
}

/** 步进：列宽 1 列、间隔 100ms */
function bumpColumns(delta) {
  setColumns(reader.columns + delta)
}
function bumpAuto(delta) {
  setAutoMs(reader.autoMs + delta)
}

function jumpLine(i) {
  reader.off = pageStart.value + i
  if (reader.off >= reader.lines.length) reader.off = reader.lines.length - 1
}

async function onPick(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  for (const f of files) {
    try {
      const buf = await f.arrayBuffer()
      let chapters = []
      if (/\.epub$/i.test(f.name)) {
        chapters = await parseEpub(buf)
      } else {
        chapters = splitChapters(decodeText(buf))
      }
      if (!chapters.length) throw new Error('没有解析到内容')
      const id = await addBook({ name: f.name.replace(/\.(txt|epub)$/i, ''), format: /\.epub$/i.test(f.name) ? 'epub' : 'txt', chapters, size: buf.byteLength })
      await refresh()
      await openBook(id)
      // VSCode：把书交给扩展，面板关掉后仍可在状态栏翻行
      try { publishBookToHost(f.name.replace(/\.(txt|epub)$/i, ''), chapters) } catch (e) {}
      ElMessage.success('《' + f.name + '》已导入，共 ' + chapters.length + ' 章')
    } catch (err) {
      error.value = f.name + '：' + (err && err.message ? err.message : '解析失败')
      ElMessage.error(error.value)
    }
  }
}

async function onExport() {
  try {
    const data = await exportAll()
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const a = document.createElement('a')
    const d = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    a.href = URL.createObjectURL(blob)
    a.download = 'xechat-reader-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(a.href), 3000)
    ElMessage.success('已导出 ' + data.books.length + ' 本书')
  } catch (err) {
    ElMessage.error('导出失败：' + ((err && err.message) || err))
  }
}

async function onImport(e) {
  const file = (e.target.files || [])[0]
  e.target.value = ''
  if (!file) return
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    const r = await importAll(data)
    await refresh()
    ElMessage.success('导入完成：新增 ' + r.added + ' 本，跳过 ' + r.skipped + ' 本')
  } catch (err) {
    ElMessage.error('导入失败：' + ((err && err.message) || err))
  }
}

onMounted(async () => {
  await refresh()
  if (!reader.book) await restore()
  // 之前就在面板里导入过的书：打开阅读页时补一次同步，让状态栏也能翻
  if (reader.book && reader.book.chapters && reader.book.chapters.length) {
    try { publishBookToHost(reader.book.name, reader.book.chapters) } catch (e) {}
  }
})
</script>

<style scoped>
.reader-panel { display: flex; flex-direction: column; height: 100%; }
.panel-header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; font-weight: 600; }
.upload-btn {
  font-size: 12px; font-weight: 400; cursor: pointer; padding: 4px 10px;
  border: 1px solid var(--border-color, #3c3c3c); border-radius: 4px;
}
.upload-btn input { display: none; }
.header-ops { display: flex; gap: 6px; align-items: center; }
.header-ops .upload-btn { background: none; color: inherit; font: inherit; font-size: 12px; }
.reader-error { margin: 0 12px 6px; font-size: 12px; color: var(--danger-color, #f44747); }
.reader-body { flex: 1; display: flex; min-height: 0; }
.shelf { width: 190px; border-right: 1px solid var(--border-color, #3c3c3c); overflow: auto; }
.shelf-title { padding: 6px 10px; font-size: 12px; color: var(--text-secondary, #999); }
.shelf-item { display: flex; align-items: center; gap: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
.shelf-item.active { background: rgba(0, 122, 204, 0.14); }
.shelf-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.shelf-meta { color: var(--text-secondary, #999); }
.shelf-del { opacity: .5; padding: 0 4px; }
.shelf-del:hover { opacity: 1; color: var(--danger-color, #f44747); }
.reading { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.chapter-bar { display: flex; gap: 10px; align-items: center; padding: 8px 12px; }
.chapter-select { width: 260px; }
.reading-progress { font-size: 12px; color: var(--text-secondary, #999); }
.reading-text { flex: 1; overflow: auto; padding: 0 12px; font-size: 14px; line-height: 1.8; }
.reading-line { cursor: pointer; }
.reading-line.current { background: rgba(0, 122, 204, 0.16); border-radius: 3px; }
.reading-ops { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-top: 1px solid var(--border-color, #3c3c3c); }
.key-hint { font-size: 11px; color: var(--text-secondary, #999); }
/* 左右分列步进器 */
.stepper { display: inline-flex; align-items: center; }
.step-btn {
  width: 24px; height: 24px; line-height: 1; padding: 0;
  border: 1px solid var(--border-color, #3c3c3c);
  background: transparent; color: inherit; cursor: pointer;
  font-size: 14px; border-radius: 0;
}
.step-btn:first-child { border-radius: 4px 0 0 4px; }
.step-btn:last-child { border-radius: 0 4px 4px 0; }
.step-btn:hover { background: rgba(127, 127, 127, 0.18); }
.step-input { width: 66px; }
.step-input :deep(.el-input__wrapper) { border-radius: 0; }
.reader-settings { display: flex; align-items: center; gap: 12px; padding: 8px 12px; border-top: 1px solid var(--border-color, #3c3c3c); font-size: 12px; }
</style>
