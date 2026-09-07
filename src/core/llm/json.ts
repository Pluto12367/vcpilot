/**
 * 从模型输出中稳健地提取 JSON:
 * 依次尝试:去代码围栏直接解析 → 截取首个 {/[ 到最后一个 }/] 再解析
 */
export function extractJSON<T = unknown>(text: string): T | null {
  if (!text) return null
  let t = String(text).trim()

  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()

  try {
    return JSON.parse(t) as T
  } catch {
    /* 继续容错 */
  }

  const start = t.search(/[{[]/)
  if (start === -1) return null
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'))
  if (end <= start) return null

  try {
    return JSON.parse(t.slice(start, end + 1)) as T
  } catch {
    return null
  }
}

/** 提取 JSON;失败时抛出带上下文的错误(调用方决定重试或降级) */
export function extractJSONStrict<T>(text: string, what: string): T {
  const v = extractJSON<T>(text)
  if (v == null) {
    throw new Error(`无法从模型输出解析${what},原始输出前 300 字符:${text.slice(0, 300)}`)
  }
  return v
}
