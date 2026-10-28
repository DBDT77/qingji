/** 统一的参数校验与错误工具 */

export class ApiError extends Error {
  constructor(message, status = 400, code = 'BAD_REQUEST') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function fail(message, status = 400, code = 'BAD_REQUEST') {
  throw new ApiError(message, status, code)
}

export function assert(condition, message, status = 400) {
  if (!condition) fail(message, status)
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

// 用户名：字母开头，允许字母数字下划线点和短横，长 3-20
export const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{2,19}$/

// 邮箱：只做格式级校验，地址是否真实可达由「收到验证码」证明
export const EMAIL_RE =
  /^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

/** 统一小写存储，避免 Foo 和 foo 变成两个账号 */
export function normalizeUsername(username) {
  return String(username ?? '').trim().toLowerCase()
}

export function assertUsername(username) {
  const value = normalizeUsername(username)
  assert(value.length > 0, '请输入用户名')
  assert(
    USERNAME_RE.test(value),
    '用户名需以字母开头，由字母、数字、下划线、点或短横组成，长度 3-20 位',
  )
  return value
}

/** 统一小写存储，避免 Foo@x.com 和 foo@x.com 变成两个账号 */
export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase()
}

export function assertEmail(email) {
  const value = normalizeEmail(email)
  assert(value.length > 0, '请输入邮箱')
  assert(value.length <= 254, '邮箱地址过长')
  assert(EMAIL_RE.test(value), '邮箱格式不正确')
  return value
}

/** 邮箱验证码：固定 6 位数字 */
export function assertCode(code) {
  const value = String(code ?? '').trim()
  assert(/^\d{6}$/.test(value), '请输入 6 位数字验证码')
  return value
}

export function assertPassword(password, { min = 6, max = 32 } = {}) {
  const value = String(password ?? '')
  assert(value.length > 0, '请输入密码')
  assert(value.length >= min, `密码长度不能少于 ${min} 位`)
  assert(value.length <= max, `密码长度不能超过 ${max} 位`)
  assert(/[A-Za-z0-9]/.test(value), '密码需包含字母或数字')
  return value
}

export function assertNickname(nickname) {
  const value = String(nickname ?? '').trim()
  assert(value.length > 0, '请输入昵称')
  assert(value.length <= 20, '昵称不能超过 20 个字符')
  return value
}

export function assertDate(date, field = '日期') {
  const value = String(date ?? '').trim()
  assert(DATE_RE.test(value), `${field}格式应为 YYYY-MM-DD`)
  const parsed = new Date(`${value}T00:00:00`)
  assert(!Number.isNaN(parsed.getTime()), `${field}不是有效日期`)
  // 拦截 2024-02-31 这类"格式对但不存在"的日期
  const [y, m, d] = value.split('-').map(Number)
  assert(
    parsed.getFullYear() === y && parsed.getMonth() + 1 === m && parsed.getDate() === d,
    `${field}不是有效日期`,
  )
  return value
}

export function assertMonth(month, field = '月份') {
  const value = String(month ?? '').trim()
  assert(MONTH_RE.test(value), `${field}格式应为 YYYY-MM`)
  return value
}

export function assertNote(note) {
  const value = String(note ?? '').trim()
  assert(value.length <= 100, '备注不能超过 100 个字符')
  return value
}

export function assertType(type) {
  const value = String(type ?? '').trim()
  assert(value === 'income' || value === 'expense', '类型只能是收入或支出')
  return value
}

export function assertEnum(value, allowed, message) {
  assert(allowed.includes(value), message)
  return value
}

export function toInt(value, fallback, { min = 1, max = 100 } = {}) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

/** 当前月份 YYYY-MM（按服务器本地时间） */
export function currentMonth(offset = 0) {
  const d = new Date()
  d.setMonth(d.getMonth() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function today() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

