import type { LlmConfig } from '../../shared/config.js'
import { truncate } from '../../shared/util.js'

export class LLMError extends Error {
  status?: number
  /** finish_reason=length:输出被截断,调用方可加大 max_tokens 重试 */
  truncated?: boolean
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'LLMError'
    this.status = status
  }
}

const REQUEST_TIMEOUT_MS = 180_000

export interface ChatImage {
  base64: string
  mime?: string
}

export interface ChatOptions {
  system?: string
  user?: string
  /** 图片输入(多模态裁判用);不支持的端点会返回 4xx,调用方可降级为纯文本 */
  images?: ChatImage[]
  maxTokens?: number
  temperature?: number
  /** 要求 JSON 输出(自动带 response_format 降级链) */
  json?: boolean
}

function chatURL(baseURL: string): string {
  const base = String(baseURL || '').replace(/\/+$/, '')
  if (base.endsWith('/chat/completions')) return base
  return base + '/chat/completions'
}

async function requestChat(body: unknown, cfg: LlmConfig): Promise<string> {
  // 用 AbortController 而非 AbortSignal.timeout:后者在 Windows 上
  // 中止请求后进程退出时会触发 libuv assertion 崩溃
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
  let resp: Response
  try {
    resp = await fetch(chatURL(cfg.baseURL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {})
      },
      body: JSON.stringify(body),
      signal: abort.signal
    })
  } catch (e) {
    const err = e as Error & { name?: string }
    const reason = err?.name === 'AbortError' ? '请求超时(3 分钟)' : err?.message || '网络错误'
    throw new LLMError(`无法连接 LLM 接口:${reason}。请检查 baseURL 是否正确、网络是否可达、API Key 是否有效`)
  } finally {
    clearTimeout(timer)
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new LLMError(`LLM 接口返回 ${resp.status}:${truncate(text)}`, resp.status)
  }
  let data: any
  try {
    data = await resp.json()
  } catch {
    throw new LLMError(
      'LLM 接口返回了非 JSON 内容,请确认 baseURL 指向 OpenAI 兼容根路径(通常以 /v1 结尾)'
    )
  }
  const choice = data?.choices?.[0]
  const content = choice?.message?.content
  let out: string
  if (typeof content === 'string') out = content
  else if (Array.isArray(content)) out = content.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join('')
  else out = ''
  if (!out || !out.trim()) {
    if (choice?.finish_reason === 'length') {
      const e = new LLMError('模型输出被 max_tokens 截断')
      e.truncated = true
      throw e
    }
    throw new LLMError('LLM 接口未返回文本内容:' + truncate(JSON.stringify(data), 300))
  }
  if (process.env.VCP_VERBOSE) {
    const u = data?.usage
    if (u) console.error(`[vcp] tokens: prompt=${u.prompt_tokens} completion=${u.completion_tokens}`)
  }
  return out
}

/**
 * OpenAI 兼容 chat 调用(移植自 ux-studio,含 json_mode 与 max_tokens 的多级降级)
 */
export async function chat(options: ChatOptions, cfg: LlmConfig): Promise<string> {
  const {
    system,
    user,
    maxTokens,
    temperature = 0.3,
    json = false
  } = options

  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      {
        role: 'user',
        content:
          options.images?.length
            ? [
                ...(options.user ? [{ type: 'text', text: options.user }] : []),
                ...options.images.map((img) => ({
                  type: 'image_url',
                  image_url: { url: `data:${img.mime || 'image/png'};base64,${img.base64}` }
                }))
              ]
            : user || ''
      }
    ],
    max_tokens: maxTokens ?? cfg.maxTokens ?? 8000,
    temperature: cfg.temperature ?? temperature
  }

  // 截断自动重试:推理类模型的隐藏 reasoning token 也计入 max_tokens,
  // 波动大,截断时双倍上限重试(上限 32768)
  const run = async (b: Record<string, unknown>): Promise<string> => {
    try {
      return await requestChat(b, cfg)
    } catch (e) {
      const err = e as LLMError
      const cur = b.max_tokens as number
      if (err.truncated && cur < 32768) {
        return run({ ...b, max_tokens: Math.min(cur * 2, 32768) })
      }
      throw e
    }
  }

  if (!json) {
    try {
      return await run(body)
    } catch (e) {
      const err = e as LLMError
      // 部分接口对过大的 max_tokens 直接报 400,降级重试一次
      if (err.status === 400 && (body.max_tokens as number) > 4096) {
        return await run({ ...body, max_tokens: 4096 })
      }
      throw e
    }
  }

  try {
    return await run({ ...body, response_format: { type: 'json_object' } })
  } catch (e) {
    const err = e as LLMError
    if (err.status !== 400) throw e
    // response_format 不被支持:去掉后重试
    try {
      return await run(body)
    } catch (e2) {
      const err2 = e2 as LLMError
      if (err2.status === 400 && (body.max_tokens as number) > 4096) {
        return await run({ ...body, max_tokens: 4096 })
      }
      throw e2
    }
  }
}
