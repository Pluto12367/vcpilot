请修复以下代码审查发现的问题(按严重度排序)。逐条修改对应文件;若认为某条不成立,说明理由跳过:

1. [major] server.js — CSV 行字段读取与规格字段名不一致，AC3 可能无法满足
   问题:规格 001-csv AC3 要求导出的行第二列为 author 值、第三列为 content 值，且 tasks.md 与表头均使用 author/content；当前 toCsv 中行数据硬编码为 m.name 与 m.text，若留言对象按规格以 author/content 存储，将导出空值，无法满足 AC3。现有数据模型使用 name/text，但改动未对齐规格字段语义。
   建议:将 toCsv 中行字段改为 m.author/m.content，或将数据模型统一为 author/content；若需兼容既有 name/text，应提供适配映射并在规格中说明。

2. [major] server.js — 导出未按规格要求流式输出，一次性构建 CSV 字符串
   问题:spec.md 非功能需求明确“导出时不得将全部留言一次性载入内存，应按行流式输出”，tasks.md T003 也要求逐条转义并流式写入响应；当前 res.end('\ufeff' + toCsv(messages)) 将全部留言转换成完整 CSV 字符串后才返回，数据量大时会占用 O(n) 内存并影响响应时间。
   建议:改为先写入 BOM 和表头，再循环调用 res.write(转义后的行 + '\n')，最后 res.end()，并尊重背压。

3. [major] dist/server.js — 新增 dist/server.js 重复源码且含硬编码令牌与 XSS，违反最小变更原则
   问题:项目宪章要求“最小变更原则——不引入未要求的配置、锁文件或依赖；保持项目结构精简”。dist/server.js 与 server.js 高度重复，且注释标明“故意保留问题”，包含硬编码管理令牌 `sk-admin-123456` 和未转义用户输入导致的 XSS。该文件不是规格 001-csv 所需的实现，也不属于构建/测试流程，新增到版本库会扩大变更面并引入安全隐患。
   建议:从本次 diff 中移除 dist/server.js；若需保留演示样例，应移出源码目录并避免提交含真实安全问题的代码。
