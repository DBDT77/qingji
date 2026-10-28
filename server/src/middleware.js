import { db } from './db.js'
import { verifyToken } from './auth.js'
import { ApiError } from './utils.js'

/** 从请求里解析登录用户；无效则返回 null（不抛错） */
function resolveUser(req) {
  const header = String(req.headers.authorization || '')
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return null
  const payload = verifyToken(token)
  if (!payload || !payload.uid) return null
  const user = db().users.find((u) => u.id === payload.uid)
  if (!user) return null
  // token 版本号用于让"改密码 / 停用"立即失效旧 token
  if (Number(user.pwdVersion || 0) !== Number(payload.ver || 0)) return null
  return user
}

/** 公开数据：仅挂载 user，不做拦截（用于 /api/auth/me 这类可选登录接口） */
export function attachUser(req, _res, next) {
  req.user = resolveUser(req)
  next()
}

/** 必须登录 */
export function requireAuth(req, res, next) {
  const user = req.user || resolveUser(req)
  if (!user) return next(new ApiError('登录状态已失效，请重新登录', 401, 'UNAUTHORIZED'))
  if (user.status === 'disabled') {
    return next(new ApiError('账号已被停用，请联系管理员', 403, 'ACCOUNT_DISABLED'))
  }
  req.user = user
  next()
}

/** 必须管理员 */
export function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err)
    if (req.user.role !== 'admin') {
      return next(new ApiError('需要管理员权限', 403, 'FORBIDDEN'))
    }
    next()
  })
}

/** 统一错误处理 */
export function errorHandler(err, _req, res, _next) {
  const status = err instanceof ApiError ? err.status : 500
  const code = err instanceof ApiError ? err.code : 'SERVER_ERROR'
  if (status >= 500) console.error('[error]', err)
  res.status(status).json({
    code,
    message: status >= 500 ? '服务器开小差了，请稍后再试' : err.message,
  })
}

/** 统一成功响应 */
export function ok(res, data = null) {
  res.json({ code: 'OK', data })
}
