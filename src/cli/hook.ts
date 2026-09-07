import fs from 'node:fs'
import path from 'node:path'
import { c, findRoot } from '../shared/util.js'

const MARKER = '# vcpilot-managed'
const HOOK = [
  '#!/bin/sh',
  MARKER,
  'command -v vcp >/dev/null 2>&1 || { echo "[vcp] 未找到 vcp 命令,跳过门禁(需先 npm link)"; exit 0; }',
  'exec vcp gate --staged --quick',
  ''
].join('\n')

export async function runHook(action: string | undefined): Promise<void> {
  const root = findRoot()
  const gitDir = path.join(root, '.git', 'hooks')
  const hookFile = path.join(gitDir, 'pre-commit')

  if (action === 'install') {
    if (!fs.existsSync(path.join(root, '.git'))) throw new Error('当前目录不是 git 仓库(未找到 .git)')
    fs.mkdirSync(gitDir, { recursive: true })
    if (fs.existsSync(hookFile)) {
      const cur = fs.readFileSync(hookFile, 'utf8')
      if (cur.includes(MARKER)) {
        console.log(c.yellow('[vcp] pre-commit 已安装,覆盖更新'))
      } else {
        throw new Error('已存在非 vcpilot 管理的 pre-commit hook,为避免破坏现有配置,请手动合并')
      }
    }
    fs.writeFileSync(hookFile, HOOK, 'utf8')
    if (process.platform !== 'win32') fs.chmodSync(hookFile, 0o755)
    console.log(c.green(`✓ pre-commit 已安装:${hookFile}`))
    console.log(c.dim('  每次 git commit 前自动执行:vcp gate --staged --quick(静态门禁 + AI 审查)'))
    return
  }

  if (action === 'uninstall') {
    if (!fs.existsSync(hookFile)) {
      console.log(c.dim('(未安装 pre-commit hook)'))
      return
    }
    const cur = fs.readFileSync(hookFile, 'utf8')
    if (!cur.includes(MARKER)) throw new Error('pre-commit 不是 vcpilot 管理的,拒绝删除')
    fs.rmSync(hookFile)
    console.log(c.green('✓ pre-commit 已卸载'))
    return
  }

  throw new Error('用法:vcp hook install | uninstall')
}
