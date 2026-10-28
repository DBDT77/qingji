import { Router } from 'express'
import { db } from '../db.js'
import { requireAuth, ok } from '../middleware.js'
import { assertDate, assertMonth, currentMonth, toInt } from '../utils.js'

const router = Router()
router.use(requireAuth)

const sum = (arr, pick = (x) => x.amount) => arr.reduce((s, x) => s + pick(x), 0)

function monthRecords(userId, month) {
  return db().records.filter((r) => r.userId === userId && r.date.startsWith(month))
}

/**
 * 统计口径：优先用日期区间，没有区间就退回整月。
 *
 * 为什么需要区间：账单页支持「点某一天 → 只看这天」，如果表头仍然按整月汇总，
 * 用户会看到「列表里只有 3 笔，表头却写着整天几千块」这种对不上的数字。
 */
function scopeRecords(req, { month, startDate, endDate }) {
  if (startDate || endDate) {
    const from = startDate ? assertDate(startDate, '开始日期') : '0000-01-01'
    const to = endDate ? assertDate(endDate, '结束日期') : '9999-12-31'
    return db().records.filter((r) => r.userId === req.user.id && r.date >= from && r.date <= to)
  }
  return monthRecords(req.user.id, month)
}

/** 分类维度汇总，按金额倒序 */
function breakdown(records, type, categories) {
  const map = new Map()
  for (const r of records) {
    if (r.type !== type) continue
    const cur = map.get(r.categoryId) || { categoryId: r.categoryId, amount: 0, count: 0 }
    cur.amount += r.amount
    cur.count += 1
    map.set(r.categoryId, cur)
  }
  const list = [...map.values()].sort((a, b) => b.amount - a.amount)
  const total = sum(list)
  const catMap = new Map(categories.map((c) => [c.id, c]))
  return list.map((item) => {
    const cat = catMap.get(item.categoryId)
    return {
      ...item,
      categoryName: cat?.name || '已删除分类',
      categoryIcon: cat?.icon || '❓',
      categoryColor: cat?.color || '#8C8C8C',
      amountYuan: item.amount / 100,
      // 占比按当期该类型总额计算，保留 1 位小数
      percent: total > 0 ? Math.round((item.amount / total) * 1000) / 10 : 0,
    }
  })
}

/** 某月每日收支（用于趋势柱状图） */
function dailyTrend(records, month) {
  const [y, m] = month.split('-').map(Number)
  const days = new Date(y, m, 0).getDate()
  const out = []
  for (let d = 1; d <= days; d += 1) {
    const date = `${month}-${String(d).padStart(2, '0')}`
    const dayRows = records.filter((r) => r.date === date)
    out.push({
      date,
      day: d,
      income: sum(dayRows.filter((r) => r.type === 'income')),
      expense: sum(dayRows.filter((r) => r.type === 'expense')),
    })
  }
  return out
}

function budgetView(userId, month) {
  const s = db()
  const budget = s.budgets.find((b) => b.userId === userId && b.month === month)
  const spent = sum(monthRecords(userId, month).filter((r) => r.type === 'expense'))
  if (!budget) return { month, amount: null, spent, percent: null, remaining: null, status: 'unset' }
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

/**
 * 首页概览：当月收支 + 预算状态 + 最近记录 + 近 6 个月趋势。
 * 一次请求把首页需要的数据全部返回，移动端少一次请求少一次等待。
 */
router.get('/overview', (req, res, next) => {
  try {
    const month = req.query.month ? assertMonth(req.query.month) : currentMonth()
    const s = db()
    const rows = monthRecords(req.user.id, month)
    const income = sum(rows.filter((r) => r.type === 'income'))
    const expense = sum(rows.filter((r) => r.type === 'expense'))
    const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
    const todayStr = new Date().toISOString().slice(0, 10)

    const recent = [...rows]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))
      .slice(0, 5)
      .map((r) => {
        const cat = s.categories.find((c) => c.id === r.categoryId)
        return {
          ...r,
          categoryName: cat?.name || '已删除分类',
          categoryIcon: cat?.icon || '❓',
          categoryColor: cat?.color || '#8C8C8C',
          amountYuan: r.amount / 100,
        }
      })

    // 趋势曲线：默认近 12 个月，让用户看到完整的一年起伏
    const trendMonths = toInt(req.query.trendMonths, 12, { min: 2, max: 24 })
    const trend = []
    for (let i = trendMonths - 1; i >= 0; i -= 1) {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - i)
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const mr = monthRecords(req.user.id, m)
      trend.push({
        month: m,
        income: sum(mr.filter((r) => r.type === 'income')),
        expense: sum(mr.filter((r) => r.type === 'expense')),
      })
    }

    ok(res, {
      month,
      income,
      expense,
      balance: income - expense,
      incomeYuan: income / 100,
      expenseYuan: expense / 100,
      balanceYuan: (income - expense) / 100,
      recordCount: rows.length,
      dailyAverage: Math.round(expense / daysInMonth),
      isCurrentMonth: month === todayStr.slice(0, 7),
      dayOfMonth: Number(todayStr.slice(8, 10)),
      budget: budgetView(req.user.id, month),
      topExpense: breakdown(rows, 'expense', s.categories).slice(0, 3),
      recent,
      trend,
    })
  } catch (err) {
    next(err)
  }
})

/** 统计页：月度汇总 + 分类占比 + 每日趋势（也用于账单页按日/按月的小结表头） */
router.get('/summary', (req, res, next) => {
  try {
    const month = req.query.month ? assertMonth(req.query.month) : currentMonth()
    const startDate = req.query.startDate || null
    const endDate = req.query.endDate || null
    const s = db()
    // 带日期区间时按区间汇总（账单页点某一天会用），否则按整月
    const rows = scopeRecords(req, { month, startDate, endDate })
    const income = sum(rows.filter((r) => r.type === 'income'))
    const expense = sum(rows.filter((r) => r.type === 'expense'))
    const daysInMonth = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate()
    const expenseRows = rows.filter((r) => r.type === 'expense')
    const biggest = expenseRows.reduce((max, r) => (r.amount > (max?.amount || 0) ? r : max), null)
    const biggestCat = biggest ? s.categories.find((c) => c.id === biggest.categoryId) : null
    const daysWithRecord = new Set(expenseRows.map((r) => r.date)).size

    ok(res, {
      month,
      startDate,
      endDate,
      income,
      expense,
      balance: income - expense,
      incomeYuan: income / 100,
      expenseYuan: expense / 100,
      balanceYuan: (income - expense) / 100,
      recordCount: rows.length,
      expenseCount: expenseRows.length,
      incomeCount: rows.length - expenseRows.length,
      daysInMonth,
      daysWithRecord,
      dailyAverage: daysWithRecord > 0 ? Math.round(expense / daysWithRecord) : 0,
      biggestExpense: biggest
        ? {
            ...biggest,
            amountYuan: biggest.amount / 100,
            categoryName: biggestCat?.name || '已删除分类',
          }
        : null,
      expenseByCategory: breakdown(rows, 'expense', s.categories),
      incomeByCategory: breakdown(rows, 'income', s.categories),
      daily: dailyTrend(rows, month),
      budget: budgetView(req.user.id, month),
    })
  } catch (err) {
    next(err)
  }
})

/** 多月份趋势对比 */
router.get('/trend', (req, res, next) => {
  try {
    const months = toInt(req.query.months, 6, { min: 2, max: 24 })
    const out = []
    for (let i = months - 1; i >= 0; i -= 1) {
      const d = new Date()
      d.setDate(1)
      d.setMonth(d.getMonth() - i)
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const rows = monthRecords(req.user.id, m)
      const income = sum(rows.filter((r) => r.type === 'income'))
      const expense = sum(rows.filter((r) => r.type === 'expense'))
      out.push({ month: m, income, expense, balance: income - expense })
    }
    ok(res, out)
  } catch (err) {
    next(err)
  }
})

export default router
