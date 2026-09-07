## Tasks: 留言板导出 CSV 功能

## Phase 1: 服务端 CSV 导出核心逻辑
- [x] T001 在 server.js 中新建 CSV 字段转义函数，按 RFC 4180：字段含逗号、双引号、换行或回车时整体用双引号包裹，内部双引号替换为 `""`。 (AC4)
- [ ] T002 在 server.js 中新增 GET 导出路由（如 `/export/messages`），输出 UTF-8 BOM 与表头 `id,author,content,created_at`，并设置响应头 `Content-Type: text/csv; charset=utf-8` 与 `Content-Disposition: attachment; filename="messages.csv"`。 (AC2, AC6)
- [ ] T003 在 server.js 导出路由中接入既有留言存取方式，逐条转义并流式写入响应，避免一次性加载全部留言；当存储无留言时仅输出 BOM+表头。 (AC1, AC3, AC5)

## Phase 2: 界面与交互
- [ ] T004 在 server.js 返回的留言板页面 HTML 中加入「导出 CSV」按钮，按钮/链接指向上述导出路由并带 `download` 属性，点击后由响应头触发下载且不刷新当前页面；快速重复点击每次均独立发起请求。 (AC1)

## Phase 3: 测试与收尾
- [ ] T005 更新 tests/run.mjs，增加集成测试：启动测试服务请求导出路由，断言 HTTP 200、Content-Type、Content-Disposition、文件名、表头及包含 `Alice/hello` 的行出现在 CSV 内容中。 (AC2, AC3, AC6)
- [ ] T006 更新 tests/run.mjs，继续补充空数据与特殊字符测试：空库时 CSV 仅含表头；content 含逗号、双引号、换行时输出符合 RFC 4180 转义规则，并校验 UTF-8 BOM。 (AC4, AC5)

依赖: 按 T001→T002→T003 完成 server.js 导出核心，再执行 T004 添加 UI；服务端与 UI 完成后，按 T005→T006 顺序补充并运行测试；同一文件连续修改，不可跨任务并行。
