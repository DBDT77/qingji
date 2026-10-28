/**
 * AI 辅助记账的「本地规则」层。
 *
 * 不调用任何外部模型时的兜底能力：
 * - 自然语言记账：规则解析「昨天午饭 35，打车 22」这类文本
 * - 智能分类：关键词 + 用户自己的分类列表匹配
 * - 问答：只基于聚合统计回答「本月花了多少 / 哪类最多 / 预算还剩多少」
 *
 * 配置了免费云模型时，ai-llm.js 会优先调用模型；模型超时/限流/返回不合法
 * 时再回退到这里。小票识别由 ocr.js（Tesseract）负责，不再返回假数据。
 */
import { db } from './db.js'
import { currentMonth, today } from './utils.js'

const SPLIT_RE = /[\n,，;；。]+/

const INCOME_WORDS = [
  '工资', '薪资', '奖金', '绩效', '年终奖', '收入', '报销', '退款', '兼职', '外包',
  '稿费', '私活', '理财', '基金', '股票', '利息', '分红', '收益', '中奖', '收到',
]

const EXPENSE_WORDS = [
  '支出', '花了', '花', '付了', '付', '买了', '买', '交', '缴费', '还款', '转出',
  '房租', '打车', '吃饭', '外卖', '购物', '请客',
]

/**
 * 关键词 → 默认分类名。
 * 用户改过分类名也不影响：先按用户自己的分类名精确匹配，匹配不到再走这里。
 */
const CATEGORY_KEYWORDS = {
  餐饮: [
    '早饭', '早餐', '午饭', '午餐', '晚饭', '晚餐', '吃饭', '外卖', '奶茶', '咖啡',
    '星巴克', '餐厅', '火锅', '快餐', '食堂', '聚餐', '零食', '水果', '夜宵', '烧烤',
    '麦当劳', '肯德基',
  ],
  交通: [
    '打车', '滴滴', '出租车', '地铁', '公交', '加油', '停车', '高铁', '火车', '机票',
    '车票', '过路费', '共享单车',
  ],
  购物: ['超市', '淘宝', '京东', '拼多多', '衣服', '鞋', '日用品', '化妆品', '数码', '家电', '购物', '快递', '网购'],
  居住: ['房租', '租房', '物业', '水电', '燃气', '宽带', '话费', '流量', '家具', '维修'],
  娱乐: ['电影', '游戏', '唱歌', 'KTV', '演出', '门票', '会员', '健身', '旅游', '酒店', '订阅'],
  医疗: ['医院', '看病', '药', '体检', '挂号', '牙', '诊所'],
  学习: ['书', '课程', '学费', '培训', '考试', '文具', '网课'],
  人情: ['礼物', '随礼', '礼金', '请客', '发红包', '给红包', '送礼'],
  其他支出: ['其他', '保险', '宠物', '理发', '洗衣', '捐款'],
  工资: ['工资', '薪资', '发薪'],
  奖金: ['奖金', '绩效', '年终奖'],
  理财: ['理财', '基金', '股票', '利息', '分红', '收益'],
  兼职: ['兼职', '外包', '稿费', '私活'],
  红包: ['收红包', '收到红包', '红包'],
  其他收入: ['其他收入', '报销', '退款', '中奖', '收到'],
}

const pad = (n) => String(n).padStart(2, '0')

function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function shiftDate(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  return fmtDate(new Date(y, m - 1, d + days))
}

function shiftMonthStr(month, offset) {
  const [y, m] = String(month).split('-').map(Number)
  const d = new Date(y, m - 1 + offset, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

function validDate(y, m, d) {
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

/** 金额（分）→ 千分位字符串，不带货币符号 */
export function fmtMoney(cents) {
  const yuan = Math.round(Number(cents) || 0) / 100
  const [intPart, dec] = yuan.toFixed(2).split('.')
  return `${intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${dec}`
}

function detectType(segment) {
  if (/发红包|给红包|送红包/.test(segment)) return 'expense'
  if (/收红包|收到红包/.test(segment)) return 'income'
  if (segment.includes('收入')) return 'income'
  if (segment.includes('支出')) return 'expense'
  if (segment.includes('红包')) return 'income'
  if (INCOME_WORDS.some((w) => segment.includes(w))) return 'income'
  if (EXPENSE_WORDS.some((w) => segment.includes(w))) return 'expense'
  return 'expense'
}

function extractDate(segment, baseDate) {
  for (const [word, offset] of [
    ['大前天', -3],
    ['前天', -2],
    ['昨天', -1],
    ['今天', 0],
  ]) {
    if (segment.includes(word)) {
      return { date: shiftDate(baseDate, offset), cleaned: segment.replace(word, ' '), matched: word }
    }
  }

  let m = segment.match(/(\d{4})\s*[-/年]\s*(\d{1,2})\s*[-/月]\s*(\d{1,2})\s*[日号]?/)
  if (m && validDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
    return {
      date: `${m[1]}-${pad(Number(m[2]))}-${pad(Number(m[3]))}`,
      cleaned: segment.replace(m[0], ' '),
      matched: m[0],
    }
  }

  m = segment.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/)
  if (m) {
    const y = Number(baseDate.slice(0, 4))
    const mo = Number(m[1])
    const d = Number(m[2])
    if (validDate(y, mo, d)) {
      return {
        date: `${y}-${pad(mo)}-${pad(d)}`,
        cleaned: segment.replace(m[0], ' '),
        matched: m[0],
      }
    }
  }

  return { date: baseDate, cleaned: segment, matched: '' }
}

/**
 * 取第一个像金额的数字。
 * 跳过「2个人」「3份」「5号」「10月」里的数量词和日期残留，
 * 避免把「两个人午饭 35」解析成 2 元。
 */
function extractAmount(cleaned) {
  const re = /(\d{1,8}(?:\.\d{1,2})?)/g
  let m
  while ((m = re.exec(cleaned))) {
    const numText = m[1]
    const after = cleaned.slice(m.index + numText.length)
    if (/^[人个份次位岁天号月日]/.test(after)) continue
    const before = cleaned.slice(0, m.index)
    if (/第\s*$/.test(before)) continue
    const value = Number(numText)
    if (!(value > 0)) continue
    return { text: numText, value }
  }
  return null
}

export function pickCategory(segment, type, categories) {
  const typed = categories.filter((c) => c.type === type)
  if (!typed.length) return null

  // 用户自己的分类名优先；长名字优先，避免「餐饮」被「餐」抢先
  const explicit = [...typed]
    .sort((a, b) => String(b.name).length - String(a.name).length)
    .find((c) => segment.includes(c.name))
  if (explicit) return { category: explicit, confidence: 'high' }

  for (const [name, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (!words.some((w) => segment.includes(w))) continue
    const cat = typed.find((c) => c.name === name)
    if (cat) return { category: cat, confidence: 'high' }
  }

  const fallback =
    typed.find((c) => c.name === (type === 'income' ? '其他收入' : '其他支出')) ||
    typed[typed.length - 1]
  return { category: fallback, confidence: 'low' }
}

/**
 * 云端模型只返回分类「名称」，这里翻回用户自己的分类对象。
 * 先精确匹配，再互相包含，最后用关键词表兜底；都匹配不到返回 null，
 * 宁可让调用方回退，也不把一笔账塞进错误的分类。
 */
export function categoryByName(name, type, categories) {
  const typed = categories.filter((c) => c.type === type)
  const clean = String(name || '').trim()
  if (!clean || !typed.length) return null

  const exact = typed.find((c) => c.name === clean)
  if (exact) return exact

  const loose = [...typed]
    .sort((a, b) => String(b.name).length - String(a.name).length)
    .find((c) => clean.includes(c.name) || c.name.includes(clean))
  if (loose) return loose

  const guessed = pickCategory(clean, type, categories)
  return guessed?.confidence === 'high' ? guessed.category : null
}

function cleanNote(segment, dateText, amountText) {
  let note = segment
  if (dateText) note = note.replace(dateText, ' ')
  if (amountText) note = note.replace(amountText, ' ')
  note = note
    .replace(/[¥￥$]/g, ' ')
    .replace(/(元|块钱|块|毛|角)/g, ' ')
    .replace(/^(今天|昨天|前天|大前天|我|花了|花|付了|付|收到|收入|支出|买了|买)\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[，,、。；;：:\s]+|[，,、。；;：:\s]+$/g, '')
  return note.slice(0, 100)
}

/**
 * 解析自然语言记账文本。
 * 纯函数，便于单元测试：categories 由调用方传入。
 *
 * @returns {{ drafts: Array, errors: Array, source: 'rule' }}
 */
export function parseText(text, categories, baseDate = today()) {
  const normalized = String(text || '').replace(/(\d),(?=\d{3}\b)/g, '$1')
  const segments = normalized
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean)

  const drafts = []
  const errors = []
  // 「昨天午饭 35，打车 22」这种写法里，日期只出现一次，但应作用于整句话。
  // 记住最近一次识别到的日期，后续没有日期词的片段沿用。
  let sharedDate = null

  for (const segment of segments) {
    const dateInfo = extractDate(segment, sharedDate || baseDate)
    if (dateInfo.matched) sharedDate = dateInfo.date
    const type = detectType(segment)
    const amountInfo = extractAmount(dateInfo.cleaned)

    if (!amountInfo) {
      errors.push({ text: segment, reason: '没有识别到金额' })
      continue
    }

    const catInfo = pickCategory(segment, type, categories)
    if (!catInfo?.category) {
      errors.push({ text: segment, reason: '没有可用分类，请先在分类管理里添加一个' })
      continue
    }

    const amount = Math.round(amountInfo.value * 100) / 100
    if (!(amount > 0) || amount > 99999999.99) {
      errors.push({ text: segment, reason: '金额超出可记录范围' })
      continue
    }

    const note = cleanNote(segment, dateInfo.matched, amountInfo.text) || catInfo.category.name

    drafts.push({
      type,
      amount: amount.toFixed(2),
      amountCents: Math.round(amount * 100),
      categoryId: catInfo.category.id,
      categoryName: catInfo.category.name,
      categoryIcon: catInfo.category.icon,
      categoryColor: catInfo.category.color,
      date: dateInfo.date,
      note,
      confidence: catInfo.confidence,
      raw: segment,
    })
  }

  return { drafts, errors, source: 'rule' }
}

/** 某用户某月的聚合数据，只用于本地问答，不包含逐笔备注 */
export function buildStats(userId, month = currentMonth()) {
  const s = db()
  const rows = s.records.filter((r) => r.userId === userId && String(r.date).startsWith(month))
  const income = rows.filter((r) => r.type === 'income').reduce((a, r) => a + r.amount, 0)
  const expense = rows.filter((r) => r.type === 'expense').reduce((a, r) => a + r.amount, 0)

  // 「哪类花得最多」只看支出分类，不能把工资/红包等收入混进占比
  const byCategory = new Map()
  for (const r of rows) {
    if (r.type !== 'expense') continue
    const cat = s.categories.find((c) => c.id === r.categoryId)
    const key = r.categoryId
    if (!byCategory.has(key)) {
      byCategory.set(key, {
        categoryId: r.categoryId,
        categoryName: cat?.name || '未分类',
        amount: 0,
      })
    }
    byCategory.get(key).amount += r.amount
  }
  const categories = [...byCategory.values()]
    .map((c) => ({
      ...c,
      percent: expense > 0 ? Math.round((c.amount / expense) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount)

  const budget = s.budgets.find((b) => b.userId === userId && b.month === month) || null
  let budgetInfo = null
  if (budget) {
    const percent = budget.amount > 0 ? Math.round((expense / budget.amount) * 1000) / 10 : 0
    let status = 'normal'
    if (expense > budget.amount) status = 'exceeded'
    else if (expense === budget.amount) status = 'reached'
    else if (percent >= 80) status = 'warning'
    budgetInfo = {
      amount: budget.amount,
      spent: expense,
      remaining: budget.amount - expense,
      percent,
      status,
    }
  }

  const prevMonth = shiftMonthStr(month, -1)
  const prevRows = s.records.filter(
    (r) => r.userId === userId && String(r.date).startsWith(prevMonth),
  )
  const prevIncome = prevRows.filter((r) => r.type === 'income').reduce((a, r) => a + r.amount, 0)
  const prevExpense = prevRows.filter((r) => r.type === 'expense').reduce((a, r) => a + r.amount, 0)

  return {
    month,
    income,
    expense,
    balance: income - expense,
    count: rows.length,
    categories,
    top: categories[0] || null,
    budget: budgetInfo,
    prev: {
      month: prevMonth,
      income: prevIncome,
      expense: prevExpense,
      balance: prevIncome - prevExpense,
      count: prevRows.length,
    },
  }
}

function compareText(stats) {
  const diff = stats.expense - stats.prev.expense
  if (!stats.prev.expense) {
    return `上月没有支出记录；本月支出 ¥${fmtMoney(stats.expense)}。`
  }
  const pct = Math.round((Math.abs(diff) / stats.prev.expense) * 1000) / 10
  const word = diff >= 0 ? '多' : '少'
  return `本月支出比上月${word} ¥${fmtMoney(Math.abs(diff))}（${pct}%）：本月 ¥${fmtMoney(
    stats.expense,
  )}，上月 ¥${fmtMoney(stats.prev.expense)}。`
}

/**
 * 本地问答：只基于聚合统计，不读取或上传逐笔明细。
 *
 * matched=false 表示本地规则不知道这个问题，调用方可以再尝试云端模型；
 * matched=true 的答案已经足够准确，没必要再花一次免费额度。
 */
export function answerQuestion(message, stats) {
  const text = String(message || '').trim()
  const lower = text.toLowerCase()

  if (!text) return { reply: '想了解本月支出、分类占比还是预算情况？', matched: true }

  if (/哪类|哪个分类|最多|花得最多|支出最多/.test(text)) {
    if (!stats.top) return { reply: '本月还没有支出记录，先记一笔吧。', matched: true }
    return {
      reply: `本月支出最多的是「${stats.top.categoryName}」，¥${fmtMoney(stats.top.amount)}，占总支出的 ${stats.top.percent}%。`,
      matched: true,
    }
  }

  if (/预算|超支|还能花|剩余/.test(text)) {
    if (!stats.budget) {
      return {
        reply: '本月还没有设置预算。可以在「月度预算」里设一个上限，我可以帮你盯着。',
        matched: true,
      }
    }
    if (stats.budget.remaining < 0) {
      return {
        reply: `本月已经超出预算 ¥${fmtMoney(Math.abs(stats.budget.remaining))}：已花 ¥${fmtMoney(
          stats.budget.spent,
        )} / 预算 ¥${fmtMoney(stats.budget.amount)}（${stats.budget.percent}%）。`,
        matched: true,
      }
    }
    return {
      reply: `本月预算 ¥${fmtMoney(stats.budget.amount)}，已花 ¥${fmtMoney(
        stats.budget.spent,
      )}，还可花 ¥${fmtMoney(stats.budget.remaining)}（${stats.budget.percent}%）。`,
      matched: true,
    }
  }

  if (/上月|上个月|环比|对比|比上/.test(text)) {
    return { reply: compareText(stats), matched: true }
  }

  if (/几笔|多少笔|记录数|笔数/.test(text)) {
    return {
      reply: `本月一共记了 ${stats.count} 笔，其中支出 ¥${fmtMoney(stats.expense)}，收入 ¥${fmtMoney(stats.income)}。`,
      matched: true,
    }
  }

  if (/结余|剩多少|存款/.test(text)) {
    return {
      reply: `本月结余 ¥${fmtMoney(stats.balance)}（收入 ¥${fmtMoney(stats.income)} - 支出 ¥${fmtMoney(
        stats.expense,
      )}）。`,
      matched: true,
    }
  }

  if (/收入/.test(text)) {
    return { reply: `本月收入 ¥${fmtMoney(stats.income)}。`, matched: true }
  }

  if (/支出|花了多少|花多少|花费/.test(text)) {
    return {
      reply: `本月支出 ¥${fmtMoney(stats.expense)}，收入 ¥${fmtMoney(stats.income)}，结余 ¥${fmtMoney(stats.balance)}。`,
      matched: true,
    }
  }

  if (/建议|省钱|怎么省|怎么控制|控制一下|怎么办/.test(text)) {
    const tips = []
    if (stats.top && stats.top.percent >= 40) {
      tips.push(`「${stats.top.categoryName}」占本月支出的 ${stats.top.percent}%，可以重点看看这一类。`)
    }
    if (stats.budget?.status === 'exceeded') {
      tips.push('本月已经超支，建议先暂停非必要支出，或调整预算。')
    } else if (stats.budget?.status === 'warning') {
      tips.push(`预算已用 ${stats.budget.percent}%，接下来注意控制。`)
    } else if (!stats.budget) {
      tips.push('本月还没有预算，建议先设一个支出上限。')
    }
    if (!tips.length) tips.push('可以从减少高频小额支出开始，比如外卖、打车和零食。')
    return { reply: tips.join('\n'), matched: true }
  }

  if (/你好|hi|hello|嗨/.test(lower)) {
    return {
      reply: '你好，我是轻记的本地 AI 助手。你可以问我：本月花了多少、哪类花得最多、预算还剩多少、和上月对比。',
      matched: true,
    }
  }

  return {
    reply:
      '本地规则模式可以回答：本月花了多少、哪类花得最多、预算还剩多少、和上月对比。也可以直接说「昨天午饭 35」让我帮你记账。配置云端 AI 后可以用自然语言问更多问题。',
    matched: false,
  }
}

export const AI_SUGGESTIONS = [
  '本月花了多少',
  '哪类花得最多',
  '预算还剩多少',
  '和上月对比',
  '这个月哪天花得最多',
]
