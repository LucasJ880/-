# Proposal：解析出的文字带 U+0000 也能入库，解析失败显示原因（FIX-13）

TASKFLOW：FIX-13（Phase F（续）— 生产实测修复，2026-11-20）

## Why

生产实测（2026-11-20「12-3 Indoor Canadian Flag」）上传 6 个、纳入 4 个，`2026004-Appendix-B-RFP-e(PDF).pdf` / `-f(PDF).pdf` 被标成「文件解析失败」：Lucas 本地用 unpdf 1.4.0 复现，英文版第 2 页利益冲突一节的勾选框（SymbolMT，CID TrueType、Identity-H）被抽成 U+0000，PostgreSQL 文本列不收这个字符，整份文件的写库失败（去掉权限加密后同样含该字符，加密已排除）。界面上只写「文件解析失败」，看不到 `parseError`，所以线上一直不知道原因。

## What Changes

- 新增一个纯函数清理解析出的文字：U+0000 换成空格，落单的 UTF-16 代理字符换成 U+FFFD；其它字符原样保留。
- 让页级解析（招标分析用的逐页文字与整份文字、非 PDF 的表格 / 文本块单元及其标签）在写库前经过这个函数；PDF 页面先清理再判断「近乎空白 / 需要 OCR」。
- 让旧的整份文字解析（项目文件列表用）在写库前经过这个函数，并在重新解析开始时清掉上一次的失败原因。
- 按实际编码读纯文本与 CSV：带 UTF-16 字节序标记的按 UTF-16 读；按 UTF-8 读出来 U+0000 超过 10% 的记为解析失败并写明原因（以前这类文件碰巧因写库失败而被挡住，清理之后不能让乱码当正文入库）。
- 把失败原因的写入收口：不超过 500 字，写入前同样清掉不可入库的字符。
- 在招标分析的文件覆盖清单（「上传 N · 纳入分析 M · 排除 K」下面的逐文件明细）里，对解析失败的文件在「未纳入：文件解析失败」之后显示该文件 `parseError` 的原文；没有记录原因时写「系统未记录原因」；清单下面加一句下一步怎么办。
- 在分析结果的「排除 K（原因）」展开列表里按同样的写法显示原因；文件之后已经不在解析失败之列的，注明是上次分析时的记录。
- 在项目文件列表里，对解析失败的文件在文件行下方显示「原因：」加 `parseError` 全文（原来只截前 60 个字，Prisma 报错时只剩「Invalid `prisma…` invocation:」）。
- 新增回归测试：用含 U+0000 的 PDF 页面（勾选框式：「…check the box.\n\u0000 The Bidder declare…」）、表格、UTF-16 文本与被截断劈开代理字符的文字，在隔离库上断言两条解析路径的结果；清理与解码的纯函数测试；覆盖清单与界面文案的测试。

## Capabilities

### New Capabilities

- `projects/document-text-extraction`：项目文件解析出的文字怎样入库（不可入库字符的清理）、解析失败怎样记原因、项目文件列表怎样显示原因。
- `tender/analysis-package-coverage`：招标分析的文件覆盖清单——上传 / 纳入 / 排除的计数，被排除文件的原因与解析失败原文。

### Modified Capabilities

（无。既有主规格里没有文件解析与覆盖清单的要求。）

## Impact

- 代码：新文件 `src/lib/files/extracted-text.ts`（清理函数、纯文本解码）；新文件 `src/lib/tender-auto-analysis/exclusion-text.ts`（界面文案，不依赖数据库，界面与测试共用）；`src/lib/tender-auto-analysis/page-parse.ts`、`src/lib/files/parse-content.ts`（写库前清理、纯文本解码、失败原因收口）；`src/lib/tender-auto-analysis/package-coverage.ts`（排除明细带 `parseError`；存进综合解读的快照显式只取原来的六项；给不显示原文的接口去掉原文）；`src/lib/tender-auto-analysis/v2-persist.ts`（改用上面的快照函数，`AnalystCoverage` 类型不变）；`src/lib/tender-auto-analysis/executive-brief.ts`（简报的覆盖清单不带原文）；`src/components/tender-analysis/analysis-panel.tsx`、`src/components/tender-analysis/analyst-synthesis-view.tsx`、`src/components/project-files/project-file-manager.tsx`（显示原因）。
- 接口：`GET /api/projects/[id]/tender-analysis/runs/[runId]` 返回的覆盖清单里，被排除文件多一个 `parseError` 字段（只对解析失败的文件有值）。`GET /api/projects/[id]/tender-brief`、`GET /api/projects/[id]/workbench-summary` 返回的覆盖清单里也有这个字段，但恒为空（这两个接口的界面不显示原文）。
- 行为变化：带字节序标记的 UTF-16 纯文本 / CSV 以前解析失败，现在能正常读出；没有字节序标记的 UTF-16（或二进制内容）以前也是解析失败，现在仍是失败，只是原因换成一句能看懂的话。
- 测试：新增 `src/lib/files/__tests__/extracted-text.test.ts`、`src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts`，扩 `package-coverage.test.ts`；都注册进 `scripts/test-all.sh`（纯函数测试同时进 `scripts/test-ci-unit.sh`）。
- 无 schema、无新开关、无新依赖、无新模型调用；合并即生效。已经失败的文件要重新解析一次（点项目页右上的「项目文件 · N」打开文件抽屉时会自动重新处理失败的文件，或点红色提示条上的「重新处理」），再重新发起分析。

## Out of scope

- 不做 PDF 解密 / 去权限：问题与加密无关（去掉加密后的版本同样含 U+0000）。
- 不做 OCR；不改「需要 OCR」的判定阈值。
- 不改 unpdf 版本、不换解析库。
- 不改其它控制字符（制表、换页等）：PostgreSQL 能存，现有行为不变。
- 不改 `parseError` 记什么内容（仍是报错原文，≤ 500 字；本次只补上旧路径漏掉的 500 字上限与字符清理）；不补救生产上已失败的两份文件（上线后重新解析）。
- 不改文件抽屉的自动重新处理逻辑与 `process-next` 接口（包括它既有的问题：只查登录不查项目权限、处理结束后会循环重试——另开任务）。
- 不识别没有字节序标记的 UTF-16、GBK 等其它编码（只把读不了的文件明确标成失败）。
- 不把 `parseError` 放进任何模型提示、Muse 通道或通知。
- 法文版 `-f(PDF).pdf` 没有单独实测，按同一来源推断相同；上线后重新解析时一并核对。
