import fs from 'node:fs'
import path from 'node:path'
import { loadConfig, requireLlm } from '../shared/config.js'
import { c, findRoot } from '../shared/util.js'
import { distillRule, appendMemory, syncToAgentsMd, readMemoryRules } from '../core/memory/memory.js'

export async function runMemory(action: string | undefined, text: string | undefined): Promise<void> {
  const root = findRoot()
  const loaded = loadConfig(root)

  if (!action || action === 'list') {
    const rules = readMemoryRules(root)
    if (!rules.length) {
      console.log(c.dim('(还没有沉淀任何经验。用 vcp memory add "教训…" 添加)'))
      return
    }
    console.log(rules.join('\n'))
    return
  }

  if (action === 'add') {
    if (!text) throw new Error('用法:vcp memory add "<经验教训>"')
    let rule = text
    let category = '其他'
    try {
      const llm = requireLlm(loaded)
      const d = await distillRule(text, llm)
      rule = d.rule
      category = d.category
      if (!d.distilled) console.log(c.dim('(规则蒸馏失败,保存原文)'))
    } catch (e) {
      console.log(c.dim(`(规则蒸馏失败,保存原文:${(e as Error).message.slice(0, 60)}…)`))
    }
    const file = appendMemory(root, rule, category)
    console.log(c.green(`✓ 已沉淀:`) + rule)

    // 自动同步进 AGENTS.md
    const sync = syncToAgentsMd(root)
    if (sync.synced) {
      console.log(c.dim(`  已同步 ${sync.count} 条规则到 ${path.relative(root, sync.file!)}`))
    } else {
      console.log(c.dim('  (AGENTS.md 不存在,跳过同步;先运行 vcp init)'))
    }
    void file
    return
  }

  throw new Error(`未知子命令:${action}(支持 add / list)`)
}
