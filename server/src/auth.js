/**
 * 密码摘要与登录令牌。
 *
 * 密码：scrypt + 每用户随机盐，只保存摘要，永不落盘明文（PRD 4.1）。
 * 令牌：HMAC-SHA256 签名的自包含 token（类似 JWT 的极简版），
 *       无需服务端会话表；用户改密码 / 被停用时通过 pwdVersion 立刻失效。
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './db.js'

const KEY_FILE = path.join(DATA_DIR, 'secret.key')
const SCRYPT_N = 16384
const KEYLEN = 32

let cachedSecret = null

function getSecret() {
  if (cachedSecret) return cachedSecret
  const fromEnv = process.env.APP_SECRET
  if (fromEnv && fromEnv.length >= 16) {
    cachedSecret = fromEnv
  } else if (fs.existsSync(KEY_FILE)) {
    cachedSecret = fs.readFileSync(KEY_FILE, 'utf8').trim()
  } else {
    cachedSecret = crypto.randomBytes(32).toString('hex')
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(KEY_FILE, cachedSecret, { mode: 0o600 })
    console.warn('[auth] 已生成新的会话密钥 data/secret.key（重启后登录状态保持有效）')
  }
  return cachedSecret
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, KEYLEN, { N: SCRYPT_N }).toString('hex')
  return `scrypt$${SCRYPT_N}$${salt}$${hash}`
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, n, salt, hash] = String(stored || '').split('$')
    if (scheme !== 'scrypt' || !salt || !hash) return false
    const actual = crypto.scryptSync(String(password), salt, KEYLEN, { N: Number(n) || SCRYPT_N })
    const expected = Buffer.from(hash, 'hex')
    if (expected.length !== actual.length) return false
    return crypto.timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const fromB64url = (str) => Buffer.from(String(str), 'base64url').toString('utf8')

/** 签发 token，默认 7 天有效 */
export function signToken(payload, ttlSeconds = 7 * 24 * 3600) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds }
  const data = Buffer.from(JSON.stringify(body)).toString('base64url')
  const sig = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url')
  return `${data}.${sig}`
}

export function verifyToken(token) {
  const raw = String(token || '')
  const idx = raw.lastIndexOf('.')
  if (idx <= 0) return null
  const data = raw.slice(0, idx)
  const sig = raw.slice(idx + 1)
  const expected = crypto.createHmac('sha256', getSecret()).update(data).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8'))
    if (!payload || typeof payload.exp !== 'number') return null
    if (payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
