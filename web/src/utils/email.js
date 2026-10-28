/** 邮箱格式校验：前端只做预校验，最终以服务端为准 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateEmail(value) {
  const email = String(value ?? '').trim()
  if (!email) return '请输入邮箱'
  if (email.length > 254) return '邮箱地址过长'
  if (!EMAIL_RE.test(email)) return '邮箱格式不正确'
  return ''
}
