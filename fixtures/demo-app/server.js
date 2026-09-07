// 故意保留问题的迷你留言板服务:供 vcpilot review 演示
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const messages = []

// [review 演示点] 硬编码密钥
const ADMIN_TOKEN = 'sk-admin-123456'

function renderPage() {
  // [review 演示点] 用户输入未转义直接拼进 HTML(XSS)
  const list = messages.map((m) => `<li>${m.name} 说:${m.text}</li>`).join('')
  return `<!doctype html>
<html lang="zh">
<head><meta charset="utf-8"><title>留言板</title></head>
<body>
  <h1>留言板</h1>
  <form method="POST" action="/post">
    <input name="name" placeholder="昵称">
    <input name="text" placeholder="留言内容">
    <button type="submit">提交</button>
  </form>
  <p><button id="export-csv" onclick="location.href=&quot;/export/messages&quot;">导出 CSV</button></p>
  <ul>${list}</ul>
</body>
</html>`
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(renderPage())
    return
  }
  if (req.method === 'POST' && req.url === '/post') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const params = new URLSearchParams(body)
      // [review 演示点] 未校验空内容/长度上限
      messages.push({ name: params.get('name') || '匿名', text: params.get('text') })
      res.writeHead(302, { Location: '/' })
      res.end()
    })
    return
  }
  if (req.url.startsWith('/admin')) {
    // [review 演示点] 鉴权用明文 URL 参数比较(时序旁路 + 弱比较)
    const url = new URL(req.url, 'http://x')
    if (url.searchParams.get('token') === ADMIN_TOKEN) {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(messages))
      return
    }
  }
  res.writeHead(404)
  res.end('not found')
})

server.listen(3000, () => console.log('demo-app listening on http://localhost:3000'))

// ---- CSV 导出(spec 001 实施:RFC 4180 转义 + BOM + 正确响应头)----
function csvEscape(field) {
  const s = String(field ?? '')
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function toCsv(rows) {
  const header = 'id,author,content,created_at'
  const lines = rows.map((m, i) => [i + 1, m.name, m.text, m.createdAt || ''].map(csvEscape).join(','))
  return header + '\n' + lines.join('\n')
}

const ORIG_HANDLER = server._events.request
server.removeAllListeners('request')
server.on('request', (req, res) => {
  if (req.method === 'GET' && req.url === '/export/messages') {
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="messages.csv"'
    })
    res.end('\ufeff' + toCsv(messages))
    return
  }
  ORIG_HANDLER(req, res)
})
