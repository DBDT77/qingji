import axios from 'axios'
import { showToast } from 'vant'

export const TOKEN_KEY = 'rmb_token'

const http = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

http.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

/**
 * 统一拆包与错误提示：后端固定返回 { code, message, data }。
 * 组件里只关心 data，出错时自动弹提示，避免每处都写 try/catch + Toast。
 */
http.interceptors.response.use(
  (res) => {
    const body = res.data
    if (body && typeof body === 'object' && 'code' in body) {
      if (body.code === 'OK') return body.data
      return Promise.reject(Object.assign(new Error(body.message || '请求失败'), { code: body.code }))
    }
    return body
  },
  (error) => {
    const status = error.response?.status
    const body = error.response?.data
    const code = body?.code || 'NETWORK_ERROR'
    // 登录接口自己会把后端的具体原因弹出来，这里不要再弹一次造成两条重叠的 toast
    const isLoginRequest = String(error.config?.url || '').includes('/auth/login')
    const message =
      body?.message ||
      (error.code === 'ECONNABORTED'
        ? '请求超时，请检查网络'
        : error.response
          ? '请求失败，请稍后再试'
          : '无法连接服务器，请确认后端已启动')

    // 其他接口的 401 才代表登录态失效；登录接口的 401 只是账号或密码错误
    if (status === 401 && !isLoginRequest) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem('rmb_user')
      const current = window.location.hash.replace(/^#/, '') || '/home'
      if (!current.startsWith('/login')) {
        window.location.hash = `#/login?redirect=${encodeURIComponent(current)}`
      }
    }
    if (status !== 401 && !isLoginRequest) {
      showToast({ message, duration: 3000, closeOnClick: true })
    }
    return Promise.reject(Object.assign(new Error(message), { code, status }))
  },
)

export default http
