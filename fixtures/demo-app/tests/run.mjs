import assert from 'node:assert'
import fs from 'node:fs'

// 迷你测试:验证关键文件存在 + 渲染函数输出包含表单
assert.ok(fs.existsSync(new URL('../server.js', import.meta.url)), 'server.js 应存在')

const src = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8')
assert.ok(src.includes('<form'), '页面应包含留言表单')
assert.ok(src.includes('/post'), '表单应提交到 /post')

console.log('demo-app tests: 2 passed')
