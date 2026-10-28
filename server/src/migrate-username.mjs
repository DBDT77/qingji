/**
 * 数据迁移：把用户表从「邮箱登录」改成「用户名登录」。
 *
 * 迁移规则
 *   admin@rmb.local  -> admin
 *   demo@rmb.local   -> demo
 *   xiaoli@qq.com    -> xiaoli（取 @ 前部分；冲突时追加数字后缀）
 *   tester_a_1791..  -> 去掉时间戳，长度裁到 20 位
 *
 * 幂等：已经是 username 结构的库直接跳过。
 * 用法：node src/migrate-username.mjs [--dry]
 */
import { db, save, DATA_DIR } from './db.js'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_.-]{2,19}$/
const dryRun = process.argv.includes('--dry')

/** 把任意标识转成一个合法的用户名 */
function toUsername(raw, taken) {
  let base = String(raw || '').trim().toLowerCase()

  // 邮箱取 @ 前部分
  if (base.includes('@')) base = base.split('@')[0]

  // 去掉时间戳类长数字后缀（测试账号留下的垃圾）
  base = base.replace(/\d{10,}$/, '')
  // 去掉首尾的连接符，避免出现 tester_a_ 这种尾巴
  base = base.replace(/^[._-]+/, '').replace(/[._-]+$/, '')
  // 非法字符替换
  base = base.replace(/[^a-z0-9_.-]/g, '')
  // 必须字母开头
  if (!/^[a-z]/.test(base)) base = `u${base}`
  // 裁长度
  base = base.slice(0, 20)
  // 补足最短长度
  if (base.length < 3) base = `${base}user`.slice(0, 3 + 3)

  if (!USERNAME_RE.test(base)) base = `user${Math.random().toString(36).slice(2, 8)}`

  if (!taken.has(base)) return base
  // 冲突则追加数字
  let n = 2
  while (taken.has(`${base}${n}`)) n += 1
  const candidate = `${base}${n}`.slice(0, 20)
  return candidate
}

function main() {
  const s = db()
  const users = s.users || []

  if (!users.some((u) => u.email && !u.username)) {
    console.log('无需迁移：用户表已经是 username 结构。')
    return
  }

  console.log(`检测到旧格式用户 ${users.filter((u) => u.email).length} 个，开始迁移${dryRun ? '（演练模式）' : ''}：\n`)

  // 先把已存在的 username 放进集合，避免冲突
  const taken = new Set(users.filter((u) => u.username && !u.email).map((u) => u.username))
  const changes = []

  for (const u of users) {
    if (!u.email) continue
    const username = toUsername(u.email, taken)
    taken.add(username)
    changes.push({ id: u.id, from: u.email, to: username, nickname: u.nickname })
  }

  for (const c of changes) {
    console.log(`  用户 #${c.id} ${c.nickname}：${c.from}  ->  ${c.to}`)
  }

  if (dryRun) {
    console.log('\n演练模式，未写入任何数据。加掉 --dry 即可实际执行。')
    return
  }

  for (const u of users) {
    if (!u.email) continue
    const change = changes.find((c) => c.id === u.id)
    u.username = change.to
    delete u.email // 彻底移除邮箱字段
  }
  save()

  console.log(`\n迁移完成，已写入：${DATA_DIR}`)
  console.log('提示：邮箱登录已移除，请使用新的用户名登录。')
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}