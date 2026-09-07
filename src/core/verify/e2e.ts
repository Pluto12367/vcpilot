import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { LlmConfig } from '../../shared/config.js'
import { c } from '../../shared/util.js'
import { chat } from '../llm/client.js'
import { selfRoot } from '../repo/devserver.js'
import type { AcItem } from '../spec/specs.js'

/* ---------------- 测试生成 ---------------- */

export const E2E_SYSTEM = `你是资深 Playwright 测试工程师,把验收标准转成可执行的 E2E 测试代码。
只输出 TypeScript 测试代码正文(不要 import、不要 describe、不要 markdown 围栏),工具会把它包进预置骨架。

硬性契约:
1. 每条验收标准一个 test,标题必须以 AC 编号开头,格式:test('AC1: 简短描述', async ({ page }) => {...})
2. 页面地址用常量 BASE(骨架已提供),如 await page.goto(BASE + '/')
3. 优先 getByRole/getByText/getByPlaceholder 等语义定位;断言用 expect 并依赖自动等待,不要写死 sleep
4. 涉及视觉/布局/交互状态的验收标准,在断言前调用 shot(page, 'AC<N>')(骨架已提供,会截图并保存 DOM 文本)
5. 下载类验收:用 Promise.all([page.waitForEvent('download'), 触发动作]) 模式断言文件名与流内容
6. 每个测试独立可跑,不依赖其他测试的执行顺序或残留状态
7. 代码务必能在当下运行:选择器要容错(如文本不完全匹配时用正则),不确定的交互先探索页面结构(从给出的项目上下文推断路由与元素)`

const PREAMBLE = (artifactsRel: string, baseUrl: string) => `// 由 vcpilot 生成:验收标准 → E2E 测试。人工可自由修改,改完直接重跑 vcp verify。
import fs from 'node:fs'
import { test, expect } from '@playwright/test'

const BASE = process.env.VCP_BASE_URL || '${baseUrl}'
const ART = process.env.VCP_ARTIFACTS_DIR || '${artifactsRel}'

fs.mkdirSync(ART, { recursive: true })
async function shot(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.screenshot({ path: ART + '/' + name + '.png', fullPage: true })
  const text = await page.evaluate(() => document.body.innerText)
  fs.writeFileSync(ART + '/' + name + '.dom.txt', String(text))
}
`

export interface GenerateE2EOptions {
  specMd: string
  acs: AcItem[]
  devUrl: string
  llm: LlmConfig
  root: string
  e2eFile: string
}

/** 抓取页面 HTML 给模型做选择器/路由参考(失败忽略) */
async function fetchPageHtml(devUrl: string, maxChars = 3000): Promise<string> {
  try {
    const resp = await fetch(devUrl, { signal: AbortSignal.timeout(5000) })
    const html = await resp.text()
    return html.replace(/<head[\s\S]*?<\/head>/i, '').slice(0, maxChars)
  } catch {
    return ''
  }
}

/** 生成 e2e 测试文件(骨架工具控制,正文 LLM 生成) */
export async function generateE2E(opts: GenerateE2EOptions): Promise<string> {
  const { specMd, acs, devUrl, llm, root, e2eFile } = opts
  const artifactsRel = path.relative(root, path.dirname(e2eFile)).replace(/\\/g, '/') + '/artifacts'

  const acList = acs.map((a) => `- ${a.id}: ${a.text}`).join('\n')
  const html = await fetchPageHtml(devUrl)
  const raw = await chat(
    {
      system: E2E_SYSTEM,
      user: `## 功能规格\n${specMd}\n\n## 验收标准清单\n${acList}\n\n## 运行环境\n- baseURL:${devUrl}\n${html ? `- 首页 HTML(路由与元素以此为准,不要猜测端点):\n\`\`\`html\n${html}\n\`\`\`` : ''}\n\n请基于以上真实页面结构编写测试。`,
      maxTokens: 8000,
      temperature: 0.2
    },
    llm
  )
  const body = raw.replace(/```(?:typescript|ts)?\s*\n?/g, '').replace(/```\s*$/, '').trim()
  const code = PREAMBLE(artifactsRel, devUrl) + '\n' + body + '\n'
  fs.mkdirSync(path.dirname(e2eFile), { recursive: true })
  fs.writeFileSync(e2eFile, code, 'utf8')
  return e2eFile
}

/* ---------------- 测试执行 ---------------- */

export interface AcTestResult {
  id: string
  status: 'passed' | 'failed' | 'not-found'
  error?: string
  durationMs?: number
}

export interface E2ERunResult {
  allOk: boolean
  acResults: AcTestResult[]
  totals: { passed: number; failed: number; total: number }
  durationMs: number
  outputTail: string
}

interface JsonSpec {
  title: string
  ok?: boolean
  tests?: Array<{ results?: Array<{ status?: string; error?: { message?: string } }> }>
  specs?: JsonSpec[]
}

function collectSpecs(node: JsonSpec | undefined, out: JsonSpec[]): void {
  if (!node) return
  if (node.specs) for (const s of node.specs) collectSpecs(s, out)
  if (node.tests) {
    for (const t of node.tests) {
      out.push({
        title: node.title,
        ok: t.results?.every((r) => r.status === 'passed'),
        tests: [t]
      })
    }
  }
}

function runCmd(cmd: string, args: string[], cwd: string, env: Record<string, string>, timeoutMs = 300_000): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32'
    const child = spawn(cmd, args, {
      cwd,
      shell: isWin ? process.env.ComSpec || 'cmd.exe' : true,
      env: { ...process.env, ...env, FORCE_COLOR: '0', NO_COLOR: '1' }
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (d) => (stdout += d.toString()))
    child.stderr?.on('data', (d) => (stderr += d.toString()))
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
    child.on('error', (e) => { clearTimeout(timer); stderr += String(e); resolve({ code: -1, stdout, stderr }) })
  })
}

/** 确保 chromium 已安装(缺失时自动安装,一次性) */
export async function ensureBrowser(): Promise<void> {
  const self = selfRoot()
  const { chromium } = await import('playwright-core')
  const exe = chromium.executablePath()
  if (fs.existsSync(exe)) return
  console.log(c.cyan('[vcp] 首次运行:安装 Playwright chromium(约 1-2 分钟)…'))
  const r = await runCmd('node', [path.join(self, 'node_modules', '@playwright', 'test', 'cli.js'), 'install', 'chromium'], self, {})
  if (r.code !== 0) throw new Error(`chromium 安装失败:${r.stderr.slice(-500)}`)
}

/** 运行生成的 e2e 测试并映射回验收标准 */
export async function runE2E(opts: {
  root: string
  e2eFile: string
  artifactsDir: string
  devUrl: string
  acs: AcItem[]
}): Promise<E2ERunResult> {
  const { root, e2eFile, artifactsDir, devUrl, acs } = opts
  const self = selfRoot()
  const started = Date.now()

  await ensureBrowser()
  fs.rmSync(artifactsDir, { recursive: true, force: true })

  const r = await runCmd(
    'node',
    [
      path.join(self, 'node_modules', '@playwright', 'test', 'cli.js'),
      'test',
      // Playwright 把文件参数当正则过滤:必须用相对路径 + 正斜杠,反斜杠会转义失配
      path.relative(root, e2eFile).split(path.sep).join('/'),
      '--reporter=json',
      '--workers=1',
      '--timeout=20000'
    ],
    root,
    { VCP_BASE_URL: devUrl, VCP_ARTIFACTS_DIR: artifactsDir }
  )

  const outputTail = (r.stdout + '\n' + r.stderr).slice(-4000)
  // JSON reporter 输出占满 stdout;取第一个 { 起解析
  const start = r.stdout.indexOf('{')
  if (start === -1) {
    throw new Error(`无法解析 Playwright 输出(退出码 ${r.code}):${outputTail.slice(-800)}`)
  }
  let report: { suites?: JsonSpec[]; stats?: { expected?: number; unexpected?: number; total?: number } }
  try {
    report = JSON.parse(r.stdout.slice(start))
  } catch {
    throw new Error(`Playwright JSON 解析失败:${outputTail.slice(-800)}`)
  }

  const specs: JsonSpec[] = []
  for (const s of report.suites || []) collectSpecs(s, specs)

  const totals = {
    passed: report.stats?.expected ?? specs.filter((s) => s.ok).length,
    failed: report.stats?.unexpected ?? specs.filter((s) => s.ok === false).length,
    total: report.stats?.total ?? specs.length
  }

  const detailed = specs.map((s) => ({
    title: s.title,
    ok: s.ok,
    error: s.tests?.[0]?.results?.find((res) => res.error?.message)?.error?.message
  }))

  const acResults: AcTestResult[] = acs.map((ac) => {
    const hit =
      detailed.find((s) => s.title.startsWith(`${ac.id}:`)) ||
      detailed.find((s) => /AC\d+/.exec(s.title)?.[0] === ac.id)
    if (!hit) return { id: ac.id, status: 'not-found' }
    return {
      id: ac.id,
      status: hit.ok ? 'passed' : 'failed',
      error: hit.error,
      durationMs: undefined
    }
  })

  return {
    allOk: totals.failed === 0 && totals.total > 0,
    acResults,
    totals,
    durationMs: Date.now() - started,
    outputTail
  }
}
