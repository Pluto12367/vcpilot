import path from 'node:path'
import { loadConfig } from '../shared/config.js'
import { c, findRoot } from '../shared/util.js'
import { runVerification } from '../core/verify/orchestrator.js'
import { saveReport } from '../core/verify/gates.js'

export interface VerifyOpts {
  e2e?: boolean
  judge?: boolean
  regen?: boolean
  skipStatic?: boolean
}

export async function runVerify(specId: string | undefined, opts: VerifyOpts): Promise<void> {
  const root = findRoot()
  const loaded = loadConfig(root)

  const outcome = await runVerification({
    root,
    vibeDir: loaded.vibeDir,
    config: loaded.config,
    llm: loaded.llm,
    specId,
    e2e: opts.e2e,
    judge: opts.judge,
    regen: opts.regen,
    runStatic: !opts.skipStatic,
    onStep: (m) => console.log(c.cyan(`[vcp] ${m}`))
  })

  if (outcome.staticReport) {
    const md = '# vcpilot 静态门禁报告\n\n' + outcome.staticReport.results
      .map((r) => `- **${r.name}**: ${r.skipped ? '_(未配置)_' : r.ok ? '✅' : '❌'} ${r.skipped ? '' : `\`${r.command}\``}`)
      .join('\n')
    const file = saveReport(loaded.vibeDir, 'static-gates', md)
    console.log(c.dim(`  报告:${path.relative(root, file)}`))
    for (const f of outcome.staticReport.results.filter((r) => !r.ok && !r.skipped)) {
      console.log(c.red(`\n── ${f.name} 输出尾部 ──`))
      console.log(c.dim(f.outputTail.trim()))
    }
  }

  if (outcome.spec) {
    console.log(c.dim(`验收对象:${outcome.spec.id} ${outcome.spec.title}(${outcome.spec.acs.length} 条验收标准)`))
  }

  if (outcome.e2e) {
    console.log(`  统计:✅ ${outcome.e2e.totals.passed} / ❌ ${outcome.e2e.totals.failed} / 共 ${outcome.e2e.totals.total}(${(outcome.e2e.durationMs / 1000).toFixed(1)}s)`)
    for (const ac of outcome.e2e.acResults) {
      const icon = ac.status === 'passed' ? c.green('✓') : ac.status === 'failed' ? c.red('✗') : c.yellow('?')
      console.log(`  ${icon} ${ac.id}:${ac.status}${ac.error ? c.dim(` — ${ac.error.split('\n')[0].slice(0, 90)}`) : ''}`)
    }
  }

  if (outcome.judge) {
    for (const v of outcome.judge) {
      const icon =
        v.verdict === 'pass' ? c.green('✓') :
        v.verdict === 'fail' ? c.red('✗') :
        v.verdict === 'uncertain' ? c.yellow('?') : c.dim('·')
      console.log(`  ${icon} ${v.ac} [${v.verdict}] ${v.reason.slice(0, 90)}`)
    }
  }

  if (outcome.e2eFile && opts.e2e) {
    console.log(c.dim(`  测试文件:${path.relative(root, outcome.e2eFile)}(人工可修改,重跑 verify 即生效)`))
  }

  console.log()

  if (outcome.allOk) {
    console.log(c.green('[vcp] 验收通过'))
  } else {
    console.log(c.red('[vcp] 验收未通过'))
    process.exitCode = 1
  }
}
