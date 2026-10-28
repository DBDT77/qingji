/**
 * 邮箱验证码的生成、发送与校验。
 *
 * 验证码只存在内存里（10 分钟有效），服务重启即失效；
 * 落盘保存的是加盐摘要而不是明文，避免内存转储直接泄露验证码。
 *
 * 限流同时按「邮箱」和「IP」两个维度：
 * - 同一邮箱 60 秒内只能发一次，每小时最多 5 次
 * - 同一 IP 每小时最多 20 次
 * - 单条验证码最多试错 5 次
 * 这些限制是内存级的，适合本项目单进程部署。
 */
import crypto from 'node:crypto'
import { sendEmailCode } from './mailer.js'
import { otpConfig } from './config.js'
import { ApiError } from './utils.js'

/** email -> { digest, salt, expiresAt, attempts, purpose, userId } */
const codes = new Map()
/** email -> 上次发送成功的时间戳（用于重发冷却，登录成功后也保留） */
const lastSentAt = new Map()
/** email -> 最近一小时的发送时间戳列表 */
const sendsByEmail = new Map()
/** ip -> 最近一小时的发送时间戳列表 */
const sendsByIp = new Map()
/** 正在发送中的邮箱，挡住并发请求绕过「60 秒冷却」 */
const inFlight = new Set()

const HOUR = 60 * 60 * 1000

function digestOf(code, salt) {
  return crypto.createHash('sha256').update(`${code}:${salt}`).digest('hex')
}

function sameDigest(a, b) {
  const bufA = Buffer.from(String(a), 'utf8')
  const bufB = Buffer.from(String(b), 'utf8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

/** 清掉过期的验证码和超出一小时的发送记录 */
function sweep() {
  const now = Date.now()
  for (const [email, rec] of codes) {
    if (rec.expiresAt <= now) codes.delete(email)
  }
  for (const map of [sendsByEmail, sendsByIp]) {
    for (const [key, list] of map) {
      const kept = list.filter((t) => now - t < HOUR)
      if (kept.length) map.set(key, kept)
      else map.delete(key)
    }
  }
  // 冷却只需要 60 秒，超过一小时的记录没有再保留的意义
  for (const [email, at] of lastSentAt) {
    if (now - at >= HOUR) lastSentAt.delete(email)
  }
}

function recentSends(map, key, now) {
  return (map.get(key) || []).filter((t) => now - t < HOUR)
}

/**
 * 生成并发送验证码。
 * @param {string} email 已归一化的小写邮箱
 * @param {{ purpose?: 'register'|'reset', ip?: string }} options
 * @returns {Promise<{ delivered: 'smtp'|'console', devCode?: string }>}
 */
export async function issueEmailCode(email, { purpose = 'register', ip = '' } = {}) {
  sweep()
  const now = Date.now()

  const last = lastSentAt.get(email)
  if (last && now - last < otpConfig.resendMs) {
    const left = Math.ceil((otpConfig.resendMs - (now - last)) / 1000)
    throw new ApiError(`请在 ${left} 秒后重新获取验证码`, 429, 'CODE_TOO_FREQUENT')
  }

  if (recentSends(sendsByEmail, email, now).length >= otpConfig.maxSendsPerEmail) {
    throw new ApiError('该邮箱获取验证码过于频繁，请 1 小时后再试', 429, 'TOO_MANY_REQUESTS')
  }
  if (ip && recentSends(sendsByIp, ip, now).length >= otpConfig.maxSendsPerIp) {
    throw new ApiError('当前网络获取验证码过于频繁，请稍后再试', 429, 'TOO_MANY_REQUESTS')
  }

  if (inFlight.has(email)) {
    throw new ApiError('验证码正在发送，请稍后再试', 429, 'CODE_TOO_FREQUENT')
  }
  inFlight.add(email)

  try {
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    const salt = crypto.randomBytes(16).toString('hex')

    // 先发送，成功后才记录冷却时间；发送失败时用户可立即重试
    let delivered
    try {
      ;({ delivered } = await sendEmailCode(email, code, purpose))
    } catch (err) {
      console.error('[email] 验证码邮件发送失败：', err.message)
      throw new ApiError('验证码发送失败，请稍后再试', 502, 'EMAIL_SEND_FAILED')
    }

    codes.set(email, {
      digest: digestOf(code, salt),
      salt,
      expiresAt: Date.now() + otpConfig.ttlMs,
      attempts: 0,
      purpose,
    })
    const sentAt = Date.now()
    lastSentAt.set(email, sentAt)
    sendsByEmail.set(email, [...recentSends(sendsByEmail, email, sentAt), sentAt])
    if (ip) sendsByIp.set(ip, [...recentSends(sendsByIp, ip, sentAt), sentAt])

    return {
      delivered,
      // 只有控制台模式才把验证码回传给前端，生产环境永远不会走到这里
      devCode: delivered === 'console' ? code : undefined,
    }
  } finally {
    inFlight.delete(email)
  }
}

/**
 * 校验并消费验证码（一次性）。
 * purpose 必须和发送时一致，避免「注册验证码被拿去重置密码」。
 */
export function verifyEmailCode(email, code, { purpose = 'register' } = {}) {
  sweep()
  const rec = codes.get(email)

  if (!rec || rec.purpose !== purpose) {
    throw new ApiError('验证码已失效，请重新获取', 400, 'CODE_INVALID')
  }
  if (rec.expiresAt <= Date.now()) {
    codes.delete(email)
    throw new ApiError('验证码已过期，请重新获取', 400, 'CODE_EXPIRED')
  }

  rec.attempts += 1
  if (!sameDigest(digestOf(code, rec.salt), rec.digest)) {
    if (rec.attempts >= otpConfig.maxVerifyAttempts) codes.delete(email)
    throw new ApiError('验证码不正确', 400, 'CODE_INVALID')
  }

  codes.delete(email)
  return true
}
