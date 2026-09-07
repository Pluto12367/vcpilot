import fs from 'node:fs'
import path from 'node:path'
import type { LlmConfig, VcpConfig } from '../../shared/config.js'
import { findSpec, parseAcs } from '../spec/specs.js'
import { runStaticGates, type StaticReport } from './gates.js'
import { ensureDevServer } from '../repo/devserver.js'
import { generateE2E, runE2E, type E2ERunResult, type AcTestResult } from './e2e.js'
import { judgeAcs, type JudgeResult } from './judge.js'
import type { AcItem } from '../spec/specs.js'

export interface VerifyOutcome {
  staticReport?: StaticReport
  spec?: { id: string; title: string; dir: string; acs: AcItem[] }
  devUrl?: string
  e2e?: E2ERunResult
  e2eFile?: string
  judge?: JudgeResult[]
  allOk: boolean
  /** 汇总文本(CLI 与 MCP 共用渲染) */
  render: () => string
}

export interface VerifyRequest {
  root: string
  vibeDir: string
  config: VcpConfig
  llm?: LlmConfig
  specId?: string
  e2e?: boolean
  judge?: boolean
  regen?: boolean
  runStatic?: boolean
  onStep?: (msg: string) => void
}

function fmtStatic(report: StaticReport): string {
  const rows = report.results.map(
    (r) => `- ${r.name}:${r.skipped ? '未配置,跳过' : r.ok ? '✅ 通过' : `❌ 失败(${(r.durationMs / 1000).toFixed(1)}s)`}`
  )
  return ['静态门禁:', ...rows].join('\n')
}

function fmtE2E(e2e: E2ERunResult, acResults: AcTestResult[]): string {
  const lines = [
    `E2E 验收:✅ ${e2e.totals.passed} / ❌ ${e2e.totals.failed} / 共 ${e2e.totals.total}(${(e2e.durationMs / 1000).toFixed(1)}s)`
  ]
  for (const ac of acResults) {
    const icon = ac.status === 'passed' ? '✓' : ac.status === 'failed' ? '✗' : '?'
    lines.push(`${icon} ${ac.id}:${ac.status}${ac.error ? ` — ${ac.error.split('\n')[0].slice(0, 120)}` : ''}`)
  }
  return lines.join('\n')
}

function fmtJudge(judge: JudgeResult[]): string {
  return ['视觉裁判:', ...judge.map((v) => `${v.verdict === 'pass' ? '✓' : v.verdict === 'fail' ? '✗' : '?'} ${v.ac} [${v.verdict}] ${v.reason.slice(0, 120)}`)].join('\n')
}

/** 验收编排:静态门禁 → e2e → 裁判。CLI 与 MCP 共用。 */
export async function runVerification(req: VerifyRequest): Promise<VerifyOutcome> {
  const { root, vibeDir, config, llm, specId, e2e: wantE2E, judge: wantJudge, regen, runStatic = true, onStep = () => {} } = req
  const outcome: VerifyOutcome = {
    allOk: true,
    render: () => '验收进行中…'
  }

  // 1. 静态门禁
  const gates = config.gates || {}
  const hasGates = Object.values(gates).some(Boolean)
  if (runStatic && hasGates) {
    onStep('执行静态门禁 …')
    outcome.staticReport = await runStaticGates(root, gates)
    if (!outcome.staticReport.allOk) outcome.allOk = false
  }

  // 2/3. e2e + judge
  if (wantE2E || wantJudge) {
    if (!specId) throw new Error('e2e/judge 验收需要 spec 编号')
    const meta = findSpec(vibeDir, specId)
    const specMd = fs.readFileSync(path.join(meta.dir, 'spec.md'), 'utf8')
    const acs = parseAcs(specMd)
    if (!acs.length) throw new Error('该规格没有可解析的验收标准(AC)')
    outcome.spec = { id: meta.id, title: meta.title, dir: meta.dir, acs }

    const dev = await ensureDevServer(root, config.dev || {})
    outcome.devUrl = dev.url

    const e2eDir = path.join(meta.dir, 'e2e')
    const e2eFile = path.join(e2eDir, 'spec.spec.ts')
    const artifactsDir = path.join(e2eDir, 'artifacts')
    outcome.e2eFile = e2eFile

    if (wantE2E) {
      if (!fs.existsSync(e2eFile) || regen) {
        if (!llm) throw new Error('生成 e2e 测试需要配置 LLM')
        onStep('生成 Playwright 验收测试 …')
        await generateE2E({ specMd, acs, devUrl: dev.url, llm, root, e2eFile })
      }
      onStep(`执行 E2E 验收(${dev.url})…`)
      outcome.e2e = await runE2E({ root, e2eFile, artifactsDir, devUrl: dev.url, acs })
      if (!outcome.e2e.allOk) outcome.allOk = false
    }

    if (wantJudge) {
      if (!llm) throw new Error('视觉裁判需要配置 LLM')
      onStep('视觉 LLM 裁判 …')
      outcome.judge = await judgeAcs({
        acs,
        artifactsDir,
        e2eResults: outcome.e2e?.acResults || [],
        llm,
        onStep
      })
      if (outcome.judge.some((v) => v.verdict === 'fail')) outcome.allOk = false
    }
  }

  // 供 CLI/MCP 渲染
  outcome.render = () =>
    [
      outcome.staticReport ? fmtStatic(outcome.staticReport) : null,
      outcome.spec && outcome.e2e ? fmtE2E(outcome.e2e, outcome.e2e.acResults) : null,
      outcome.judge ? fmtJudge(outcome.judge) : null,
      `结论:${outcome.allOk ? '✅ 验收通过' : '❌ 验收未通过'}`
    ]
      .filter(Boolean)
      .join('\n\n')

  return outcome
}
