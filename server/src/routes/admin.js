import { Router } from 'express'
import { db, nextId, save } from '../db.js'
import { requireAdmin, ok } from '../middleware.js'
import { hashPassword } from '../auth.js'
import { createDefaultCategories } from '../seed.js'
import {
  assert,
  assertPassword,
  assertNickname,
  assertUsername,
  assertEmail,
  assertEnum,
  assertMonth,
  fail,
  normalizeUsername,
  normalizeEmail,
  toInt,
  currentMonth,
} from '../utils.js'

const router = Router()
// 整个后台都要求管理员身份（PRD 未强制，但后台是本项目额外提供的能力）
router.use(requireAdmin)

const asUser = (u) => ({
  id: u.id,
  username: u.username,
  nickname: u.nickname,
  email: u.email || null,
  role: u.role,
  status: u.status,
  createdAt: u.createdAt,
})

/**
 * 用户活跃分层：按累计记账笔数分档。
 * 放在这里作为唯一来源 —— /layers 出图和 /users 按档位筛选都必须用同一套档位，
 * 各写一份迟早会漂移（改了分档边界但只改了一处，筛选结果就和图对不上）。
 */
const LAYER_BUCKETS = [
  { key: 'never', label: '从未记账', min: 0, max: 0 },
  { key: 'low', label: '1-9 笔', min: 1, max: 9 },
  { key: 'mid', label: '10-49 笔', min: 10, max: 49 },
  { key: 'high', label: '50 笔以上', min: 50, max: Infinity },
]

const LAYER_KEYS = LAYER_BUCKETS.map((b) => b.key)

/** 某用户的累计笔数落在哪个档位 */
function layerKeyOf(recordCount) {
  return LAYER_BUCKETS.find((b) => recordCount >= b.min && recordCount <= b.max)?.key || 'never'
}

function recordStatsOf(userId) {
  const s = db()
  const rows = s.records.filter((r) => r.userId === userId)
  return {
    recordCount: rows.length,
    categoryCount: s.categories.filter((c) => c.userId === userId).length,
    totalIncome: rows.filter((r) => r.type === 'income').reduce((a, r) => a + r.amount, 0),
    totalExpense: rows.filter((r) => r.type === 'expense').reduce((a, r) => a + r.amount, 0),
    lastActiveAt: rows.reduce((max, r) => (r.createdAt > max ? r.createdAt : max), ''),
  }
}

/** 平台总览 */
router.get('/overview', (_req, res) => {
  const s = db()
  const month = currentMonth()
  const monthRows = s.records.filter((r) => r.date.startsWith(month))
  ok(res, {
    userCount: s.users.length,
    activeUserCount: s.users.filter((u) => u.status === 'active').length,
    disabledUserCount: s.users.filter((u) => u.status === 'disabled').length,
    adminCount: s.users.filter((u) => u.role === 'admin').length,
    recordCount: s.records.length,
    categoryCount: s.categories.length,
    budgetCount: s.budgets.length,
    totalIncome: s.records.filter((r) => r.type === 'income').reduce((a, r) => a + r.amount, 0),
    totalExpense: s.records.filter((r) => r.type === 'expense').reduce((a, r) => a + r.amount, 0),
    monthRecordCount: monthRows.length,
    monthActiveUsers: new Set(monthRows.map((r) => r.userId)).size,
    monthIncome: monthRows.filter((r) => r.type === 'income').reduce((a, r) => a + r.amount, 0),
    monthExpense: monthRows.filter((r) => r.type === 'expense').reduce((a, r) => a + r.amount, 0),
  })
})

/** 近 n 个月的月份列表（含当前月），升序 */
function recentMonths(n = 6) {
  const out = []
  const now = new Date()
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/**
 * 用户增长：每月新增注册 + 累计用户。
 * 累计值从窗口开始前的历史用户数起算，否则第一根柱子会少算存量用户。
 */
router.get('/growth', (req, res, next) => {
  try {
    const months = toInt(req.query.months, 6, { min: 3, max: 24 })
    const s = db()
    const list = recentMonths(months)
    const first = list[0]

    // 窗口之前就存在的用户计入累计基数
    let cumulative = s.users.filter((u) => String(u.createdAt || '').slice(0, 7) < first).length
    const data = list.map((m) => {
      const added = s.users.filter((u) => String(u.createdAt || '').slice(0, 7) === m).length
      cumulative += added
      return { month: m, added, cumulative }
    })
    ok(res, data)
  } catch (err) {
    next(err)
  }
})

/** 活跃度：每月有记账行为的用户数 + 记录笔数 */
router.get('/activity', (req, res, next) => {
  try {
    const months = toInt(req.query.months, 6, { min: 3, max: 24 })
    const s = db()
    const data = recentMonths(months).map((m) => {
      const rows = s.records.filter((r) => r.date.startsWith(m))
      return {
        month: m,
        activeUsers: new Set(rows.map((r) => r.userId)).size,
        recordCount: rows.length,
      }
    })
    ok(res, data)
  } catch (err) {
    next(err)
  }
})

/**
 * 用户活跃分层：按累计记账笔数把用户分档，看有多少人注册后就没再使用。
 * 只看普通用户——管理员账号通常不参与记账，混进来会拉低「沉默用户」的观感。
 */
router.get('/layers', (_req, res, next) => {
  try {
    const s = db()
    const users = s.users.filter((u) => u.role !== 'admin')
    const counts = new Map(LAYER_BUCKETS.map((b) => [b.key, 0]))
    // 先把每个用户的笔数算出来，避免在循环里反复全表扫描 records
    const countByUser = new Map()
    for (const r of s.records) countByUser.set(r.userId, (countByUser.get(r.userId) || 0) + 1)
    for (const u of users) {
      const key = layerKeyOf(countByUser.get(u.id) || 0)
      counts.set(key, counts.get(key) + 1)
    }
    ok(res, LAYER_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: counts.get(b.key) })))
  } catch (err) {
    next(err)
  }
})

/** 全站月度收支趋势（与首页个人版同一套结构，便于复用图表组件） */
router.get('/charts', (req, res, next) => {
  try {
    const months = toInt(req.query.months, 6, { min: 3, max: 24 })
    const s = db()
    const data = recentMonths(months).map((m) => {
      const rows = s.records.filter((r) => r.date.startsWith(m))
      return {
        month: m,
        income: rows.filter((r) => r.type === 'income').reduce((a, r) => a + r.amount, 0),
        expense: rows.filter((r) => r.type === 'expense').reduce((a, r) => a + r.amount, 0),
      }
    })
    ok(res, data)
  } catch (err) {
    next(err)
  }
})

/** 用户列表：搜索 + 状态/角色筛选 + 分页 */
router.get('/users', (req, res, next) => {
  try {
    const s = db()
    const keyword = String(req.query.keyword || '').trim().toLowerCase()
    const status = req.query.status
      ? assertEnum(req.query.status, ['active', 'disabled'], '状态不合法')
      : null
    const role = req.query.role
      ? assertEnum(req.query.role, ['user', 'admin'], '角色不合法')
      : null
    // 后台图表点进来时带的筛选：注册月份 / 该月有记账 / 活跃档位
    const createdMonth = req.query.createdMonth ? assertMonth(req.query.createdMonth) : null
    const activeMonth = req.query.activeMonth ? assertMonth(req.query.activeMonth) : null
    const layer = req.query.layer ? assertEnum(req.query.layer, LAYER_KEYS, '活跃档位不合法') : null

    let list = s.users
    if (keyword) {
      list = list.filter(
        (u) =>
          normalizeUsername(u.username).includes(keyword) ||
          String(u.nickname).toLowerCase().includes(keyword) ||
          String(u.email || '').toLowerCase().includes(keyword),
      )
    }
    if (status) list = list.filter((u) => u.status === status)
    if (role) list = list.filter((u) => u.role === role)
    if (createdMonth) {
      list = list.filter((u) => String(u.createdAt || '').slice(0, 7) === createdMonth)
    }
    if (activeMonth) {
      const activeIds = new Set(
        s.records.filter((r) => r.date.startsWith(activeMonth)).map((r) => r.userId),
      )
      list = list.filter((u) => activeIds.has(u.id))
    }
    // 档位筛选与「用户活跃分层」图共用同一套口径：那张图只统计普通用户，
    // 否则点「从未记账」那根柱子落到的名单会比柱子上的数字多出管理员，两边对不上。
    if (layer) list = list.filter((u) => u.role !== 'admin')
    list = [...list].sort((a, b) => a.id - b.id)

    const page = toInt(req.query.page, 1, { min: 1, max: 100000 })
    const pageSize = toInt(req.query.pageSize, 20, { min: 1, max: 100 })
    // 档位筛选要在补齐 recordCount 之后才谈得上，所以放在这里过滤
    const withStats = list.map((u) => {
      const stats = recordStatsOf(u.id)
      return { ...asUser(u), ...stats, layerKey: layerKeyOf(stats.recordCount) }
    })
    const filtered = layer ? withStats.filter((u) => u.layerKey === layer) : withStats

    const total = filtered.length
    const items = filtered.slice((page - 1) * pageSize, page * pageSize)
    ok(res, { total, page, pageSize, items })
  } catch (err) {
    next(err)
  }
})

/** 新建用户（管理员代开） */
router.post('/users', (req, res, next) => {
  try {
    const username = assertUsername(req.body?.username)
    const nickname = assertNickname(req.body?.nickname)
    const password = assertPassword(req.body?.password ?? '123456')
    const email = assertEmail(req.body?.email)
    const role = req.body?.role ? assertEnum(req.body.role, ['user', 'admin'], '角色不合法') : 'user'

    const s = db()
    assert(!s.users.some((u) => normalizeUsername(u.username) === username), '该用户名已存在', 409)
    assert(
      !s.users.some((u) => u.email && normalizeEmail(u.email) === email),
      '该邮箱已被使用',
      409,
    )

    const now = new Date().toISOString()
    const user = {
      id: nextId('users'),
      username,
      email,
      emailVerifiedAt: now,
      password: hashPassword(password),
      nickname,
      role,
      status: 'active',
      pwdVersion: 1,
      authMethods: ['password', 'email'],
      createdAt: now,
    }
    s.users.push(user)
    createDefaultCategories(user.id)
    save()
    ok(res, asUser(user))
  } catch (err) {
    next(err)
  }
})

/** 修改用户（昵称 / 角色 / 状态 / 重置密码） */
router.put('/users/:id', (req, res, next) => {
  try {
    const s = db()
    const user = s.users.find((u) => u.id === Number(req.params.id))
    if (!user) fail('用户不存在', 404, 'NOT_FOUND')

    if (req.body?.nickname !== undefined) user.nickname = assertNickname(req.body.nickname)
    if (req.body?.email !== undefined) {
      const email = assertEmail(req.body.email)
      const other = s.users.find(
        (u) => u.id !== user.id && u.email && normalizeEmail(u.email) === email,
      )
      assert(!other, '该邮箱已被其他用户使用', 409)
      user.email = email
      user.emailVerifiedAt = new Date().toISOString()
      if (!Array.isArray(user.authMethods)) user.authMethods = ['password']
      if (!user.authMethods.includes('email')) user.authMethods.push('email')
    }
    if (req.body?.role !== undefined) {
      const role = assertEnum(req.body.role, ['user', 'admin'], '角色不合法')
      // 不能把最后一个管理员降级，否则后台将无人可管
      if (user.role === 'admin' && role !== 'admin') {
        const admins = s.users.filter((u) => u.role === 'admin' && u.status === 'active')
        assert(admins.length > 1, '至少保留一名管理员', 400)
      }
      // 也不允许管理员把自己降级（当前登录者会立刻失去权限）
      assert(!(user.id === req.user.id && role !== 'admin'), '不能修改自己的角色')
      user.role = role
    }
    if (req.body?.status !== undefined) {
      const status = assertEnum(req.body.status, ['active', 'disabled'], '状态不合法')
      assert(!(user.id === req.user.id && status === 'disabled'), '不能停用当前登录的账号')
      user.status = status
    }
    if (req.body?.password) {
      const pwd = assertPassword(req.body.password)
      user.password = hashPassword(pwd)
      user.pwdVersion = Number(user.pwdVersion || 0) + 1
    }
    save()
    ok(res, asUser(user))
  } catch (err) {
    next(err)
  }
})

/** 删除用户：连同该用户的分类 / 记录 / 预算一并清除 */
router.delete('/users/:id', (req, res, next) => {
  try {
    const s = db()
    const id = Number(req.params.id)
    const idx = s.users.findIndex((u) => u.id === id)
    if (idx < 0) fail('用户不存在', 404, 'NOT_FOUND')
    assert(id !== req.user.id, '不能删除当前登录的账号')
    if (s.users[idx].role === 'admin') {
      assert(
        s.users.filter((u) => u.role === 'admin' && u.id !== id).length > 0,
        '至少保留一名管理员',
        400,
      )
    }
    s.users.splice(idx, 1)
    s.categories = s.categories.filter((c) => c.userId !== Number(req.params.id))
    s.records = s.records.filter((r) => r.userId !== Number(req.params.id))
    s.budgets = s.budgets.filter((b) => b.userId !== Number(req.params.id))
    save()
    ok(res, { deleted: true })
  } catch (err) {
    next(err)
  }
})

/**
 * 全平台记录检索已移除。
 * PRD 4.1 明确「登录后只能访问当前用户自己的分类、账目和预算」，
 * 而逐条浏览他人私人记账与该原则冲突；后台改为只提供聚合分析数据。
 */

/** 用户活跃度排行（按记录数 / 支出金额） */
router.get('/ranking', (req, res, next) => {
  try {
    const by = req.query.by === 'expense' ? 'expense' : 'records'
    const list = db()
      .users.filter((u) => u.role !== 'admin' || db().records.some((r) => r.userId === u.id))
      .map((u) => ({ ...asUser(u), ...recordStatsOf(u.id) }))
      .sort((a, b) => (by === 'expense' ? b.totalExpense - a.totalExpense : b.recordCount - a.recordCount))
      .slice(0, 10)
    ok(res, list)
  } catch (err) {
    next(err)
  }
})

export default router
