import { Router } from 'express'
import { db, nextId, save } from '../db.js'
import { requireAuth, ok } from '../middleware.js'
import {
  assert,
  assertDate,
  assertMonth,
  assertNote,
  assertType,
  toInt,
  fail,
} from '../utils.js'

const router = Router()
router.use(requireAuth)

/** 金额校验：>0，最多 2 位小数，转成「分」存储 */
function parseAmount(raw, { allowZero = false } = {}) {
  const text = String(raw ?? '').trim()
  assert(text.length > 0, '请输入金额')
  assert(/^\d+(\.\d{1,2})?$/.test(text), '金额格式不正确，最多保留 2 位小数')
  const cents = Math.round(Number(text) * 100)
  assert(Number.isFinite(cents), '金额格式不正确')
  assert(allowZero ? cents >= 0 : cents > 0, allowZero ? '金额不能为负数' : '金额必须大于 0')
  assert(cents <= 99999999999, '金额超出可记录范围')
  return cents
}

/** 校验分类属于当前用户，且与记录类型一致 */
function resolveCategory(userId, categoryId, type) {
  const cat = db().categories.find((c) => c.id === Number(categoryId) && c.userId === userId)
  if (!cat) fail('分类不存在', 404, 'CATEGORY_NOT_FOUND')
  assert(cat.type === type, '所选分类与记录类型不匹配')
  return cat
}

/** 统一的列表查询：月份 / 类型 / 分类 / 关键字 / 分页 */
function queryRecords(req, { paginate = true } = {}) {
  const s = db()
  const { month, startDate, endDate } = req.query
  const type = req.query.type ? assertType(req.query.type) : null
  const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null
  const keyword = String(req.query.keyword || '').trim()

  let list = s.records.filter((r) => r.userId === req.user.id)

  if (month) {
    const m = assertMonth(month)
    list = list.filter((r) => r.date.startsWith(m))
  }
  if (startDate) {
    const from = assertDate(startDate, '开始日期')
    list = list.filter((r) => r.date >= from)
  }
  if (endDate) {
    const to = assertDate(endDate, '结束日期')
    list = list.filter((r) => r.date <= to)
  }
  if (type) list = list.filter((r) => r.type === type)
  if (categoryId) list = list.filter((r) => r.categoryId === categoryId)
  if (keyword) {
    const kw = keyword.toLowerCase()
    list = list.filter(
      (r) =>
        String(r.note || '').toLowerCase().includes(kw) ||
        (s.categories.find((c) => c.id === r.categoryId)?.name || '').toLowerCase().includes(kw),
    )
  }

  // PRD 4.3：按发生日期倒序；同一天按创建时间倒序
  list.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))

  const total = list.length
  const catMap = new Map(s.categories.map((c) => [c.id, c]))
  const withCat = (r) => {
    const cat = catMap.get(r.categoryId)
    return {
      ...r,
      categoryName: cat?.name || '已删除分类',
      categoryIcon: cat?.icon || '❓',
      categoryColor: cat?.color || '#8C8C8C',
      amountYuan: Math.round(r.amount) / 100,
    }
  }

  if (!paginate) return { total, items: list.map(withCat), raw: list }

  const page = toInt(req.query.page, 1, { min: 1, max: 100000 })
  const pageSize = toInt(req.query.pageSize, 20, { min: 1, max: 100 })
  const items = list.slice((page - 1) * pageSize, page * pageSize).map(withCat)
  return { total, page, pageSize, items }
}

/** 记录列表 */
router.get('/', (req, res, next) => {
  try {
    ok(res, queryRecords(req))
  } catch (err) {
    next(err)
  }
})

/** 单条记录 */
router.get('/:id', (req, res, next) => {
  try {
    const s = db()
    const r = s.records.find((x) => x.id === Number(req.params.id) && x.userId === req.user.id)
    if (!r) fail('记录不存在', 404, 'NOT_FOUND')
    const cat = s.categories.find((c) => c.id === r.categoryId)
    ok(res, {
      ...r,
      categoryName: cat?.name || '已删除分类',
      categoryIcon: cat?.icon || '❓',
      categoryColor: cat?.color || '#8C8C8C',
      amountYuan: Math.round(r.amount) / 100,
    })
  } catch (err) {
    next(err)
  }
})

/** 新增记录 */
router.post('/', (req, res, next) => {
  try {
    const type = assertType(req.body?.type)
    const amount = parseAmount(req.body?.amount)
    const categoryId = Number(req.body?.categoryId)
    assert(Number.isFinite(categoryId) && categoryId > 0, '请选择分类')
    resolveCategory(req.user.id, categoryId, type)
    const date = assertDate(req.body?.date)
    const note = assertNote(req.body?.note)

    const now = new Date().toISOString()
    const record = {
      id: nextId('records'),
      userId: req.user.id,
      categoryId,
      type,
      amount,
      date,
      note,
      createdAt: now,
      updatedAt: now,
    }
    db().records.push(record)
    save()
    ok(res, record)
  } catch (err) {
    next(err)
  }
})

/** 修改记录 */
router.put('/:id', (req, res, next) => {
  try {
    const s = db()
    const r = s.records.find((x) => x.id === Number(req.params.id) && x.userId === req.user.id)
    if (!r) fail('记录不存在', 404, 'NOT_FOUND')

    const type = req.body?.type === undefined ? r.type : assertType(req.body.type)
    const amount = req.body?.amount === undefined ? r.amount : parseAmount(req.body.amount)
    const categoryId =
      req.body?.categoryId === undefined ? r.categoryId : Number(req.body.categoryId)
    assert(Number.isFinite(categoryId) && categoryId > 0, '请选择分类')
    resolveCategory(req.user.id, categoryId, type)
    const date = req.body?.date === undefined ? r.date : assertDate(req.body.date)
    const note = req.body?.note === undefined ? r.note : assertNote(req.body.note)

    Object.assign(r, { type, amount, categoryId, date, note, updatedAt: new Date().toISOString() })
    save()
    ok(res, r)
  } catch (err) {
    next(err)
  }
})

/** 删除记录（前端会先弹确认） */
router.delete('/:id', (req, res, next) => {
  try {
    const s = db()
    const idx = s.records.findIndex(
      (x) => x.id === Number(req.params.id) && x.userId === req.user.id,
    )
    if (idx < 0) fail('记录不存在', 404, 'NOT_FOUND')
    s.records.splice(idx, 1)
    save()
    ok(res, { deleted: true })
  } catch (err) {
    next(err)
  }
})

export default router
