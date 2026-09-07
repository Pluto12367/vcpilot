# vcpilot

**vibe coding 副驾** —— 给 ZCode / Cursor / Claude Code 等 coding agent 配套的「规格 + 质检 + 记忆」工具。

核心主张:**agent 按规格干活,用可执行的验收标准闭环,把每次踩坑沉淀成越来越聪明的规范。**

```
vcp spec "想法"       →  spec.md(编号验收标准 AC1..ACn)+ tasks.md
        ↓ 交给 coding agent 实施(或经 MCP 让 agent 直接读 spec)
vcp verify 001 --e2e  →  静态门禁 + 自动生成 Playwright 测试并执行,逐 AC 出结果
vcp verify 001 --judge → 视觉 LLM 裁判:截图/DOM 证据逐条判定 pass/fail/uncertain
vcp gate 001 --e2e    →  验收 + AI 审查一条龙,任一失败退出码 1
vcp memory add "教训"  →  蒸馏为规范规则,自动同步进 AGENTS.md,越用越聪明
```

## 为什么是 vcpilot

- **规格驱动**(借鉴 [github/spec-kit](https://github.com/github/spec-kit) 工作流):想法 → 澄清 → spec(用户故事按优先级、验收标准 Given/When/Then)→ 任务拆解
- **差异化:可执行验收**。spec-kit 们的 converge 是 LLM 自评;vcpilot 把验收标准(AC1..ACn)自动转成 **Playwright E2E 测试**真实执行,LLM 只对模糊的视觉/体验标准做证据裁判
- **感知规格的审查**:review 的规范 pass 直接对照活动 spec 的 AC 与 AGENTS.md,能报出「违反 AC3」这种可执行的结论
- **上下文工程**:[agents.md 开放标准](https://agents.md/) 项目指南 + memory 规则自动同步 + MCP 上下文检索
- **轻量单角色**(吸取 BMAD-METHOD 的教训):无 agent 编排、不替代 IDE,所有产物都是 git 里的可审文件

## 安装

```bash
cd vcpilot
npm install && npm run build
npm link          # 全局可用 vcp 命令
npx playwright install chromium   # e2e 验收首次需要(缺失时 verify 会自动装)
```

要求 Node ≥ 18.17。

## 配置 LLM

任意 OpenAI 兼容接口,环境变量(推荐)或项目内 `.vibe/config.yaml`:

```bash
export VCP_BASE_URL=https://open.bigmodel.cn/api/paas/v4
export VCP_MODEL=glm-4.6
export VCP_API_KEY=你的key
```

## 使用

### 1. 项目初始化(一次)

```bash
cd 你的项目
vcp init
```

生成 `AGENTS.md`(项目宪章 + 常用命令 + 结构说明)+ `.vibe/config.yaml`:

```yaml
version: 1
llm: { baseURL: ..., model: ..., apiKey: ... }   # 或用环境变量
gates: { lint: ..., typecheck: ..., test: npm test, build: npm run build }
dev:  { startCommand: "npm run dev", url: http://localhost:5173 }   # e2e 验收用
```

### 2. 想法 → 规格

```bash
vcp spec "给留言板加导出 CSV 功能"
```

LLM 提最多 5 个澄清问题(带推荐默认值,直接回车即用默认)→ 产出:

- `.vibe/specs/001-*/spec.md` —— 背景 / 用户故事(US1..,P1..P3)/ **验收标准(AC1..ACn,Given-When-Then)** / 边界情况 / 非功能需求 / 假设与范围外
- `.vibe/specs/001-*/tasks.md` —— T001.. 任务清单,每条标注 `[P]` 并行性与 `(AC1,AC3)` 关联

### 3. 验收(核心闭环)

把 tasks.md 交给 coding agent 实施后:

```bash
vcp verify 001 --e2e     # 静态门禁 + 自动生成 Playwright 测试并执行,逐 AC 出 ✓/✗
vcp verify 001 --judge   # 视觉裁判:截图优先、DOM 文本降级,逐条 pass/fail/uncertain
vcp verify 001 --e2e --judge --regen   # 组合;--regen 强制重新生成测试
```

e2e 细节:
- 生成的测试在 `.vibe/specs/001/e2e/spec.spec.ts`,**人工可修改,重跑 verify 即生效**(推荐 review 后再跑)
- dev server 已监听则复用,否则按 `dev.startCommand` 自动启动(纯 node 服务改代码后需手动重启,HMR 类工具不受影响)
- 截图与 DOM 证据存 `.vibe/specs/001/e2e/artifacts/`
- 生成测试时会抓取首页 HTML 给模型做路由/选择器参考,避免猜测端点

### 4. 提交前守门

```bash
vcp gate 001 --staged --e2e --judge   # 一条龙:验收 + 审查,汇总表裁决,任一失败退出码 1
vcp review --staged --fix             # 只审查;--fix 额外生成修复 prompt 粘回给 agent
vcp hook install                      # pre-commit 自动跑 vcp gate --staged --quick
```

review 三 pass:**规范符合性**(对照 AGENTS.md + 活动规格 AC,能报「违反 AC3」)/ **bug 逻辑** / **安全**(secrets、注入、CSV 公式注入等);severity:critical(退出码 1)/ major / minor / info。

### 5. 经验沉淀(飞轮)

```bash
vcp memory add "上次忘了对用户输入做 HTML 转义导致 XSS"
```

教训被蒸馏成一行规范规则,**自动同步进 AGENTS.md 的受管区块**(`<!-- vcp:memory:start/end -->`),成为 review 规范 pass 与编码的强约束。

### 6. MCP:让 agent 直接接入

在 ZCode / Claude Code / Cursor 的 MCP 配置中添加:

```json
{ "command": "vcp", "args": ["mcp"] }
```

提供 8 个工具:

| 工具 | 作用 |
|---|---|
| `spec_list` / `spec_get` | agent 读规格与验收标准 |
| `spec_create` | 会话中直接从想法建规格 |
| `task_update` | 完成一个任务勾一个(T 编号),全部完成自动置 done |
| `verify_spec` | agent 自己触发验收(静态 / e2e / judge),拿逐 AC 结果 |
| `review_diff` | 触发三 pass 审查 |
| `memory_add` | 踩坑即时沉淀并同步 AGENTS.md |
| `project_context` | 检索项目上下文(摘要 + AGENTS.md + 相关文件) |

## 目录约定

```
你的项目/
├── AGENTS.md                  # vcp init 生成;memory 规则同步进受管区块
└── .vibe/
    ├── config.yaml            # LLM / 门禁 / dev server 配置
    ├── specs/001-*/
    │   ├── spec.md  tasks.md  # 提交到 git,人工可改
    │   └── e2e/spec.spec.ts   # 生成的验收测试(人工可改)+ artifacts/ 证据
    ├── reports/               # 验收/审查报告
    └── memory.md              # 经验沉淀源文件
```

## 开发

```bash
npm run dev -- --help   # tsx 直跑源码
npm run build           # tsc 编译到 dist/
fixtures/demo-app       # 故意带 bug 的演示项目(含已实施完成的 spec 001 与生成的验收测试)
```

## 路线图

- [x] Phase 0-1:脚手架、LLM 客户端、仓库扫描、init / spec / verify --static / review / memory
- [x] Phase 2:AC → Playwright 测试生成与执行、视觉 LLM 裁判、`gate` 一条龙 + git hook、memory 自动同步 AGENTS.md
- [x] Phase 3:MCP server(8 工具)、project_context 上下文检索
- [ ] 后续:流式输出与 token 成本报表、converge 对账(AC ↔ 实现/测试覆盖度)、视觉裁判接多模态模型实测、fixture 场景扩充

## 参考

设计借鉴并致谢:[github/spec-kit](https://github.com/github/spec-kit)(工作流与模板)、[agents.md](https://agents.md/)(指南格式)、[Playwright](https://playwright.dev/)(验收执行)、[auto-playwright](https://github.com/lucgagan/auto-playwright)(自然语言→浏览器步骤参考)、BMAD-METHOD / OpenSpec(反面与正面教训)。
