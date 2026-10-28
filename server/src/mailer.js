/**
 * 邮件发送。
 *
 * 真实发送走 nodemailer + SMTP；开发环境未配置 SMTP 时，
 * 验证码只打印到后端控制台，接口流程保持完全一致。
 */
import { emailMode, smtpConfig } from './config.js'

let transporter = null

async function getTransporter() {
  if (transporter) return transporter
  const cfg = smtpConfig()
  if (!cfg.configured) {
    throw new Error(
      'SMTP 未配置：请在 server/.env 中填写 SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_FROM',
    )
  }
  // 延迟加载：没装 nodemailer 或没配 SMTP 时，服务仍能正常启动
  const { default: nodemailer } = await import('nodemailer')
  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    // 前端请求超时是 15 秒，SMTP 各阶段都控制在 12 秒内，
    // 避免邮件已经发出但页面先提示超时
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 12_000,
  })
  return transporter
}

function mailInfo(purpose) {
  if (purpose === 'register') {
    return { action: '注册', intro: '你正在注册轻记，验证码是：' }
  }
  if (purpose === 'reset') {
    return { action: '重置密码', intro: '你正在重置轻记登录密码，验证码是：' }
  }
  return { action: '登录', intro: '你的登录验证码是：' }
}

function subjectOf(purpose) {
  return `【轻记】${mailInfo(purpose).action}验证码`
}

function textOf(code, purpose) {
  return [
    `${mailInfo(purpose).intro}${code}`,
    '',
    '验证码 10 分钟内有效，仅可使用一次。',
    '如果这不是你本人的操作，请忽略本邮件，不要向任何人透露验证码。',
  ].join('\n')
}

function htmlOf(code, purpose) {
  const { action, intro } = mailInfo(purpose)
  return `
  <div style="max-width:480px;margin:0 auto;padding:28px 24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;color:#1f2329">
    <h2 style="margin:0 0 6px;font-size:18px">轻记 · ${action}验证码</h2>
    <p style="margin:0 0 12px;font-size:13px;color:#646a73">${intro}</p>
    <div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#4c6ef5;padding:14px 0">${code}</div>
    <p style="margin:0 0 6px;font-size:13px;color:#646a73">验证码 10 分钟内有效，仅可使用一次。</p>
    <p style="margin:0;font-size:12px;color:#8f959e">如果这不是你本人的操作，请忽略本邮件，不要向任何人透露验证码。</p>
  </div>`
}

/**
 * 发送验证码邮件。
 * @returns {Promise<{delivered: 'smtp'|'console'}>}
 */
export async function sendEmailCode(to, code, purpose = 'register') {
  const mode = emailMode()

  if (mode === 'console') {
    console.log('\n[email] 邮箱验证码（开发模式，未发送真实邮件）')
    console.log(`  收件人：${to}`)
    console.log(`  验证码：${code}（10 分钟内有效，用于${mailInfo(purpose).action}）`)
    console.log('  配置 SMTP 后会改为真实发送，详见 README「邮箱登录」\n')
    return { delivered: 'console' }
  }

  if (mode === 'disabled') {
    throw new Error('邮件服务未配置，无法发送验证码')
  }

  const t = await getTransporter()
  const cfg = smtpConfig()
  const info = await t.sendMail({
    from: cfg.from,
    to,
    subject: subjectOf(purpose),
    text: textOf(code, purpose),
    html: htmlOf(code, purpose),
  })
  // 只记录投递元信息，不打印验证码；SMTP 接受不等于一定进收件箱，便于排查退信
  const accepted = Array.isArray(info.accepted) ? info.accepted.length : 0
  const rejected = Array.isArray(info.rejected) ? info.rejected.length : 0
  console.log(
    `[email] 已提交 SMTP：to=${to} messageId=${info.messageId || '-'} accepted=${accepted} rejected=${rejected}`,
  )
  if (rejected > 0 && accepted === 0) {
    throw new Error('SMTP 拒绝了所有收件人')
  }
  return { delivered: 'smtp' }
}
