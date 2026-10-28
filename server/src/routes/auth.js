import crypto from 'node:crypto'
import { Router } from 'express'
import { db, nextId, save } from '../db.js'
import { hashPassword, verifyPassword, signToken } from '../auth.js'
import { requireAuth, ok } from '../middleware.js'
import { createDefaultCategories, INTERNAL_EMAIL_DOMAIN } from '../seed.js'
import { issueEmailCode, verifyEmailCode } from '../email-code.js'
import {
  assert,
  fail,
  assertPassword,
  assertNickname,
  assertUsername,
  assertEmail,
  assertCode,
  normalizeUsername,
  normalizeEmail,
  ApiError,
} from '../utils.js'

const router = Router()

/** 登录失败次数限制（简单的内存级防爆破） */
const attempts = new Map()
const MAX_ATTEMPTS = 8
const LOCK_MS = 10 * 60 * 1000

function checkLock(key) {
  const rec = attempts.get(key)
  if (rec && rec.count >= MAX_ATTEMPTS && Date.now() - rec.at < LOCK_MS) {
    const left = Math.ceil((LOCK_MS - (Date.now() - rec.at)) / 60000)
    fail(`尝试次数过多，请 ${left} 分钟后再试`, 429, 'TOO_MANY_ATTEMPTS')
  }
}

function recordFail(key) {
  const rec = attempts.get(key) || { count: 0, at: Date.now() }
  rec.count += 1
  rec.at = Date.now()
  attempts.set(key, rec)
}

/** 对外暴露的用户字段（永远不含密码摘要） */
export function publicUser(user) {
  const authMethods = Array.isArray(user.authMethods)
    ? user.authMethods
    : user.password
      ? ['password']
      : []
  return {
    id: user.id,
    username: user.username,
    nickname: user.nickname,
    email: user.email || null,
    role: user.role,
    status: user.status,
    hasPassword: Boolean(user.password),
    authMethods,
    createdAt: user.createdAt,
  }
}

function issue(user) {
  const token = signToken({ uid: user.id, ver: Number(user.pwdVersion || 0), role: user.role })
  return { token, user: publicUser(user) }
}

/** 按邮箱查用户（邮箱统一小写存储，查询前也先归一化） */
function findUserByEmail(email) {
  return db().users.find((u) => u.email && normalizeEmail(u.email) === email)
}

/** 邮箱注册时生成一个不会与现有用户名冲突的内部账号名 */
function uniqueEmailUsername() {
  const s = db()
  for (let i = 0; i < 20; i += 1) {
    const name = `em_${crypto.randomBytes(4).toString('hex')}`
    if (!s.users.some((u) => normalizeUsername(u.username) === name)) return name
  }
  // 理论上不会走到这里；用时间戳兜底，保证注册流程不会卡住
  return `em_${Date.now().toString(36)}`
}

/**
 * 邮箱注册。
 * 先填邮箱验证码，再设置昵称和密码；注册成功后不自动登录，
 * 由用户回到登录页用「邮箱 + 密码」登录。
 */
function registerByEmail(req, res, next) {
  try {
    const email = assertEmail(req.body?.email)
    const code = assertCode(req.body?.code)
    const password = assertPassword(req.body?.password)
    const nickname = assertNickname(req.body?.nickname)

    assert(
      !email.endsWith(`@${INTERNAL_EMAIL_DOMAIN}`),
      '该邮箱域名仅用于演示账号，请使用真实邮箱',
    )

    const s = db()
    assert(!findUserByEmail(email), '该邮箱已注册，请直接登录', 409)

    // 放在所有格式校验之后：密码/昵称不合法时不要白白消耗验证码
    verifyEmailCode(email, code, { purpose: 'register' })

    const now = new Date().toISOString()
    const user = {
      id: nextId('users'),
      username: uniqueEmailUsername(),
      email,
      emailVerifiedAt: now,
      password: hashPassword(password),
      nickname,
      role: 'user',
      status: 'active',
      pwdVersion: 1,
      authMethods: ['password', 'email'],
      createdAt: now,
    }
    s.users.push(user)
    createDefaultCategories(user.id) // 新用户自动获得默认分类
    save()

    // 不返回 token：注册后需回到登录页登录
    ok(res, { user: publicUser(user) })
  } catch (err) {
    next(err)
  }
}

/**
 * 注册。
 * - 带 email：邮箱验证码注册（前端使用的方式）
 * - 不带 email：保留旧的用户名注册，供测试脚本与内部工具使用
 */
router.post('/register', (req, res, next) => {
  if (req.body?.email !== undefined) return registerByEmail(req, res, next)

  try {
    const username = assertUsername(req.body?.username)
    const password = assertPassword(req.body?.password)
    const nickname = assertNickname(req.body?.nickname)

    const s = db()
    assert(
      !s.users.some((u) => normalizeUsername(u.username) === username),
      '该用户名已被注册，换一个试试',
      409,
    )

    const user = {
      id: nextId('users'),
      username,
      password: hashPassword(password),
      nickname,
      role: 'user',
      status: 'active',
      pwdVersion: 1,
      authMethods: ['password'],
      createdAt: new Date().toISOString(),
    }
    s.users.push(user)
    createDefaultCategories(user.id) // 新用户自动获得默认分类
    save()

    // 不返回 token：注册后需回到登录页登录
    ok(res, { user: publicUser(user) })
  } catch (err) {
    next(err)
  }
})

/**
 * 登录。
 * - 带 email：邮箱 + 密码登录（前端使用的方式）
 * - 不带 email：保留旧的用户名 + 密码登录，供测试脚本与内部工具使用
 */
router.post('/login', (req, res, next) => {
  try {
    const usingEmail = typeof req.body?.email === 'string' && req.body.email.trim() !== ''
    const password = String(req.body?.password ?? '')
    assert(password.length > 0, '请输入密码')

    let user
    let lockKey

    if (usingEmail) {
      const email = assertEmail(req.body.email)
      lockKey = `email:${email}`
      checkLock(lockKey)
      user = findUserByEmail(email)
      // 邮箱不存在与密码错误返回同一句提示，避免暴露邮箱是否注册
      if (!user || !verifyPassword(password, user.password)) {
        recordFail(lockKey)
        throw new ApiError('邮箱或密码不正确', 401, 'BAD_CREDENTIALS')
      }
    } else {
      const username = assertUsername(req.body?.username)
      lockKey = username
      checkLock(lockKey)
      user = db().users.find((u) => normalizeUsername(u.username) === username)
      if (!user || !verifyPassword(password, user.password)) {
        recordFail(lockKey)
        throw new ApiError('用户名或密码不正确', 401, 'BAD_CREDENTIALS')
      }
    }

    if (user.status === 'disabled') {
      throw new ApiError('账号已被停用，请联系管理员', 403, 'ACCOUNT_DISABLED')
    }
    attempts.delete(lockKey)
    ok(res, issue(user))
  } catch (err) {
    next(err)
  }
})

/**
 * 发送邮箱验证码。
 * purpose=register：注册时验证邮箱；邮箱已注册会直接拒绝。
 * purpose=reset：忘记密码时重置；未注册邮箱返回成功但不发信，避免暴露账号是否存在。
 */
router.post('/email/send-code', async (req, res, next) => {
  try {
    const email = assertEmail(req.body?.email)
    const purpose = String(req.body?.purpose || '')
    assert(purpose === 'register' || purpose === 'reset', '验证码用途不正确')

    // 演示账号使用内部邮箱，真实 SMTP 发不出去，直接给出明确提示
    if (email.endsWith(`@${INTERNAL_EMAIL_DOMAIN}`)) {
      throw new ApiError(
        purpose === 'reset'
          ? '演示账号请直接使用登录页提供的密码'
          : '该邮箱域名仅用于演示账号，请使用真实邮箱',
        400,
        'DEMO_EMAIL_DOMAIN',
      )
    }

    if (purpose === 'register') {
      assert(!findUserByEmail(email), '该邮箱已注册，请直接登录', 409)
    } else if (!findUserByEmail(email)) {
      // 不暴露邮箱是否注册：统一返回成功，但不会真的发信
      return ok(res, { sent: true, delivered: 'none' })
    }

    const result = await issueEmailCode(email, { purpose, ip: req.ip || '' })
    ok(res, {
      sent: true,
      delivered: result.delivered,
      // 仅开发环境的控制台模式会返回；配置 SMTP 后不会出现
      ...(result.devCode ? { devCode: result.devCode } : {}),
    })
  } catch (err) {
    next(err)
  }
})

/** 忘记密码：验证邮箱验证码后设置新密码 */
router.post('/password/reset', (req, res, next) => {
  try {
    const email = assertEmail(req.body?.email)
    const code = assertCode(req.body?.code)
    const newPassword = assertPassword(req.body?.newPassword)

    const user = findUserByEmail(email)
    if (!user) throw new ApiError('邮箱或验证码不正确', 400, 'CODE_INVALID')

    verifyEmailCode(email, code, { purpose: 'reset' })

    user.password = hashPassword(newPassword)
    user.pwdVersion = Number(user.pwdVersion || 0) + 1
    if (!Array.isArray(user.authMethods)) user.authMethods = ['password']
    if (!user.authMethods.includes('password')) user.authMethods.push('password')
    save()
    ok(res, { reset: true })
  } catch (err) {
    next(err)
  }
})

/** 退出登录（token 自包含，服务端只需告知前端清除即可） */
router.post('/logout', (_req, res) => ok(res, { loggedOut: true }))

/** 当前登录用户 */
router.get('/me', requireAuth, (req, res) => ok(res, publicUser(req.user)))

/** 修改昵称 */
router.patch('/profile', requireAuth, (req, res, next) => {
  try {
    const nickname = assertNickname(req.body?.nickname)
    req.user.nickname = nickname
    save()
    ok(res, publicUser(req.user))
  } catch (err) {
    next(err)
  }
})

/** 修改密码：改完旧 token 全部失效，需要重新登录 */
router.post('/change-password', requireAuth, (req, res, next) => {
  try {
    const oldPassword = String(req.body?.oldPassword ?? '')
    const newPassword = assertPassword(req.body?.newPassword)
    if (!verifyPassword(oldPassword, req.user.password)) {
      return next(new ApiError('原密码不正确', 400, 'BAD_OLD_PASSWORD'))
    }
    assert(newPassword !== oldPassword, '新密码不能与原密码相同')
    req.user.password = hashPassword(newPassword)
    req.user.pwdVersion = Number(req.user.pwdVersion || 0) + 1
    save()
    ok(res, { changed: true })
  } catch (err) {
    next(err)
  }
})

export default router
