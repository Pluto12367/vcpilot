import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import type { LlmConfig } from '../../shared/config.js'
import { chat } from '../llm/client.js'
import { extractJSONStrict } from '../llm/json.js'
import {
  REVIEW_BUGS_SYSTEM,
  REVIEW_CONVENTIONS_SYSTEM,
  REVIEW_SECURITY_SYSTEM,
  buildReviewUser,
  type ReviewFindingRaw
} from '../llm/prompts.js'

export type Severity = 'critical' | 'major' | 'minor' | 'info'

export interface Finding extends ReviewFindingRaw {
  pass: string
}

export interface ReviewReport {
  findings: Finding[]
  base: string
  stats: { files: number; add: number; del: number; chunks: number }
  ranAt: string
  durationMs: number
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, major: 1, minor: 2, info: 3 }

const MAX_CHUNK_CHARS = 24_000 // 每块 diff 上限,避免单次请求过大

/** 取 git diff 文本:staged、或 base..HEAD/工作区 */
export function getDiff(root: string, opts: { staged?: boolean; base?: string }): { diff: string; base: string } {
  const git = (args: string[]) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

  if (opts.staged) {
    const r = git(['diff', '--staged', '-U3'])
    if (r.status !== 0) throw new Error(`git diff --staged 失败:${r.stderr}`)
    return { diff: r.stdout, base: 'HEAD(staged)' }
  }
  const base = opts.base || 'HEAD'
  const r = git(['diff', base, '-U3'])
  if (r.status !== 0) throw new Error(`git diff ${base} 失败:${r.stderr}`)
  // 未提交改动可能同时在工作区与暂存区,补上 staged
  const r2 = git(['diff', '--staged', '-U3'])
  const diff = (r2.status === 0 && r2.stdout ? r2.stdout + '\n' : '') + r.stdout
  return { diff: diff.trim(), base }
}

/** 按文件边界把 diff 切成大小受控的块 */
export function chunkDiff(diff: string, maxChars = MAX_CHUNK_CHARS): string[] {
  if (diff.length <= maxChars) return [diff]
  const fileBlocks = diff.split(/\n(?=diff --git )/)
  const chunks: string[] = []
  let cur = ''
  for (const block of fileBlocks) {
    // 单个文件块超限:硬切
    if (block.length > maxChars) {
      if (cur) { chunks.push(cur); cur = '' }
      for (let i = 0; i < block.length; i += maxChars) chunks.push(block.slice(i, i + maxChars))
      continue
    }
    if (cur.length + block.length > maxChars) { chunks.push(cur); cur = block }
    else cur = cur ? cur + '\n' + block : block
  }
  if (cur) chunks.push(cur)
  return chunks
}

export function diffStats(diff: string): { files: number; add: number; del: number } {
  const files = new Set<string>()
  let add = 0
  let del = 0
  for (const line of diff.split('\n')) {
    const fm = line.match(/^diff --git a\/(.+?) b\//)
    if (fm) files.add(fm[1])
    else if (line.startsWith('+') && !line.startsWith('+++')) add++
    else if (line.startsWith('-') && !line.startsWith('---')) del++
  }
  return { files: files.size, add, del }
}

/** 项目规范上下文:AGENTS.md + 活跃 spec 的 AC 摘要 */
export function conventionsContext(root: string, vibeDir: string): string | undefined {
  const parts: string[] = []
  const agents = path.join(root, 'AGENTS.md')
  if (fs.existsSync(agents)) {
    const md = fs.readFileSync(agents, 'utf8')
    parts.push(`### AGENTS.md(节选,前 4000 字)\n${md.slice(0, 4000)}`)
  }
  const specsDir = path.join(vibeDir, 'specs')
  if (fs.existsSync(specsDir)) {
    const latest = fs.readdirSync(specsDir).sort().pop()
    const specFile = latest && path.join(specsDir, latest, 'spec.md')
    if (specFile && fs.existsSync(specFile)) {
      const acs = fs
        .readFileSync(specFile, 'utf8')
        .split('\n')
        .filter((l) => /^[-*]\s+\[.\]\s+AC\d+\s*[:：]/.test(l))
        .join('\n')
      if (acs) parts.push(`### 活跃规格 ${latest} 的验收标准(实现须满足)\n${acs}`)
    }
  }
  return parts.length ? parts.join('\n\n') : undefined
}

async function runPass(
  name: string,
  system: string,
  chunk: string,
  ctx: { conventions?: string; chunkIndex: number; chunkTotal: number },
  llm: LlmConfig
): Promise<Finding[]> {
  const user = buildReviewUser({ diffText: chunk, conventionsCtx: name === 'conventions' ? ctx.conventions : undefined, chunkIndex: ctx.chunkIndex, chunkTotal: ctx.chunkTotal })
  const raw = await chat({ system, user, json: true, maxTokens: 4000, temperature: 0.1 }, llm)
  const parsed = extractJSONStrict<{ findings: ReviewFindingRaw[] }>(raw, '审查结果 JSON')
  const findings = Array.isArray(parsed.findings) ? parsed.findings : []
  return findings.map((f) => ({ ...f, pass: name }))
}

export async function runReview(
  root: string,
  vibeDir: string,
  llm: LlmConfig,
  opts: { staged?: boolean; base?: string; passes?: string[] }
): Promise<ReviewReport> {
  const started = Date.now()
  const { diff, base } = getDiff(root, opts)
  if (!diff.trim()) {
    return { findings: [], base, stats: { files: 0, add: 0, del: 0, chunks: 0 }, ranAt: new Date().toISOString(), durationMs: Date.now() - started }
  }
  const chunks = chunkDiff(diff)
  const stats = { ...diffStats(diff), chunks: chunks.length }
  const passes = opts.passes || ['conventions', 'bugs', 'security']
  const conventions = conventionsContext(root, vibeDir)
  const findings: Finding[] = []

  for (const pass of passes) {
    for (let i = 0; i < chunks.length; i++) {
      const system =
        pass === 'bugs' ? REVIEW_BUGS_SYSTEM : pass === 'security' ? REVIEW_SECURITY_SYSTEM : REVIEW_CONVENTIONS_SYSTEM
      try {
        const f = await runPass(pass, system, chunks[i], { conventions, chunkIndex: i + 1, chunkTotal: chunks.length }, llm)
        findings.push(...f)
      } catch (e) {
        // 单 pass 失败不阻塞其他 pass,降级为一条 info
        findings.push({
          pass,
          severity: 'info',
          file: '(review)',
          title: `${pass} pass 第 ${i + 1} 块审查失败`,
          detail: (e as Error).message
        })
      }
    }
  }

  findings.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
  return { findings, base, stats, ranAt: new Date().toISOString(), durationMs: Date.now() - started }
}

export function reviewReportMarkdown(report: ReviewReport): string {
  const lines: string[] = [
    `# vcpilot 代码审查报告`,
    '',
    `- 对比基准:\`${report.base}\``,
    `- 变更规模:${report.stats.files} 个文件,+${report.stats.add} / -${report.stats.del},分 ${report.stats.chunks} 块`,
    `- 时间:${report.ranAt}`,
    `- 发现:${report.findings.length} 条(critical ${report.findings.filter((f) => f.severity === 'critical').length} / major ${report.findings.filter((f) => f.severity === 'major').length} / minor ${report.findings.filter((f) => f.severity === 'minor').length} / info ${report.findings.filter((f) => f.severity === 'info').length})`,
    ''
  ]
  if (!report.findings.length) {
    lines.push('✅ 未发现问题。')
    return lines.join('\n')
  }
  const icon: Record<Severity, string> = { critical: '🔴', major: '🟠', minor: '🟡', info: '🔵' }
  for (const f of report.findings) {
    lines.push(
      `## ${icon[f.severity]} [${f.severity.toUpperCase()}] ${f.title}`,
      '',
      `- 文件:${f.file}${f.line ? `:${f.line}` : ''}(pass:${f.pass})`,
      '',
      f.detail,
      ...(f.suggestion ? ['', `**建议**:${f.suggestion}`] : []),
      ''
    )
  }
  return lines.join('\n')
}

/** 生成回喂 coding agent 的修复 prompt(--fix 用) */
export function fixPrompt(report: ReviewReport): string {
  const actionable = report.findings.filter((f) => f.severity === 'critical' || f.severity === 'major')
  if (!actionable.length) return ''
  const lines = [
    '请修复以下代码审查发现的问题(按严重度排序)。逐条修改对应文件;若认为某条不成立,说明理由跳过:',
    ''
  ]
  actionable.forEach((f, i) => {
    lines.push(
      `${i + 1}. [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.title}`,
      `   问题:${f.detail}`,
      ...(f.suggestion ? [`   建议:${f.suggestion}`] : []),
      ''
    )
  })
  return lines.join('\n')
}
