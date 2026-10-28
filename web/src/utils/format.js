/** 金额格式化：分 -> 元，千分位 + 两位小数 */
export function money(cents, { sign = false, symbol = true } = {}) {
  const value = Math.round(Number(cents || 0)) / 100
  const abs = Math.abs(value).toFixed(2)
  const [intPart, dec] = abs.split('.')
  const withComma = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  let signStr = ''
  if (sign) signStr = value > 0 ? '+' : value < 0 ? '-' : ''
  else if (value < 0) signStr = '-'
  return `${signStr}${withComma}.${dec}`
}

/** 2026-10-05 -> 10月5日 */
export function friendlyDate(date) {
  const [y, m, d] = String(date).split('-')
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`
  if (date === todayStr) return '今天'
  const yesterday = new Date(today.getTime() - 86400000)
  const yStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(
    yesterday.getDate(),
  ).padStart(2, '0')}`
  if (date === yStr) return '昨天'
  const thisYear = today.getFullYear()
  return Number(y) === thisYear ? `${Number(m)}月${Number(d)}日` : `${y}年${Number(m)}月${Number(d)}日`
}

/** 2026-10 -> 2026年10月 */
export function monthLabel(month) {
  const [y, m] = String(month).split('-')
  return `${y}年${Number(m)}月`
}

export function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function currentMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 月份加减，offset 为月数 */
export function shiftMonth(month, offset) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function isFutureMonth(month) {
  return month > currentMonthStr()
}

/** 生成最近 n 个月（含当前），升序 */
export function recentMonths(n = 12) {
  const out = []
  const now = new Date()
  for (let i = 0; i < n; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}
