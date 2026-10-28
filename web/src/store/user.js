import { defineStore } from 'pinia'
import { authApi } from '@/api'
import { TOKEN_KEY } from '@/api/http'

const USER_KEY = 'rmb_user'

function readCachedUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null')
  } catch {
    return null
  }
}

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem(TOKEN_KEY) || '',
    profile: readCachedUser(), // 先读缓存，避免首屏闪烁未登录状态
    ready: false, // 是否已完成一次 /me 校验
  }),

  getters: {
    isLoggedIn: (s) => Boolean(s.token),
    isAdmin: (s) => s.profile?.role === 'admin',
    nickname: (s) => s.profile?.nickname || '记账用户',
  },

  actions: {
    persist(data) {
      this.token = data.token
      this.profile = data.user
      localStorage.setItem(TOKEN_KEY, data.token)
      localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    },

    async login(payload) {
      const data = await authApi.login(payload)
      this.persist(data)
      this.ready = true
      return data.user
    },

    /** 发送注册 / 重置密码的邮箱验证码 */
    sendEmailCode(email, purpose) {
      return authApi.sendEmailCode({ email, purpose })
    },

    /** 忘记密码：验证邮箱验证码后设置新密码 */
    async resetPassword(payload) {
      return authApi.resetPassword(payload)
    },

    /**
     * 注册。注册接口**不返回 token**（服务端刻意不自动登录），
     * 所以这里只把用户名回传，由调用方引导用户回登录页。
     */
    async register(payload) {
      const data = await authApi.register(payload)
      return data.user
    },

    /** 应用启动时校验 token 是否仍然有效 */
    async fetchProfile() {
      if (!this.token) {
        this.ready = true
        return null
      }
      try {
        const user = await authApi.me()
        this.profile = user
        localStorage.setItem(USER_KEY, JSON.stringify(user))
        return user
      } catch {
        // token 失效则清空本地状态，路由守卫会引导去登录
        this.clear()
        return null
      } finally {
        this.ready = true
      }
    },

    async updateProfile(nickname) {
      const user = await authApi.updateProfile({ nickname })
      this.profile = user
      localStorage.setItem(USER_KEY, JSON.stringify(user))
      return user
    },

    /** 改密码后后端会让旧 token 失效，因此需要重新登录 */
    async changePassword(payload) {
      await authApi.changePassword(payload)
      this.clear()
    },

    async logout() {
      try {
        await authApi.logout()
      } catch {
        // 退出接口失败也要清本地状态，不能把用户卡在登录态
      }
      this.clear()
    },

    clear() {
      this.token = ''
      this.profile = null
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    },
  },
})
