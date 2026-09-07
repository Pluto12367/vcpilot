import fs from 'node:fs'
import path from 'node:path'
import type { GateConfig } from '../../shared/config.js'

export interface RepoScan {
  root: string
  name: string
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun'
  stack: string[]
  scripts: Record<string, string>
  tree: string
  hasAGENTS: boolean
  gates: GateConfig
  gatesSource: Partial<Record<keyof GateConfig, 'config' | 'detected'>>
}

/** 扫描时忽略的目录名(导出供上下文检索复用) */
export const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt',
  '.output', 'coverage', '.cache', '.turbo', '.vibe', '.idea', '.vscode',
  '__pycache__', '.venv', 'venv', 'vendor', 'target', 'bin', 'obj',
  '.refs', 'playwright-report', 'test-results'
])

/** 顶层/浅层展示的普通文件白名单(其余文件太多时截断) */
const INTERESTING_FILES = new Set([
  'package.json', 'tsconfig.json', 'vite.config.ts', 'vite.config.js',
  'next.config.js', 'next.config.mjs', 'nuxt.config.ts', 'README.md',
  'AGENTS.md', 'CLAUDE.md', '.eslintrc', '.eslintrc.js', '.eslintrc.json',
  'eslint.config.js', 'eslint.config.mjs', 'prettier.config.js',
  '.prettierrc', 'playwright.config.ts', 'playwright.config.js',
  'vitest.config.ts', 'jest.config.js', 'tailwind.config.js', 'tailwind.config.ts',
  'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'Makefile'
])

interface PkgJson {
  name?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

function readPkg(root: string): PkgJson | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as PkgJson
  } catch {
    return null
  }
}

function detectPackageManager(root: string): RepoScan['packageManager'] {
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn'
  if (fs.existsSync(path.join(root, 'bun.lockb')) || fs.existsSync(path.join(root, 'bun.lock'))) return 'bun'
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm'
  return undefined
}

/** 依赖表 → 技术栈标签 */
function detectStack(pkg: PkgJson | null, root: string): string[] {
  const tags = new Set<string>()
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
  const has = (n: string) => n in deps

  if (fs.existsSync(path.join(root, 'tsconfig.json')) || has('typescript')) tags.add('TypeScript')
  const frameworks: Array<[string, string]> = [
    ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['angular', 'Angular'],
    ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['astro', 'Astro'],
    ['express', 'Express'], ['koa', 'Koa'], ['fastify', 'Fastify'], ['nest', 'NestJS'],
    ['vite', 'Vite'], ['webpack', 'webpack'], ['tailwindcss', 'Tailwind CSS'],
    ['@playwright/test', 'Playwright'], ['vitest', 'Vitest'], ['jest', 'Jest'],
    ['eslint', 'ESLint'], ['prisma', 'Prisma'], ['drizzle-orm', 'Drizzle'],
    ['mongoose', 'Mongoose'], ['antd', 'Ant Design'], ['@mui/material', 'MUI'],
    ['electron', 'Electron']
  ]
  for (const [dep, tag] of frameworks) if (has(dep)) tags.add(tag)
  if (fs.existsSync(path.join(root, 'pyproject.toml')) || fs.existsSync(path.join(root, 'requirements.txt'))) tags.add('Python')
  if (fs.existsSync(path.join(root, 'go.mod'))) tags.add('Go')
  if (fs.existsSync(path.join(root, 'Cargo.toml'))) tags.add('Rust')
  if (tags.size === 0) {
    if (pkg) tags.add('Node.js(未检出已知框架依赖)')
    else tags.add('未知(未检出 package.json 或框架标记)')
  }
  return [...tags]
}

/** 生成带缩进的目录树(深度/条目数受限) */
function buildTree(root: string, maxDepth = 4, maxEntries = 220): string {
  const lines: string[] = []
  let count = 0

  const walk = (dir: string, prefix: string, depth: number): void => {
    if (depth > maxDepth || count >= maxEntries) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    const dirs = entries
      .filter((e) => e.isDirectory() && !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name))
    const files = entries
      .filter((e) => e.isFile() && (INTERESTING_FILES.has(e.name) || e.name.endsWith('.md')))
      .sort((a, b) => a.name.localeCompare(b.name))

    for (const d of dirs) {
      if (count >= maxEntries) { lines.push(prefix + '…'); return }
      count++
      lines.push(`${prefix}${d.name}/`)
      walk(path.join(dir, d.name), prefix + '  ', depth + 1)
    }
    for (const f of files) {
      if (count >= maxEntries) { lines.push(prefix + '…'); return }
      count++
      lines.push(`${prefix}${f.name}`)
    }
  }

  lines.push(path.basename(root) + '/')
  walk(root, '', 1)
  return lines.join('\n')
}

/** 有某脚本则用之;typecheck 特殊:tsconfig 存在即可用 npx tsc --noEmit */
function detectGates(pkg: PkgJson | null, root: string): { gates: GateConfig; source: RepoScan['gatesSource'] } {
  const scripts = pkg?.scripts || {}
  const gates: GateConfig = {}
  const source: RepoScan['gatesSource'] = {}
  const pm = detectPackageManager(root) || 'npm'
  const run = (s: string) => `${pm} run ${s}`

  if (scripts.lint) { gates.lint = run('lint'); source.lint = 'detected' }
  if (scripts.typecheck) { gates.typecheck = run('typecheck'); source.typecheck = 'detected' }
  else if (fs.existsSync(path.join(root, 'tsconfig.json'))) { gates.typecheck = 'npx tsc --noEmit'; source.typecheck = 'detected' }
  if (scripts.test) { gates.test = run('test'); source.test = 'detected' }
  if (scripts.build) { gates.build = run('build'); source.build = 'detected' }
  return { gates, source }
}

export function scanRepo(root: string, gatesOverride?: GateConfig): RepoScan {
  const pkg = readPkg(root)
  const { gates, source } = detectGates(pkg, root)
  return {
    root,
    name: pkg?.name || path.basename(root),
    packageManager: detectPackageManager(root),
    stack: detectStack(pkg, root),
    scripts: pkg?.scripts || {},
    tree: buildTree(root),
    hasAGENTS: fs.existsSync(path.join(root, 'AGENTS.md')),
    gates: { ...gates, ...(gatesOverride || {}) },
    gatesSource: source
  }
}
