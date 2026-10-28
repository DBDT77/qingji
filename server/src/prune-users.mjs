/**
 * 一次性数据清理：只保留管理员和演示账号，删除其余用户及其账目。
 *
 * 用法（必须先停止后端，避免运行中的进程把旧数据再写回来）：
 *   cd server
 *   npm run prune-users -- --dry     # 只预览，不写盘
 *   npm run prune-users              # 备份 db.json 后执行
 *
 * --force 可以跳过「3000 端口还有服务在跑」的检查，仅建议在测试数据目录使用。
 */
import fs from 'node:fs'
import path from 'node:path'
import { db, save, DATA_DIR, DB_FILE } from './db.js'
import { DEMO_USERS } from './demo-data.js'
import { demoPassword } from './config.js'
import { ensureSeed } from './seed.js'

const force = process.argv.includes('--force')
const dry = process.argv.includes('--dry')

const KEEP_USERNAMES = new Set(['admin', ...DEMO_USERS.map((u) => u.username)])

async function serverRunning() {
  try {
    const res = await fetch(process.env.HEALTH_URL || 'http://localhost:3000/api/health', {
      signal: AbortSignal.timeout(1500),
    })
    return res.ok
  } catch {
    return false
  }
}

async function main() {
  if (!fs.existsSync(DB_FILE)) {
    console.error(`数据文件不存在：${DB_FILE}`)
    process.exitCode = 1
    return
  }

  if (!dry && !force && (await serverRunning())) {
    console.error(
      '检测到 3000 端口仍有后端在运行。\n' +
        '请先停止后端再清理，否则运行中的进程会把旧数据重新写回 db.json。\n' +
        '确认数据目录是测试用的，可以加 --force 跳过此检查。',
    )
    process.exitCode = 1
    return
  }

  const s = db()
  const doomed = s.users.filter((u) => !KEEP_USERNAMES.has(u.username))
  const doomedIds = new Set(doomed.map((u) => u.id))

  const recordCount = s.records.filter((r) => doomedIds.has(r.userId)).length
  const categoryCount = s.categories.filter((c) => doomedIds.has(c.userId)).length
  const budgetCount = s.budgets.filter((b) => doomedIds.has(b.userId)).length

  console.log(`数据目录：${DATA_DIR}`)
  console.log(`保留用户：${[...KEEP_USERNAMES].join('、')}`)
  if (!doomed.length) {
    console.log('没有需要删除的用户。')
  } else {
    console.log(`将删除 ${doomed.length} 个用户：`)
    for (const u of doomed) {
      console.log(`  #${u.id} ${u.username}${u.email ? ` <${u.email}>` : ''} (${u.role})`)
    }
    console.log(`同时删除：${recordCount} 条记录、${categoryCount} 个分类、${budgetCount} 条预算`)
  }

  if (dry) {
    console.log('\n--dry 模式：未写入任何数据。')
    return
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backup = path.join(DATA_DIR, `db.json.bak-${stamp}`)
  fs.copyFileSync(DB_FILE, backup)
  console.log(`\n已备份原数据：${backup}`)

  s.users = s.users.filter((u) => !doomedIds.has(u.id))
  s.records = s.records.filter((r) => !doomedIds.has(r.userId))
  s.categories = s.categories.filter((c) => !doomedIds.has(c.userId))
  s.budgets = s.budgets.filter((b) => !doomedIds.has(b.userId))
  save()

  // 补齐管理员 / 演示账号的内部邮箱，并确保演示数据仍在
  ensureSeed({ quiet: true })
  save()

  console.log('\n清理完成，当前用户：')
  for (const u of db().users) {
    console.log(`  #${u.id} ${u.username} <${u.email || '未绑定'}> ${u.role} ${u.status}`)
  }
  console.log('\n管理员登录：admin@qingji.local（密码见 server/.env 的 ADMIN_PASSWORD）')
  console.log(`演示账号登录：demo@qingji.local / ${demoPassword()}（其余演示账号同理）`)
}

main().catch((err) => {
  console.error('清理失败：', err)
  process.exitCode = 1
})
