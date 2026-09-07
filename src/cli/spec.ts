import path from 'node:path'
import { input } from '@inquirer/prompts'
import { loadConfig, requireLlm, ensureVibeDirs } from '../shared/config.js'
import { c, findRoot } from '../shared/util.js'
import { scanRepo } from '../core/repo/scan.js'
import { clarifyQuestions, generateSpecArtifacts } from '../core/spec/generate.js'
import { listSpecs } from '../core/spec/specs.js'

export async function runSpec(
  mode: 'create' | 'interactive' | 'list',
  ideaArg?: string,
  opts: { yes?: boolean } = {}
): Promise<void> {
  if (mode === 'list') return printList()

  const root = findRoot()
  ensureVibeDirs(root)
  const loaded = loadConfig(root)
  const llm = requireLlm(loaded)

  let idea = ideaArg
  if (!idea) {
    idea = await input({ message: '描述你想做的功能:' })
    if (!idea.trim()) {
      console.log(c.yellow('[vcp] 未输入内容,退出'))
      return
    }
  }

  console.log(c.cyan('[vcp] 扫描仓库并准备澄清 …'))
  const scan = scanRepo(root, loaded.config.gates)

  // ---- 澄清 ----
  const answers: { question: string; answer: string }[] = []
  if (opts.yes) {
    console.log(c.dim('(-y)跳过澄清,按推荐默认值生成'))
  } else {
    console.log(c.cyan('[vcp] 生成澄清问题 …'))
    const qs = await clarifyQuestions(idea, scan, llm)
    for (const q of qs) {
      console.log(c.dim(`  ${q.why ? `(${q.why})` : ''}`))
      const ans = await input({ message: q.question, default: q.default || '' })
      answers.push({ question: q.question, answer: ans || q.default || '' })
    }
  }

  // ---- 生成与落盘 ----
  const result = await generateSpecArtifacts({
    vibeDir: loaded.vibeDir,
    root,
    idea,
    answers,
    scan,
    llm,
    onStep: (m) => console.log(c.cyan(`[vcp] ${m}`))
  })

  console.log(c.green(`\n[vcp] 规格已生成:${result.dir}`))
  console.log(c.dim(`  验收标准 ${result.acs.length} 条:`))
  for (const ac of result.acs) console.log(c.dim(`  ${ac.id}: ${ac.text.slice(0, 72)}${ac.text.length > 72 ? '…' : ''}`))
  console.log(`\n下一步:`)
  let step = 1
  console.log(c.dim(`  ${step++}. 检查并修改 ${path.relative(root, result.specFile)}`))
  if (result.tasksFile) console.log(c.dim(`  ${step++}. 把 ${path.relative(root, result.tasksFile)} 交给 coding agent 按 T 编号逐条实施`))
  console.log(c.dim(`  ${step++}. 实施完成后运行 vcp verify ${result.id} --e2e 做验收`))
}

function printList(): void {
  const root = findRoot()
  const loaded = loadConfig(root)
  const specs = listSpecs(loaded.vibeDir)
  if (!specs.length) {
    console.log(c.dim('(尚无规格,用 vcp spec "<想法>" 创建)'))
    return
  }
  const statusCn: Record<string, string> = { draft: '草稿', implementing: '实施中', done: '已完成' }
  for (const s of specs) {
    console.log(`${c.cyan(s.id)}  ${statusCn[s.status] || s.status}  ${s.title}  ${c.dim(s.createdAt)}`)
  }
}
