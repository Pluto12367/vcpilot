import type { LlmConfig } from '../../shared/config.js'
import { slugify } from '../../shared/util.js'
import type { RepoScan } from '../repo/scan.js'
import { chat } from '../llm/client.js'
import { extractJSONStrict } from '../llm/json.js'
import { CLARIFY_SYSTEM, SPEC_SYSTEM, TASKS_SYSTEM, buildClarifyUser, buildSpecUser, buildTasksUser } from '../llm/prompts.js'
import { nextSpecId, writeSpec, parseAcs, type AcItem } from './specs.js'

export interface ClarifyQ {
  question: string
  why?: string
  default?: string
}

/** 生成澄清问题(纯函数,CLI 与 MCP 共用) */
export async function clarifyQuestions(idea: string, scan: RepoScan, llm: LlmConfig): Promise<ClarifyQ[]> {
  const raw = await chat(
    { system: CLARIFY_SYSTEM, user: buildClarifyUser(idea, scan), json: true, maxTokens: 2000 },
    llm
  )
  const parsed = extractJSONStrict<{ questions: ClarifyQ[] }>(raw, '澄清问题 JSON')
  return (parsed.questions || []).slice(0, 5)
}

export interface GenerateSpecResult {
  id: string
  slug: string
  title: string
  dir: string
  specFile: string
  tasksFile?: string
  acs: AcItem[]
  markdown: string
}

/**
 * 生成并落盘规格 + 任务清单(非交互)。
 * answers 传空数组 = 跳过澄清按默认值(MCP / -y 场景)。
 */
export async function generateSpecArtifacts(opts: {
  vibeDir: string
  root: string
  idea: string
  answers: { question: string; answer: string }[]
  scan: RepoScan
  llm: LlmConfig
  onStep?: (msg: string) => void
}): Promise<GenerateSpecResult> {
  const { vibeDir, root, idea, answers, scan, llm, onStep = () => {} } = opts

  onStep('生成规格(含验收标准)…')
  const specMd = (
    await chat({ system: SPEC_SYSTEM, user: buildSpecUser(idea, answers, scan), maxTokens: 8000 }, llm)
  )
    .replace(/^```(?:markdown)?\s*\n?/, '')
    .replace(/```\s*$/, '')
    .trim()
  const titleLine = specMd.split('\n').find((l) => /^#\s+\S/.test(l))
  const title = titleLine?.replace(/^#\s+/, '').trim()
  if (!title) throw new Error('规格输出缺少一级标题,请重试')
  const markdown = specMd.replace(/^#\s+\S.*\n/, '').trimStart()

  const acs = parseAcs(markdown)
  if (!acs.length) throw new Error('生成的规格没有可解析的验收标准(AC),请重试或调整想法描述')

  onStep('拆解任务清单 …')
  let tasksMd = ''
  try {
    tasksMd = await chat({ system: TASKS_SYSTEM, user: buildTasksUser(markdown, scan), maxTokens: 6000 }, llm)
  } catch (e) {
    onStep(`任务拆解失败(${(e as Error).message.slice(0, 80)}…),仅保存规格`)
  }

  const id = nextSpecId(vibeDir)
  const slug = slugify(title) || slugify(idea) || `spec-${id}`
  const { dir, specFile, tasksFile } = writeSpec(vibeDir, { id, slug, title, markdown, tasksMd: tasksMd || undefined })

  return { id, slug, title, dir, specFile, tasksFile, acs, markdown }
}
