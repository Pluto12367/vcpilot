import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { GateConfig } from '../../shared/config.js'

export interface GateResult {
  name: 'lint' | 'typecheck' | 'test' | 'build'
  command: string
  ok: boolean
  durationMs: number
  /** 输出尾部(报告用) */
  outputTail: string
  skipped?: boolean
}

const TAIL_CHARS = 4000

function runCommand(cmd: string, cwd: string, timeoutMs = 600_000): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const child = spawn(cmd, {
      cwd,
      shell: isWin ? process.env.ComSpec || 'cmd.exe' : true,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    })
    let output = ''
    const collect = (chunk: Buffer) => {
      output += chunk.toString()
      if (output.length > 200_000) output = output.slice(-100_000) // 防爆内存,保留尾部
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, output })
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      output += `\n[vcp] 命令启动失败:${e.message}`
      resolve({ code: -1, output })
    })
  })
}

export interface StaticReport {
  results: GateResult[]
  allOk: boolean
  ranAt: string
  durationMs: number
}

/** 执行静态门禁(lint/typecheck/test/build);未配置的标记 skipped */
export async function runStaticGates(root: string, gates: GateConfig): Promise<StaticReport> {
  const started = Date.now()
  const results: GateResult[] = []
  const order: Array<keyof GateConfig> = ['lint', 'typecheck', 'test', 'build']
  for (const name of order) {
    const cmd = gates[name]
    if (!cmd || !cmd.trim()) {
      results.push({ name, command: '', ok: true, durationMs: 0, outputTail: '', skipped: true })
      continue
    }
    const t0 = Date.now()
    const { code, output } = await runCommand(cmd, root)
    results.push({
      name: name as GateResult['name'],
      command: cmd,
      ok: code === 0,
      durationMs: Date.now() - t0,
      outputTail: output.slice(-TAIL_CHARS)
    })
  }
  return {
    results,
    allOk: results.every((r) => r.ok),
    ranAt: new Date().toISOString(),
    durationMs: Date.now() - started
  }
}

export function staticReportMarkdown(root: string, report: StaticReport): string {
  const lines: string[] = [
    `# vcpilot 静态门禁报告`,
    '',
    `- 项目根:\`${root}\``,
    `- 时间:${report.ranAt}`,
    `- 总耗时:${(report.durationMs / 1000).toFixed(1)}s`,
    `- 结果:**${report.allOk ? '✅ 全部通过' : '❌ 存在失败'}**`,
    '',
    '| 门禁 | 命令 | 结果 | 耗时 |',
    '|---|---|---|---|'
  ]
  for (const r of report.results) {
    lines.push(
      `| ${r.name} | ${r.skipped ? '_(未配置,跳过)_' : `\`${r.command}\``} | ${r.ok ? '✅' : '❌'} | ${(r.durationMs / 1000).toFixed(1)}s |`
    )
  }
  const failed = report.results.filter((r) => !r.ok && !r.skipped)
  if (failed.length) {
    lines.push('', '## 失败详情')
    for (const f of failed) {
      lines.push('', `### ${f.name}(\`${f.command}\`)`, '', '```', f.outputTail.trim(), '```')
    }
  }
  return lines.join('\n')
}

export function saveReport(vibeDir: string, name: string, content: string): string {
  const dir = path.join(vibeDir, 'reports')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = path.join(dir, `${name}-${stamp}.md`)
  fs.writeFileSync(file, content, 'utf8')
  return file
}
