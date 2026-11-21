# Design：解析出的文字带 U+0000 也能入库，解析失败显示原因

## Context

动机见 proposal.md「Why」。两条解析路径都把文字原样写库：

- 页级解析 `parseDocumentPagesAndStore`（`src/lib/tender-auto-analysis/page-parse.ts`）：`extractPdfPagesFromBuffer` 用 unpdf 逐页取字 → `classifyPageText` 判近乎空白 → 事务里 `projectDocumentPage.createMany` 写逐页文字、`projectDocument.update` 写整份文字；非 PDF 经 `extractNonPdfUnits` 切表格 / 文本块单元同样写库。招标分析只读这条路径的逐页文字。
- 旧的整份文字解析 `parseAndStoreContent`（`src/lib/files/parse-content.ts`）：项目文件页的「处理下一个」用它，写 `ProjectDocument.contentText`。

PostgreSQL 的 `text` 不收 U+0000（报 22021 `invalid byte sequence for encoding "UTF8": 0x00`）；Prisma 序列化落单的 UTF-16 代理字符时报 `unexpected end of hex escape`。两种都在写库时抛出，被各自的 catch 收成 `parseStatus = failed`、`parseError = <报错>`（已在本机隔离库上复现，两条路径相同）。Lucas 本地读 Appendix B 不会失败，是因为只读了文字、没写库。

`parseError` 今天只有两处出现：项目文件列表那一行截前 60 字（Prisma 报错只剩「Invalid `prisma…` invocation:」），以及「处理下一个」的进度文字。招标分析的覆盖清单（`package-coverage.ts`）只给排除原因的标签「文件解析失败」。

覆盖清单有两份：分析详情接口现算的（`getPackageCoverage`，面板顶部那一段用），以及分析完成时存进综合解读的快照（`loadCoverageForRun` → `analystSynthesis.coverage`，「排除 K（原因）」展开用）。综合解读整块会被投标草稿的取数（`tender-bid-draft/gather.ts` 的 `analystBrief`）带进模型提示。

## Goals / Non-Goals

**Goals:**
- 不论 unpdf / mammoth / xlsx 抽出什么，写库都不因字符本身失败。
- 解析失败时人能在分析面板与文件列表上直接看到原因原文。

**Non-Goals（不动的模块 / 文件）:**
- `node_modules/unpdf` 与 `package.json` 依赖：不升级、不换库、不加解密库。
- `classifyPageText` 的阈值 `NEAR_EMPTY_PAGE_CHARS`、`MAX_PDF_PAGES`、`PACKAGE_ANALYSIS_MAX_PDF_PAGES`、`MAX_TEXT_LENGTH` / `MAX_CONTENT_TEXT_CHARS`：不改。
- `parseError` 的写入点与 500 字上限（`page-parse.ts` 的 `sanitizeParseError`、`parse-content.ts` 的 catch）：不改写法。
- `src/lib/tender-understanding/**`（证据核验、归一化）：不改；它对空白做折叠，换成空格不影响引文比对。
- `src/app/api/projects/[id]/files/process-next/route.ts` 与文件管理器的自动重试逻辑：不改。
- `src/lib/tender-analyst/contract.ts` 的 `AnalystCoverage` 字段：不加字段（快照不带原文）。

## Decisions

### D1 U+0000 换成空格，落单代理字符换成 U+FFFD

- U+0000 → 空格：Appendix B 里它是勾选框字形（SymbolMT，Identity-H，没有 ToUnicode），位置在两段文字之间；换成空格不会把左右两个词粘在一起。证据核验与去重都先折叠空白（`normalizeWhitespace`），多出的空格不影响引文比对。
  - 否决：直接删掉。整页都是 U+0000 的字体（每个字都映射成 0）删完会把相邻词粘连，换空格后整页变空白，正好落到「需要 OCR」。
  - 否决：换成「☐」之类的可见符号。是在猜原字形，可能错（同一字体里还有别的字形也会抽成 0）。
- 落单代理字符 → U+FFFD：Unicode 对不成对代理字符的标准替换，与 `String.prototype.toWellFormed` 结果相同；成对的代理字符（表情符号、扩展区汉字）不动。
  - 否决：用 `toWellFormed()`。TypeScript 目标 ES2017 / lib 的类型支持不稳定，正则实现更直接、可测。

### D2 一个纯函数，放在写库边界

新文件 `src/lib/files/extracted-text.ts` 导出 `toStorableText(text)`（与一个只读判断 `hasUnstorableChars`），两条路径在**写库之前**调用：PDF 逐页文字在 `classifyPageText` 之前；整份文字在截断（`slice`）之后再清理一遍——截断可能把一对代理字符劈开，产生新的落单字符。

- 否决：在 Prisma 中间件 / 扩展里统一处理所有字符串字段。影响全库所有写入，范围远超本次。
- 否决：只在 page-parse 里改。旧路径写的是同一张表的 `contentText`，同样会失败（文件列表会一直显示失败）。

### D3 覆盖清单的原文用独立字段，不并进排除原因的文字

`ExcludedFileDetail` 多一个 `parseError: string | null`（只有解析失败的文件有值）；`exclusionReason` 的标签不变。综合解读的快照在 `loadCoverageForRun` 里**显式只取原来的六项**。

- 否决：把原文拼进 `exclusionReason`（「文件解析失败：…」）。改动最小，但快照会把原文带进综合解读，再经投标草稿取数进模型提示；原文里可能有数据库报错与服务端路径。

### D4 「排除 K（原因）」展开列表用现算的原文

分析面板把现算覆盖清单里「文件名 → parseError」的对照交给综合解读视图；视图按文件名取原文显示，快照里有而现算里已经没有（之后重新解析成功了）的文件只显示标签。

- 否决：快照里存原文（见 D3）。
- 否决：综合解读视图自己再调一次接口。面板已经拿到同一份数据。

### D5 文件列表显示全文，在文件行下方

解析失败的文件在行下方加一行红色小字「原因：〈parseError〉」，自动换行；行内仍是「解析失败」。

- 否决：保留截前 60 字 + 悬停看全文。Prisma 报错前 60 字没有信息量；手机上没有悬停。

### D6 回归测试用测试里现做的 PDF，不入库真实文件

隔离库测试在测试里拼一份最小 PDF：一页正文里有一个 Type0 / Identity-H、没有 ToUnicode 的字体字符（unpdf 抽成 U+0000，与 Appendix B 同一机理），前后是「check the box.」「The Bidder declare」；另一页整页只有这种字符。经本地文件存储走真实的两条解析路径写入本机 PostgreSQL。

- 否决：把 Appendix B 放进仓库做夹具。是客户的招标文件，带采购方身份。

## 与八条硬纪律的关系

1. 零 schema：遵守——不加模型 / 字段 / 迁移；`parseError` 是既有字段。
2. 出站先审批：不涉及（没有任何对外发送）。
3. 禁止第三套队列：不涉及（不新增任何调度、队列、租约）。
4. 脱敏：遵守——解析失败原文只在登录后的网页接口与界面出现，不进 Muse 通道、通知与模型提示（D3、spec「解析失败原文不进模型与对外通道」）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守——纯字符替换，没有新增模型调用。
8. 测试注册：`extracted-text.test.ts`（进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`）、`page-parse-nul-db.isolated.test.ts`（进 `scripts/test-all.sh`）同一 task 内注册，`bash scripts/check-test-registry.sh` 通过。

## 验证方式

- `npx tsx src/lib/files/__tests__/extracted-text.test.ts`：U+0000 → 空格、落单高 / 低位代理 → U+FFFD、成对代理与中文 / 制表 / 换行不变、截断劈开代理对后再清理。
- `npx tsx src/lib/tender-auto-analysis/__tests__/page-parse-nul-db.isolated.test.ts`（本机 PostgreSQL，`DATABASE_ENVIRONMENT=isolated`）：两条路径都 `done`、逐页与整份文字不含 U+0000、勾选框页的文字、整页 U+0000 → 需要 OCR；在改动前的代码上失败（`failed`，`parseError` 含 22021）——输出贴进报告。
- `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts`：解析失败带原文、其它原因为空、快照只取六项。
- 既有：`page-parse.test.ts`、`blob-access.test.ts`、`analyst-synthesis.test.ts` 照旧通过。
- `npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、CI 子集、`npm test`（对照既有失败清单）、`openspec validate document-parse-nul-and-reason --strict`。
- 真实应用截图：分析面板覆盖清单与文件列表各一张（隔离库造数据），放 `docs/acceptance/fix-13/`。

## Risks / Trade-offs

- [U+0000 原本代表的字形（勾选框）在文字里看不出来] → 与原来「整份失败、什么都没有」相比是净改进；勾选框本身不是要求文字。
- [原文里有数据库报错、服务端路径，项目成员能看到] → Evan 明确要求显示原文；只对有项目读权限的人、只在网页上；不进模型与对外通道。
- [已失败的文件不会自己恢复] → 打开「项目文件」抽屉时自动重新处理失败的文件（既有行为）；报告写明上线后的操作：打开「项目文件」抽屉或点「重新处理」，然后重新发起分析。
- [法文版没实测] → 机理相同；上线后重新解析时核对状态。

## Migration Plan

无数据迁移、无开关。合并部署即生效；回滚 = 回退本 PR。上线后在「12-3 Indoor Canadian Flag」打开「项目文件」抽屉触发重新处理，确认两份附录 B 不再显示「解析失败」，再重新发起分析。
