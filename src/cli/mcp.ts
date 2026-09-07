import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** vcp mcp:fork MCP server 子进程并转发 stdio(保持同一 Node 运行时) */
export async function runMcp(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const serverJs = path.join(here, '..', 'mcp', 'server.js')
  const child = spawn(process.execPath, [serverJs], {
    stdio: 'inherit',
    env: process.env
  })
  child.on('close', (code) => {
    process.exitCode = code || 0
  })
}
