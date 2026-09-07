# demo-app — 基于 Node.js 的最小示例应用,启动入口为 server.js,通过三套 npm scripts 完成启动、测试与构建。

## 项目宪章

- **零框架核心** — 未检出任何框架依赖;server.js 应继续基于 Node 内置能力(http 等),不得擅自引入 Express 等框架来“简化”问题。
- **scripts 为唯一入口** — 启动、测试、构建均以 package.json 中定义的 start/test/build 为唯一流程;不得绕过或私自新增其他执行方式。
- **跨平台可移植** — 所有命令与脚本须在 Windows/macOS/Linux 下均可运行,禁止依赖 bash 专属语法、绝对路径或未安装的系统工具。
- **测试自包含** — `npm test` 必须在无网络、无外部服务的干净环境中通过;tests/run.mjs 是唯一测试入口。
- **最小变更原则** — 不引入未要求的配置、锁文件或依赖;改前先读已有文件,保持项目结构精简。

## 常用命令

- `npm install` — 安装依赖(注意:当前未检出 lockfile,包管理器未知;若现场存在 package-lock.json / yarn.lock / pnpm-lock.yaml,改用对应包管理器命令)。
- `npm start` — 启动服务(实际执行 `node server.js`)。
- `npm test` — 运行测试(实际执行 `node tests/run.mjs`)。
- `npm run build` — 执行构建(实际执行 `node scripts/build.mjs`)。

## 代码结构

- `server.js` — 应用入口、HTTP 服务与路由逻辑(由 start 脚本推断位于项目根,目录树未列出但必然存在)。
- `scripts/` — 构建/自动化辅助脚本目录,目前含 `build.mjs`,不属于业务模块。
- `tests/` — 测试目录,`run.mjs` 是测试执行器(或用例集合),由 `npm test` 直接调用。
- `package.json` — 项目清单:依赖、scripts、元数据;是流程配置的唯一事实来源。

## 代码风格与约定

> 以下为默认约定,可修改;实际以现有代码风格为准,改前先读同类文件。

- **命名**:文件名用 kebab-case,`.mjs` 后缀表示 ESM 模块;变量与函数用 camelCase;常量用 UPPER_SNAKE_CASE。
- **模块划分**:文件职责单一;可复用逻辑从入口文件抽出;业务代码与测试严格分离到根目录 / `tests/`。
- **错误处理**:内部错误尽早抛出;进程边界(脚本入口)须捕获错误并输出到 stderr 后以非零码退出,避免静默失败。
- **注释语言**:注释建议使用中文(与本文档一致);标识符一律使用英文。
- **测试风格**:优先使用 `node:assert` 做断言;断言失败时输出明确的上下文信息。新增用例需确认 `tests/run.mjs` 是否会收集到。

## 注意事项

- `scripts/` 目录存放的是 Node 脚本(`.mjs`),不是待调度的 shell 脚本;不要往里添加 `.sh` 文件,也不要与 package.json 中的 “scripts” 字段混淆。
- `npm test` 直接指向 `tests/run.mjs`,它可能显式列出用例而非自动扫描;新增测试文件后务必检查是否需要同步注册。
- 未检出任何锁文件与包管理器痕迹,`npm install` 只是安全默认;安装前先确认现场使用的包管理器,避免生成多余锁文件。
- `server.js` 未出现在目录树中,但 start 脚本依赖它;如发现缺失,先检查文件是否被 gitignore 或遗漏,不可擅自改名或改变启动路径。
- `build.mjs` 与 `run.mjs` 是裸 Node 脚本而非框架 CLI,不要假设它们支持某些参数或约定;执行前先通读脚本内容。
- 项目无框架,遇到小需求时不要默认引入 Express、vitest 等依赖;遵循零框架宪章。
- 若根 package.json 未声明 `"type": "module"`,则只有 `.mjs` 文件确定是 ESM;新增 `.js` 文件时需先确认模块系统,避免混用 `require` 与 `import`。

## 项目经验沉淀(vcpilot)
<!-- vcp:memory:start -->
以下规则来自 vcpilot memory 沉淀,是本项目的强约束,review 与编码都必须遵守:

- [2026-09-07] [其他] 上次留言板忘了对用户输入做 HTML 转义导致 XSS,以后所有用户内容渲染前必须转义
- [2026-09-07] [其他] 导出文件必须设置正确的 Content-Disposition,否则浏览器不会触发下载
<!-- vcp:memory:end -->
