<template>
  <div class="game-login">
    <div class="login-title">{{ mode === 'login' ? '登录游戏平台' : '注册账号' }}</div>
    <div class="login-form">
      <div class="field">
        <input
          v-model="form.username"
          class="input"
          type="text"
          placeholder="用户名"
          autocomplete="username"
          @keyup.enter="handleSubmit"
        />
      </div>
      <div v-if="mode === 'register'" class="field">
        <input
          v-model="form.nickname"
          class="input"
          type="text"
          placeholder="昵称（可选）"
          @keyup.enter="handleSubmit"
        />
      </div>
      <div class="field">
        <input
          v-model="form.password"
          class="input"
          type="password"
          placeholder="密码"
          autocomplete="current-password"
          @keyup.enter="handleSubmit"
        />
      </div>
      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>
      <button class="submit-btn" :disabled="loading" @click="handleSubmit">
        {{ loading ? '处理中...' : mode === 'login' ? '登 录' : '注 册' }}
      </button>
    </div>
    <div class="switch-row">
      <span>{{ mode === 'login' ? '还没有账号？' : '已有账号？' }}</span>
      <a class="switch-link" @click="switchMode">{{ mode === 'login' ? '立即注册' : '返回登录' }}</a>
    </div>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { login, register } from '@/api/auth'

const emit = defineEmits(['success'])

const mode = ref('login')
const loading = ref(false)
const errorMsg = ref('')

const form = reactive({
  username: '',
  password: '',
  nickname: ''
})

function switchMode() {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  errorMsg.value = ''
}

async function handleSubmit() {
  if (loading.value) return
  if (!form.username.trim() || !form.password) {
    errorMsg.value = '请输入用户名和密码'
    return
  }
  loading.value = true
  errorMsg.value = ''
  try {
    const payload = { username: form.username.trim(), password: form.password }
    if (mode.value === 'register' && form.nickname.trim()) {
      payload.nickname = form.nickname.trim()
    }
    const res = mode.value === 'login' ? await login(payload) : await register(payload)
    const user = res.data || {}
    if (user.token) {
      localStorage.setItem('satoken', user.token)
    }
    emit('success', user)
  } catch (e) {
    errorMsg.value = e.message || '操作失败，请重试'
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.game-login {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  gap: 18px;
}

.login-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary, #e8eaed);
}

.login-form {
  width: 100%;
  max-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.field .input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  font-size: 13px;
  color: var(--text-primary, #e8eaed);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s;
}

.field .input:focus {
  border-color: var(--accent-color);
}

.submit-btn {
  padding: 9px 0;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  background: var(--success-color);
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: opacity 0.15s;
}

.submit-btn:hover {
  opacity: 0.88;
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-msg {
  font-size: 12px;
  color: #f56c6c;
  text-align: center;
}

.switch-row {
  font-size: 12px;
  color: var(--text-muted);
}

.switch-link {
  color: var(--accent-color);
  cursor: pointer;
  text-decoration: underline;
  margin-left: 4px;
}
</style>
