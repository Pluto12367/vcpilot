import fs from 'node:fs'
import path from 'node:path'

/** ANSI 颜色(不引第三方库,Windows Terminal / Git Bash 均支持) */
export const c = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`
}

export function truncate(s: string, n = 400): string {
  return s && s.length > n ? s.slice(0, n) + '…' : s || ''
}

/** ascii kebab-case slug;非 ascii 字符丢弃,空则返回空串 */
export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || ''
  )
}

export function timeStamp(): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 向上查找项目根(含 package.json 或 .git 的目录),找不到则原样返回 */
export function findRoot(start = process.cwd()): string {
  let dir = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, '.git'))) {
      return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(start)
    dir = parent
  }
}
