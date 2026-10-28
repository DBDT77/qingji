<template>
  <AuthLayout
    v-if="done"
    title="密码已重置"
    slogan="用新密码登录你的账本"
  >
    <div class="done">
      <div class="done__icon">🔑</div>
      <p class="done__text">账号「<b>{{ done.email }}</b>」的密码已更新</p>
      <p class="done__hint">请回到登录页，用该邮箱和新密码登录。</p>
      <van-button block round type="primary" @click="goLogin">去登录</van-button>
      <button class="done__link" type="button" @click="reset">重新填写</button>
    </div>
  </AuthLayout>

  <AuthLayout
    v-else
    back
    title="重置密码"
    slogan="通过注册邮箱验证身份"
  >
    <van-form validate-first @submit="onSubmit">
      <van-field
        v-model="form.email"
        name="email"
        label="邮箱"
        placeholder="you@example.com"
        type="email"
        autocomplete="email"
        clearable
        :rules="emailRules"
      />
      <van-field
        v-model="form.code"
        name="code"
        label="验证码"
        placeholder="6 位数字"
        type="digit"
        maxlength="6"
        autocomplete="one-time-code"
        :rules="codeRules"
      >
        <template #button>
          <van-button
            class="code-btn"
            size="small"
            round
            type="primary"
            plain
            native-type="button"
            :loading="codeSending"
            :disabled="countdown > 0"
            @click="onSendCode"
          >
            {{ countdown > 0 ? `${countdown}s` : '获取验证码' }}
          </van-button>
        </template>
      </van-field>
      <van-field
        v-model="form.newPassword"
        name="newPassword"
        type="password"
        label="新密码"
        placeholder="6-32 位，建议字母 + 数字"
        autocomplete="new-password"
        :rules="passwordRules"
      />
      <van-field
        v-model="form.confirm"
        name="confirm"
        type="password"
        label="确认密码"
        placeholder="再输一次新密码"
        autocomplete="new-password"
        :rules="confirmRules"
      />

      <div class="auth-actions">
        <van-button
          block
          round
          type="primary"
          native-type="submit"
          :loading="loading"
          loading-text="重置中..."
        >
          重置密码
        </van-button>
      </div>
    </van-form>

    <div class="auth-switch">
      想起密码了？
      <router-link class="auth-link" :to="{ name: 'login' }">返回登录</router-link>
    </div>

    <template #foot>
      <p class="auth-hint">
        只有已注册的邮箱才会收到验证码。<br />
        如果几分钟内没收到，请检查垃圾箱，或确认邮箱地址是否填写正确。
      </p>
    </template>
  </AuthLayout>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { showToast } from 'vant'
import AuthLayout from '@/components/AuthLayout.vue'
import { useUserStore } from '@/store/user'
import { validateEmail } from '@/utils/email'
import { useEmailCode } from '@/utils/useEmailCode'

const router = useRouter()
const store = useUserStore()

const form = reactive({ email: '', code: '', newPassword: '', confirm: '' })
const loading = ref(false)
const done = ref(null)

const { sending: codeSending, countdown, send: sendCode } = useEmailCode(
  (email, purpose) => store.sendEmailCode(email, purpose),
)

const emailRules = [
  { required: true, message: '请输入邮箱' },
  { validator: (value) => !validateEmail(value), message: '邮箱格式不正确' },
]
const codeRules = [
  { required: true, message: '请输入验证码' },
  { validator: (value) => /^\d{6}$/.test(value), message: '请输入 6 位数字验证码' },
]
const passwordRules = [
  { required: true, message: '请输入新密码' },
  { validator: (v) => v.length >= 6, message: '密码至少 6 位' },
  { validator: (v) => v.length <= 32, message: '密码最多 32 位' },
]
const confirmRules = [
  { required: true, message: '请再次输入新密码' },
  { validator: (v) => v === form.newPassword, message: '两次输入的密码不一致' },
]

async function onSendCode() {
  const data = await sendCode(form.email, 'reset', validateEmail)
  if (data?.devCode) form.code = data.devCode
}

async function onSubmit() {
  loading.value = true
  try {
    await store.resetPassword({
      email: form.email.trim(),
      code: form.code.trim(),
      newPassword: form.newPassword,
    })
    done.value = { email: form.email.trim() }
  } catch (err) {
    showToast(err.message || '重置失败')
  } finally {
    loading.value = false
  }
}

function goLogin() {
  router.replace({ name: 'login', query: { email: done.value.email } })
}

function reset() {
  done.value = null
  Object.assign(form, { email: '', code: '', newPassword: '', confirm: '' })
}
</script>

<style scoped>
.code-btn {
  --van-button-small-height: 30px;
  padding: 0 10px;
  font-size: 12px;
}

.done {
  padding: 10px 4px 4px;
  text-align: center;
}
.done__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin: 0 auto 14px;
  border-radius: 50%;
  background: var(--c-primary-light);
  font-size: 30px;
}
.done__text {
  margin: 0 0 8px;
  font-size: 15px;
  color: var(--c-text);
  word-break: break-all;
}
.done__text b {
  color: var(--c-primary-dark);
}
.done__hint {
  margin: 0 0 20px;
  font-size: 12px;
  line-height: 1.7;
  color: var(--c-text-3);
}
.done__link {
  margin-top: 6px;
  padding: 10px;
  border: none;
  background: transparent;
  color: var(--c-text-3);
  font-size: 13px;
}
</style>
