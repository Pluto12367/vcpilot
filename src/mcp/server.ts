#!/usr/bin/env node
/**
 * vcpilot MCP server(stdio):让 ZCode / Cursor / Claude Code 等 coding agent
 * 直接读写规格、勾任务、触发验收与审查、检索项目上下文。
 *
 * 启动:node <vcpilot>/dist/mcp/server.js  或全局安装后:vcp mcp
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, ensureVibeDirs } from '../shared/config.js'
import { findRoot } from '../shared/util.js'
import { listSpecs, findSpec, parseAcs, parseTasks, setTaskDone, setSpecStatus } from '../core/spec/specs.js'
import { generateSpecArtifacts } from '../core/spec/generate.js'
import { scanRepo } from '../core/repo/scan.js'
import { runVerification } from '../core/verify/orchestrator.js'
import { runReview } from '../core/review/review.js'
import { distillRule, appendMemory, syncToAgentsMd } from '../core/memory/memory.js'
import { searchContext } from '../core/context/context.js'

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}
function fail(e: unknown) {
  return { content: [{ type: 'text' as const, text: `错误:${(e as Error).message}` }], isError: true }
}

function ctx() {
  const root = findRoot()
  ensureVibeDirs(root)
  const loaded = loadConfig(root)
  return { root: loaded.root, vibeDir: loaded.vibeDir, config: loaded.config, llm: loaded.llm }
}

const server = new McpServer({ name: 'vcpilot', version: '0.2.0' })

/* ---------- 规格 ---------- */

server.tool('spec_list', '列出项目全部功能规格(编号/标题/状态)', {}, async () => {
  try {
    const { vibeDir } = ctx()
    const specs = listSpecs(vibeDir)
    if (!specs.length) return ok('尚无规格。用 spec_create 创建。')
    return ok(specs.map((s) => `${s.id}  [${s.status}]  ${s.title}  (${s.createdAt})`).join('\n'))
  } catch (e) {
    return fail(e)
  }
})

server.tool('spec_get', '读取规格全文:spec.md + tasks.md + 验收标准与任务状态', { id: z.string().describe('spec 编号,如 001') }, async ({ id }) => {
  try {
    const { vibeDir } = ctx()
    const meta = findSpec(vibeDir, id)
    const specMd = fs.readFileSync(path.join(meta.dir, 'spec.md'), 'utf8')
    const tasksFile = path.join(meta.dir, 'tasks.md')
    const tasksMd = fs.existsSync(tasksFile) ? fs.readFileSync(tasksFile, 'utf8') : ''
    const acs = parseAcs(specMd)
    const tasks = tasksMd ? parseTasks(tasksMd) : []
    const acBlock = acs.map((a) => `- ${a.id}: ${a.text}`).join('\n')
    const taskBlock = tasks.length ? tasks.map((t) => `- [${t.done ? 'x' : ' '}] ${t.id} ${t.text}${t.acs.length ? ` (验收:${t.acs.join(',')})` : ''}`).join('\n') : '(无任务清单)'
    return ok(
      `# ${meta.title}(${meta.id},${meta.status})\n\n## 验收标准\n${acBlock}\n\n## 任务清单\n${taskBlock}\n\n## spec.md 原文\n${specMd}`
    )
  } catch (e) {
    return fail(e)
  }
})

server.tool(
  'spec_create',
  '从想法创建规格:生成 spec.md(验收标准 AC)+ tasks.md。answers 传空则按推荐默认值。',
  {
    idea: z.string().describe('功能想法描述'),
    answers: z
      .array(z.object({ question: z.string(), answer: z.string() }))
      .optional()
      .describe('澄清问答(可空,空则跳过澄清)')
  },
  async ({ idea, answers }) => {
    try {
      const { root, vibeDir, llm } = ctx()
      if (!llm) throw new Error('未配置 LLM(VCP_BASE_URL / VCP_MODEL / VCP_API_KEY)')
      const scan = scanRepo(root)
      const r = await generateSpecArtifacts({
        vibeDir,
        root,
        idea,
        answers: answers || [],
        scan,
        llm,
        onStep: (m) => process.stderr.write(`[vcp] ${m}\n`)
      })
      return ok(
        `规格已创建:${r.dir}\n标题:${r.title}\n验收标准 ${r.acs.length} 条:\n${r.acs.map((a) => `- ${a.id}: ${a.text}`).join('\n')}\n${r.tasksFile ? `任务清单:${r.tasksFile}\n按 T 编号逐条实施;完成后用 verify_spec 验收。` : ''}`
      )
    } catch (e) {
      return fail(e)
    }
  }
)

server.tool('task_update', '勾选/取消任务;若全部完成会把规格状态置为 done', { id: z.string(), task_id: z.string().describe('任务编号,如 T003'), done: z.boolean() }, async ({ id, task_id, done }) => {
  try {
    const { vibeDir } = ctx()
    const meta = findSpec(vibeDir, id)
    const tasksFile = path.join(meta.dir, 'tasks.md')
    if (!fs.existsSync(tasksFile)) throw new Error('该规格没有 tasks.md')
    setTaskDone(tasksFile, task_id, done)
    const tasks = parseTasks(fs.readFileSync(tasksFile, 'utf8'))
    if (done && tasks.length && tasks.every((t) => t.done)) {
      setSpecStatus(meta.dir, 'done')
      return ok(`${task_id} 已完成;全部任务完成,规格 ${meta.id} 状态已置为 done`)
    }
    const left = tasks.filter((t) => !t.done).length
    return ok(`${task_id} 已标记${done ? '完成' : '未完成'};剩余 ${left} 个任务`)
  } catch (e) {
    return fail(e)
  }
})

/* ---------- 验收与审查 ---------- */

server.tool(
  'verify_spec',
  '验收规格:静态门禁(+可选 e2e 与视觉裁判)。返回逐条验收标准结果。',
  {
    id: z.string().describe('spec 编号,如 001'),
    e2e: z.boolean().optional().describe('生成并运行 Playwright 验收测试'),
    judge: z.boolean().optional().describe('视觉 LLM 裁判(基于 e2e 产生的截图/DOM 证据)'),
    regen: z.boolean().optional().describe('强制重新生成 e2e 测试')
  },
  async ({ id, e2e, judge, regen }) => {
    try {
      const { root, vibeDir, config, llm } = ctx()
      const outcome = await runVerification({
        root,
        vibeDir,
        config,
        llm,
        specId: id,
        e2e: e2e || judge || false, // 裁判依赖证据,至少要跑一次 e2e 产生证据
        judge: judge || false,
        regen,
        onStep: (m) => process.stderr.write(`[vcp] ${m}\n`)
      })
      const render = outcome.render!()
      return ok(render)
    } catch (e) {
      return fail(e)
    }
  }
)

server.tool('review_diff', 'AI 三 pass 代码审查(规范/bug/安全),返回分级发现', { staged: z.boolean().optional(), base: z.string().optional() }, async ({ staged, base }) => {
  try {
    const { root, vibeDir, llm } = ctx()
    if (!llm) throw new Error('未配置 LLM')
    const report = await runReview(root, vibeDir, llm, { staged, base })
    if (!report.stats.chunks) return ok('没有可审查的改动。')
    return ok(
      `审查完成:${report.stats.files} 文件 +${report.stats.add}/-${report.stats.del},发现 ${report.findings.length} 条\n` +
        report.findings
          .map((f) => `- [${f.severity}][${f.pass}] ${f.file}${f.line ? ':' + f.line : ''} ${f.title}\n  ${f.detail}${f.suggestion ? `\n  建议:${f.suggestion}` : ''}`)
          .join('\n')
    )
  } catch (e) {
    return fail(e)
  }
})

/* ---------- 记忆与上下文 ---------- */

server.tool('memory_add', '把经验教训蒸馏成项目规范规则,并同步进 AGENTS.md', { text: z.string().describe('经验教训描述') }, async ({ text }) => {
  try {
    const { root, llm } = ctx()
    let rule = text
    let category = '其他'
    if (llm) {
      const d = await distillRule(text, llm)
      rule = d.rule
      category = d.category
    }
    appendMemory(root, rule, category)
    const sync = syncToAgentsMd(root)
    return ok(`已沉淀:[${category}] ${rule}${sync.synced ? `\n已同步 ${sync.count} 条规则到 AGENTS.md` : '\n(AGENTS.md 不存在,未同步)'}`)
  } catch (e) {
    return fail(e)
  }
})

server.tool('project_context', '检索项目上下文:项目摘要 + AGENTS.md + 与查询相关的文件', { query: z.string().describe('任务关键词,如 "csv 导出"') }, async ({ query }) => {
  try {
    const { root } = ctx()
    const r = searchContext(root, query)
    return ok(
      [
        `## 项目摘要\n${r.summary}`,
        r.agentsMd ? `## AGENTS.md(节选)\n${r.agentsMd}` : null,
        r.hits.length ? `## 相关文件\n${r.hits.map((h) => `- ${h.path}(相关度 ${h.score})${h.excerpt ? `\n  ${h.excerpt}` : ''}`).join('\n')}` : '## 相关文件\n(无匹配)'
      ]
        .filter(Boolean)
        .join('\n\n')
    )
  } catch (e) {
    return fail(e)
  }
})

/* ---------- 启动 ---------- */

await server.connect(new StdioServerTransport())
process.stderr.write('[vcp] vcpilot MCP server ready (stdio)\n')
