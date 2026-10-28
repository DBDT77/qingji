/**
 * 初始化脚本：创建默认分类、管理员账号和一份演示数据。
 * 可重复执行（幂等）；加 --force 会清空后重建。
 *
 *   npm run seed
 *   npm run seed -- --force
 */
import { db, nextId, save, reset, DATA_DIR } from './db.js'
import { hashPassword } from './auth.js'
import { adminPassword, demoPassword, ENV_FILE } from './config.js'
import crypto from 'node:crypto'
import fs from 'node:fs'
import {
  DEMO_USERS,
  MONTH_WINDOW,
  windowMonths,
  generateMonthRecords,
  isLegacySeedRecord,
} from './demo-data.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 系统默认分类（PRD 4.4：系统提供常用的收入和支出默认分类） */
export const DEFAULT_CATEGORIES = {
  expense: [
    { name: '餐饮', icon: '🍜', color: '#FF7A45' },
    { name: '交通', icon: '🚌', color: '#40A9FF' },
    { name: '购物', icon: '🛍️', color: '#F759AB' },
    { name: '居住', icon: '🏠', color: '#9254DE' },
    { name: '娱乐', icon: '🎮', color: '#36CFC9' },
    { name: '医疗', icon: '💊', color: '#FF4D4F' },
    { name: '学习', icon: '📚', color: '#597EF7' },
    { name: '人情', icon: '🎁', color: '#FFA930' },
    { name: '其他支出', icon: '📦', color: '#8C8C8C' },
  ],
  income: [
    { name: '工资', icon: '💰', color: '#52C41A' },
    { name: '奖金', icon: '🧧', color: '#FA541C' },
    { name: '理财', icon: '📈', color: '#1890FF' },
    { name: '兼职', icon: '💼', color: '#722ED1' },
    { name: '红包', icon: '🎁', color: '#EB2F96' },
    { name: '其他收入', icon: '✨', color: '#13C2C2' },
  ],
}

const now = () => new Date().toISOString()

/** 演示账号 / 管理员使用内部邮箱：只用于登录，不接收真实邮件 */
export const INTERNAL_EMAIL_DOMAIN = 'qingji.local'

export function internalEmail(username) {
  return `${username}@${INTERNAL_EMAIL_DOMAIN}`
}

/** 给已有账号补上邮箱和登录方式（幂等；不覆盖真实邮箱） */
function ensureInternalEmail(user, email) {
  if (!user.email) user.email = email
  if (!user.emailVerifiedAt) user.emailVerifiedAt = user.createdAt || now()
  if (!Array.isArray(user.authMethods)) user.authMethods = ['password']
  if (!user.authMethods.includes('password')) user.authMethods.push('password')
  if (!user.authMethods.includes('email')) user.authMethods.push('email')
}

/**
 * 端到端测试用界面真实记一笔时写死的备注与金额（e2e-test.mjs）。
 * 两者同时命中才认定是测试残留，避免误删用户自己写的同样文案。
 */
const E2E_RECORD_NOTES = new Set(['端到端测试'])
const E2E_RECORD_AMOUNT = 6666

/**
 * 生成某个月份里的一个 ISO 时间戳（用于回填 createdAt）。
 * 演示数据不该全部带着「现在」的时间戳 —— 那样后台的用户增长 / 活跃度曲线
 * 会全部挤在同一根柱子上，看不出趋势。
 */
function stampForMonth(month, hour = 10) {
  return `${month}-01T${String(hour).padStart(2, '0')}:00:00.000Z`
}

/** 为一组用户创建系统默认分类，返回创建的分类列表 */
export function createDefaultCategories(userId) {
  const s = db()
  const created = []
  for (const [type, list] of Object.entries(DEFAULT_CATEGORIES)) {
    for (const item of list) {
      const cat = {
        id: nextId('categories'),
        userId,
        name: item.name,
        type,
        icon: item.icon,
        color: item.color,
        isDefault: true,
        createdAt: now(),
      }
      s.categories.push(cat)
      created.push(cat)
    }
  }
  return created
}

/** 创建一个用户并写入默认分类 */
function createUser(s, { username, password, nickname, role = 'user', status = 'active', createdAt }) {
  // 演示账号的注册时间要错开分布，否则后台「新增用户」图会全部挤在一根柱子上
  const stamp = createdAt || now()
  const user = {
    id: nextId('users'),
    username,
    email: internalEmail(username),
    emailVerifiedAt: stamp,
    password: hashPassword(password),
    nickname,
    role,
    status,
    pwdVersion: 1,
    authMethods: ['password', 'email'],
    createdAt: stamp,
  }
  s.users.push(user)
  return user
}

/** 把生成的密码写回 server/.env（已 gitignore），避免只在控制台出现一次 */
function persistEnv(key, value) {
  const line = `${key}=${value}`
  let text = ''
  try {
    text = fs.readFileSync(ENV_FILE, 'utf8')
  } catch {
    /* .env 不存在时创建 */
  }
  const re = new RegExp(`^${key}=.*$`, 'm')
  if (re.test(text)) {
    text = text.replace(re, line)
  } else {
    text = `${text.replace(/\s*$/, '')}${text.trim() ? '\n' : ''}${line}\n`
  }
  fs.mkdirSync(path.dirname(ENV_FILE), { recursive: true })
  fs.writeFileSync(ENV_FILE, text)
  process.env[key] = value
}

/** 管理员密码只来自 ADMIN_PASSWORD；首次启动没有配置时随机生成并写入 .env */
function initialAdminPassword() {
  const configured = adminPassword()
  if (configured) return { password: configured, generated: false }
  const password = crypto.randomBytes(12).toString('base64url')
  try {
    persistEnv('ADMIN_PASSWORD', password)
  } catch (err) {
    console.warn(`[seed] 无法写入 server/.env，请手动保存管理员密码：${password}`)
    console.warn(`[seed] 写入失败原因：${err.message}`)
  }
  return { password, generated: true }
}

function seedAdmin(s, quiet = false) {
  const existing = s.users.find((u) => u.username === 'admin')
  if (existing) {
    ensureInternalEmail(existing, internalEmail('admin'))
    return
  }
  const { password, generated } = initialAdminPassword()
  const admin = createUser(s, {
    username: 'admin',
    password,
    nickname: '系统管理员',
    role: 'admin',
  })
  createDefaultCategories(admin.id)
  if (!quiet) {
    console.log(
      generated
        ? '- 管理员账号：admin（随机密码已写入 server/.env 的 ADMIN_PASSWORD）'
        : '- 管理员账号：admin（密码来自 ADMIN_PASSWORD）',
    )
  }
}

/**
 * 清理旧版 seed 落在当月的那批账目，交由新版按月重新生成。
 *
 * 旧版把十几条记录全部写进「当前月」，于是历史是空的、当月堆了一座山；
 * 备注里还写死了「本月工资」这类相对时间（线上真出现了 10 月 5 日写着「八月工资」
 * 的记录），日期甚至跑到「今天」之后。
 *
 * 为什么可以直接删：新版规格里每条经常性 / 一次性账目的金额和「日」都和旧版逐条
 * 对齐过（一次性事件用 mOff 钉在原月份），删掉再生成，同样的账目会出现在正确的月份，
 * 不会凭空少账。
 *
 * 判定用精确签名（类型 + 分类名 + 金额 + 日），只动旧 seed 的那批。已核对不会误伤：
 * alice 那条 note='午餐' 是 52200 分 / 13 号，端到端测试留下的是 6666 分，都不在
 * 任何旧规格签名里；用户自己后来补记的账同理。
 */
function purgeLegacyDemoRecords(s, quiet = false) {
  const catNameOf = (id) => s.categories.find((c) => c.id === id)?.name
  let removed = 0

  for (const spec of DEMO_USERS) {
    const user = s.users.find((u) => u.username === spec.username)
    // 还不存在（全新安装）→ 没有旧数据可清；
    // 已经有 demoMonths → 这个账号已用新格式生成过，删了不会补，绝不能再删
    if (!user || Array.isArray(user.demoMonths)) continue
    const before = s.records.length
    s.records = s.records.filter((r) => !(r.userId === user.id && isLegacySeedRecord(r, catNameOf)))
    removed += before - s.records.length
  }

  if (!quiet && removed) console.log(`- 已清理 ${removed} 条旧版演示账目（改由新版按月生成）`)
  return removed
}

/**
 * 写入 / 补齐演示用户及其账目。
 *
 * 为什么要「补齐」而不是「跳过已存在」：旧版只生成当前月，老用户升上来之后
 * 历史仍然是空的。所以这里按「最近 12 个月」逐月检查，缺哪个月补哪个月。
 *
 * 幂等的关键是用 user.demoMonths 记录「这个用户已经生成过哪些月」，
 * 而不是去看底下有没有记录 —— 用户自己在 10 月记过一笔，不代表 10 月的演示数据已生成。
 */
function seedDemoUsers(s, quiet = false) {
  const months = windowMonths(MONTH_WINDOW)
  const demoPwd = demoPassword()
  let created = 0
  let toppedUp = 0

  DEMO_USERS.forEach((spec, index) => {
    let user = s.users.find((u) => u.username === spec.username)
    if (!user) {
      user = createUser(s, {
        username: spec.username,
        password: demoPwd,
        nickname: spec.nickname,
        status: spec.status,
      })
      createDefaultCategories(user.id)
      user.demoMonths = []
      created += 1
    } else {
      // 老数据里的演示账号没有邮箱，补一个内部邮箱用于登录
      ensureInternalEmail(user, internalEmail(spec.username))
    }
    if (!Array.isArray(user.demoMonths)) user.demoMonths = []

    // 首次迁移时把注册时间铺到整个数据窗口里。
    // 旧版所有演示账号的 createdAt 都是同一秒，后台「新增用户」图只有一根柱子有值，
    // 看不出增长趋势。只在 demoMonths 还是空的时候设一次，之后保持不变。
    if (!user.demoMonths.length) {
      user.createdAt = stampForMonth(months[index % months.length], 10)
    }

    const cats = s.categories.filter((c) => c.userId === user.id)
    const catOf = (type, name) => cats.find((c) => c.type === type && c.name === name)

    for (const month of months) {
      // demoMonths 是「已生成过哪些月」的权威清单 —— 不能改看底下有没有记录，
      // 因为用户完全可能在 10 月自己记过一笔，那不表示 10 月的演示数据已生成
      if (user.demoMonths.includes(month)) continue

      for (const line of generateMonthRecords(spec, month)) {
        const cat = catOf(line.type, line.catName)
        if (!cat) continue
        // 兜底防重：同一天、同一分类、同一金额已存在就跳过
        const dup = s.records.some(
          (r) =>
            r.userId === user.id &&
            r.date === line.date &&
            r.categoryId === cat.id &&
            r.amount === line.amount,
        )
        if (dup) continue

        const id = nextId('records')
        // 回填 createdAt 到账目当天的一个工作时间：这样「最近记录」的排序
        // 和后台的活跃度图才有真实的时间分布，而不是全部挤在「现在」
        const stamp = stampForMonth(line.date, 9 + (cat.id % 9))
        s.records.push({
          id,
          userId: user.id,
          categoryId: cat.id,
          type: line.type,
          amount: line.amount,
          date: line.date,
          note: line.note,
          origin: 'demo',
          createdAt: stamp,
          updatedAt: stamp,
        })
      }
      user.demoMonths.push(month)
      toppedUp += 1
    }

    // 预算按月 upsert。spec.budget 为 null 的（小美）刻意不设，
    // 首页与统计页需要「未设置预算」这个状态做演示
    if (spec.budget) {
      for (const month of months) {
        const existing = s.budgets.find((b) => b.userId === user.id && b.month === month)
        if (existing) {
          if (existing.amount !== spec.budget) {
            existing.amount = spec.budget
            existing.updatedAt = now()
          }
        } else {
          s.budgets.push({
            id: nextId('budgets'),
            userId: user.id,
            month: month,
            amount: spec.budget,
            createdAt: now(),
            updatedAt: now(),
          })
        }
      }
    }
  })

  if (!quiet && created) {
    console.log(`- 演示账号：${DEMO_USERS.length} 个（统一密码：${demoPwd}）`)
  }
  if (!quiet && toppedUp) {
    console.log(`- 已为演示账号补齐最近 ${MONTH_WINDOW} 个月的账目`)
  }
}

/**
 * 清理测试脚本留在数据里的痕迹。
 *
 * 两类残留：
 * 1. 冒烟 / 端到端测试注册的垃圾账号（ta_12345678 / tester_a1234 / e2e_71309819 /
 *    截图脚本的 shot_8236528）。这些账号对管理员看用户列表没有意义。
 * 2. 端到端测试通过界面真实提交的账目。它记在 demo 名下，备注是脚本写死的
 *    「端到端测试」、金额 6666 分 —— 每跑一次就多一条，时间一长 demo 的账本里
 *    就堆满了这种假账，用户翻账单看到的就是「数据不符合实际」。
 *    笔记里写死的测试文案本来就是不该留在真实账号里的东西，一并清掉。
 */
function purgeTestAccounts(s, quiet = false) {
  const isJunk = (name) =>
    /^tester_/i.test(name) ||
    /^t[ab]_\d{6,}$/.test(name) ||
    /^u\d{6,}$/.test(name) ||
    /^e2e_\d{6,}$/.test(name) ||
    // 截图脚本反复跑出来的账号，如 shot_8236528
    /^shot_\d{5,}$/.test(name)

  const junk = s.users.filter((u) => isJunk(u.username || ''))
  const ids = new Set(junk.map((u) => u.id))
  if (junk.length) {
    s.users = s.users.filter((u) => !ids.has(u.id))
    s.records = s.records.filter((r) => !ids.has(r.userId))
    s.budgets = s.budgets.filter((b) => !ids.has(b.userId))
    s.categories = s.categories.filter((c) => !ids.has(c.userId))
  }

  // 测试账目：备注与金额都要对上才算 —— 只靠备注，万一有人真敲了这几个字会被误删
  const before = s.records.length
  s.records = s.records.filter((r) => !(E2E_RECORD_NOTES.has(r.note) && r.amount === E2E_RECORD_AMOUNT))
  const strayRecords = before - s.records.length

  if (!quiet && junk.length) {
    console.log(`- 已清理 ${junk.length} 个测试账号（${junk.map((u) => u.username).join('、')}）`)
  }
  if (!quiet && strayRecords) {
    console.log(`- 已清理 ${strayRecords} 条端到端测试留下的账目（备注：端到端测试）`)
  }
}

/** 确保管理员与演示数据存在（幂等），服务启动时也会调用 */
export function ensureSeed({ force = false, quiet = false } = {}) {
  if (force) {
    reset()
    if (!quiet) console.log('- 已清空既有数据')
  }
  const s = db()
  seedAdmin(s, quiet)
  purgeTestAccounts(s, quiet)
  // 先迁旧账（把它们归位到本来的月份），再按月补齐缺的月份
  purgeLegacyDemoRecords(s, quiet)
  seedDemoUsers(s, quiet)
  save()
}

function main() {
  const force = process.argv.includes('--force')
  ensureSeed({ force })
  console.log(`\n数据文件：${DATA_DIR}`)
  console.log('管理员后台：登录后访问 /admin（前端底部「我的 → 管理后台」也有入口）')
}

// 仅当直接执行本文件时运行，被 import 时不自动执行
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
