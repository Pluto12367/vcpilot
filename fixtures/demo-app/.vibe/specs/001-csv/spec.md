# 留言板导出 CSV 功能

<!-- vcp:created:2026-09-07 vcp:status:draft -->
## 背景
留言板目前只支持在线查看，无法导出数据。本功能新增「导出 CSV」按钮，一键下载全部留言，便于归档与离线分析。

## 用户故事
### US1 (P1): 页面提供导出按钮并下载 CSV 文件
访客在留言板页点击按钮即可下载包含全部留言的 CSV 文件。

### US2 (P2): 导出内容真实、格式可解析
CSV 表头完整、数据与留言一致，特殊字符正确转义，可被 Excel 等表格工具直接打开。

## 验收标准
- [ ] AC1: Given 页面正常加载且有 2 条以上留言 When 点击「导出 CSV」按钮 Then 浏览器下载名为 messages.csv 的文件
- [ ] AC2: Given 成功下载 messages.csv When 用文本编辑器打开并查看首行 Then 首行内容为 `id,author,content,created_at`
- [ ] AC3: Given 存在 author="Alice"、content="hello" 的留言 When 导出并检索 messages.csv Then 可找到一行，其第二列为 Alice 且第三列为 hello
- [ ] AC4: Given 留言 content 含逗号、双引号或换行 When 导出并查看该留言所在行 Then 该字段整体用双引号包裹且内部双引号转义为 `""`
- [ ] AC5: Given 留言板暂无留言 When 点击导出 Then 下载的 CSV 仅包含表头行
- [ ] AC6: Given 页面可正常访问 When 点击导出 Then 响应头 Content-Type 为 text/csv 且 Content-Disposition 含 attachment

## 边界情况
- 空数据：仍返回 200，CSV 仅含表头。
- 内容含逗号、双引号、换行或回车：按 RFC 4180 转义，不破坏列结构。
- 快速重复点击导出：每次均独立返回完整文件，不报错、不中断。
- 导出与新增留言并发：读取视图一致，不出现半行数据。

## 非功能需求
- 编码为 UTF-8（建议带 BOM），保证 Excel 正确识别中文。
- 1 万条留言以内的导出请求应在 2 秒内完成。
- 导出时不得将全部留言一次性载入内存，应按行流式输出。

## 假设与范围外
- 仅导出全部留言，不做条件筛选；本次不做 CSV 导入。
- 复用 server.js 既有路由与留言存取方式，不新增 npm 依赖。
- 单进程部署，只需保证单次读取操作的一致性，无需跨进程锁。
