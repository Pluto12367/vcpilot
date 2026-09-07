import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { c } from '../../shared/util.js'

export interface DevConfig {
  startCommand?: string
  url?: string
}

async function reachable(url: string, timeoutMs = 2000): Promise<boolean> {
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    // 任何 HTTP 响应(含 404)都说明端口活着
    return resp.status < 600
  } catch {
    return false
  }
}

export interface DevServer {
  url: string
  /** true = 本次调用启动的进程(保持运行以便复用,不回收) */
  started: boolean
}

/**
 * 确保 dev server 可用:已监听则复用;否则用 startCommand 启动并轮询就绪。
 * 启动的进程保持运行(自用场景下重复验收无需反复起停)。
 */
export async function ensureDevServer(root: string, dev: DevConfig, timeoutMs = 60_000): Promise<DevServer> {
  const url = dev.url || 'http://localhost:3000'
  if (await reachable(url)) return { url, started: false }

  if (!dev.startCommand || !dev.startCommand.trim()) {
    throw new Error(
      `dev server 未运行(${url})且未配置 dev.startCommand。请在 .vibe/config.yaml 填写:\ndev:\n  startCommand: "npm run dev"\n  url: http://localhost:3000\n或手动启动后重试。`
    )
  }

  console.log(c.cyan(`[vcp] 启动 dev server:${dev.startCommand}`))
  const isWin = process.platform === 'win32'
  const child = spawn(dev.startCommand, {
    cwd: root,
    shell: isWin ? process.env.ComSpec || 'cmd.exe' : true,
    stdio: 'ignore',
    detached: !isWin
  })
  if (isWin) child.unref()

  const t0 = Date.now()
  for (;;) {
    if (await reachable(url)) {
      console.log(c.green(`[vcp] dev server 就绪:${url}(保持运行,便于重复验收)`))
      return { url, started: true }
    }
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`dev server 在 ${timeoutMs / 1000}s 内未就绪:${url}(命令:${dev.startCommand})`)
    }
    await new Promise((r) => setTimeout(r, 600))
  }
}

/** vcpilot 自身安装根(用于调用自带 playwright) */
export function selfRoot(): string {
  // dist/core/repo/devserver.js → 向上找 package.json(name=vcpilot)
  let dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  for (;;) {
    const pkg = path.join(dir, 'package.json')
    if (fs.existsSync(pkg) && fs.readFileSync(pkg, 'utf8').includes('"name": "vcpilot"')) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('无法定位 vcpilot 安装目录')
    dir = parent
  }
}
