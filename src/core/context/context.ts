import fs from 'node:fs'
import path from 'node:path'
import { scanRepo, IGNORE_DIRS } from '../repo/scan.js'

const TEXT_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.py', '.go', '.rs',
  '.md', '.json', '.yaml', '.yml', '.html', '.css', '.scss', '.sql', '.sh', '.toml'
])

interface Candidate {
  rel: string
  score: number
  firstMatch?: { line: number; text: string }
}

/** 简单高效的项目上下文检索:关键词在路径(3x)与内容(1x)中计分,返回 top 文件与摘录 */
export function searchContext(root: string, query: string, topN = 6): {
  summary: string
  agentsMd?: string
  hits: Array<{ path: string; score: number; excerpt: string }>
} {
  const scan = scanRepo(root)
  const keywords = query.toLowerCase().split(/\s+/).filter((k) => k.length > 1)
  const candidates: Candidate[] = []
  let filesSeen = 0

  const walk = (dir: string, rel: string): void => {
    if (filesSeen > 900 || candidates.length > 400) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue
        walk(path.join(dir, e.name), rel ? rel + '/' + e.name : e.name)
      } else if (e.isFile() && TEXT_EXTS.has(path.extname(e.name))) {
        filesSeen++
        const full = path.join(dir, e.name)
        let stat: fs.Stats
        try {
          stat = fs.statSync(full)
        } catch {
          continue
        }
        if (stat.size > 128 * 1024) continue
        let content: string
        try {
          content = fs.readFileSync(full, 'utf8')
        } catch {
          continue
        }
        const lowerPath = rel.toLowerCase()
        let score = 0
        for (const k of keywords) {
          if (lowerPath.includes(k)) score += 3
          const occurrences = content.toLowerCase().split(k).length - 1
          score += Math.min(occurrences, 10)
        }
        if (score <= 0) continue
        let firstMatch: Candidate['firstMatch']
        const lower = content.toLowerCase()
        for (const k of keywords) {
          const idx = lower.indexOf(k)
          if (idx !== -1) {
            const before = content.lastIndexOf('\n', idx)
            const after = content.indexOf('\n', idx)
            firstMatch = {
              line: content.slice(0, idx).split('\n').length,
              text: content.slice(before + 1, after === -1 ? undefined : after).trim().slice(0, 200)
            }
            break
          }
        }
        candidates.push({ rel, score, firstMatch })
      }
    }
  }

  walk(root, '')
  candidates.sort((a, b) => b.score - a.score)
  const top = candidates.slice(0, topN)

  let agentsMd: string | undefined
  const agentsPath = path.join(root, 'AGENTS.md')
  if (fs.existsSync(agentsPath)) {
    agentsMd = fs.readFileSync(agentsPath, 'utf8').slice(0, 6000)
  }

  return {
    summary: `项目 ${scan.name};技术栈:${scan.stack.join(', ')};脚本:${JSON.stringify(scan.scripts)}\n目录结构:\n${scan.tree.slice(0, 1800)}`,
    agentsMd,
    hits: top.map((t) => ({
      path: t.rel,
      score: t.score,
      excerpt: t.firstMatch ? `L${t.firstMatch.line}: ${t.firstMatch.text}` : ''
    }))
  }
}
