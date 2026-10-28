/**
 * 邮箱注册 / 登录 / 找回密码接口测试。
 *
 * 需要后端已在 3000 端口运行，并且处于「开发模式」（未配置 SMTP，
 * 验证码会随接口返回 devCode）。为了让「60 秒重发冷却」在测试里可以跨过，
 * 建议测试服务设置 OTP_RESEND_MS=1000。用法：
 *
 *   cd server
 *   npm run test:email
 *   BASE=http://localhost:3100/api npm run test:email
 */
import './src/config.js'

const BASE = process.env.BASE || 'http://localhost:3000/api'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || ''
let pass = 0
let fail = 0
const failures = []
const createdUserIds = new Set()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function check(name, condition, extra = '') {
  if (condition) {
    pass += 1
    console.log(`  ok  ${name}`)
  } else {
    fail += 1
    failures.push(name)
    console.log(`  FAIL ${name} ${extra}`)
  }
}

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ...json }
}

function finish() {
  console.log(`\n结果：${pass} 通过，${fail} 失败`)
  if (fail) {
    console.log('失败项：')
    for (const name of failures) console.log(` - ${name}`)
    process.exitCode = 1
  }
}

/** 测试结束后删掉自己创建的账号，避免污染演示数据 */
async function cleanup() {
  if (!createdUserIds.size) return
  const admin = await api('/auth/login', {
    method: 'POST',
    body: { email: 'admin@qingji.local', password: ADMIN_PASSWORD },
  })
  const token = admin.data?.token
  if (!token) {
    console.log(`清理失败：管理员登录失败，请手动删除用户 ${[...createdUserIds].join(', ')}`)
    return
  }
  console.log('\n=== 清理测试账号 ===')
  for (const id of createdUserIds) {
    const res = await api(`/admin/users/${id}`, { method: 'DELETE', token })
    console.log(`  用户 #${id}: ${res.code}`)
  }
}

async function main() {
  console.log('\n=== 1. 发送注册验证码 ===')
  const health = await api('/health')
  check('后端服务可访问', health.code === 'OK', JSON.stringify(health))

  const badEmail = await api('/auth/email/send-code', {
    method: 'POST',
    body: { email: 'not-an-email', purpose: 'register' },
  })
  check('非法邮箱被拒绝', badEmail.status === 400, `status=${badEmail.status}`)

  const stamp = Date.now().toString(36)
  const email = `tester_email_${stamp}@example.com`
  const password = 'test123'
  const newPassword = 'newpass456'

  const sent = await api('/auth/email/send-code', {
    method: 'POST',
    body: { email, purpose: 'register' },
  })
  check('注册验证码发送成功', sent.code === 'OK', sent.message)

  const code = sent.data?.devCode
  check('开发模式返回 devCode', /^\d{6}$/.test(code || ''), JSON.stringify(sent.data))
  if (!code) {
    console.log(
      '\n未拿到 devCode：当前可能已配置 SMTP。' +
        '请用 EMAIL_DEV_MODE=true 启动测试服务，或在未配置 SMTP 的环境运行本测试。',
    )
    return
  }

  console.log('\n=== 2. 邮箱注册 ===')
  const wrongCode = code === '000000' ? '111111' : '000000'
  const bad = await api('/auth/register', {
    method: 'POST',
    body: { email, code: wrongCode, password, nickname: '邮箱测试' },
  })
  check('错误验证码不能注册', bad.status === 400 && bad.code === 'CODE_INVALID', bad.message)

  const reg = await api('/auth/register', {
    method: 'POST',
    body: { email, code, password, nickname: '邮箱测试' },
  })
  check('正确验证码注册成功', reg.code === 'OK', reg.message)
  check('注册返回邮箱', reg.data?.user?.email === email, JSON.stringify(reg.data?.user))
  check('注册不返回 token', reg.data?.token === undefined)
  check('注册生成内部用户名', /^em_[a-z0-9]+$/.test(reg.data?.user?.username || ''), reg.data?.user?.username)
  if (reg.data?.user?.id) createdUserIds.add(reg.data.user.id)

  const dupSend = await api('/auth/email/send-code', {
    method: 'POST',
    body: { email, purpose: 'register' },
  })
  check('已注册邮箱不能再获取注册码', dupSend.status === 409, `status=${dupSend.status}`)

  const dupReg = await api('/auth/register', {
    method: 'POST',
    body: { email, code: '123456', password, nickname: '重复注册' },
  })
  check('重复邮箱不能注册', dupReg.status === 409, `status=${dupReg.status}`)

  console.log('\n=== 3. 邮箱 + 密码登录 ===')
  const badLogin = await api('/auth/login', {
    method: 'POST',
    body: { email, password: 'wrong-password' },
  })
  check('错误密码被拒绝', badLogin.status === 401, `status=${badLogin.status}`)

  const login = await api('/auth/login', {
    method: 'POST',
    body: { email, password },
  })
  check('邮箱密码登录成功', login.code === 'OK', login.message)
  check('返回可用 token', typeof login.data?.token === 'string' && login.data.token.length > 0)
  const token = login.data?.token

  const me = await api('/auth/me', { token })
  check('/me 返回邮箱', me.data?.email === email, JSON.stringify(me.data))

  console.log('\n=== 4. 忘记密码 ===')
  // 测试服务建议设置 OTP_RESEND_MS=1000；正式环境默认 60 秒
  await sleep(1100)
  const resetSent = await api('/auth/email/send-code', {
    method: 'POST',
    body: { email, purpose: 'reset' },
  })
  check('重置密码验证码发送成功', resetSent.code === 'OK', resetSent.message)
  const resetCode = resetSent.data?.devCode
  check('重置验证码返回 devCode', /^\d{6}$/.test(resetCode || ''), JSON.stringify(resetSent.data))

  const noSuchUser = await api('/auth/email/send-code', {
    method: 'POST',
    body: { email: `nobody_${stamp}@example.com`, purpose: 'reset' },
  })
  check(
    '未注册邮箱不暴露是否存在',
    noSuchUser.code === 'OK' && noSuchUser.data?.delivered === 'none',
    JSON.stringify(noSuchUser.data),
  )

  const resetWrong = await api('/auth/password/reset', {
    method: 'POST',
    body: { email, code: resetCode === '000000' ? '111111' : '000000', newPassword },
  })
  check('错误验证码不能重置密码', resetWrong.status === 400, `status=${resetWrong.status}`)

  const reset = await api('/auth/password/reset', {
    method: 'POST',
    body: { email, code: resetCode, newPassword },
  })
  check('正确验证码重置密码成功', reset.code === 'OK', reset.message)

  const reuse = await api('/auth/password/reset', {
    method: 'POST',
    body: { email, code: resetCode, newPassword: 'another123' },
  })
  check('重置验证码不能重复使用', reuse.status === 400, `status=${reuse.status}`)

  const oldLogin = await api('/auth/login', {
    method: 'POST',
    body: { email, password },
  })
  check('旧密码已失效', oldLogin.status === 401, `status=${oldLogin.status}`)

  const newLogin = await api('/auth/login', {
    method: 'POST',
    body: { email, password: newPassword },
  })
  check('新密码可以登录', newLogin.code === 'OK', newLogin.message)

  console.log('\n=== 5. 发送频率限制 ===')
  const tooSoon = await api('/auth/email/send-code', {
    method: 'POST',
    body: { email, purpose: 'reset' },
  })
  check('短时间重复发送被限流', tooSoon.status === 429, `status=${tooSoon.status}`)

  const raceEmail = `tester_race_${stamp}@example.com`
  const [race1, race2] = await Promise.all([
    api('/auth/email/send-code', { method: 'POST', body: { email: raceEmail, purpose: 'register' } }),
    api('/auth/email/send-code', { method: 'POST', body: { email: raceEmail, purpose: 'register' } }),
  ])
  const raceStatuses = [race1.status, race2.status].sort()
  check(
    '并发发送同一邮箱只成功一次',
    raceStatuses[0] === 200 && raceStatuses[1] === 429,
    raceStatuses.join(','),
  )
}

main()
  .catch((err) => {
    console.error('\n测试异常：', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await cleanup()
    finish()
  })
