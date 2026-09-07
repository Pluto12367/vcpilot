import fs from 'node:fs'
import path from 'node:path'
import type { LlmConfig } from '../../shared/config.js'
import { todayISO } from '../../shared/util.js'
import { chat } from '../llm/client.js'

const MEMORY_SYSTEM = `你是工程规范编辑。把一条开发经验教训蒸馏成一条可执行、可判定的项目规范规则。
要求:一行以内;以「应当/不要/必须」开头;具体到代码行为;不写空话。
只输出 JSON:{"rule":"规范规则文本","category":"命名|错误处理|安全|架构|测试|流程|其他"}`

export function memoryFile(root: string): string {
  return path.join(root, '.vibe', 'memory.md')
}

/** 把经验教训蒸馏成规范规则(LLM 失败时降级保存原文) */
export async function distillRule(text: string, llm: LlmConfig): Promise<{ rule: string; category: string; distilled: boolean }> {
  try {
    const raw = await chat({ system: MEMORY_SYSTEM, user: `经验教训:${text}`, json: true, maxTokens: 500, temperature: 0.2 }, llm)
    const parsed = JSON.parse(raw.replace(/```(?:json)?|```/g, '').trim()) as { rule?: string; category?: string }
    if (parsed.rule) return { rule: parsed.rule, category: parsed.category || '其他', distilled: true }
  } catch {
    /* 降级保存原文 */
  }
  return { rule: text, category: '其他', distilled: false }
}

export function appendMemory(root: string, rule: string, category: string): string {
  const file = memoryFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const line = `- [${todayISO()}] [${category}] ${rule}\n`
  fs.appendFileSync(file, fs.existsSync(file) && fs.statSync(file).size ? line : '# 项目经验沉淀(自动蒸馏为规范)\n\n' + line, 'utf8')
  return file
}

export function readMemoryRules(root: string): string[] {
  const file = memoryFile(root)
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => /^-\s+\[/.test(l.trim()))
    .map((l) => l.trim())
}

const SECTION_TITLE = '## 项目经验沉淀(vcpilot)'
const START = '<!-- vcp:memory:start -->'
const END = '<!-- vcp:memory:end -->'

/**
 * 把 memory 规则同步进 AGENTS.md 的受管区块(幂等)。
 * AGENTS.md 不存在时返回 false(由 vcp init 先生成)。
 */
export function syncToAgentsMd(root: string): { synced: boolean; file?: string; count: number } {
  const agents = path.join(root, 'AGENTS.md')
  if (!fs.existsSync(agents)) return { synced: false, count: 0 }
  const rules = readMemoryRules(root)
  const section = rules.length
    ? [SECTION_TITLE, `${START}`, '以下规则来自 vcpilot memory 沉淀,是本项目的强约束,review 与编码都必须遵守:', '', ...rules, `${END}`].join('\n')
    : ''

  let md = fs.readFileSync(agents, 'utf8')
  const startIdx = md.indexOf(START)
  const endIdx = md.indexOf(END)

  if (startIdx !== -1 && endIdx !== -1) {
    // 替换已有区块(连同区块标题一起替换,标题取自受管内容)
    const headStart = md.lastIndexOf('\n## ', startIdx)
    const from = headStart === -1 ? startIdx : headStart + 1
    md = md.slice(0, from) + section + md.slice(endIdx + END.length)
  } else {
    // 追加新区块
    md = md.trimEnd() + '\n\n' + section + '\n'
  }
  fs.writeFileSync(agents, md, 'utf8')
  return { synced: true, file: agents, count: rules.length }
}
