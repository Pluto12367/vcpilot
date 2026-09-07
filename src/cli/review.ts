import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, requireLlm } from '../shared/config.js'
import { c, findRoot } from '../shared/util.js'
import { runReview as runReviewEngine, reviewReportMarkdown, fixPrompt } from '../core/review/review.js'
import { saveReport } from '../core/verify/gates.js'

export async function runReview(opts: { staged?: boolean; base?: string; fix?: boolean }): Promise<void> {
  const root = findRoot()
  const loaded = loadConfig(root)
  const llm = requireLlm(loaded)

  console.log(c.cyan(`[vcp] 获取 diff(${opts.staged ? 'staged' : opts.base || '工作区 vs HEAD'})…`))
  const report = await runReviewEngine(root, loaded.vibeDir, llm, { staged: opts.staged, base: opts.base })

  if (!report.stats.chunks) {
    console.log(c.yellow('[vcp] 没有可审查的改动。'))
    return
  }
  console.log(
    c.dim(`  变更:${report.stats.files} 文件,+${report.stats.add}/-${report.stats.del},分 ${report.stats.chunks} 块,三 pass 审查中…`)
  )

  const md = reviewReportMarkdown(report)
  const file = saveReport(loaded.vibeDir, 'review', md)

  const sev = (s: string) => report.findings.filter((f) => f.severity === s).length
  console.log(
    `\n发现 ${report.findings.length} 条:` +
      c.red(` critical:${sev('critical')}`) +
      c.yellow(` major:${sev('major')}`) +
      c.dim(` minor:${sev('minor')} info:${sev('info')}`)
  )
  console.log(c.dim(`  报告:${path.relative(root, file)}`))

  for (const f of report.findings.filter((x) => x.severity === 'critical' || x.severity === 'major')) {
    const icon = f.severity === 'critical' ? c.red('🔴') : c.yellow('🟠')
    console.log(`  ${icon} [${f.pass}/${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.title}`)
  }

  if (opts.fix) {
    const prompt = fixPrompt(report)
    if (prompt) {
      const fixFile = path.join(root, '.vibe', 'reports', 'fix-prompt.md')
      fs.writeFileSync(fixFile, prompt, 'utf8')
      console.log(c.green(`\n[vcp] 修复 prompt 已生成:${path.relative(root, fixFile)}`))
      console.log(c.dim('  把它粘贴给 coding agent(或让 agent 读取该文件)执行修复。'))
    } else {
      console.log(c.dim('没有 critical/major 问题,无需生成修复 prompt。'))
    }
  }

  if (sev('critical') > 0) process.exit(1)
}
