import { Router } from 'express'
import { db, nextId, save } from '../db.js'
import { requireAuth, ok } from '../middleware.js'
import { assert, assertMonth } from '../utils.js'

const router = Router()
router.use(requireAuth)

/** 预算金额：>= 0，最多 2 位小数 */
function parseBudget(raw) {
  const text = String(raw ?? '').trim()
  assert(text.length > 0, '请输入预算金额')
  assert(/^\d+(\.\d{1,2})?$/.test(text), '预算金额格式不正确，最多保留 2 位小数')
  const cents = Math.round(Number(text) * 100)
  assert(Number.isFinite(cents) && cents >= 0, '预算金额必须大于或等于 0')
  assert(cents <= 99999999999, '预算金额超出可记录范围')
  return cents
}

function spentOf(userId, month) {
  return db()
    .records.filter((r) => r.userId === userId && r.type === 'expense' && r.date.startsWith(month))
    .reduce((sum, r) => sum + r.amount, 0)
}

function view(budget, userId, month) {
  const spent = spentOf(userId, month)
  if (!budget) {
    return { month, amount: null, spent, remaining: null, percent: null, status: 'unset' }
  }
  const remaining = budget.amount - spent
  const percent = budget.amount > 0 ? Math.round((spent / budget.amount) * 1000) / 10 : spent > 0 ? 100 : 0
  let status = 'normal'
  if (budget.amount === 0) status = spent > 0 ? 'exceeded' : 'normal'
  else if (spent > budget.amount) status = 'exceeded'
  else if (spent === budget.amount) status = 'reached'
  else if (spent / budget.amount >= 0.8) status = 'warning'
  return {
    month,
    amount: budget.amount,
    amountYuan: budget.amount / 100,
    spent,
    spentYuan: spent / 100,
    remaining,
    remainingYuan: remaining / 100,
    percent,
    status,
  }
}

/** 某月预算（未设置时 amount 为 null，前端显示"未设置"） */
router.get('/', (req, res, next) => {
  try {
    const month = req.query.month ? assertMonth(req.query.month) : new Date().toISOString().slice(0, 7)
    const budget = db().budgets.find((b) => b.userId === req.user.id && b.month === month)
    ok(res, view(budget, req.user.id, month))
  } catch (err) {
    next(err)
  }
})

/** 设置 / 更新预算（upsert） */
router.put('/', (req, res, next) => {
  try {
    const month = assertMonth(req.body?.month)
    const amount = parseBudget(req.body?.amount)
    const s = db()
    let budget = s.budgets.find((b) => b.userId === req.user.id && b.month === month)
    const now = new Date().toISOString()
    if (budget) {
      budget.amount = amount
      budget.updatedAt = now
    } else {
      budget = {
        id: nextId('budgets'),
        userId: req.user.id,
        month,
        amount,
        createdAt: now,
        updatedAt: now,
      }
      s.budgets.push(budget)
    }
    save()
    ok(res, view(budget, req.user.id, month))
  } catch (err) {
    next(err)
  }
})

/** 删除预算（恢复为"未设置"） */
router.delete('/', (req, res, next) => {
  try {
    const month = assertMonth(req.query.month)
    const s = db()
    const idx = s.budgets.findIndex((b) => b.userId === req.user.id && b.month === month)
    if (idx >= 0) s.budgets.splice(idx, 1)
    save()
    ok(res, view(null, req.user.id, month))
  } catch (err) {
    next(err)
  }
})

export default router
