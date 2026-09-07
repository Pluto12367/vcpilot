#!/usr/bin/env node
import { Command } from 'commander'
import { runInit } from './init.js'
import { runSpec } from './spec.js'
import { runVerify } from './verify.js'
import { runReview } from './review.js'
import { runMemory } from './memory.js'
import { runGate } from './gate.js'
import { runHook } from './hook.js'
import { runMcp } from './mcp.js'

const program = new Command()

program
  .name('vcp')
  .description('vcpilot — vibe coding 副驾:规格驱动 + 验收闭环 + 质量守门 + 上下文工程')
  .version('0.2.0')

program
  .command('init')
  .description('扫描仓库,生成/更新 AGENTS.md 与 .vibe/config.yaml')
  .option('--force', '覆盖已存在的 AGENTS.md')
  .action(runInit)

program
  .command('spec')
  .description('把想法变成规格:澄清 → spec.md(含验收标准 AC)→ tasks.md')
  .argument('[idea]', '功能想法描述')
  .option('-y, --yes', '跳过澄清,直接按推荐默认值生成')
  .addCommand(new Command('list').description('列出全部规格').action(() => runSpec('list')))
  .action((idea, opts) => runSpec(idea ? 'create' : 'interactive', idea, opts))

program
  .command('verify')
  .description('验收:静态门禁;--e2e 生成并运行 Playwright 测试;--judge 视觉 LLM 裁判')
  .argument('[spec-id]', 'spec 编号(如 001)')
  .option('--e2e', '生成(如缺失)并运行 Playwright 验收测试')
  .option('--judge', '视觉 LLM 裁判(需要先有 e2e 证据)')
  .option('--regen', '强制重新生成 e2e 测试')
  .option('--skip-static', '跳过静态门禁(只跑 e2e/judge)')
  .action((specId, opts) => runVerify(specId, opts))

program
  .command('review')
  .description('AI 代码审查:规范符合性 + bug + 安全三 pass,severity 分级报告')
  .option('--staged', '审查暂存区(默认审查工作区 vs HEAD)')
  .option('--base <ref>', '对比基准(默认 HEAD)')
  .option('--fix', '生成回喂 coding agent 的修复 prompt')
  .action((opts) => runReview(opts))

program
  .command('gate')
  .description('一条龙:静态门禁 + (--e2e 时)浏览器验收 + AI 审查,任一失败退出码 1')
  .argument('[spec-id]', 'spec 编号(配 --e2e/--judge)')
  .option('--staged', '审查暂存区')
  .option('--e2e', '加入浏览器验收')
  .option('--judge', '加入视觉裁判')
  .option('--quick', '只跑静态门禁 + 审查(跳过 e2e/judge,pre-commit 用)')
  .action((specId, opts) => runGate(specId, opts))

program
  .command('hook')
  .description('git pre-commit 门禁:hook install | uninstall')
  .argument('[action]', 'install | uninstall')
  .action((action) => runHook(action))

program
  .command('memory')
  .description('项目经验沉淀:add 蒸馏为规范规则并同步 AGENTS.md / list 查看')
  .argument('[action]', 'add | list')
  .argument('[text]', '要沉淀的经验教训(配合 add)')
  .action((action, text) => runMemory(action, text))

program
  .command('mcp')
  .description('启动 MCP server(stdio),供 coding agent 接入')
  .action(runMcp)

program.parseAsync(process.argv).catch((e: Error) => {
  console.error(`\x1b[31m[vcp] ${e.message}\x1b[0m`)
  // 不用 process.exit():让挂起的网络句柄自然关闭,否则 Windows 上可能崩溃
  process.exitCode = 1
})
