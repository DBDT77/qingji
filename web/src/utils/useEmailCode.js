import { onUnmounted, ref } from 'vue'
import { showToast } from 'vant'

/**
 * 邮箱验证码的发送状态与 60 秒倒计时。
 * 登录页和「我的 → 绑定邮箱」共用，避免两处各写一份定时器逻辑。
 *
 * @param {(email: string, purpose: 'register'|'reset') => Promise<any>} sendFn
 */
export function useEmailCode(sendFn) {
  const sending = ref(false)
  const countdown = ref(0)
  let timer = null

  function startCountdown(seconds = 60) {
    clearInterval(timer)
    countdown.value = seconds
    timer = setInterval(() => {
      countdown.value -= 1
      if (countdown.value <= 0) {
        clearInterval(timer)
        timer = null
        countdown.value = 0
      }
    }, 1000)
  }

  /**
   * @param {string} email
   * @param {'register'|'reset'} purpose
   * @param {(email: string) => string} [validate] 返回空字符串表示通过
   */
  async function send(email, purpose = 'register', validate) {
    if (sending.value || countdown.value > 0) return null

    const problem = validate?.(email)
    if (problem) {
      showToast(problem)
      return null
    }

    sending.value = true
    try {
      const data = await sendFn(email, purpose)
      // 重置密码时，未注册邮箱不会真的发信；明确告诉用户，避免一直等邮件
      if (data?.delivered === 'none') {
        showToast({ message: '该邮箱未注册或未绑定邮箱，请检查后重试', duration: 3000 })
        return data
      }
      startCountdown()
      if (data?.devCode) showToast('开发模式：验证码已自动填入')
      else
        showToast({
          type: 'success',
          message: '验证码已发送，请到收件箱或垃圾箱查收',
          duration: 3000,
        })
      return data
    } catch {
      // http 拦截器已经弹过错误提示，这里不重复弹
      return null
    } finally {
      sending.value = false
    }
  }

  onUnmounted(() => clearInterval(timer))

  return { sending, countdown, send }
}
