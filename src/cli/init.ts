import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, requireLlm, ensureVibeDirs } from '../shared/config.js'
import { c, findRoot } from '../shared/util.js'
import { scanRepo } from '../core/repo/scan.js'
import { AGENTS_MD_SYSTEM, buildAgentsUser } from '../core/llm/prompts.js'
import { chat } from '../core/llm/client.js'

export async function runInit(opts: { force?: boolean }): Promise<void> {
  const root = findRoot()
  ensureVibeDirs(root)
  const loaded = loadConfig(root)
  const llm = requireLlm(loaded)

  console.log(c.cyan(`[vcp] 扫描仓库:${root}`))
  const scan = scanRepo(root, loaded.config.gates)
  console.log(c.dim(`  技术栈:${scan.stack.join(', ')}`))
  console.log(
    c.dim(`  门禁探测:${Object.entries(scan.gates).map(([k, v]) => `${k}=${v ? '✓' : '-'}`).join(' ')}`)
  )

  const agentsFile = path.join(root, 'AGENTS.md')
  if (fs.existsSync(agentsFile) && !opts.force) {
    console.log(c.yellow('[vcp] AGENTS.md 已存在,跳过(用 --force 覆盖)'))
  } else {
    console.log(c.cyan('[vcp] 生成 AGENTS.md …'))
    const md = await chat({ system: AGENTS_MD_SYSTEM, user: buildAgentsUser(scan), maxTokens: 4000 }, llm)
    fs.writeFileSync(agentsFile, md.trimStart() + '\n', 'utf8')
    console.log(c.green(`  ✓ ${agentsFile}`))
  }

  const configFile = path.join(root, '.vibe', 'config.yaml')
  if (!fs.existsSync(configFile)) {
    const template = [
      '# vcpilot 配置(所有字段可省略)',
      'version: 1',
      '',
      '# LLM:任意 OpenAI 兼容接口;也可用环境变量 VCP_BASE_URL / VCP_MODEL / VCP_API_KEY',
      'llm:',
      '  baseURL: https://open.bigmodel.cn/api/paas/v4',
      '  model: glm-4.6',
      '  apiKey: ""   # 建议用环境变量,不要提交到 git',
      '',
      '# 静态门禁命令;留空/删掉的项自动探测或跳过',
      'gates:',
      ...(scan.gates.lint ? [`  lint: ${JSON.stringify(scan.gates.lint)}`] : ['  lint: ""']),
      ...(scan.gates.typecheck ? [`  typecheck: ${JSON.stringify(scan.gates.typecheck)}`] : []),
      ...(scan.gates.test ? [`  test: ${JSON.stringify(scan.gates.test)}`] : []),
      ...(scan.gates.build ? [`  build: ${JSON.stringify(scan.gates.build)}`] : []),
      '',
      '# dev server(为后续浏览器验收准备)',
      'dev:',
      '  startCommand: ""',
      '  url: http://localhost:5173',
      ''
    ].join('\n')
    fs.writeFileSync(configFile, template, 'utf8')
    console.log(c.green(`  ✓ ${configFile}`))
  }

  console.log(c.green(`\n[vcp] init 完成。下一步:vcp spec "<你的想法>"`))
}
