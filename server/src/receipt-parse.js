/**
 * 小票 OCR 文本 → 金额 / 日期 / 商户。
 *
 * 纯函数，不依赖数据库和 OCR 引擎，方便单独测试。
 * OCR 结果一定有噪声，所以这里只做「最可能的猜测」：金额优先取
 * 实付/合计附近的数字，日期优先取完整年月日，商户取最像店名的首行。
 * 最终仍由用户在页面上核对。
 */
import { today } from './utils.js'

const LABEL_PRIORITIES = [
  { re: /(实付|实收|实际支付|支付金额|付款金额|已付)/, priority: 5 },
  { re: /(应付|应收|应付款)/, priority: 4 },
  { re: /(合计|总计|共计|总额|消费金额|金额)/, priority: 3 },
]

const MERCHANT_SKIP =
  /(小票|发票|收据|欢迎|谢谢|地址|电话|日期|时间|单号|流水|收银|客户|备注|会员|支付|微信|支付宝|现金|找零|优惠|折扣|税率|税额|商品|数量|单价|金额|合计|总计|实付|应付|扫描|二维码)/

function normalize(text) {
  return String(text || '')
    // Tesseract 常在汉字之间插入空格：「星 巴 克 咖 啡」→「星巴克咖啡」，
    // 否则「合 计」「实 付」这类标签和分类关键词都会匹配不到。
    // 只合并同一行内的空格，不能把换行也吃掉，否则商户行会粘到欢迎语上
    .replace(/([㐀-鿿])[^\S\r\n]+(?=[㐀-鿿])/g, '$1')
    .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[￥]/g, '¥')
    .replace(/　/g, ' ')
    // OCR 常把千分位识别成逗号，先还原成纯数字
    .replace(/(\d)[,](?=\d{3}(?:\D|$))/g, '$1')
}

/** 给云端提示词和分类匹配用的清洗文本：去掉汉字之间的 OCR 空格 */
export function normalizeOcrText(text) {
  return normalize(text)
}

const pad = (n) => String(n).padStart(2, '0')

function validDate(y, m, d) {
  const dt = new Date(y, m - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d
}

function firstAmount(text) {
  const re = /(\d{1,7}(?:\.\d{1,2})?)/g
  let m
  while ((m = re.exec(text))) {
    const value = Number(m[1])
    if (!(value > 0) || value > 1_000_000) continue

    const before = text.slice(0, m.index)
    const after = text.slice(m.index + m[1].length)
    // 排除时间 12:34、日期 10月/10日、百分比、序号
    if (/^[:：]/.test(after)) continue
    if (/^[年月日时分秒%折]/.test(after)) continue
    if (/第\s*$/.test(before)) continue
    if (/\d$/.test(before)) continue
    return { value, raw: m[1] }
  }
  return null
}

function findAmount(text, lines) {
  // 1. 标签附近（实付 > 应付 > 合计/金额）
  let best = null
  for (const { re, priority } of LABEL_PRIORITIES) {
    for (const line of lines) {
      const label = line.match(re)
      if (!label) continue
      const hit = firstAmount(line.slice(label.index + label[0].length))
      if (!hit) continue
      const candidate = { ...hit, priority, basis: 'label', label: label[0] }
      if (
        !best ||
        candidate.priority > best.priority ||
        (candidate.priority === best.priority && candidate.value > best.value)
      ) {
        best = candidate
      }
    }
    // 已经找到更高优先级的标签，就不再看更低优先级
    if (best) break
  }
  if (best) return best

  // 2. 货币符号后的金额
  const currency = []
  const reCurrency = /[¥]\s*(\d{1,7}(?:\.\d{1,2})?)/g
  let m
  while ((m = reCurrency.exec(text))) {
    const value = Number(m[1])
    if (value > 0 && value <= 1_000_000) currency.push({ value, raw: m[1], basis: 'currency' })
  }
  if (currency.length) {
    return currency.reduce((a, b) => (b.value > a.value ? b : a))
  }

  // 3.「32 元」这类带单位的写法
  const yuan = text.match(/(\d{1,7}(?:\.\d{1,2})?)\s*元/)
  if (yuan) {
    const value = Number(yuan[1])
    if (value > 0) return { value, raw: yuan[1], basis: 'yuan' }
  }

  // 4. 最后才用两位小数兜底（排除日期、时间、订单号）
  const decimals = []
  const reDecimal = /(?<![\d.])(\d{1,6}\.\d{2})(?![\d.])/g
  while ((m = reDecimal.exec(text))) {
    const value = Number(m[1])
    if (!(value > 0) || value > 1_000_000) continue
    decimals.push({ value, raw: m[1], basis: 'decimal' })
  }
  if (decimals.length) {
    return decimals.reduce((a, b) => (b.value > a.value ? b : a))
  }

  return null
}

function findDate(text, baseDate) {
  let m = text.match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*[日号]?/)
  if (m) {
    const y = Number(m[1])
    const mo = Number(m[2])
    const d = Number(m[3])
    if (validDate(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`
  }

  // 没有年份的「10月26日」；不解析 10.26，避免把金额 3.20 当成日期
  m = text.match(/(?<!\d)(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/)
  if (m) {
    const y = Number(baseDate.slice(0, 4))
    const mo = Number(m[1])
    const d = Number(m[2])
    if (validDate(y, mo, d)) {
      const candidate = `${y}-${pad(mo)}-${pad(d)}`
      // 1 月收到去年 12 月的小票是常见情况
      if (candidate > baseDate) {
        const previous = `${y - 1}-${pad(mo)}-${pad(d)}`
        if (previous <= baseDate) return previous
      }
      return candidate
    }
  }

  return baseDate
}

function findMerchant(lines) {
  for (const line of lines.slice(0, 8)) {
    const clean = line
      .replace(/^[\s*#\-—·]+|[\s*#\-—·]+$/g, '')
      .replace(/\s*[¥￥]?\d{1,7}(?:\.\d{1,2})?\s*元?$/, '')
      .trim()
    if (clean.length < 2 || clean.length > 30) continue
    if (MERCHANT_SKIP.test(clean)) continue
    if (!/[一-龥A-Za-z]/.test(clean)) continue
    if ((clean.match(/\d/g) || []).length > clean.length / 2) continue
    return clean
  }
  return '小票消费'
}

/**
 * @param {string} text OCR 原始文本
 * @param {string} baseDate 兜底日期 YYYY-MM-DD
 * @returns {{ amount: string, amountCents: number, date: string, merchant: string, basis: string|null }}
 */
export function extractReceiptFields(text, baseDate = today()) {
  const normalized = normalize(text)
  const lines = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const amount = findAmount(normalized, lines)
  return {
    amount: amount ? amount.value.toFixed(2) : '',
    amountCents: amount ? Math.round(amount.value * 100) : 0,
    date: findDate(normalized, baseDate),
    merchant: findMerchant(lines),
    basis: amount?.basis || null,
  }
}
