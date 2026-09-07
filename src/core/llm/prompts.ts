import type { RepoScan } from '../repo/scan.js'

/** 仓库上下文块(拼进各类 user 消息,控制体积) */
export function repoContextBlock(scan: RepoScan, maxTreeChars = 2500): string {
  const lines = [
    `## 项目上下文`,
    `- 项目名:${scan.name}`,
    `- 包管理器:${scan.packageManager || '未检出'}`,
    `- 技术栈:${scan.stack.join(', ') || '未检出'}`,
    `- npm scripts:${JSON.stringify(scan.scripts)}`,
    '',
    '### 目录结构(已忽略 node_modules 等)',
    '```',
    scan.tree.slice(0, maxTreeChars),
    '```'
  ]
  return lines.join('\n')
}

/* ============================= spec:澄清问题 ============================= */

export const CLARIFY_SYSTEM = `你是资深的产品/架构顾问,帮助把一个模糊的开发想法变成可实现的功能规格。
你的任务:针对用户的想法,提出少量「对实现结果有实质影响」的澄清问题。

规则:
1. 最多 5 个问题;只问会显著改变实现方案的点(范围边界、数据形态、交互方式、依赖的既有系统、非功能要求如性能/权限)。
2. 不问可以用常识默认值解决的问题;每个问题必须给出你推荐的默认答案。
3. 问题要具体到「用户直接选默认值也能开工」的程度。

只输出 JSON,格式:
{"questions":[{"question":"问题原文","why":"为什么需要问","default":"推荐的默认答案"}]}`

export function buildClarifyUser(idea: string, scan: RepoScan): string {
  return [`## 用户想法\n${idea}\n`, repoContextBlock(scan)].join('\n')
}

/* ============================= spec:规格生成 ============================= */

export const SPEC_SYSTEM = `你是资深软件工程师,为 AI coding agent(ZCode / Cursor 等)撰写可直接执行的功能规格。
vcpilot 会用工具自动解析规格中的验收标准并做机器验证,所以格式契约必须严格遵守。

输出要求:
1. 直接输出 markdown 正文(不要 JSON、不要代码围栏)。
2. 第一行必须是:# <简短中文标题>(有且仅有这一行一级标题)
3. 之后按顺序包含以下章节:
   ## 背景 — 为什么做这件事,解决什么问题(2-4 句)
   ## 用户故事 — 每个故事 ### US<N> (P<N>): 标题,含一句描述;按优先级排序;每个故事独立可交付
   ## 验收标准 — 全文最关键的章节。每个标准一行,格式必须是:
     - [ ] AC1: Given <前置状态> When <操作> Then <可观察的预期结果>
     编号从 AC1 连续递增,不重复、不跳号。每条必须可被自动化验证或截图验证:写具体的数据、文案、状态变化,不写「界面美观」这类无法判定的表述。
   ## 边界情况 — 至少 3 条:非法输入、空数据、并发/重复操作、权限不足等
   ## 非功能需求 — 性能、安全、兼容性等,若无写「无特殊要求」
   ## 假设与范围外 — 明确本次不做什么、依赖什么既有设施
4. 验收标准的数量宁精勿滥:覆盖每个用户故事的主路径 + 关键异常路径,通常 3-8 条。
5. 基于项目上下文写,复用既有技术栈与目录结构,不要发明项目中不存在的东西。
6. 篇幅控制:正文总长 1000 字以内,每个用户故事描述不超过 3 句;宁可精炼不可冗长。`

export function buildSpecUser(idea: string, answers: { question: string; answer: string }[], scan: RepoScan): string {
  const qa = answers.length
    ? ['## 澄清结果', ...answers.map((a) => `- 问:${a.question}\n  答:${a.answer}`), '']
    : []
  return [`## 用户想法\n${idea}\n`, ...qa, repoContextBlock(scan)].join('\n')
}

/* ============================= spec:任务拆解 ============================= */

export const TASKS_SYSTEM = `你是资深软件工程师,把功能规格拆解为 AI coding agent 可逐条执行的任务清单。

输出 markdown(不要 JSON、不要代码围栏),格式契约:
1. 首行:## Tasks: <规格标题>
2. 任务按阶段分组:## Phase 1: <阶段名> …总共 2-3 个阶段,全篇 6-12 个任务。
3. 每个任务一行 checkbox,格式严格为:
   - [ ] T00<N> [P] (AC1, AC3) 任务描述,含明确的目标文件路径
   T 编号连续递增;[P] 表示可与相邻任务并行(改的是不同文件);括号内列出该任务完成后应满足的验收标准编号,无关联则省略括号。
4. 阶段顺序:核心逻辑 → 界面与交互 → 测试与收尾。
5. 任务粒度:一个任务 = agent 一次专注的修改(1-5 个文件);描述一句话写清改哪个文件、做什么。
6. 最后一行加「依赖:」开头的一句话说明串行/并行顺序。全篇务必精炼,不要展开解释。`

export function buildTasksUser(specMd: string, scan: RepoScan): string {
  return [`## 功能规格\n${specMd}\n`, repoContextBlock(scan, 1500)].join('\n')
}

/* ============================= init:AGENTS.md ============================= */

export const AGENTS_MD_SYSTEM = `你是资深工程教练,为当前项目生成 AGENTS.md —— 给 AI coding agent 看的项目指南(遵循 agents.md 开放标准的常见结构)。

输出 markdown(不要代码围栏),必须包含以下章节:
1. # <项目名> —— 一句话说明项目是什么
2. ## 项目宪章 —— 3-5 条本项目不可妥协的原则(技术选型约束、质量底线、架构方向),每条一行加粗标题 + 一句解释
3. ## 常用命令 —— 开发/构建/测试/lint 的真实命令(从项目上下文提取,不要编造)
4. ## 代码结构 —— 主要目录的职责说明
5. ## 代码风格与约定 — 命名、模块划分、错误处理、注释语言等约定;从技术栈推断合理默认并明确标注「默认约定,可修改」
6. ## 注意事项 — AI agent 容易踩的坑(框架特性、平台差异、易混淆目录)

要求:全部基于项目上下文的真实信息;上下文里没有的不要编造,用合理的通用默认并标注;总长控制在 150 行以内。`

export function buildAgentsUser(scan: RepoScan): string {
  return repoContextBlock(scan, 4000)
}

/* ============================= review:三 pass ============================= */

export interface ReviewFindingRaw {
  severity: 'critical' | 'major' | 'minor' | 'info'
  file: string
  line?: number
  title: string
  detail: string
  suggestion?: string
}

const REVIEW_COMMON = `
只输出 JSON:{"findings":[{"severity":"critical|major|minor|info","file":"改动中的文件路径","line":行号或省略,"title":"一句话问题标题","detail":"问题说明与依据","suggestion":"具体修复建议"}]}
严重级别定义:critical=会导致故障/数据丢失/安全事故;major=逻辑错误或明确违反规范,应当修复;minor=小问题或风格瑕疵;info=提示性。
没有问题就输出 {"findings":[]}。不要报告 diff 之外的问题;不要为了凑数报无关紧要的问题;file 必须取自本次 diff 的文件。`

export const REVIEW_BUGS_SYSTEM = `你是代码审查专家,专注从 diff 中找出【逻辑缺陷】:
- 边界条件错误、空值/未定义处理缺失
- 错误处理缺失或吞错(空 catch、未处理的 promise)
- 异步/并发问题(竞态、未 await、资源未释放)
- 与调用方契约不符(参数、返回值、类型)
- 明显的性能问题(循环内重复 IO、内存泄漏)
${REVIEW_COMMON}`

export const REVIEW_SECURITY_SYSTEM = `你是安全审计专家,专注从 diff 中找出【安全问题】:
- 硬编码的密钥、token、密码、内网地址
- 注入类:XSS(未转义插入 DOM)、SQL 注入、命令注入(exec 拼接)、路径穿越
- 不安全的依赖使用方式(已知高危 API,如 eval、Math.random 做安全用途)
- 敏感信息写入日志、CORS/权限校验缺失、cookie/localStorage 滥用
${REVIEW_COMMON}`

export const REVIEW_CONVENTIONS_SYSTEM = `你是项目规范守护者,检查 diff 是否符合【项目规范与既定规格】。
规范来源按优先级:1) 下方提供的「项目规范」(AGENTS.md / 项目宪章);2) 规格(spec)中已约定的行为与范围。
若无规范来源,则检查通用工程惯例:命名一致性、模块职责、重复代码、死代码、TODO 遗留。
注意:规范里没有约束到的地方不要强行报告;报告时必须在 detail 里引用违反了哪条规范/哪条 AC。
${REVIEW_COMMON}`

export function buildReviewUser(opts: {
  diffText: string
  conventionsCtx?: string
  chunkIndex: number
  chunkTotal: number
}): string {
  const parts: string[] = []
  if (opts.conventionsCtx) {
    parts.push(`## 项目规范(仅规范 pass 使用,其他 pass 忽略)\n${opts.conventionsCtx}`)
  }
  parts.push(
    `## 待审查 diff(第 ${opts.chunkIndex}/${opts.chunkTotal} 块)\n\`\`\`diff\n${opts.diffText}\n\`\`\``
  )
  return parts.join('\n\n')
}
