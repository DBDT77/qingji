/**
 * 更新现有数据库里的管理员 / 演示账号密码。
 *
 * 适用场景：已经运行过 seed，数据库里已有账号，此时修改 .env 不会自动改密码。
 * 用法：
 *   1. 在 server/.env 设置 ADMIN_PASSWORD 和 DEMO_PASSWORD
 *   2. 停止后端（避免内存里的旧数据覆盖本次修改）
 *   3. npm run set-passwords
 *   4. 重新启动后端
 *
 * 密码只保存 scrypt 摘要；脚本会递增 pwdVersion，让旧登录 token 立即失效。
 */
import { db, save } from './db.js'
import { hashPassword } from './auth.js'
import { adminPassword, demoPassword } from './config.js'
import { DEMO_USERS } from './demo-data.js'

const adminPwd = adminPassword()
if (!adminPwd) {
  console.error('请先在 server/.env 设置 ADMIN_PASSWORD')
  process.exit(1)
}

const demoPwd = demoPassword()
const s = db()
const admin = s.users.find((u) => u.username === 'admin')
if (!admin) {
  console.error('数据库里没有 admin 账号，请先运行 npm run seed')
  process.exit(1)
}

admin.password = hashPassword(adminPwd)
admin.pwdVersion = Number(admin.pwdVersion || 0) + 1

const demoUsernames = new Set(DEMO_USERS.map((u) => u.username))
let demoCount = 0
for (const user of s.users) {
  if (!demoUsernames.has(user.username)) continue
  user.password = hashPassword(demoPwd)
  user.pwdVersion = Number(user.pwdVersion || 0) + 1
  demoCount += 1
}

save()
console.log(`已更新 admin 密码（来自 ADMIN_PASSWORD）`)
console.log(`已更新 ${demoCount} 个演示账号密码（统一为 DEMO_PASSWORD）`)
