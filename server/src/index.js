import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { db, DATA_DIR } from './db.js'
import { aiConfig, emailMode, smtpConfig } from './config.js'
import { providerLabel } from './ai-provider.js'
import { attachUser, errorHandler, ok } from './middleware.js'
import authRoutes from './routes/auth.js'
import categoryRoutes from './routes/categories.js'
import recordRoutes from './routes/records.js'
import budgetRoutes from './routes/budgets.js'
import statsRoutes from './routes/stats.js'
import adminRoutes from './routes/admin.js'
import aiRoutes from './routes/ai.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 3000)
const app = express()

app.disable('x-powered-by')
app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use(attachUser) // 解析 token，挂载 req.user（不拦截）

// 简易访问日志
app.use((req, _res, next) => {
  if (req.path.startsWith('/api') && process.env.NODE_ENV !== 'test') {
    console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.originalUrl}`)
  }
  next()
})

app.get('/api/health', (_req, res) => ok(res, { status: 'up', time: new Date().toISOString() }))

app.use('/api/auth', authRoutes)
app.use('/api/categories', categoryRoutes)
app.use('/api/records', recordRoutes)
app.use('/api/budgets', budgetRoutes)
app.use('/api/stats', statsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/ai', aiRoutes)

app.use('/api', (_req, res) => {
  res.status(404).json({ code: 'NOT_FOUND', message: '接口不存在' })
})

// 生产模式下顺带托管前端构建产物：先 npm run build，再 npm start 即可单端口运行
const distDir = path.resolve(__dirname, '..', '..', 'web', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
  console.log(`已托管前端静态资源：${distDir}`)
}

app.use(errorHandler)

// 启动前确保管理员与默认分类存在，避免首次运行无从登录
import { ensureSeed } from './seed.js'

try {
  ensureSeed({ quiet: true })
  app.listen(PORT, () => {
    console.log(`  记账系统 API 已启动`)
    console.log(`  地址：http://localhost:${PORT}`)
    console.log(`  健康检查：http://localhost:${PORT}/api/health`)
    const mode = emailMode()
    const mailLabel =
      mode === 'smtp'
        ? `SMTP（${smtpConfig().host}）`
        : mode === 'console'
          ? '控制台模式（验证码打印在本终端）'
          : '未配置（发送验证码会失败）'
    console.log(`  邮件发送：${mailLabel}`)
    const ai = aiConfig()
    console.log(
      `  AI 助手：${
        ai.configured
          ? `云端 ${providerLabel(ai.provider)}（${ai.model}），失败自动回退本地规则`
          : '本地规则（未配置云端模型）'
      }`,
    )
    console.log(`  数据目录：${DATA_DIR}\n`)
  })
} catch (err) {
  console.error('初始化失败', err)
  process.exit(1)
}

export { app }
