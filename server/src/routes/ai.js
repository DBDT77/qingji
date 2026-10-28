import { Router } from 'express'
import { db } from '../db.js'
import { aiConfig } from '../config.js'
import { requireAuth, ok } from '../middleware.js'
import { ApiError, assert } from '../utils.js'
import { AI_SUGGESTIONS, answerQuestion, buildStats, parseText } from '../ai.js'
import {
  answerWithCloud,
  parseWithCloud,
  receiptFromCloud,
  receiptFromOcr,
} from '../ai-llm.js'
import { cloudStatus, providerLabel } from '../ai-provider.js'
import { normalizeOcrText } from '../receipt-parse.js'
import { recognizeReceiptImage } from '../ocr.js'

const router = Router()

/**
 * 简单的内存级用量限制。
 * 免费云模型有自己的额度，本地规则也防刷，避免接口被当成免费解析器。
 */
const usage = new Map()
const LIMITS = { parse: 30, chat: 40, receipt: 10 }
const WINDOW = 60 * 60 * 1000

function checkQuota(userId, kind) {
  const now = Date.now()
  const rec = usage.get(userId) || {}
  const list = (rec[kind] || []).filter((t) => now - t < WINDOW)
  const limit = LIMITS[kind] || 30
  if (list.length >= limit) {
    throw new ApiError('AI 使用次数过多，请稍后再试', 429, 'AI_RATE_LIMITED')
  }
  list.push(now)
  rec[kind] = list
  usage.set(userId, rec)
}

function categoriesOf(userId) {
  return db().categories.filter((c) => c.userId === userId)
}

/** 当前 AI 通道状态：本地规则，或已配置的免费云模型 */
router.get('/status', requireAuth, (_req, res) => {
  const cfg = aiConfig()
  const cloud = cloudStatus()
  const cloudMode = cfg.configured
  ok(res, {
    provider: cloudMode ? cfg.provider : 'mock',
    label: cloudMode ? providerLabel(cfg.provider) : '本地规则',
    mode: cloudMode ? 'cloud' : 'rule',
    configured: cfg.configured,
    available: cloud.available,
    model: cloudMode ? cfg.model : null,
    ocr: {
      engine: 'tesseract.js',
      local: true,
      languages: ['chi_sim', 'eng'],
    },
    notice: !cloudMode
      ? '未配置云端 AI，当前使用本地规则；在 server/.env 填入 AI_API_KEY 即可启用免费云模型。'
      : cloud.quota.exhausted
        ? '今日云端调用额度已用完，正在自动使用本地规则。'
        : cloud.available
          ? '云端 AI 已启用：只发送当前输入、分类名称和月度聚合统计，不上传逐笔账目。'
          : '云端 AI 暂时不可用，正在自动使用本地规则。',
    modes: { chat: cfg.chatMode, receipt: cfg.receiptMode },
    quota: cloud.quota,
    suggestions: AI_SUGGESTIONS,
  })
})

/** 自然语言 → 可编辑的记账草稿（云端优先，失败自动回退规则） */
router.post('/parse', requireAuth, async (req, res, next) => {
  try {
    const text = String(req.body?.text || '').trim()
    assert(text.length > 0, '请输入要记账的内容')
    assert(text.length <= 2000, '一次最多解析 2000 个字符')
    checkQuota(req.user.id, 'parse')

    const categories = categoriesOf(req.user.id)
    let result = null
    let llmError = null

    try {
      result = await parseWithCloud(text, categories)
    } catch (err) {
      llmError = err
      console.warn('[ai] 云端解析失败，改用本地规则：', err.message)
    }

    if (!result?.drafts?.length) {
      const rule = parseText(text, categories)
      // 规则也解析不出来时才把两边的错误一起给用户；规则能解析就以规则结果为准
      result = rule.drafts.length
        ? rule
        : { ...rule, errors: [...(result?.errors || []), ...rule.errors].slice(0, 10) }
      result.notice = llmError
        ? '云端 AI 暂时不可用，已改用本地规则解析，请核对金额和分类。'
        : '本地规则解析完成，请核对金额和分类后再保存。'
    } else {
      result.notice = '云端 AI 生成草稿：只发送了这段文字和分类名称，请核对金额和分类。'
    }

    ok(res, result)
  } catch (err) {
    next(err)
  }
})

/**
 * 聚合问答：云端只读月度汇总；未配置时用本地规则。
 *
 * chatMode=auto（默认）：规则能答的固定问题直接本地回答，不花免费额度；
 * chatMode=cloud：仍然云端优先（质量更好，但更费额度）；
 * chatMode=rule：完全不调用云端。
 */
router.post('/chat', requireAuth, async (req, res, next) => {
  try {
    const message = String(req.body?.message || '').trim()
    assert(message.length > 0, '请输入问题')
    assert(message.length <= 500, '问题太长，请精简到 500 字以内')
    checkQuota(req.user.id, 'chat')

    const cfg = aiConfig()
    const stats = buildStats(req.user.id)
    const rule = answerQuestion(message, stats)
    let reply = null
    let source = 'rule'
    let notice
    let llmError = null

    const allowCloud = cfg.chatMode !== 'rule'
    const cloudFirst = cfg.chatMode === 'cloud'

    if (!cloudFirst && rule.matched) {
      reply = rule.reply
      notice = '本地规则回答：只使用本月聚合统计，未调用云端模型。'
    } else if (allowCloud) {
      try {
        reply = await answerWithCloud(message, stats)
      } catch (err) {
        llmError = err
        console.warn('[ai] 云端问答失败，改用本地规则：', err.message)
      }

      if (reply) {
        source = 'cloud'
        notice = '云端 AI：只发送了本月聚合统计和你的问题，没有逐笔备注。'
      } else {
        reply = rule.reply
        notice =
          llmError?.code === 'AI_DAILY_LIMIT'
            ? '今日云端额度已用完，已用本地规则回答。'
            : llmError
              ? '云端 AI 暂时不可用，已用本地规则回答。'
              : '本地规则模式：只使用本月聚合统计，不会上传逐笔账目。'
      }
    } else {
      reply = rule.reply
      notice = '本地规则模式：只使用本月聚合统计，不会上传逐笔账目。'
    }

    ok(res, {
      reply,
      source,
      suggestions: AI_SUGGESTIONS,
      notice,
      ...(source === 'cloud' ? { provider: cfg.provider, model: cfg.model } : {}),
    })
  } catch (err) {
    next(err)
  }
})

/**
 * 小票识别：本地 OCR 先用。
 *
 * receiptMode=auto（默认）：本地能提取出金额就不调云端，省免费额度；
 * receiptMode=cloud：始终再让云端从 OCR 文本里提取一次（更准，但更费额度）；
 * receiptMode=rule：完全不用云端，只信本地 OCR。
 */
router.post('/receipt', requireAuth, async (req, res, next) => {
  try {
    const image = String(req.body?.image || '')
    assert(image.length > 0, '请上传小票图片')
    assert(image.startsWith('data:image/'), '图片格式不正确')
    // 全局 JSON body 限制是 1MB，这里留出余量；前端会先压缩
    assert(image.length <= 700_000, '图片太大，请压缩到 700KB 以内再试')
    checkQuota(req.user.id, 'receipt')

    let ocr
    try {
      // Tesseract 会在汉字间插空格，先统一清洗，标签/分类关键词才匹配得到
      ocr = await recognizeReceiptImage(image)
      ocr = { ...ocr, text: normalizeOcrText(ocr.text) }
    } catch (err) {
      if (err instanceof ApiError) throw err
      console.error('[ai] OCR 失败：', err?.message || err)
      throw new ApiError('小票识别服务暂时不可用，请稍后重试或手动记一笔', 503, 'OCR_UNAVAILABLE')
    }

    if (!ocr.text.trim()) {
      ok(res, {
        drafts: [],
        errors: [{ text: '小票', reason: '没有识别到文字，请换一张更清晰、光线更均匀的图片' }],
        source: 'ocr',
        notice: '本地 OCR 没有读到文字，请重试或手动记一笔。',
      })
      return
    }

    const cfg = aiConfig()
    const categories = categoriesOf(req.user.id)
    const local = receiptFromOcr(ocr, categories)
    let result = null

    if (cfg.receiptMode === 'rule' || (cfg.receiptMode === 'auto' && local.drafts.length)) {
      result = local
      if (cfg.receiptMode === 'auto') {
        result = { ...local, notice: `${local.notice} 本地已提取到金额，未调用云端模型。` }
      }
    } else {
      try {
        result = await receiptFromCloud(ocr, categories)
      } catch (err) {
        console.warn('[ai] 云端小票提取失败，使用本地 OCR 结果：', err.message)
      }
      if (!result) result = local
    }

    ok(res, { ...result, ocrConfidence: Math.round(ocr.confidence) })
  } catch (err) {
    next(err)
  }
})

export default router
