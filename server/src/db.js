/**
 * 极简文件型数据存储。
 *
 * 为什么不用数据库：本项目数据量小（单用户级别），文件存储可以做到零原生依赖，
 * 任何装了 Node 的机器 `npm install` 之后即可运行。所有写入都是同步落盘 +
 * 先写临时文件再 rename（原子替换），避免写一半断电导致数据文件损坏。
 *
 * 数据结构：
 *   users      [{ id, username, email?, password(摘要|可空), nickname, role, status,
 *                 authMethods, pwdVersion, createdAt }]
 *   categories [{ id, userId, name, type, icon, color, isDefault, createdAt }]
 *   records    [{ id, userId, categoryId, type, amount(分), date, note, createdAt, updatedAt }]
 *   budgets    [{ id, userId, month, amount(分), createdAt, updatedAt }]
 *   counters   { users: 3, records: 12, ... }  —— 自增主键
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 允许用 DATA_DIR 指向独立目录，方便测试或多实例部署时隔离数据
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.resolve(__dirname, '..', 'data')
export const DB_FILE = path.join(DATA_DIR, 'db.json')

const EMPTY = () => ({
  users: [],
  categories: [],
  records: [],
  budgets: [],
  counters: {},
})

let state = null

function ensure() {
  if (state) return state
  fs.mkdirSync(DATA_DIR, { recursive: true })
  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'))
      state = { ...EMPTY(), ...parsed }
      for (const key of ['users', 'categories', 'records', 'budgets']) {
        if (!Array.isArray(state[key])) state[key] = []
      }
      if (!state.counters || typeof state.counters !== 'object') state.counters = {}
    } catch (err) {
      const backup = `${DB_FILE}.broken-${Date.now()}`
      try {
        fs.renameSync(DB_FILE, backup)
      } catch {
        /* ignore */
      }
      console.error(`[db] 数据文件无法解析，已备份到 ${backup}，重新初始化。原因：${err.message}`)
      state = EMPTY()
    }
  } else {
    state = EMPTY()
  }
  return state
}

/** 获取内存中的数据集（首次调用会从磁盘加载） */
export function db() {
  return ensure()
}

/** 生成自增 ID。注意：调用后请记得 save() 才会把计数器落盘 */
export function nextId(collection) {
  const s = ensure()
  const next = Number(s.counters[collection] || 0) + 1
  s.counters[collection] = next
  return next
}

/** 原子写盘 */
export function save() {
  const s = ensure()
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${DB_FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8')
  fs.renameSync(tmp, DB_FILE)
}

/** 清空所有数据（仅用于测试 / 重置） */
export function reset() {
  state = EMPTY()
  save()
}
