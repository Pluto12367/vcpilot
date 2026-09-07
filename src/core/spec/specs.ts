import fs from 'node:fs'
import path from 'node:path'

export interface AcItem {
  id: string // "AC1"
  text: string // Given...When...Then 全文
}

export interface SpecMeta {
  id: string // "001"
  slug: string
  title: string
  dir: string
  createdAt: string
  status: 'draft' | 'implementing' | 'done'
}

/** 从 spec.md 正文提取验收标准:"- [ ] AC1: ..." 或 "- [x] AC1: ..." */
export function parseAcs(specMd: string): AcItem[] {
  const items: AcItem[] = []
  const re = /^[-*]\s+\[([ xX])\]\s+(AC\d+)\s*[:：]\s*(.+)$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(specMd))) {
    items.push({ id: m[2], text: m[3].trim() })
  }
  return items
}

export function specsDir(vibeDir: string): string {
  return path.join(vibeDir, 'specs')
}

/** 已有 spec 的下一个编号(001 → 002) */
export function nextSpecId(vibeDir: string): string {
  const dir = specsDir(vibeDir)
  let max = 0
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      const m = name.match(/^(\d+)/)
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
  }
  return String(max + 1).padStart(3, '0')
}

export function specPath(vibeDir: string, id: string): { dir: string; spec: string; tasks: string } {
  const dir = path.join(specsDir(vibeDir), id)
  return { dir, spec: path.join(dir, 'spec.md'), tasks: path.join(dir, 'tasks.md') }
}

/** 按 id 或 id 前缀定位已有 spec;找不到抛错 */
export function findSpec(vibeDir: string, idOrPrefix: string): SpecMeta {
  const dir = specsDir(vibeDir)
  if (!fs.existsSync(dir)) throw new Error(`尚无任何 spec,先运行 vcp spec`)
  const wanted = idOrPrefix.replace(/\/+$/, '')
  const hit = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith(wanted))
    .sort()[0]
  if (!hit) throw new Error(`找不到 spec:${idOrPrefix}(用 vcp spec list 查看)`)
  const full = path.join(dir, hit)
  const specFile = path.join(full, 'spec.md')
  if (!fs.existsSync(specFile)) throw new Error(`spec 目录损坏(缺 spec.md):${full}`)
  const md = fs.readFileSync(specFile, 'utf8')
  const title =
    md.match(/^#\s+(.+)$/m)?.[1]?.trim() || hit
  const status = (md.match(/<!--\s*vcp:status:\s*(\w+)\s*-->/)?.[1] as SpecMeta['status']) || 'draft'
  const createdAt = md.match(/<!--\s*vcp:created:\s*([\d-]+)\s*-->/)?.[1] || ''
  return { id: hit.match(/^\d+/)?.[0] || hit, slug: hit.replace(/^\d+-?/, ''), title, dir: full, createdAt, status }
}

export function listSpecs(vibeDir: string): SpecMeta[] {
  const dir = specsDir(vibeDir)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((n) => fs.existsSync(path.join(dir, n, 'spec.md')))
    .sort()
    .map((hit) => {
      const md = fs.readFileSync(path.join(dir, hit, 'spec.md'), 'utf8')
      return {
        id: hit.match(/^\d+/)?.[0] || hit,
        slug: hit.replace(/^\d+-?/, ''),
        title: md.match(/^#\s+(.+)$/m)?.[1]?.trim() || hit,
        dir: path.join(dir, hit),
        createdAt: md.match(/<!--\s*vcp:created:\s*([\d-]+)\s*-->/)?.[1] || '',
        status: (md.match(/<!--\s*vcp:status:\s*(\w+)\s*-->/)?.[1] as SpecMeta['status']) || 'draft'
      }
    })
}

export function writeSpec(
  vibeDir: string,
  opts: { id: string; slug: string; title: string; markdown: string; tasksMd?: string }
): { dir: string; specFile: string; tasksFile?: string } {
  const slugPart = opts.slug ? `-${opts.slug}` : ''
  const dir = path.join(specsDir(vibeDir), `${opts.id}${slugPart}`)
  fs.mkdirSync(dir, { recursive: true })
  const specFile = path.join(dir, 'spec.md')
  const head = [
    `# ${opts.title}`,
    '',
    `<!-- vcp:created:${new Date().toISOString().slice(0, 10)} vcp:status:draft -->`,
    ''
  ].join('\n')
  fs.writeFileSync(specFile, head + opts.markdown.trimStart() + '\n', 'utf8')
  let tasksFile: string | undefined
  if (opts.tasksMd) {
    tasksFile = path.join(dir, 'tasks.md')
    fs.writeFileSync(tasksFile, opts.tasksMd.trimStart() + '\n', 'utf8')
  }
  return { dir, specFile, tasksFile }
}

export function setSpecStatus(specDir: string, status: SpecMeta['status']): void {
  const specFile = path.join(specDir, 'spec.md')
  if (!fs.existsSync(specFile)) return
  const md = fs.readFileSync(specFile, 'utf8')
  const updated = md.replace(/(<!--\s*vcp:[^\s>]*\s*)vcp:status:\s*\w+/, (_s, keep) => `${keep}vcp:status:${status}`)
  fs.writeFileSync(specFile, updated.includes(`vcp:status:${status}`) ? updated : md, 'utf8')
}

export interface TaskItem {
  id: string // T001
  parallel: boolean
  acs: string[]
  text: string
  done: boolean
  line: number
}

/** 解析 tasks.md 的任务行 */
export function parseTasks(tasksMd: string): TaskItem[] {
  const items: TaskItem[] = []
  const lines = tasksMd.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^[-*]\s+\[([ xX])\]\s+(T\d+)\s+(\[P\]\s+)?(?:\(([^)]*)\)\s+)?(.+)$/)
    if (m) {
      items.push({
        done: m[1].toLowerCase() === 'x',
        id: m[2],
        parallel: Boolean(m[3]),
        acs: m[4] ? m[4].split(/[,，\s]+/).filter((s) => /^AC\d+$/.test(s)) : [],
        text: m[5].trim(),
        line: i
      })
    }
  }
  return items
}

/** 勾选/取消某个任务并写回 tasks.md */
export function setTaskDone(tasksFile: string, taskId: string, done: boolean): void {
  const md = fs.readFileSync(tasksFile, 'utf8')
  const lines = md.split('\n')
  const re = /^([-*]\s+\[)([ xX])(\]\s+T\d+\s+)/
  let hit = false
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^[-*]\s+\[([ xX])\]\s+(T\d+)\s+/)
    if (m && m[2] === taskId) {
      lines[i] = lines[i].replace(re, `$1${done ? 'x' : ' '}$3`)
      hit = true
      break
    }
  }
  if (!hit) throw new Error(`tasks.md 中找不到任务:${taskId}`)
  fs.writeFileSync(tasksFile, lines.join('\n'), 'utf8')
}
