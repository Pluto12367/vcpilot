import fs from 'node:fs'

// 迷你构建:把 server.js 复制为 dist/server.js(模拟真实构建产物)
fs.mkdirSync(new URL('../dist', import.meta.url), { recursive: true })
fs.copyFileSync(new URL('../server.js', import.meta.url), new URL('../dist/server.js', import.meta.url))
console.log('demo-app build: dist/server.js written')
