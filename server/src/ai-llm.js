/**
 * 云端模型的业务层：提示词、结构化输出校验、失败回退所需的归一化。
 *
 * 隐私边界：
 * - 文字解析只发送「当前这段输入 + 用户自己的分类名称」
 * - 问答只发送「月度聚合统计 + 当前问题」，不发送逐笔备注
 * - 小票只发送「本地 OCR 出来的文字」，不发送原图
 */
import { aiConfig } from './config.js'
import { chatCompletion, extractJson } from './ai-provider.js'
import { categoryByName, fmtMoney, pickCategory } from './ai.js'
import { extractReceiptFields } from './receipt-parse.js'
import { today } from './utils.js'

const pad = (n) => String(n).padStart(2, '0')

function validDate(y, m, d) {
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

function parseAmountToCents(value) {
  const text = String(value ?? '')
    .replace(/[¥￥,，\s元]/g, '')
    .trim()
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text)) return null
  const cents = Math.round(Number(text) * 100)
  if (!(cents > 0) || cents > 99_999_999_999) return null
  return cents
}

function normalizeDate(value, baseDate) {
  const text = String(value || '').trim()
  if (!text) return { date: baseDate, valid: true }

  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2])
    const d = Number(m[3])
    if (validDate(y, mo, d)) return { date: `${y}-${pad(mo)}-${pad(d)}`, valid: true }
  }

  m = text.match(/^(\d{1,2})[-/月](\d{1,2})日?$/)
  if (m) {
    const y = Number(baseDate.slice(0, 4))
    const mo = Number(m[1])
    const d = Number(m[2])
    if (validDate(y, mo, d)) {
      let candidate = `${y}-${pad(mo)}-${pad(d)}`
      if (candidate > baseDate && validDate(y - 1, mo, d)) {
        candidate = `${y - 1}-${pad(mo)}-${pad(d)}`
      }
      return { date: candidate, valid: true }
    }
  }

  return { date: baseDate, valid: false }
}

function categoryLines(categories) {
  const expense = categories.filter((c) => c.type === 'expense').map((c) => c.name)
  const income = categories.filter((c) => c.type === 'income').map((c) => c.name)
  return `支出分类：${expense.join('、') || '（无）'}\n收入分类：${income.join('、') || '（无）'}`
}

function parsePrompt(baseDate, categories) {
  return `你是「轻记」的记账解析助手。今天是 ${baseDate}。
把用户输入拆成一笔或多笔收支草稿。只输出 JSON，不要 Markdown，不要解释。

输出格式：
{"drafts":[{"type":"expense","amount":"35.00","category":"餐饮","date":"YYYY-MM-DD","note":"午饭","raw":"昨天午饭 35","confidence":"high"}],"errors":[{"text":"原文","reason":"原因"}]}

规则：
1. type 只能是 expense（支出）或 income（收入）。
2. amount 是大于 0 的数字字符串，最多两位小数，不要带货币符号或千分位。
3. category 只能从下面的分类名里选，并且必须与 type 一致，不要输出分类 id。
4. date 用 YYYY-MM-DD；今天/昨天/上周五等相对日期按今天换算；没说日期就用今天。
5. 没有明确金额的片段放进 errors，不要编造金额。
6. 一句话里有多笔就输出多笔，共享的日期应用到每一笔。
7. 分类或日期不确定时 confidence 填 low。

${categoryLines(categories)}`
}

/**
 * 把模型返回的 JSON 归一化成接口使用的草稿。
 * 模型输出不可信：金额、类型、分类、日期全部重新校验。
 */
export function normalizeModelPayload(payload, { text, categories, baseDate }) {
  const list = Array.isArray(payload) ? payload : payload?.drafts
  const drafts = []
  const errors = []

  if (!Array.isArray(list)) {
    return {
      drafts,
      errors: [{ text: String(text || '').slice(0, 60), reason: '模型返回格式不正确' }],
    }
  }

  for (const item of list.slice(0, 20)) {
    const raw = String(item?.raw || item?.text || '').trim().slice(0, 200) || String(text).slice(0, 200)
    const cents = parseAmountToCents(item?.amount)
    if (!cents) {
      errors.push({ text: raw || '未命名片段', reason: '没有识别到有效金额' })
      continue
    }

    const type = item?.type === 'income' ? 'income' : 'expense'
    let low = item?.confidence === 'low'

    let category = categoryByName(item?.category || item?.categoryName, type, categories)
    if (!category) {
      const guessed = pickCategory(`${item?.note || ''} ${raw}`, type, categories)
      category = guessed?.category || null
      low = true
    }
    if (!category) {
      errors.push({ text: raw, reason: '没有可用的分类' })
      continue
    }

    const dateInfo = normalizeDate(item?.date, baseDate)
    if (!dateInfo.valid) low = true

    const note =
      String(item?.note || raw || category.name)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100) || category.name

    const amount = (cents / 100).toFixed(2)
    drafts.push({
      type,
      amount,
      amountCents: cents,
      categoryId: category.id,
      categoryName: category.name,
      categoryIcon: category.icon,
      categoryColor: category.color,
      date: dateInfo.date,
      note,
      confidence: low ? 'low' : 'high',
      raw: raw.slice(0, 100),
    })
  }

  for (const err of Array.isArray(payload?.errors) ? payload.errors.slice(0, 10) : []) {
    if (typeof err === 'string') {
      errors.push({ text: err.slice(0, 80), reason: '模型未识别' })
    } else if (err?.reason) {
      errors.push({
        text: String(err.text || '').slice(0, 80),
        reason: String(err.reason).slice(0, 80),
      })
    }
  }

  return { drafts, errors }
}

/** 云端解析；未配置或模型没给出草稿时由调用方回退本地规则 */
export async function parseWithCloud(text, categories, baseDate = today()) {
  if (!aiConfig().configured || !categories.length) return null

  const raw = await chatCompletion(
    [
      { role: 'system', content: parsePrompt(baseDate, categories) },
      { role: 'user', content: String(text).slice(0, 2000) },
    ],
    { temperature: 0.1, maxTokens: 900 },
  )

  const payload = extractJson(raw)
  if (!payload) throw new Error('模型返回内容无法解析为 JSON')

  const result = normalizeModelPayload(payload, { text, categories, baseDate })
  if (!result.drafts.length && !result.errors.length) {
    throw new Error('模型没有返回任何草稿')
  }
  return { ...result, source: 'cloud' }
}

function promptStats(stats) {
  const money = (cents) => `¥${fmtMoney(cents)}`
  return {
    month: stats.month,
    income: money(stats.income),
    expense: money(stats.expense),
    balance: money(stats.balance),
    recordCount: stats.count,
    categories: stats.categories.slice(0, 10).map((c) => ({
      name: c.categoryName,
      amount: money(c.amount),
      percent: `${c.percent}%`,
    })),
    budget: stats.budget
      ? {
          amount: money(stats.budget.amount),
          spent: money(stats.budget.spent),
          remaining: money(stats.budget.remaining),
          percent: `${stats.budget.percent}%`,
          status: stats.budget.status,
        }
      : null,
    previousMonth: {
      month: stats.prev.month,
      income: money(stats.prev.income),
      expense: money(stats.prev.expense),
      balance: money(stats.prev.balance),
      recordCount: stats.prev.count,
    },
  }
}

/** 云端问答；只发送聚合统计，不发送逐笔账目 */
export async function answerWithCloud(message, stats) {
  if (!aiConfig().configured) return null

  const system = `你是「轻记」的记账助手。今天是 ${today()}，当前统计月份是 ${stats.month}。
只能依据下面的月度聚合统计回答，不要编造不存在的记录、分类或金额。
统计里没有逐笔备注；用户问“具体某天买了什么”时，说明只能看到月度汇总，并建议去账单页查看。
用中文回答，1-3 句，简洁直接。金额已经格式化，直接引用，不要自己换算或编造。
如果用户问省钱建议，给 1-2 条具体、克制的建议，不要说教。

统计 JSON：
${JSON.stringify(promptStats(stats), null, 2)}`

  const reply = await chatCompletion(
    [
      { role: 'system', content: system },
      { role: 'user', content: String(message).slice(0, 500) },
    ],
    { temperature: 0.3, maxTokens: 500 },
  )
  return reply.trim().slice(0, 800) || null
}

/** 基于本地 OCR 文本生成草稿（不依赖云端） */
export function receiptFromOcr(ocr, categories, baseDate = today()) {
  const typed = categories.filter((c) => c.type === 'expense')
  if (!typed.length) {
    return {
      drafts: [],
      errors: [{ text: '小票', reason: '还没有可用分类，请先在分类管理里添加一个' }],
      source: 'ocr',
      notice: '小票识别失败：没有可用的支出分类。',
    }
  }

  const fields = extractReceiptFields(ocr.text, baseDate)
  if (!fields.amountCents) {
    return {
      drafts: [],
      errors: [
        {
          text: '小票文字',
          reason: '没有识别到金额，请换一张更清晰的图片，或切到「文字记账」手动记一笔',
        },
      ],
      source: 'ocr',
      notice: `本地 OCR 识别完成（置信度 ${Math.round(ocr.confidence)}%），但没有找到金额。`,
    }
  }

  const byName = categoryByName(fields.merchant, 'expense', categories)
  const guessed = byName
    ? { category: byName, confidence: 'high' }
    : pickCategory(ocr.text.slice(0, 800), 'expense', categories)
  const category = guessed?.category
  if (!category) {
    return {
      drafts: [],
      errors: [{ text: fields.merchant, reason: '无法匹配支出分类' }],
      source: 'ocr',
      notice: '小票识别完成，但没有匹配到分类，请手动选择。',
    }
  }

  const low =
    ocr.confidence < 65 ||
    !['label', 'currency', 'yuan'].includes(fields.basis) ||
    guessed.confidence === 'low'

  return {
    drafts: [
      {
        type: 'expense',
        amount: fields.amount,
        amountCents: fields.amountCents,
        categoryId: category.id,
        categoryName: category.name,
        categoryIcon: category.icon,
        categoryColor: category.color,
        date: fields.date,
        note: fields.merchant,
        confidence: low ? 'low' : 'high',
        raw: `OCR · ${fields.merchant} · ${fields.amount}`,
      },
    ],
    errors: [],
    source: 'ocr',
    notice: `本地 OCR 识别（置信度 ${Math.round(ocr.confidence)}%）：金额、日期和商户请核对后再保存。`,
  }
}

/**
 * 用云端模型从 OCR 文本里再提取一次（OCR 常有错位，模型更会找“实付”）。
 * 未配置或模型没给出金额时返回 null，由调用方使用本地 OCR 结果。
 */
export async function receiptFromCloud(ocr, categories, baseDate = today()) {
  if (!aiConfig().configured || !categories.length) return null

  const system = `你在解析一张小票的 OCR 文本。OCR 可能有错字、顺序错乱、数字粘连。
只输出 JSON，不要 Markdown，不要解释：
{"amount":"32.00","date":"YYYY-MM-DD","merchant":"店名","category":"分类名","note":"备注"}

规则：
1. amount 取实付/合计金额，必须大于 0；找不到就输出空字符串，不要猜。
2. date 用 YYYY-MM-DD；缺失或不确定就用 ${baseDate}。
3. merchant 是店名，尽量去掉“小票/收据/欢迎光临”等字样。
4. category 只能从下面的支出分类里选。
5. note 是简短备注，可写主要商品。

${categoryLines(categories)}`

  const raw = await chatCompletion(
    [
      { role: 'system', content: system },
      { role: 'user', content: String(ocr.text).slice(0, 3000) },
    ],
    { temperature: 0.1, maxTokens: 300 },
  )

  const payload = extractJson(raw)
  if (!payload) throw new Error('模型返回内容无法解析为 JSON')

  const cents = parseAmountToCents(payload.amount)
  if (!cents) return null

  const byName = categoryByName(payload.category, 'expense', categories)
  const guessed = byName
    ? { category: byName, confidence: 'high' }
    : pickCategory(`${payload.merchant || ''} ${payload.note || ''} ${ocr.text.slice(0, 500)}`, 'expense', categories)
  const category = guessed?.category
  if (!category) return null

  const dateInfo = normalizeDate(payload.date, baseDate)
  const merchant = String(payload.merchant || '').trim().slice(0, 30) || '小票消费'
  const note = String(payload.note || merchant).trim().slice(0, 100) || merchant
  const amount = (cents / 100).toFixed(2)

  // 金额在 OCR 原文里找不到时，可能是模型纠错，也可能是编造；标记低置信度让人工核对
  const plainText = String(ocr.text).replace(/[,，\s]/g, '')
  const amountSeen = [amount, amount.replace(/\.00$/, '')].some((v) => plainText.includes(v))

  const low =
    ocr.confidence < 65 ||
    !dateInfo.valid ||
    guessed.confidence === 'low' ||
    !amountSeen

  return {
    drafts: [
      {
        type: 'expense',
        amount,
        amountCents: cents,
        categoryId: category.id,
        categoryName: category.name,
        categoryIcon: category.icon,
        categoryColor: category.color,
        date: dateInfo.date,
        note,
        confidence: low ? 'low' : 'high',
        raw: `OCR + 云端 · ${merchant} · ${amount}`,
      },
    ],
    errors: [],
    source: 'ocr+cloud',
    notice: `本地 OCR + 云端模型提取（OCR 置信度 ${Math.round(
      ocr.confidence,
    )}%），请核对金额、日期和商户。`,
  }
}
