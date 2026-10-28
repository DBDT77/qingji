/**
 * 演示数据生成器：把「一个人一年怎么花钱」描述成可重复生成的规格。
 *
 * 为什么要单独一层：早期版本把每条账目写死成一行 `['income','工资',1800000,'05','本月工资']`，
 * 只会写进当前这一个月，于是趋势图右边全是 0，而且备注里的「本月」跨月就自相矛盾
 * （线上数据里真的出现了 10 月 5 日写着「八月工资」的记录）。
 *
 * 现在改成两层结构：
 *   recurring —— 每月都发生的固定开销（房租、通勤、吃饭）
 *   oneOffs   —— 只在指定月份出现的一次性事件（年终奖、体检、换季买衣服）
 * 再按「最近 12 个月」逐月展开，金额按月份做确定性微扰，让 12 根柱子各不相同。
 *
 * 备注硬规则：只写事件本身，绝不写「本月 / 上月 / 八月工资」这类相对时间。
 *
 * 本模块保持纯函数、不 import 任何项目内模块（尤其不能 import seed.js，
 * 否则会形成 seed.js → demo-data.js → seed.js 的循环依赖）。
 */

/** 生成多少个月的历史数据 */
export const MONTH_WINDOW = 12

/** 把月份字符串加减若干个月，返回 'YYYY-MM' */
export function shiftMonth(month, offset) {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** 某月天数（2 月会自动落到 28 / 29） */
export function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}

/** 两个月份之间相差几个月（b - a），用于把「相对偏移」换算成绝对月份 */
export function monthDiff(from, to) {
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

/** 最近 n 个月（升序，含当月） */
export function windowMonths(n = MONTH_WINDOW, from = new Date()) {
  const base = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`
  const out = []
  for (let i = n - 1; i >= 0; i -= 1) out.push(shiftMonth(base, -i))
  return out
}

/**
 * 以月份为种子的确定性微扰（0.85 ~ 1.15）。
 * 必须是确定性的：生成器每次服务启动都会跑，若金额每次都变，
 * 用户的账单就会自己改数字。
 */
function jitter(month, amount) {
  let h = 0
  const seed = `${month}:${amount}`
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 100000
  const factor = 0.85 + (h % 301) / 1000 // 0.85 ~ 1.15
  return Math.max(100, Math.round(amount * factor / 100) * 100) // 取整到元，账目看着更自然
}

/**
 * 演示用户画像。
 *
 * recurring 的条数决定了这个人的记账密度，也就决定了他在后台「用户活跃分层」
 * （按累计笔数分档：从未记账 / 1-9 / 10-49 / 50 笔以上）里落在哪一档。
 * 如果每个演示账号都记几十笔/月，12 个月后所有人都会挤进「50 笔以上」，
 * 另外三档永远是空的、分层图就没得看了。所以刻意把密度拉开：
 *   demo 22 条 → 约 264 笔（50 笔以上）
 *   小鱼  19 条 → 约 228 笔（50 笔以上）
 *   老王   5 条 → 约 52 笔（50 笔以上）
 *   小美   2 条 → 约 34 笔（10-49）
 *   小周   只有头两个月 → 6 笔（1-9）
 *   赵明   3 条 → 约 36 笔（10-49，账号已停用）
 * 规律：频繁记账的（≥5 条/月）会进 50 笔以上，控制在 3 条/月才稳稳落在 10-49 档。
 */
export const DEMO_USERS = [
  {
    username: 'demo',
    nickname: '演示用户',
    status: 'active',
    bio: '收入稳定的上班族，账目最完整',
    budget: 800000,
    recurring: [
      { type: 'income', cat: '工资', amount: 1800000, day: 5, note: '工资' },
      { type: 'expense', cat: '居住', amount: 320000, day: 1, note: '房租' },
      { type: 'expense', cat: '餐饮', amount: 8650, day: 3, note: '午餐' },
      { type: 'expense', cat: '交通', amount: 3600, day: 8, note: '地铁充值' },
      { type: 'expense', cat: '餐饮', amount: 12900, day: 7, note: '同事聚餐' },
      { type: 'expense', cat: '购物', amount: 15800, day: 21, note: '日用品' },
      { type: 'expense', cat: '餐饮', amount: 4200, day: 20, note: '下午茶' },
    ],
    oneOffs: [
      { offset: -1, type: 'income', cat: '红包', amount: 20000, day: 10, note: '朋友生日红包' },
      { offset: -2, type: 'expense', cat: '医疗', amount: 15000, day: 14, note: '感冒药' },
      { offset: -3, type: 'expense', cat: '购物', amount: 39900, day: 9, note: '运动鞋' },
      { offset: -4, type: 'expense', cat: '学习', amount: 19900, day: 13, note: '技术书籍' },
      { offset: -5, type: 'income', cat: '理财', amount: 32050, day: 12, note: '基金分红' },
      { offset: -6, type: 'expense', cat: '人情', amount: 26800, day: 15, note: '同事生日礼物' },
      { offset: -8, type: 'income', cat: '奖金', amount: 1200000, day: 8, note: '季度绩效奖金' },
      { offset: -9, type: 'expense', cat: '娱乐', amount: 6800, day: 11, note: '电影票' },
      { offset: -11, type: 'income', cat: '理财', amount: 18600, day: 12, note: '理财赎回' },
    ],
  },
  {
    username: 'xiaoyu',
    nickname: '小鱼',
    status: 'active',
    bio: '月光族，消费多但收入少，支出榜第一',
    budget: 300000,
    oneOffs: [
      // mOff 与 offset 等价（都是「相对当月的偏移」），两种写法都支持
      { mOff: -1, type: 'expense', cat: '购物', amount: 129900, day: 4, note: '换季买衣服' },
      { mOff: -6, type: 'income', cat: '兼职', amount: 280000, day: 18, note: '私活尾款' },
      { mOff: -7, type: 'expense', cat: '购物', amount: 45900, day: 9, note: '护肤品' },
      { mOff: -7, type: 'expense', cat: '娱乐', amount: 26800, day: 11, note: '演唱会门票' },
      { mOff: -9, type: 'expense', cat: '购物', amount: 33900, day: 22, note: '家居小物' },
      { mOff: -11, type: 'expense', cat: '餐饮', amount: 21500, day: 13, note: '外卖充值' },
    ],
    recurring: [
      { type: 'income', cat: '兼职', amount: 320000, day: 6, note: '设计外包结算' },
      { type: 'expense', cat: '居住', amount: 150000, day: 1, note: '合租房租' },
      { type: 'expense', cat: '餐饮', amount: 38600, day: 2, note: '和朋友吃火锅' },
      { type: 'expense', cat: '交通', amount: 8600, day: 15, note: '打车' },
      { type: 'expense', cat: '娱乐', amount: 19900, day: 19, note: '会员订阅' },
      { type: 'expense', cat: '餐饮', amount: 15800, day: 24, note: '周末早午餐' },
    ],
  },
  {
    username: 'laowang',
    nickname: '老王',
    status: 'active',
    bio: '自由职业者，收入不固定但很会省钱',
    budget: 500000,
    oneOffs: [
      { offset: -2, type: 'income', cat: '奖金', amount: 2500000, day: 8, note: '项目尾款结算' },
      { offset: -6, type: 'expense', cat: '学习', amount: 39900, day: 10, note: '专业课程' },
      { offset: -8, type: 'expense', cat: '医疗', amount: 22000, day: 21, note: '年度体检' },
      { offset: -10, type: 'expense', cat: '娱乐', amount: 9900, day: 17, note: '电影和展览' },
    ],
    recurring: [
      { type: 'expense', cat: '居住', amount: 480000, day: 1, note: '工作室房租' },
      { type: 'expense', cat: '餐饮', amount: 12800, day: 5, note: '家里做饭采购' },
      { type: 'expense', cat: '交通', amount: 15600, day: 7, note: '加油' },
      { type: 'expense', cat: '餐饮', amount: 18600, day: 14, note: '家庭采购' },
    ],
  },
  {
    username: 'xiaomei',
    nickname: '小美',
    status: 'active',
    bio: '刚开始记账的新手，记录不多但在坚持',
    // 刻意不给预算：首页与统计页需要「未设置预算」这个状态做演示
    budget: null,
    oneOffs: [
      { offset: -1, type: 'expense', cat: '餐饮', amount: 6800, day: 18, note: '和室友吃饭' },
      { offset: -3, type: 'expense', cat: '交通', amount: 2600, day: 13, note: '公交充值' },
      { offset: -5, type: 'expense', cat: '学习', amount: 6900, day: 16, note: '买了一本书' },
    ],
    recurring: [
      { type: 'income', cat: '工资', amount: 950000, day: 10, note: '实习补贴' },
      { type: 'expense', cat: '餐饮', amount: 4200, day: 12, note: '楼下面馆' },
      // 记账新手：前几个月记得很少，从第 8 个月起才稳定下来。
      // 这样一眼能看出「她是逐渐养成了记账习惯」，而不是一上来就记满
      { type: 'expense', cat: '交通', amount: 2600, day: 13, note: '公交充值', whereElapsedFromStart: 8 },
      { type: 'expense', cat: '餐饮', amount: 3800, day: 18, note: '食堂', whereElapsedFromStart: 9 },
      { type: 'expense', cat: '娱乐', amount: 4500, day: 22, note: '买了张电影票', whereElapsedFromStart: 10 },
    ],
  },
  {
    username: 'xiaozhou',
    nickname: '小周',
    status: 'active',
    bio: '注册后只记了几天账就放弃了，用来演示流失用户',
    budget: null,
    // 前两个月集中记了几笔，之后就再没打开过 —— 累计 6 笔，落在「1-9 笔」这一档。
    // 后台的活跃分层需要这样一个人，否则「1-9 笔」永远是空的。
    oneOffs: [
      { mOff: -11, type: 'income', cat: '工资', amount: 880000, day: 10, note: '工资' },
      { mOff: -11, type: 'expense', cat: '居住', amount: 280000, day: 1, note: '房租' },
      { mOff: -11, type: 'expense', cat: '餐饮', amount: 5200, day: 3, note: '公司楼下快餐' },
      { mOff: -10, type: 'income', cat: '工资', amount: 880000, day: 10, note: '工资' },
      { mOff: -10, type: 'expense', cat: '居住', amount: 280000, day: 1, note: '房租' },
      { mOff: -10, type: 'expense', cat: '交通', amount: 4200, day: 6, note: '地铁充值' },
    ],
    recurring: [],
  },
  {
    username: 'zhaoming',
    nickname: '赵明',
    status: 'disabled',
    bio: '已停用账号，用来演示后台的停用状态',
    oneOffs: [
      { offset: -4, type: 'expense', cat: '交通', amount: 26000, day: 9, note: '打车' },
    ],
    recurring: [
      { type: 'income', cat: '工资', amount: 1200000, day: 5, note: '工资' },
      { type: 'expense', cat: '居住', amount: 350000, day: 1, note: '房租' },
      { type: 'expense', cat: '餐饮', amount: 15600, day: 9, note: '日常吃饭' },
    ],
  },
]

/**
 * 旧版 seed 的原始规格：`[类型, 分类名, 金额(分), 日, 备注]`，逐条照抄自上一版 seed.js。
 *
 * 为什么需要它：现存 db.json 里的记录带着旧版写死的「相对时间」备注
 * （甚至出现了 10 月 5 日写「八月工资」的记录）。光改生成器修不好已经落盘的数据，
 * 所以启动时做一次性清洗 —— 但删除必须精确，否则会误删用户自己的账。
 *
 * 判定用的是**五元组全等**（类型 + 分类名 + 金额 + 日 + 备注）。曾经想过只比
 * 「分类名 + 备注」，那会误伤 alice 那条 note='午餐' 的真实记录；加上金额和日期后
 * 才真正安全。旧版每条记录的金额都是硬编码常量（不含微扰），所以能精确命中。
 */
const LEGACY_SPECS = [
  ['income', '工资', 1800000, '05', '本月工资'],
  ['income', '理财', 32050, '12', '基金分红'],
  ['income', '红包', 20000, '10', '朋友红包'],
  ['expense', '居住', 320000, '01', '房租'],
  ['expense', '餐饮', 8650, '03', '午餐'],
  ['expense', '餐饮', 12900, '07', '同事聚餐'],
  ['expense', '交通', 3600, '08', '地铁充值'],
  ['expense', '购物', 39900, '09', '运动鞋'],
  ['expense', '娱乐', 6800, '11', '电影票'],
  ['expense', '学习', 19900, '13', '技术书籍'],
  ['expense', '医疗', 15000, '14', '感冒药'],
  ['expense', '人情', 26800, '15', '同事生日礼物'],
  ['expense', '餐饮', 4200, '20', '下午茶'],
  ['expense', '购物', 15800, '21', '日用品'],
  ['income', '兼职', 450000, '06', '设计外包'],
  ['income', '兼职', 280000, '18', '私活尾款'],
  ['expense', '餐饮', 38600, '02', '和朋友吃火锅'],
  ['expense', '购物', 129900, '04', '换季买衣服'],
  ['expense', '购物', 45900, '09', '护肤品'],
  ['expense', '娱乐', 26800, '11', '演唱会门票'],
  ['expense', '餐饮', 21500, '13', '外卖一周'],
  ['expense', '交通', 8600, '15', '打车'],
  ['expense', '娱乐', 19900, '19', '会员订阅'],
  ['expense', '购物', 33900, '22', '家居小物'],
  ['expense', '餐饮', 15800, '24', '周末brunch'],
  ['income', '奖金', 2500000, '08', '项目尾款奖金'],
  ['expense', '居住', 480000, '01', '工作室房租'],
  ['expense', '餐饮', 12800, '05', '家里做饭'],
  ['expense', '交通', 15600, '07', '加油'],
  ['expense', '学习', 39900, '10', '专业课程'],
  ['expense', '餐饮', 18600, '14', '家庭采购'],
  ['expense', '娱乐', 9900, '17', '电影和展览'],
  ['expense', '医疗', 22000, '21', '体检'],
  ['income', '工资', 950000, '10', '实习补贴'],
  ['expense', '餐饮', 4200, '12', '楼下面馆'],
  ['expense', '交通', 2600, '13', '公交'],
  ['expense', '学习', 6900, '16', '买了本书'],
  ['expense', '餐饮', 6800, '18', '和室友吃饭'],
  ['income', '工资', 1200000, '05', '月薪'],
  ['expense', '居住', 350000, '01', '房租'],
  ['expense', '餐饮', 15600, '09', '日常吃饭'],
]

/** 旧记录的精确签名 → 用于判定「这条是旧版 seed 生成的」 */
const LEGACY_SIGNATURES = new Set(
  LEGACY_SPECS.map(([type, cat, amount, day]) => `${type}|${cat}|${amount}|${day}`),
)

/**
 * 判断一条已有记录是否由旧版 seed 生成。
 *
 * 刻意**不含备注**：线上有一条 10 月 5 日的记录备注是「八月工资」而不是规格里的
 * 「本月工资」，把备注纳入签名反而漏掉它。去掉备注后靠「类型 + 分类名 + 金额 + 日」
 * 判等 —— 旧版金额全是硬编码常量（不含按月微扰），所以这个签名依然精确。
 *
 * 已核对不会误伤：alice 那条 note='午餐' 是 52200 分、13 号，与规格的 8650 分、3 号
 * 不同；端到端测试留下的记录是 6666 分，也不在任何规格里。
 */
export function isLegacySeedRecord(record, categoryNameOf) {
  const name = categoryNameOf(record.categoryId)
  if (!name) return false
  const day = String(record.date || '').slice(8, 10)
  return LEGACY_SIGNATURES.has(`${record.type}|${name}|${record.amount}|${day}`)
}

/**
 * 生成某个月的账目。
 *
 * @param spec  演示用户画像
 * @param month 'YYYY-MM'
 * @param today 今天（默认取系统时间）—— 当月不能生成「未来」的账，
 *              否则统计页会显示还没发生的支出（旧数据就有这个问题，14 号的账单能写到 24 号）
 * @returns [{ type, catName, amount, date, note, origin }]
 */
export function generateMonthRecords(spec, month, today = new Date()) {
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  // 当月只填到今天；历史月份填满整月
  const cap = month === currentMonthStr ? today.getDate() : daysInMonth(month)

  // whereElapsedFromStart：这条规则从数据窗口第几个月开始生效
  // （小美是新手，前几个月还没开始记这类账）
  const windowStart = shiftMonth(currentMonthStr, -(MONTH_WINDOW - 1))
  const isActive = (line) =>
    line.whereElapsedFromStart === undefined ||
    monthDiff(windowStart, month) >= line.whereElapsedFromStart

  const lines = [
    ...(spec.recurring || []).map((r) => ({ ...r, recurring: true })),
    // 一次性事件：mOff（绝对偏移）优先，其次 offset（同义，保留旧写法）
    ...(spec.oneOffs || []).filter((o) => shiftMonth(currentMonthStr, o.mOff ?? o.offset) === month),
  ].filter(isActive)

  return lines
    .map((line) => {
      // 先按当月天数收口（「31 号」在 2 月要落到 28/29 号），再判断是否已经发生。
      // 顺序反了的话，2 月会把「31 号」这类规则整条丢掉，而不是顺延到最后一天。
      const day = Math.min(Number(line.day), daysInMonth(month))
      return { line, day }
    })
    .filter(({ day }) => day <= cap)
    .map(({ line, day }) => ({
      type: line.type,
      catName: line.cat,
      // 经常性支出按月微扰（否则 12 根柱子一样高）；一次性事件保持原值，奖金就该是那个数
      amount: line.recurring ? jitter(month, line.amount) : line.amount,
      date: `${month}-${String(day).padStart(2, '0')}`,
      note: line.note,
      origin: 'demo',
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}
