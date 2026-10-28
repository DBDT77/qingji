import { Router } from 'express'
import { db, nextId, save } from '../db.js'
import { requireAuth, ok } from '../middleware.js'
import { assert, assertType, fail } from '../utils.js'

const router = Router()
router.use(requireAuth)

const NAME_MAX = 10

function assertName(name) {
  const value = String(name ?? '').trim()
  assert(value.length > 0, '请输入分类名称')
  assert(value.length <= NAME_MAX, `分类名称不能超过 ${NAME_MAX} 个字`)
  return value
}

/** 当前用户的分类列表；?type=income|expense 过滤 */
router.get('/', (req, res, next) => {
  try {
    const type = req.query.type ? assertType(req.query.type) : null
    const list = db()
      .categories.filter((c) => c.userId === req.user.id && (!type || c.type === type))
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.id - b.id)
    ok(res, list)
  } catch (err) {
    next(err)
  }
})

/** 新增自定义分类 */
router.post('/', (req, res, next) => {
  try {
    const type = assertType(req.body?.type)
    const name = assertName(req.body?.name)
    const s = db()
    const dup = s.categories.some(
      (c) => c.userId === req.user.id && c.type === type && c.name === name,
    )
    assert(!dup, '同类型下已有同名分类', 409)

    const cat = {
      id: nextId('categories'),
      userId: req.user.id,
      name,
      type,
      icon: String(req.body?.icon || '🏷️').slice(0, 4),
      color: /^#[0-9A-Fa-f]{6}$/.test(req.body?.color || '') ? req.body.color : '#8C8C8C',
      isDefault: false,
      createdAt: new Date().toISOString(),
    }
    s.categories.push(cat)
    save()
    ok(res, cat)
  } catch (err) {
    next(err)
  }
})

/** 修改分类 */
router.put('/:id', (req, res, next) => {
  try {
    const cat = db().categories.find(
      (c) => c.id === Number(req.params.id) && c.userId === req.user.id,
    )
    if (!cat) fail('分类不存在', 404, 'NOT_FOUND')

    const type = req.body?.type === undefined ? cat.type : assertType(req.body.type)
    const name = req.body?.name === undefined ? cat.name : assertName(req.body.name)
    const s = db()
    const dup = s.categories.some(
      (c) => c.id !== cat.id && c.userId === req.user.id && c.type === type && c.name === name,
    )
    assert(!dup, '同类型下已有同名分类', 409)

    // 系统默认分类允许改名/换图标，但不允许改类型（改了会让历史记录分类错位）
    if (cat.isDefault && type !== cat.type) {
      fail('系统默认分类不能修改类型', 400, 'DEFAULT_TYPE_LOCKED')
    }
    // 自定义分类改类型时，必须没有历史记录引用，否则记录的类型会和分类不一致
    if (!cat.isDefault && type !== cat.type) {
      const used = s.records.some((r) => r.categoryId === cat.id)
      assert(!used, '该分类下已有记录，不能修改类型', 400)
    }

    cat.name = name
    cat.type = type
    if (req.body?.icon !== undefined) cat.icon = String(req.body.icon || '🏷️').slice(0, 4)
    if (req.body?.color !== undefined && /^#[0-9A-Fa-f]{6}$/.test(req.body.color)) {
      cat.color = req.body.color
    }
    save()
    ok(res, cat)
  } catch (err) {
    next(err)
  }
})

/** 删除分类：被记录引用的不允许删除（PRD 4.4） */
router.delete('/:id', (req, res, next) => {
  try {
    const s = db()
    const idx = s.categories.findIndex(
      (c) => c.id === Number(req.params.id) && c.userId === req.user.id,
    )
    if (idx < 0) fail('分类不存在', 404, 'NOT_FOUND')

    const cat = s.categories[idx]
    // PRD 4.4：已被收支记录使用的分类不得直接删除，必须提示用户先调整相关记录
    const usedCount = s.records.filter((r) => r.categoryId === cat.id).length
    if (usedCount > 0) {
      fail(`该分类下还有 ${usedCount} 条记录，请先调整这些记录的分类后再删除`, 409, 'CATEGORY_IN_USE')
    }

    s.categories.splice(idx, 1)
    save()
    ok(res, { deleted: true })
  } catch (err) {
    next(err)
  }
})

export default router
