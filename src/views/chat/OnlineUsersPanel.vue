<template>
  <div class="online-users-panel">
    <div class="panel-header">
      <span>在线用户</span>
      <el-tag size="small" type="info">{{ onlineStore.count }} 人</el-tag>
    </div>
    <div class="user-list" v-if="onlineStore.users.length">
      <div v-for="g in groups" :key="g.key" class="user-group">
        <div class="group-header">
          <span>{{ g.label }}</span>
          <el-tag size="small" type="info" effect="plain">{{ g.users.length }}</el-tag>
        </div>
        <div v-for="u in g.users" :key="u.username" class="user-item">
          <span class="user-status-icon">{{ statusIcon(u.status) }}</span>
          <span class="user-name">{{ u.username }}</span>
          <span class="user-region" v-if="u.displayRegion">[{{ u.displayRegion }}]</span>
          <span class="user-platform">{{ platformIcon(u.platform) }}</span>
          <span v-if="canManage(u)" class="user-actions">
            <button
              class="op-btn"
              :class="{ off: !hasPermit(u, PERMIT_SEND_FILE) }"
              :title="hasPermit(u, PERMIT_SEND_FILE) ? '禁止发图' : '解除禁止发图'"
              @click="toggleSendFile(u)"
            >{{ hasPermit(u, PERMIT_SEND_FILE) ? '禁图' : '解图' }}</button>
            <button
              class="op-btn"
              :class="{ off: !hasPermit(u, PERMIT_SPEAK) }"
              :title="hasPermit(u, PERMIT_SPEAK) ? '禁止发言' : '解除禁止发言'"
              @click="toggleSpeak(u)"
            >{{ hasPermit(u, PERMIT_SPEAK) ? '禁言' : '解言' }}</button>
            <button v-if="!u.pond" class="op-btn danger" title="踢出鱼塘" @click="kickUser(u)">踢人</button>
          </span>
        </div>
      </div>
    </div>
    <div v-else class="empty-hint">暂无在线用户</div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useOnlineUsersStore } from '@/stores/onlineUsersStore'
import { state } from '@/store.js'
import { transport } from '@/transport/transport-manager.js'

const onlineStore = useOnlineUsersStore()

/** 权限位：与后端 Permissions 枚举一致（SPEAK=01、SEND_FILE=10） */
const PERMIT_SPEAK = 1
const PERMIT_SEND_FILE = 2

/** 当前登录者是否为管理员：取在线列表自身条目的 role（服务端按 LOGIN 帧 token 授予 ADMIN） */
const isAdmin = computed(() => {
  const me = onlineStore.users.find(u => u.username === state.username)
  return !!me && me.role === 'ADMIN'
})

/**
 * 展示管控按钮的条件：管理员、非自己、有服务端用户 id。
 * 外塘用户（pond 非空）同样可管控——指令由本塘上行 hub，按 targetUserId 路由到其所在鱼塘执行；
 * 踢人仅本塘可用（跨塘踢人未纳入本方案），故模板中踢人按钮以 !u.pond 单独收窄。
 */
function canManage(u) {
  return isAdmin.value && u.username !== state.username && !!u.id
}

/** 跨塘用户的管控确认文案补充：指令将经 hub 路由到其所属鱼塘执行 */
function pondTip(u) {
  return u.pond ? `（跨塘：将由【${u.pond}】执行）` : ''
}

function hasPermit(u, bit) {
  return (u.permit & bit) === bit
}

/** 下发管控帧；当前通信方式不支持时提示切换 WebSocket */
function sendAdminReact(operate, permission, uid) {
  if (!transport.adminReact(operate, permission, uid)) {
    ElMessage.warning('当前通信方式不支持管控指令，请在设置中切换为 WebSocket 后重试')
  }
}

function toggleSpeak(u) {
  const removing = hasPermit(u, PERMIT_SPEAK)
  ElMessageBox.confirm(`确认${removing ? '禁止' : '允许'} [${u.username}] 发言？${pondTip(u)}`, '权限管控', {
    type: 'warning',
    confirmButtonText: '确认',
    cancelButtonText: '取消'
  }).then(() => {
    sendAdminReact(removing ? 'USER_PERMIT_REMOVE' : 'USER_PERMIT_ADD', 'SPEAK', u.id)
  }).catch(() => {})
}

function toggleSendFile(u) {
  const removing = hasPermit(u, PERMIT_SEND_FILE)
  ElMessageBox.confirm(`确认${removing ? '禁止' : '允许'} [${u.username}] 发送图片？${pondTip(u)}`, '权限管控', {
    type: 'warning',
    confirmButtonText: '确认',
    cancelButtonText: '取消'
  }).then(() => {
    sendAdminReact(removing ? 'USER_PERMIT_REMOVE' : 'USER_PERMIT_ADD', 'SEND_FILE', u.id)
  }).catch(() => {})
}

function kickUser(u) {
  if (u.pond) {
    ElMessage.warning('跨塘踢人暂不支持，请由该用户所属鱼塘管理员处理')
    return
  }
  ElMessageBox.confirm(`确认将 [${u.username}] 踢出鱼塘？`, '踢人', {
    type: 'warning',
    confirmButtonText: '确认踢出',
    cancelButtonText: '取消'
  }).then(() => {
    if (!transport.kickUser(u.username)) {
      ElMessage.warning('当前通信方式不支持踢人指令')
    }
  }).catch(() => {})
}

/**
 * 按源塘分组：本塘（pond 为空）排最前，其余外塘按塘名排序。
 * 外塘来源由服务端 shortRegion 前缀约定识别（见 regionClean.splitRegion）。
 */
const groups = computed(() => {
  const map = new Map()
  for (const u of onlineStore.users) {
    const key = u.pond || ''
    if (!map.has(key)) {
      map.set(key, { key, label: key || '本塘', users: [] })
    }
    map.get(key).users.push(u)
  }
  return [...map.values()].sort((a, b) => {
    if (!a.key) return -1
    if (!b.key) return 1
    return a.key.localeCompare(b.key, 'zh')
  })
})

function statusIcon(s) {
  switch (s) {
    case 'FISHING': return '🎣'
    case 'WORKING': return '💼'
    case 'PLAYING': return '🎮'
    default: return '🟢'
  }
}

function platformIcon(p) {
  switch (p) {
    case 'IDEA': return '☕'
    case 'WEB':
    case 'VSCODE': return '🌐'
    default: return ''
  }
}
</script>

<style scoped>
.online-users-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  padding: 12px;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border-color);
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.user-list {
  flex: 1;
  overflow-y: auto;
  padding-top: 8px;
}

.user-group + .user-group {
  margin-top: 4px;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 2px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.group-header .el-tag {
  height: 18px;
  line-height: 16px;
}

.user-group .user-item:last-child {
  border-bottom: none;
}

.user-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px;
  font-size: 13px;
  color: var(--text-primary);
  border-bottom: 1px solid var(--border-color-light, rgba(128, 128, 128, 0.1));
}

.user-status-icon {
  font-size: 14px;
}

.user-name {
  font-weight: 500;
}

.user-region {
  color: var(--text-secondary);
  font-size: 12px;
}

.user-platform {
  margin-left: auto;
  font-size: 13px;
}

.empty-hint {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 13px;
}
</style>
