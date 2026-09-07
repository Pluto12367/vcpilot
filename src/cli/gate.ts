import path from 'node:path'
import { loadConfig, requireLlm } from '../shared/config.js'
import { c, findRoot } from '../shared/util.js'
import { runVerify } from './verify.js'
import { runReview as runReviewEngine, reviewReportMarkdown, fixPrompt, type ReviewReport } from '../core/review/review.js'
import { saveReport } from '../core/verify/gates.js'
import fs from 'node:fs'

export interface GateOpts {
  staged?: boolean
  e2e?: boolean
  judge?: boolean
  quick?: boolean
}

/**
 * 一条龙:静态门禁 →(可选)e2e+裁判 → AI 审查。
 * 任何环节失败退出码 1,可直接接 git hook / CI。
 */
export async function runGate(specId: string | undefined, opts: GateOpts): Promise<void> {
  const root = findRoot()
  const loaded = loadConfig(root)

  console.log(c.bold(c.cyan('\n═══ [1/2] 验收(verify)═══')))
  await runVerify(specId, {
    e2e: opts.e2e && !opts.quick,
    judge: opts.judge && !opts.quick,
    skipStatic: false
  })
  // runVerify 失败时设了 process.exitCode=1,但我们还要跑 review,最后统一退出
  const verifyFailed = process.exitCode === 1
  process.exitCode = 0

  console.log(c.bold(c.cyan('\n═══ [2/2] AI 审查(review)═══')))
  const llm = requireLlm(loaded)
  const report: ReviewReport = await runReviewEngine(root, loaded.vibeDir, llm, {
    staged: opts.staged
  })
  const md = reviewReportMarkdown(report)
  const file = saveReport(loaded.vibeDir, 'review', md)
  const sev = (s: string) => report.findings.filter((f) => f.severity === s).length
  if (report.stats.chunks) {
    console.log(
      `发现 ${report.findings.length} 条:` +
        c.red(` critical:${sev('critical')}`) +
        c.yellow(` major:${sev('major')}`) +
        c.dim(` minor:${sev('minor')} info:${sev('info')}`) +
        c.dim(`  报告:${path.relative(root, file)}`)
    )
    for (const f of report.findings.filter((x) => x.severity === 'critical' || x.severity === 'major')) {
      const icon = f.severity === 'critical' ? c.red('🔴') : c.yellow('🟠')
      console.log(`  ${icon} [${f.pass}/${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.title}`)
    }
    const prompt = fixPrompt(report)
    if (prompt) {
      const fixFile = path.join(root, '.vibe', 'reports', 'fix-prompt.md')
      fs.writeFileSync(fixFile, prompt, 'utf8')
      console.log(c.dim(`  修复 prompt:${path.relative(root, fixFile)}(粘回给 agent 执行)`))
    }
  } else {
    console.log(c.dim('  无待审查改动'))
  }

  // 汇总裁决
  const reviewFailed = sev('critical') > 0
  console.log(c.bold(c.cyan('\n═══ gate 汇总 ═══')))
  console.log(`  验收(verify):${verifyFailed ? c.red('❌ 未通过') : c.green('✅ 通过')}`)
  console.log(`  审查(review):${reviewFailed ? c.red('❌ 有 critical') : c.green('✅ 通过')}`)
  if (verifyFailed || reviewFailed) {
    process.exitCode = 1
  } else {
    console.log(c.green('  全部通过,可以提交'))
  }
}
