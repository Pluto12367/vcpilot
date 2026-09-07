import fs from 'node:fs'
import path from 'node:path'
import YAML from 'yaml'

export interface LlmConfig {
  baseURL: string
  apiKey?: string
  model: string
  maxTokens?: number
  temperature?: number
}

export interface GateConfig {
  lint?: string
  typecheck?: string
  test?: string
  build?: string
}

export interface VcpConfig {
  version?: number
  llm?: LlmConfig
  gates?: GateConfig
  dev?: { startCommand?: string; url?: string }
}

export interface LoadedConfig {
  root: string
  vibeDir: string
  config: VcpConfig
  /** 环境变量优先于文件,两者都没有则为 undefined */
  llm?: LlmConfig
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export function configPath(root: string): string {
  return path.join(root, '.vibe', 'config.yaml')
}

/** 读取 .vibe/config.yaml(可缺省),合并环境变量覆盖 */
export function loadConfig(start = process.cwd()): LoadedConfig {
  let dir = path.resolve(start)
  // 配置只认调用目录及其下的 .vibe,不再向上冒泡(findRoot 已负责定位项目本身)
  const vibeDir = path.join(dir, '.vibe')
  const file = path.join(vibeDir, 'config.yaml')
  let config: VcpConfig = {}
  if (fs.existsSync(file)) {
    try {
      config = YAML.parse(fs.readFileSync(file, 'utf8')) || {}
    } catch (e) {
      throw new ConfigError(`.vibe/config.yaml 解析失败:${(e as Error).message}`)
    }
  }
  const llm = resolveLlm(config.llm)
  return { root: dir, vibeDir, config, llm }
}

function resolveLlm(fromFile?: LlmConfig): LlmConfig | undefined {
  const baseURL = process.env.VCP_BASE_URL || fromFile?.baseURL
  const apiKey = process.env.VCP_API_KEY || fromFile?.apiKey
  const model = process.env.VCP_MODEL || fromFile?.model
  if (baseURL && model) {
    return {
      baseURL,
      apiKey,
      model,
      maxTokens: fromFile?.maxTokens,
      temperature: fromFile?.temperature
    }
  }
  return undefined
}

export function requireLlm(l: LoadedConfig): LlmConfig {
  if (!l.llm) {
    throw new ConfigError(
      '未配置 LLM:请在 .vibe/config.yaml 填写 llm.baseURL / llm.model / llm.apiKey,' +
        '或设置环境变量 VCP_BASE_URL / VCP_MODEL / VCP_API_KEY(支持任意 OpenAI 兼容接口)'
    )
  }
  return l.llm
}

export function saveConfig(root: string, config: VcpConfig): string {
  const vibeDir = path.join(root, '.vibe')
  fs.mkdirSync(vibeDir, { recursive: true })
  const file = configPath(root)
  fs.writeFileSync(file, YAML.stringify(config), 'utf8')
  return file
}

export function ensureVibeDirs(root: string): void {
  for (const sub of ['', 'specs', 'reports']) {
    fs.mkdirSync(path.join(root, '.vibe', sub), { recursive: true })
  }
}
