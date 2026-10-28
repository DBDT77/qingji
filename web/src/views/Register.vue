<template>
  <AuthLayout
    v-if="done"
    title="注册成功"
    slogan="用刚设置的密码登录，开始记账"
  >
    <div class="done">
      <div class="done__icon">🎉</div>
      <p class="done__text">账号「<b>{{ done.email }}</b>」已创建</p>
      <p class="done__hint">
        我们已为你准备好常用的收支分类。请到登录页输入邮箱和密码完成登录。
      </p>
      <van-button block round type="primary" @click="goLogin">去登录</van-button>
      <button class="done__link" type="button" @click="reset">用别的邮箱注册</button>
    </div>
  </AuthLayout>

  <AuthLayout
    v-else
    back
    title="创建你的账本"
    slogan="用邮箱注册，邮箱就是你的登录账号"
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
        v-model="form.nickname"
        name="nickname"
        label="昵称"
        placeholder="怎么称呼你？"
        maxlength="20"
        clearable
        :rules="[{ required: true, message: '请输入昵称' }]"
      />
      <van-field
        v-model="form.password"
        name="password"
        type="password"
        label="密码"
        placeholder="6-32 位，建议字母 + 数字"
        autocomplete="new-password"
        :rules="passwordRules"
      />
      <van-field
        v-model="form.confirm"
        name="confirm"
        type="password"
        label="确认密码"
        placeholder="再输一次密码"
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
          loading-text="注册中..."
        >
          注册
        </van-button>
      </div>
    </van-form>

    <div class="auth-switch">
      已经有账号了？
      <router-link class="auth-link" :to="{ name: 'login' }">去登录</router-link>
    </div>

    <template #foot>
      <p class="auth-hint">
        注册需要邮箱验证码；验证码会发送到你的邮箱，请留意垃圾箱。<br />
        注册完成后回到登录页，用邮箱和密码登录。
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

const form = reactive({ email: '', code: '', nickname: '', password: '', confirm: '' })
const loading = ref(false)

/** 注册成功后只记下邮箱，跳回登录页由用户自己输入密码 */
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
  { required: true, message: '请输入密码' },
  { validator: (v) => v.length >= 6, message: '密码至少 6 位' },
  { validator: (v) => v.length <= 32, message: '密码最多 32 位' },
]
const confirmRules = [
  { required: true, message: '请再次输入密码' },
  { validator: (v) => v === form.password, message: '两次输入的密码不一致' },
]

async function onSendCode() {
  const data = await sendCode(form.email, 'register', validateEmail)
  if (data?.devCode) form.code = data.devCode
}

async function onSubmit() {
  loading.value = true
  try {
    const user = await store.register({
      email: form.email.trim(),
      code: form.code.trim(),
      nickname: form.nickname,
      password: form.password,
    })
    // 注册成功但**不登录**，由用户回到登录页输入邮箱和密码
    done.value = { email: user.email, nickname: user.nickname }
  } catch (err) {
    showToast(err.message || '注册失败')
  } finally {
    loading.value = false
  }
}

function goLogin() {
  router.replace({ name: 'login', query: { email: done.value.email } })
}

function reset() {
  done.value = null
  Object.assign(form, { email: '', code: '', nickname: '', password: '', confirm: '' })
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
