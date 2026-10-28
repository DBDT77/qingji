/**
 * AI 辅助记账单元测试。
 * 不依赖数据库和外部网络：解析器、问答、小票文本解析都按纯函数测试；
 * 云端适配器用本机临时 HTTP 服务模拟 OpenAI 兼容接口。
 *
 *   cd server
 *   npm run test:ai
 */
import http from 'node:http'
import { answerQuestion, parseText } from './src/ai.js'
import { normalizeModelPayload } from './src/ai-llm.js'
import { chatCompletion, cloudQuota, extractJson } from './src/ai-provider.js'
import { extractReceiptFields, normalizeOcrText } from './src/receipt-parse.js'

let pass = 0
let fail = 0
const failures = []

function check(name, cond, extra = '') {
  if (cond) {
    pass += 1
    console.log(`  ok  ${name}`)
  } else {
    fail += 1
    failures.push(name)
    console.log(`  FAIL ${name} ${extra}`)
  }
}

const categories = [
  { id: 1, name: '餐饮', type: 'expense', icon: '🍜', color: '#FF7A45' },
  { id: 2, name: '交通', type: 'expense', icon: '🚌', color: '#40A9FF' },
  { id: 3, name: '购物', type: 'expense', icon: '🛍️', color: '#F759AB' },
  { id: 4, name: '医疗', type: 'expense', icon: '💊', color: '#FF4D4F' },
  { id: 5, name: '人情', type: 'expense', icon: '🎁', color: '#FFA930' },
  { id: 6, name: '其他支出', type: 'expense', icon: '📦', color: '#8C8C8C' },
  { id: 7, name: '工资', type: 'income', icon: '💰', color: '#52C41A' },
  { id: 8, name: '红包', type: 'income', icon: '🎁', color: '#EB2F96' },
  { id: 9, name: '其他收入', type: 'income', icon: '✨', color: '#13C2C2' },
]

const baseDate = '2026-10-26'

console.log('\n=== 1. 自然语言解析 ===')
const multi = parseText('昨天午饭 35，打车 22', categories, baseDate)
check('一句话解析出两笔', multi.drafts.length === 2, JSON.stringify(multi.drafts))
check('第一笔是餐饮 35', multi.drafts[0]?.categoryName === '餐饮' && multi.drafts[0]?.amount === '35.00')
check('第二笔是交通 22', multi.drafts[1]?.categoryName === '交通' && multi.drafts[1]?.amount === '22.00')
check('昨天日期正确', multi.drafts.every((d) => d.date === '2026-10-25'), JSON.stringify(multi.drafts.map((d) => d.date)))

const salary = parseText('工资 8000', categories, baseDate)
check('工资识别为收入', salary.drafts[0]?.type === 'income' && salary.drafts[0]?.categoryName === '工资')
check('工资金额 8000', salary.drafts[0]?.amount === '8000.00')

const dateText = parseText('10月5日超市 128', categories, baseDate)
check('绝对日期正确', dateText.drafts[0]?.date === '2026-10-05', JSON.stringify(dateText.drafts[0]))
check('超市归到购物', dateText.drafts[0]?.categoryName === '购物', dateText.drafts[0]?.categoryName)
check('日期数字没有当成金额', dateText.drafts[0]?.amount === '128.00', dateText.drafts[0]?.amount)

const twoPeople = parseText('两个人午饭 35', categories, baseDate)
check('人数不当作金额', twoPeople.drafts[0]?.amount === '35.00', twoPeople.drafts[0]?.amount)

const medicine = parseText('买药 30', categories, baseDate)
check('买药归到医疗', medicine.drafts[0]?.categoryName === '医疗', medicine.drafts[0]?.categoryName)

const giveRed = parseText('发红包 200', categories, baseDate)
check('发红包是支出/人情', giveRed.drafts[0]?.type === 'expense' && giveRed.drafts[0]?.categoryName === '人情')

const getRed = parseText('收红包 200', categories, baseDate)
check('收红包是收入/红包', getRed.drafts[0]?.type === 'income' && getRed.drafts[0]?.categoryName === '红包')

const fallback = parseText('乱七八糟 50', categories, baseDate)
check('无关键词回退其他支出', fallback.drafts[0]?.categoryName === '其他支出')
check('无关键词置信度低', fallback.drafts[0]?.confidence === 'low')

const noAmount = parseText('今天心情不错', categories, baseDate)
check('没有金额进入 errors', noAmount.drafts.length === 0 && noAmount.errors.length === 1, JSON.stringify(noAmount))

const thousands = parseText('房租 1,000', categories, baseDate)
check('千分位金额正确', thousands.drafts[0]?.amount === '1000.00', thousands.drafts[0]?.amount)

const quantity = parseText('3份外卖 45', categories, baseDate)
check('数量词不当作金额', quantity.drafts[0]?.amount === '45.00', quantity.drafts[0]?.amount)

console.log('\n=== 2. 聚合问答 ===')
const stats = {
  month: '2026-10',
  income: 1638000,
  expense: 421600,
  balance: 1216400,
  count: 6,
  top: { categoryId: 4, categoryName: '居住', amount: 346600, percent: 82.2 },
  budget: { amount: 800000, spent: 421600, remaining: 378400, percent: 52.7, status: 'normal' },
  prev: { month: '2026-09', income: 1600000, expense: 350000, balance: 1250000, count: 5 },
}

const askExpense = answerQuestion('本月花了多少', stats).reply
check('问答：本月支出', askExpense.includes('¥4,216.00'), askExpense)
const askTop = answerQuestion('哪类花得最多', stats).reply
check('问答：最大分类', askTop.includes('居住') && askTop.includes('82.2%'), askTop)
const askBudget = answerQuestion('预算还剩多少', stats).reply
check('问答：预算剩余', askBudget.includes('¥3,784.00'), askBudget)
const askCompare = answerQuestion('和上月对比', stats).reply
check('问答：环比', askCompare.includes('比上月多'), askCompare)
const askAdvice = answerQuestion('怎么省钱', stats).reply
check('问答：建议', askAdvice.includes('居住'), askAdvice)
const askFallback = answerQuestion('今天天气怎么样', stats).reply
check('问答：兜底提示', askFallback.includes('本月花了多少'), askFallback)
check('固定问题标记为本地已命中', answerQuestion('本月花了多少', stats).matched === true)
check('未知问题标记为未命中', answerQuestion('今天天气怎么样', stats).matched === false)

console.log('\n=== 3. 小票 OCR 文本解析 ===')
const ocrDemo = `星巴克咖啡
2026年10月26日 12:34
拿铁 32.00
合计 32.00
微信支付 32.00`
const fields = extractReceiptFields(ocrDemo, baseDate)
check('识别商户', fields.merchant === '星巴克咖啡', fields.merchant)
check('识别金额 32', fields.amount === '32.00', fields.amount)
check('识别日期', fields.date === '2026-10-26', fields.date)
check('金额取自标签', fields.basis === 'label', fields.basis)

const noisy = `欢迎光临
好又多超市
2026/10/25
面包 12.50
牛奶 18.00
总计 30.50
找零 0.50`
const noisyFields = extractReceiptFields(noisy, baseDate)
check('嘈杂小票取总计金额', noisyFields.amount === '30.50', noisyFields.amount)
check('嘈杂小票跳过欢迎语', noisyFields.merchant === '好又多超市', noisyFields.merchant)

const noAmountText = extractReceiptFields('星巴克咖啡\n欢迎光临', baseDate)
check('没有金额时返回空', noAmountText.amount === '' && noAmountText.amountCents === 0)

const spaced = `星 巴 克 咖 啡
2026 年 10 月 26 日 12:34
拿 铁 32.00
合 计 32.00
实 付 32.00`
const spacedFields = extractReceiptFields(spaced, baseDate)
check('清理汉字之间的 OCR 空格', spacedFields.merchant === '星巴克咖啡', spacedFields.merchant)
check(
  '清理空格后能识别合计标签',
  spacedFields.amount === '32.00' && spacedFields.basis === 'label',
  JSON.stringify(spacedFields),
)
check('normalizeOcrText 可单独用于分类关键词匹配', normalizeOcrText('星 巴 克 咖 啡') === '星巴克咖啡')

console.log('\n=== 4. 云端返回归一化 ===')
const fenced = extractJson('```json\n{"drafts":[]}\n```')
check('剥离 Markdown 代码块', Boolean(fenced) && Array.isArray(fenced.drafts))
check('非 JSON 返回 null', extractJson('今天天气不错') === null)

const norm = normalizeModelPayload(
  {
    drafts: [
      { type: 'expense', amount: 35, category: '交通', date: '', note: '打车', raw: '打车35' },
      { type: 'income', amount: '8,000.00', category: '工资', date: '2026-10-01', note: '工资' },
      { type: 'expense', amount: 'abc', category: '餐饮', note: '坏金额' },
    ],
    errors: [{ text: '心情不错', reason: '没有金额' }],
  },
  { text: '打车35，工资8000', categories, baseDate },
)
check('金额数字归一化为两位小数', norm.drafts[0]?.amount === '35.00', norm.drafts[0]?.amount)
check('分类按名称匹配到 id', norm.drafts[0]?.categoryId === 2, String(norm.drafts[0]?.categoryId))
check('缺失日期用今天', norm.drafts[0]?.date === baseDate, norm.drafts[0]?.date)
check(
  '千分位金额和收入类型正确',
  norm.drafts[1]?.amount === '8000.00' && norm.drafts[1]?.type === 'income',
  JSON.stringify(norm.drafts[1]),
)
check('非法金额进入 errors', norm.errors.some((e) => e.reason.includes('金额')))
check('保留模型自己的 errors', norm.errors.some((e) => e.reason === '没有金额'))

const unknownCat = normalizeModelPayload(
  { drafts: [{ type: 'expense', amount: '19', category: '不存在的分类', note: '瑞幸咖啡' }] },
  { text: '瑞幸咖啡 19', categories, baseDate },
)
check(
  '未知分类按关键词回退并标记低置信度',
  unknownCat.drafts[0]?.categoryName === '餐饮' && unknownCat.drafts[0]?.confidence === 'low',
  JSON.stringify(unknownCat.drafts[0]),
)

console.log('\n=== 5. 云端适配器（本机假服务） ===')
const mockServer = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    const data = JSON.parse(body || '{}')
    const okReq =
      req.url === '/v1/chat/completions' &&
      /^Bearer test-key$/.test(req.headers.authorization || '') &&
      data.model === 'mock-model'
    res.writeHead(okReq ? 200 : 400, { 'Content-Type': 'application/json' })
    res.end(
      JSON.stringify(
        okReq
          ? { choices: [{ message: { content: 'pong' } }] }
          : { error: { message: 'bad request' } },
      ),
    )
  })
})
await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve))
const mockPort = mockServer.address().port
process.env.AI_PROVIDER = 'openai'
process.env.AI_BASE_URL = `http://127.0.0.1:${mockPort}/v1`
process.env.AI_API_KEY = 'test-key'
process.env.AI_MODEL = 'mock-model'
process.env.AI_TIMEOUT_MS = '3000'
const pong = await chatCompletion([{ role: 'user', content: 'ping' }], { maxTokens: 10 })
check('适配器按 OpenAI 协议调用并返回文本', pong === 'pong', pong)
check('云端调用计入每日额度', cloudQuota().used >= 1, JSON.stringify(cloudQuota()))
mockServer.close()

process.env.AI_DAILY_CLOUD_LIMIT = '1'
let quotaError = null
try {
  await chatCompletion([{ role: 'user', content: 'ping again' }], { maxTokens: 10 })
} catch (err) {
  quotaError = err
}
delete process.env.AI_DAILY_CLOUD_LIMIT
check('每日额度用完后拒绝云端调用', quotaError?.code === 'AI_DAILY_LIMIT', String(quotaError))

console.log(`\n结果：${pass} 通过，${fail} 失败`)
if (fail) {
  console.log('失败项：')
  failures.forEach((n) => console.log(` - ${n}`))
  process.exitCode = 1
}
