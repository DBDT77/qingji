/**
 * 运行时配置。
 *
 * 读取 server/.env（不存在则忽略），只实现 KEY=VALUE 的最小子集，
 * 不引第三方 dotenv 依赖。已有的进程环境变量优先，方便部署时覆盖。
 *
 * 邮箱相关配置说明见 server/.env.example 与 README「邮箱登录」一节。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const ENV_FILE = path.resolve(__dirname, '..', '.env')

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // 允许用引号包裹带空格的值，例如 MAIL_FROM="轻记 <a@b.com>"
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile(ENV_FILE)

const bool = (value) => /^(1|true|yes|on)$/i.test(String(value ?? '').trim())

export const isProd = process.env.NODE_ENV === 'production'

/** SMTP 连接参数（QQ / 163 / Gmail 均可，端口 465 时默认走 SSL） */
export function smtpConfig() {
  const host = String(process.env.SMTP_HOST || '').trim()
  const user = String(process.env.SMTP_USER || '').trim()
  const pass = String(process.env.SMTP_PASS || '').trim()
  const port = Number(process.env.SMTP_PORT || 465)
  const from = String(process.env.MAIL_FROM || '').trim() || user
  const hasAny = Boolean(host || user || pass || process.env.MAIL_FROM)
  return {
    host,
    port: Number.isFinite(port) ? port : 465,
    // 默认按端口推断：465 用 SSL，587 用 STARTTLS
    secure: process.env.SMTP_SECURE === undefined ? port === 465 : bool(process.env.SMTP_SECURE),
    user,
    pass,
    from,
    configured: Boolean(host && user && pass && from),
    // 配了一半通常是漏了某个变量，启动时给个提示，避免"以为发了邮件其实没发"
    partial: hasAny && !(host && user && pass && from),
  }
}

/**
 * 邮件投递方式：
 * - smtp      真实发送
 * - console   只把验证码打印到后端控制台（开发环境）
 * - disabled  未配置且不允许降级，发送时直接报错
 *
 * EMAIL_DEV_MODE=auto（默认）：配好 SMTP 就真发，否则开发环境走控制台
 * EMAIL_DEV_MODE=true：强制控制台（生产环境会忽略，避免验证码泄露）
 * EMAIL_DEV_MODE=false：强制真实发送
 */
export function emailMode() {
  const raw = String(process.env.EMAIL_DEV_MODE || 'auto').trim().toLowerCase()
  if (raw === 'true' || raw === '1') return isProd ? 'disabled' : 'console'
  if (raw === 'false' || raw === '0') return 'smtp'
  return smtpConfig().configured ? 'smtp' : isProd ? 'disabled' : 'console'
}

const num = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** 免费云厂商的 OpenAI 兼容地址（填 AI_BASE_URL 时以填的为准） */
const AI_PROVIDER_BASES = {
  openrouter: 'https://openrouter.ai/api/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
}

/** 管理员初始密码：只在首次创建 admin 时使用；未设置时由 seed 随机生成 */
export function adminPassword() {
  return String(process.env.ADMIN_PASSWORD || '').trim()
}

/** 演示账号统一密码；公开演示默认值，可用 DEMO_PASSWORD 覆盖 */
export function demoPassword() {
  return String(process.env.DEMO_PASSWORD || '').trim() || 'Demo@2026!'
}

const AI_MODES = new Set(['auto', 'cloud', 'rule'])

function aiMode(value, fallback = 'auto') {
  const mode = String(value || '').trim().toLowerCase()
  return AI_MODES.has(mode) ? mode : fallback
}

/**
 * AI 辅助记账配置。
 *
 * - mock（默认）：只走本地规则，不联网
 * - openrouter / gemini / openai：OpenAI 兼容的云模型，需要 API Key
 *
 * 三项（baseUrl / apiKey / model）齐了才算配置完成；否则自动退回本地规则。
 *
 * 免费部署（1–5 人）建议：
 * - chatMode=auto：固定问题本地回答，只有规则答不了才调云端
 * - receiptMode=auto：本地 OCR 能出草稿就不调云端
 * - dailyLimit：全局每日云端调用上限，避免少数请求打满免费额度
 */
export function aiConfig() {
  const provider = String(process.env.AI_PROVIDER || 'mock').trim().toLowerCase()
  const baseUrl =
    String(process.env.AI_BASE_URL || '').trim().replace(/\/+$/, '') ||
    AI_PROVIDER_BASES[provider] ||
    ''
  const apiKey = String(process.env.AI_API_KEY || '').trim()
  const model = String(process.env.AI_MODEL || '').trim()
  const timeoutMs = num(process.env.AI_TIMEOUT_MS, 25_000)
  return {
    provider,
    baseUrl,
    apiKey,
    model,
    timeoutMs: Math.min(60_000, Math.max(3_000, timeoutMs)),
    configured: provider !== 'mock' && Boolean(baseUrl && apiKey && model),
    chatMode: aiMode(process.env.AI_CHAT_MODE),
    receiptMode: aiMode(process.env.AI_RECEIPT_MODE),
    // 0 表示不限制；免费额度部署时建议设成供应商日额度的 80% 左右
    dailyLimit: num(process.env.AI_DAILY_CLOUD_LIMIT, 200),
  }
}

/**
 * 本地 OCR 配置。
 *
 * tesseract.js 默认从 jsdelivr 下载语言包，国内网络经常连不上；
 * 这里默认改用 projectnaptha 的官方静态镜像。完全离线部署时，
 * 把 chi_sim.traineddata.gz / eng.traineddata.gz 放进一个目录，
 * 再把 OCR_LANG_PATH 指向它即可（本地目录或 URL 都支持）。
 */
const DEFAULT_OCR_LANG_PATH = 'https://tessdata.projectnaptha.com/4.0.0'

export function ocrConfig() {
  const langPath = String(process.env.OCR_LANG_PATH || '').trim() || DEFAULT_OCR_LANG_PATH
  return { langPath }
}

/**
 * 验证码策略：默认 10 分钟有效、60 秒重发间隔、每邮箱 5 次/小时、每 IP 20 次/小时。
 * 几个上限可以用环境变量覆盖，主要给自动化测试缩短等待时间用。
 */
export const otpConfig = {
  ttlMs: num(process.env.OTP_TTL_MS, 10 * 60 * 1000),
  resendMs: num(process.env.OTP_RESEND_MS, 60 * 1000),
  maxSendsPerEmail: num(process.env.OTP_MAX_SENDS_PER_EMAIL, 5),
  maxSendsPerIp: num(process.env.OTP_MAX_SENDS_PER_IP, 20),
  maxVerifyAttempts: num(process.env.OTP_MAX_VERIFY_ATTEMPTS, 5),
}

if (smtpConfig().partial) {
  console.warn(
    '[config] SMTP 配置不完整：需要同时设置 SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_FROM。' +
      '当前将按 EMAIL_DEV_MODE 的规则处理。',
  )
}
