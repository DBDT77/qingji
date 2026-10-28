/**
 * 云端大模型适配层（OpenAI 兼容协议）。
 *
 * 支持 OpenRouter、Google Gemini 的 OpenAI 兼容入口，以及任意自定义兼容服务。
 * 只负责「发消息、取文本」，不理解记账业务；业务提示词在 ai-llm.js。
 *
 * 失败策略：任何上游错误都会让适配层冷却 60 秒，期间调用方直接回落本地规则，
 * 避免免费额度被反复无效消耗，也避免每个请求都等一次超时。
 */
import { aiConfig } from './config.js'
import { ApiError, today } from './utils.js'

const PROVIDER_LABELS = {
  mock: '本地规则',
  openrouter: 'OpenRouter',
  gemini: 'Google Gemini',
  openai: 'OpenAI 兼容服务',
}

const COOLDOWN_MS = 60 * 1000

let downUntil = 0
let lastError = ''

/**
 * 全局每日云端调用计数。
 *
 * 免费额度是整个账号共享的，不跟着用户走：5 个用户各自 30 次/小时，
 * 一小时就能把供应商的每日额度打满。这里按自然日计数（进程内），
 * 超出后直接抛 AI_DAILY_LIMIT，由调用方回退本地规则。
 * 重启会清零；对 1–5 人的小规模部署够用，也避免为了计数写磁盘。
 */
let usage = { date: '', count: 0 }

function rollUsage() {
  const date = today()
  if (usage.date !== date) usage = { date, count: 0 }
  return usage
}

/** 供 /api/ai/status 使用：今日云端用量与剩余额度（不暴露密钥） */
export function cloudQuota() {
  const { dailyLimit } = aiConfig()
  const current = rollUsage()
  return {
    date: current.date,
    used: current.count,
    limit: dailyLimit,
    remaining: dailyLimit > 0 ? Math.max(0, dailyLimit - current.count) : null,
    exhausted: dailyLimit > 0 && current.count >= dailyLimit,
  }
}

export function providerLabel(provider) {
  return PROVIDER_LABELS[provider] || provider
}

function markDown(err) {
  downUntil = Date.now() + COOLDOWN_MS
  lastError = err?.message || String(err)
  console.warn(`[ai] 云端模型调用失败，${COOLDOWN_MS / 1000} 秒内改用本地规则：${lastError}`)
}

function markUp() {
  downUntil = 0
  lastError = ''
}

/** 供 /api/ai/status 使用：只暴露是否可用，不暴露密钥 */
export function cloudStatus() {
  const cfg = aiConfig()
  return {
    provider: cfg.provider,
    label: providerLabel(cfg.provider),
    model: cfg.model,
    configured: cfg.configured,
    available: cfg.configured && Date.now() >= downUntil && !cloudQuota().exhausted,
    lastError: lastError || null,
    quota: cloudQuota(),
  }
}

/**
 * 从模型输出里提取 JSON。
 * 免费模型经常加 ```json 代码块或前后解释文字，这里做容错。
 */
export function extractJson(raw) {
  const text = String(raw || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  if (!text) return null

  const candidates = [text]
  const start = text.search(/[{[]/)
  if (start >= 0) {
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'))
    if (end > start) candidates.push(text.slice(start, end + 1))
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate)
    } catch {
      /* 继续尝试下一个候选 */
    }
  }
  return null
}

/**
 * 调用一次 chat completion，返回纯文本。
 * 出错时抛出 ApiError，调用方负责回落；错误信息不包含 API Key。
 */
export async function chatCompletion(messages, { temperature = 0.2, maxTokens = 800 } = {}) {
  const cfg = aiConfig()
  if (!cfg.configured) {
    throw new ApiError('未配置云端 AI', 503, 'AI_NOT_CONFIGURED')
  }
  if (Date.now() < downUntil) {
    throw new ApiError('云端 AI 暂时不可用', 503, 'AI_COOLING')
  }
  if (cloudQuota().exhausted) {
    throw new ApiError('今日云端 AI 额度已用完，已改用本地规则', 429, 'AI_DAILY_LIMIT')
  }
  // 上游无论成功失败通常都会消耗额度，这里按「尝试次数」计数
  rollUsage().count += 1

  const url = `${cfg.baseUrl}/chat/completions`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs)

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        ...(cfg.provider === 'openrouter'
          ? { 'HTTP-Referer': 'http://localhost:3000', 'X-Title': '轻记' }
          : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: controller.signal,
    })

    const bodyText = await res.text()
    if (!res.ok) {
      let detail = `HTTP ${res.status}`
      try {
        const data = JSON.parse(bodyText)
        detail = data?.error?.message || data?.message || detail
      } catch {
        /* 上游可能返回 HTML，保留状态码即可 */
      }
      throw new Error(detail)
    }

    let data
    try {
      data = JSON.parse(bodyText)
    } catch {
      throw new Error('云端返回的不是 JSON')
    }

    const content = data?.choices?.[0]?.message?.content
    const text = Array.isArray(content)
      ? content.map((part) => part?.text || '').join('')
      : String(content || '')
    if (!text.trim()) throw new Error('云端返回内容为空')

    markUp()
    return text.trim()
  } catch (err) {
    if (err instanceof ApiError) throw err
    if (err?.name === 'AbortError') {
      markDown(new Error(`请求超时（${cfg.timeoutMs}ms）`))
      throw new ApiError('云端 AI 响应超时', 504, 'AI_TIMEOUT')
    }
    markDown(err)
    throw new ApiError('云端 AI 暂时不可用', 502, 'AI_UPSTREAM')
  } finally {
    clearTimeout(timer)
  }
}
