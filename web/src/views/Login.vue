<template>
  <AuthLayout title="轻记" slogan="随手记一笔，看清钱去哪儿了">
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
        v-model="form.password"
        name="password"
        type="password"
        label="密码"
        placeholder="请输入密码"
        autocomplete="current-password"
        :rules="[{ required: true, message: '请输入密码' }]"
      />

      <div class="auth__forgot">
        <router-link class="auth-link auth__forgot-link" :to="{ name: 'forgot-password' }">
          忘记密码？
        </router-link>
      </div>

      <div class="auth-actions">
        <van-button
          block
          round
          type="primary"
          native-type="submit"
          :loading="loading"
          loading-text="登录中..."
        >
          登录
        </van-button>
      </div>
    </van-form>

    <div class="auth-switch">
      还没有账号？
      <router-link class="auth-link" :to="{ name: 'register' }">立即注册</router-link>
    </div>
  </AuthLayout>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { showToast } from 'vant'
import AuthLayout from '@/components/AuthLayout.vue'
import { useUserStore } from '@/store/user'
import { validateEmail } from '@/utils/email'

const router = useRouter()
const route = useRoute()
const store = useUserStore()

const form = reactive({ email: '', password: '' })
const loading = ref(false)

// 注册成功 / 重置密码成功跳回来时带上邮箱，省去重新输入
if (typeof route.query.email === 'string') form.email = route.query.email

const emailRules = [
  { required: true, message: '请输入邮箱' },
  { validator: (value) => !validateEmail(value), message: '邮箱格式不正确' },
]

async function onSubmit() {
  loading.value = true
  try {
    await store.login({ email: form.email.trim(), password: form.password })
    showToast({ type: 'success', message: '欢迎回来' })
    router.replace(route.query.redirect || '/home')
  } catch (err) {
    // 登录失败的具体原因（密码错误、账号停用、请求过多等）由后端返回，原样展示
    showToast({ message: err.message || '登录失败，请稍后重试', duration: 3000 })
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth__forgot {
  display: flex;
  justify-content: flex-end;
  margin-top: 2px;
}
.auth__forgot-link {
  font-size: 12px;
  font-weight: 500;
  color: var(--c-text-3);
}

</style>
