# Design：系统生成的文件不进招标文件包

## Context

本文行号以 main `2ef4f9c8` 为准。FIX-13 合并后的位置另标「FIX-13 后」，依据 `/home/user/wt/fix13` HEAD `fad35ae2`。

**生成的文件怎么进了文件包**
- 「一键生成文档」卡片（`src/components/project-generate/project-generate-menu.tsx:9-18,94-101`）调用 `POST /api/projects/:id/generate-pdf`。另外 4 个入口调用同一个接口：
  - `china-supplier-brief-panel.tsx:29,53`
  - `bid-draft-card.tsx:72`
  - `analyst-memo-card.tsx:45`
  - `org-award-intel-slots.tsx:415`
- 落库函数在 `src/lib/projects/generate/generate-docs.ts:445-530`。除了写 `ProjectGeneratedDocument`，它还写一行 `ProjectDocument`（`:516-528`），字段如下：
  - `title` 为「<标题> v<n>」（`:499`）
  - `url` / `blobUrl` 为 `/api/files/projects/<pid>/generated/<docType>-v<n>-<ts>.pdf`（`:470`）
  - `fileType` 为 `"pdf"`，PDF 渲染失败时回落为 `"html"`
  - `parseStatus` 为 `"done"`，`source` 为 `"generated"`（`:524-525`）
  - `uploadedById` 为当前用户
  - 不写 `contentHash`
- 选包只有一个函数，`src/lib/tender-auto-analysis/package.ts:138-230`。查询条件只有 `where: { projectId }`（`:146`），过滤只看类型、解析状态、页数、只作补遗的文件（`:162-182`）。缺内容指纹但有存储地址时，它会读出内容补写指纹（`:184-199`）。生成的 PDF 因此进包，还被补上指纹。
- 角色只看标题（`:49-67`），什么关键词都不命中时默认 PRIMARY（`:66`）。我用 tsx 实际跑过：8 种生成标题加上客户报价标题，全部判为 PRIMARY。分析详情接口把 PRIMARY 显示成「主文件」（`src/app/api/projects/[id]/tender-analysis/runs/[runId]/route.ts:122-140`，默认分支在 `:138`）。

**两条流程共用这一个函数**
- 旧流程：
  - `enqueue-package.ts:191`（入队）
  - `:374`（重新分析）
  - `enqueue.ts:100`（上传后按文件入队）
- 一键 AI 分析：`src/lib/tender-workforce/tools.ts:501-521` → `analysis-run-service.ts:133`。LLM 计划与确定性计划都从这一步开始（`deterministic-plan.ts:59`）。
- 执行摘要算当前指纹：`executive-brief.ts:364-371`。
- 后面的步骤都按记下的清单走：页级解析（`worker.ts:360-379`、`tools.ts:530-557`）、抽取与澄清（`extract.ts:45-62`、`clarifications.ts:37-50`）、V2 分析器输入（`v2-persist.ts:60-121`）。

**写入 `ProjectDocument` 的入口一共 6 个**
- 依据：`src` 下非测试代码只有 5 处 `create`、1 处 `createMany`，没有 `INSERT`。

| 入口 | 位置 | `source` |
|---|---|---|
| 项目文件上传（文件抽屉、新建项目的文件夹导入 `project-import-banner.tsx:34`） | `src/app/api/projects/[id]/files/route.ts:164-176` | `"upload"`（`:172`） |
| 一键生成与其它生成入口 | `generate-docs.ts:516-528` | `"generated"` |
| 投标准备清单 | `src/app/api/projects/[id]/checklist/route.ts:58-71` | `"ai_checklist"`（常量 `:17`；`fileType "json"`、`url internal://bid-checklist`） |
| 客户报价 PDF | `src/lib/quote-engine/quotation-pdf.ts:84` | `"generated_customer_quotation"`（存储路径同在 `/generated/` 下，`:75`） |
| 报价工具导入供应商报价 | `src/lib/quote-engine/import/import-service.ts:137-140` | `"quote_import"`（xlsx / xls / csv / pdf，写内容指纹，随后做页级解析） |
| 外部系统建项（BidToGo，`POST /api/v1/projects`） | `src/app/api/v1/projects/route.ts:211-221` | 不写 → 库默认 `"external_link"`（`prisma/schema.prisma:1847`） |

**现有的三处来源判定，口径各不相同**
- `package-coverage.ts:64-67`（FIX-13 后 `:76-77`）：白名单 `source == null || source === "upload"`。只影响「上传 N」的计数，不影响选包。
- `src/lib/tender-understanding/package-input.ts:276,530-532`：黑名单 `{"ai_checklist"}`，用于 agent「标书分析」技能。
- `src/lib/files/intelligence-extractor.ts:174`：`source: { not: "ai_checklist" }`。
- 另有两处：`reply-resolution.ts:94-99` 用字面量 `source: "upload"` 白名单；分析师备忘录 v2 的语料（`src/lib/tender-analyst-memo/v2/pipeline.ts:37-41`）读项目全部文件的页面，不看来源。

## Goals / Non-Goals

**Goals**
- 招标文件包只纳入用户上传的文件，两条流程、所有入口同一个判定。
- 就绪判断、内容指纹、覆盖计数、agent 技能清单、项目情报输入、备忘录语料用同一口径。
- 已经误纳入的旧分析能看出问题、能恢复。

**Non-Goals**（具体到文件）
- `src/lib/tender-auto-analysis/enqueue-package.ts`、`enqueue.ts`、`enqueue-helpers.ts`：入队、幂等、取代、workforce 改派都不动。
- `src/lib/projects/generate/generate-docs.ts`、`src/lib/quote-engine/quotation-pdf.ts`、`src/lib/quote-engine/import/import-service.ts`、`src/app/api/projects/[id]/checklist/route.ts`、`src/app/api/v1/projects/route.ts`：写入的来源值不动，照旧写进 `ProjectDocument`。
- `src/app/api/projects/[id]/files/process-next/route.ts`、`src/lib/files/ai-summary.ts`、`src/lib/projects/apply-document-metadata.ts`：文件流水线不动（理由见 proposal「Out of scope」）。
- `src/components/project-files/project-file-manager.tsx`：文件抽屉的分组与图标不动。
- `src/lib/projects/project-ai-context.ts`、`src/lib/ai/context.ts`：项目 AI 上下文不动。
- `src/lib/tender-auto-analysis/executive-brief.ts`：不改代码，它经选包函数自动跟上。
- `src/lib/tender-auto-analysis/page-parse.ts`、`worker.ts`、`src/lib/tender-workforce/tools.ts`：不动，它们按清单走。
- `prisma/**`：零 schema。

## Decisions

### D1 判定依据：只认 `source = "upload"`（白名单）

**两种做法逐类比较**（以各来源在现状下的行为为依据）

| 来源 | 是不是招标文件 | 现在进包时怎样 | 白名单 | 黑名单（generated / generated_customer_quotation / ai_checklist / quote_import） |
|---|---|---|---|---|
| `upload` | 是。用户在文件抽屉或建项时传的招标文件 | 正常 | 纳入 | 纳入 |
| `generated`（8 种生成文件） | 不是，是我方根据分析写的文字 | 进包、判成主文件。其中「内部项目分析」的旧文本路径把项目 AI 上下文拼进正文（`generate-docs.ts:331`），上下文里有预估金额、我方报价、中标价（`project-ai-context.ts:138-146`） | 排除 | 排除 |
| `generated_customer_quotation` | 不是，是我方给客户的报价 | PDF、已解析，进包，正文是我方报价合计 | 排除 | 排除 |
| `ai_checklist` | 不是 | `fileType "json"` 不在可分析类型里，现在本来就进不了包 | 排除 | 排除 |
| `quote_import` | 不是。是供应商发给我方的报价，进报价引擎做成本（`import-service.ts:137-140` → `QuoteCostImport.sourceDocumentId`） | xlsx / csv / pdf 都可分析，已解析，有指纹，**现在会进包**，标题按文件名判角色 | 排除 | 排除（这一项是这次专门列进名单的） |
| `external_link`（BidToGo 建项带的链接） | 指向采购方的招标文件，但青砚**没有它的内容**：没有存储地址、没有指纹 | `fileType` 取 `file_type`，缺省 `"link"`（`v1/projects/route.ts:217`）。`"link"` 不可分析，被静默跳过。若外部给的是 `"pdf"` 等可分析类型，parseStatus 停在默认的 pending（`schema.prisma:1843`；没有存储地址时解析函数直接返回、不改状态，`parse-content.ts:90`）：选包时没有指纹也读不出内容 → 带 `failOnMissingHash` 的入队、重新分析、一键分析一律以「缺少内容指纹」失败（`package.ts:200-203,216-218`；`enqueue-package.ts:191-203`；`analysis-run-service.ts:133-145`）；就绪判断永远是「仍在处理」（`package-ready.ts:75-85`） | 排除。项目里有上传文件就能照常分析 | 现状不变：可分析类型的外部链接继续挡住整个项目的分析 |
| 今后新增的写入入口 | 未知 | 不写 `source` 时用默认值 `external_link` | 排除，要显式写 `upload` 才进 | 纳入，要记得加黑名单才排除 |

**结论**：选白名单。
- 招标文件只有一个入口（项目文件上传），那里固定写 `upload`。
- 白名单失败时偏向不纳入：新入口忘写或写错来源，结果是文件没进分析，覆盖清单的「上传 N」也不计它，人能看出来；而不是把系统文字悄悄当证据。
- 它与现有的覆盖计数（`package-coverage.ts:64-67`）、业主回复匹配（`reply-resolution.ts:94-99`）口径一致。
- 外部链接本来就没有内容可分析；白名单还顺带消除了它挡住分析的问题。

**否决：黑名单**。
- 每多一种系统写入，都要记得回来加。
- 现在就要把 `quote_import` 与 `external_link` 一个个想到。
- 漏一个就会重演 12-3。

**历史数据里有没有别的来源值**
- 仓库能查到的：可见历史从 2026-08-25 开始，是浅克隆。对可见历史里所有增删 `projectDocument.create/createMany` 的提交，抽出 `source:` 字面量，只有 `upload`、`generated`、`generated_customer_quotation`、`quote_import`。`ai_checklist` 经常量写入。
- `external_link` 默认值从 2026-04-16 的基线迁移起就在（`prisma/migrations_legacy_pre_greenfield_baseline/20260416120000_baseline_before_launch/migration.sql:983`）。
- 2026-08-25 之前上传接口写什么来源，仓库里查不到。如果当年上传没写来源，真上传的文件会是 `external_link`，白名单会把它排除。上线前用下面「生产只读核对」的第 1、2 条 SQL 确认；结果不干净就进「留给 GATE」第 2 条。

### D2 判定放在一个不依赖库的小模块里，上传接口改写它的常量

- 新建 `src/lib/files/document-source.ts`，导出两样，没有任何数据库或网络依赖，前端组件也能引用：
  - `USER_UPLOAD_SOURCE = "upload"`
  - `isUserUploadedSource(source: string | null | undefined): boolean`，只有恰好等于常量时为真；`null`、`undefined`、大小写不同都为假。
- 写入端：上传接口 `files/route.ts:172` 改写这个常量，写入方与读取方用同一个值。
- 读取端：选包、就绪、覆盖、agent 技能、项目情报、备忘录、业主回复都引用它。
- 否决：
  - 放进 `src/lib/tender-auto-analysis/enqueue-helpers.ts`：项目情报（`src/lib/files/`）与 agent 技能（`src/lib/tender-understanding/`）不属于招标自动分析模块，反向依赖它不合适。
  - 只在各处 Prisma 查询里写 `source: "upload"`：字面量散在七处，没有一个地方能被测试守住；就绪判断这个纯函数也测不到。

### D3 选包与就绪：在代码里过滤，放在补写指纹之前

**选包**（`package.ts`）
- 查询多选 `source`，循环里第一件事就判来源，不是上传就 `continue`。这样被过滤的文件不读存储、不补写指纹，满足规格「SHALL NOT 读取 / 补写」。
- 强制纳入（`forceIncludeDocumentIds`）也不能越过来源判定。它只来自上传接口（`enqueue.ts:100-105`），来的总是上传文件。

**就绪**（`package-ready.ts`）
- `ReadinessRow` 加必填的 `source`，`assessPackageReadiness` 的候选先按来源过滤，`getTenderPackageReadiness` 多选这一列。

**否决：改成 Prisma `where: { projectId, source: "upload" }`**
- 对选包而言等价，但就绪判断的纯函数就测不到来源规则了。
- 两个文件写法不一，以后容易各改各的。

项目情报那一处用 `where`（D5），因为它带 `take: 10`：先取 10 条再过滤，会少拿上传文件。

### D4 覆盖计数：改用共享判定，字段缺省时仍按上传算

- `summarizePackageCoverage` 的过滤改为 `isUserUploadedSource(r.source ?? USER_UPLOAD_SOURCE)`。
- `CoverageRow.source` 是可选字段（`package-coverage.ts:20-21`），main 与 FIX-13 的覆盖测试都不传它，靠「缺省即计入」。数据库这一列非空，缺省只出现在纯函数调用里。所以库里的数据计数结果不变，既有测试不用改。
- 否决：把 `source` 改成必填。要改 FIX-13 刚加的约 200 行测试的构造方式，零收益。

### D5 另外四处读取改用同一判定

| 位置 | 现在 | 改成 | 行为变化 |
|---|---|---|---|
| `src/lib/tender-understanding/package-input.ts:276,530-532`（agent「标书分析」技能） | `SYSTEM_SOURCES = {"ai_checklist"}` | `!isUserUploadedSource(doc.source)` → 排除 | 生成文件、客户报价、报价导入、外部链接也被排除，排除原因沿用 `SYSTEM_GENERATED` |
| `src/lib/files/intelligence-extractor.ts:171-180`（项目情报，所有项目） | `parseStatus "done"` 且 `source ≠ ai_checklist`，`take: 10` | `parseStatus "done"` 且 `source = USER_UPLOAD_SOURCE` | 项目情报不再读已被解析过的生成文件与报价导入。没有正文的生成文件（解析状态为 done）原来也可能占掉 10 个名额中的一个，再在正文过滤时被丢掉；现在 10 个名额只给上传文件 |
| `src/lib/tender-analyst-memo/v2/pipeline.ts:37` | 读项目全部文件的页面 | 只读上传文件的页面 | 备忘录语料不再含已被解析过的生成文件（包括上一版备忘录）与报价导入的页面 |
| `src/lib/tender-auto-analysis/reply-resolution.ts:97` | 字面量 `"upload"` | 常量 | 无 |

- 排除原因码沿用 `SYSTEM_GENERATED`。这个码只出现在 agent 技能写给模型的文件清单文本里（`package-input.ts:761-778`），没有界面显示它，也没有测试断言它（全仓 grep 测试为 0）。
- 否决：新增 `NOT_USER_UPLOAD` 码。要改类型联合与清单文本，读者只有模型，收益为零。
- 否决：这四处保持不变、只改选包。这样今后 12-3 这类生成文件虽然不进分析，却仍会进 agent 技能与备忘录语料，「系统文字当招标证据」的问题只修了一半。

### D6 已有分析：不迁移、不自动重跑，靠标签与过期提示让人重新分析

**这次合并之后会变的**

1. **执行摘要过期**：
   - 凡是文件清单里有非上传文件的分析（如 12-3），当前文件包的指纹（只算上传文件）与它记下的指纹不同，执行摘要标为过期（`executive-brief.ts:218-221`）。
   - 显示为工作台「文件有更新，摘要可能过期」（`workbench-command-deck.tsx:196-199`）与情报页「招标文件有更新，建议重新分析」（`project-intel-sections.tsx:372-373`）。这是我们要的恢复提示。
   - 反过来，现在「分析之后又生成了文件」的项目被误标过期的情况，从此消失：当前指纹不再算生成文件。
2. **旧分析的文件列表**：那份生成文件改标「不是上传的招标文件（重新分析后不再纳入）」（D7）。
3. **旧流程的自动入队开关（`TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED`）开着、且没有改派到 workforce 时，受影响的项目会自动多起一轮分析**：
   - 下一次文件流水线跑到「全部处理完」时会走自动入队（`process-next/route.ts:166,206,225`）。
   - 新指纹找不到活跃的同指纹分析（`enqueue-package.ts:226-243`；活跃集合不含 APPROVED，见 `enqueue-helpers.ts:8-13`），于是新建一份 PENDING 的完整分析（`:250-284`）。
   - 这份新分析就是我们要的恢复，每个受影响的项目只多一轮：它还在进行或等待审核时，之后同指纹的调用都复用它。
   - 不受影响的项目指纹不变，不会多起。
   - workforce 改派开着时，自动路径用固定的 `requestId`（`enqueue-package.ts:611`）重放已有任务（`trigger-service.ts:130-140`），不会自动重跑，要人点「重新分析」。
   - 生产上两个开关的实际值，仓库里查不到（`docs/QINGYAN_TENDER_FLOW_BASELINE.md:172`）。
4. 已经被页级解析过的生成文件，页面行与正文都保留。但选包、agent 技能、项目情报、备忘录都不再读它们（D3、D5）。

**12-3 的恢复步骤**（写进报告）
1. FIX-13、FIX-19 都部署之后，打开「12-3」的项目页。
2. 在「AI 数字员工 · 投标分析」卡片上点「重新分析」：这一步取消旧任务，按新清单再建，`trigger-service.ts:151-168`。
3. 新的分析清单只含上传文件。
4. 在分析面板核对「上传 N · 纳入分析 N」，文件列表里不再有「China Supplier Sourcing Brief」。
5. 其它受影响的项目用下面的第 3 条 SQL 列出来，逐个同样处理。

**否决**
- 写一次性脚本，把旧分析清单里的非上传文件删掉或改角色：分析结果（事实、要求、章节、引用）已经引用了这些文件的页面，只删清单会让结果与清单对不上；改写记录还会破坏审计。
- 合并后自动对所有受影响项目重跑：会新增模型调用与费用，也和「不补救」的既定做法（FIX-12 / FIX-13 都是人来重新分析）不一致。

### D7 旧分析的标签在展示层改，不改记录

- 分析详情接口在 `route.ts:57-63` 的文档查询里多选 `document.source`。
- 角色标签函数从 `route.ts:122-140` 挪到 `src/lib/tender-auto-analysis/display-labels.ts`，导出成纯函数，入参为（角色、来源）：
  - 来源不是上传 → 「不是上传的招标文件（重新分析后不再纳入）」
  - 是上传 → 照旧的 7 种标签
- 响应里的 `documents` 只改标签的值，不加 `source` 字段，不加正文（规格的敏感项要求：不返回来源值与正文）。
- 否决：
  - 不改标签，只靠过期提示：12-3 的人在面板上仍看到「China Supplier Sourcing Brief v1 · 主文件」，看不出问题在哪。
  - 前端按标题猜：标题不可靠，「主文件」本身就是按标题猜错的。

### D8 测试：纯函数与接线进 CI，选包用隔离库端到端，先在旧代码上证明会失败

**新增 `src/lib/files/__tests__/document-source.test.ts`**（不用库，进 `scripts/test-ci-unit.sh`）
- 判定的真值表：`upload` 为真；`generated`、`generated_customer_quotation`、`ai_checklist`、`quote_import`、`external_link`、空串、`null`、`undefined`、`Upload` 都为假。
- 角色标签函数：非上传文件给新标签；上传文件 7 种角色的标签与改动前相同。
- 写入端源码断言：
  - 上传接口写常量。
  - 四个系统写入方的来源值分别是 `generated` / `generated_customer_quotation` / `ai_checklist` / `quote_import`。
  - 外部 API 的 `createMany` 不写来源。
  - `src` 非测试代码里不再有 `source: "upload"` 字面量。
- 读取端接线断言：
  - 选包查询选了 `source`，来源判定出现在 `readBlobBuffer(` 之前。
  - 就绪的取数映射带 `source`。
  - 覆盖、agent 技能、项目情报、备忘录、业主回复都引用共享判定或常量。
  - `package-input.ts` 里不再有 `SYSTEM_SOURCES`，`intelligence-extractor.ts` 里不再有 `not: "ai_checklist"`。
  - 分析详情接口引用标签函数，响应的 `documents` 映射里没有 `source:` 键。

**扩既有测试**
- `package-ready.test.ts`：辅助函数默认 `source: "upload"`；加用例「待解析的外部链接、生成文件、报价导入不挡就绪、不计数」。
- `package-coverage.test.ts`：加混合来源的用例「上传 2 · 纳入分析 2」。
- `input-completeness.test.ts`：生成文件、报价导入标 `SYSTEM_GENERATED`，上传照旧。

**新增 `src/lib/tender-auto-analysis/__tests__/package-source-db.isolated.test.ts`**（隔离库，没有隔离库时跳过）
- 夹具与断言：

| 夹具文件 | 来源 | 状态 | 断言 |
|---|---|---|---|
| RFP、Addendum 1 两份 PDF | `upload` | 已解析、有指纹、有页面 | 选包恰好这 2 份；不出现两份以上主文件的分类歧义提示 |
| China Supplier Sourcing Brief v1 | `generated` | 已解析、**有指纹**（模拟生产里被补写过的状态）、有页面 | 不进包；读到的页面里没有它 |
| 内部项目分析 v1 | `generated` | 正文含「我方报价：」 | 不进包 |
| 供应商报价表 xlsx | `quote_import` | 已解析、有指纹 | 不进包 |
| 外部链接 PDF | `external_link` | 待解析、无指纹、无存储地址 | 带 `failOnMissingHash` 的选包不抛错 |
| 投标准备清单 | `ai_checklist` | — | 不进包 |
| 生成文件 | `generated` | 无指纹；有存储地址，测试开本地存储（`PRODUCT_CONTENT_LOCAL_STORE=1`，`blob-access.ts:38-40`），文件真实存在 | 选包后指纹仍为空、不进包（改动前会被读出、补写指纹、进包） |

- 其余断言：
  - 就绪为已就绪、文件数 2。
  - 当前指纹等于两份上传文件的指纹。
  - 覆盖为「上传 2」。
- 在只有测试、没有改动的代码上运行，必须有用例失败：生成文件和报价导入进了包，无指纹的生成文件被补写了指纹，外部链接让带 `failOnMissingHash` 的选包抛错，就绪为「仍在处理」。失败输出贴进报告。

**扩 `src/lib/tender-workforce/__tests__/t1b-integration.test.ts`**
- 夹具 `:97-120` 的两份文件补 `source: "upload"`。它们现在没写来源，用的是默认 `external_link`，白名单会把它们排除，整个测试会以 INPUT_MISSING 失败。
- 再加一份生成文件，断言 workforce 分析清单里没有它、`documents.length` 仍为 2。
- 同一文件里的旧流程用例（`:830,842`）用的是同一批夹具，跟着修好。

**否决：只做纯函数测试**
- 选包、就绪、指纹都是带库的取数函数，生产问题恰好出在取数那一步。
- 只有隔离库端到端能证明真实的行进不进包。

**不用改的既有夹具**（逐个核对过）
- `page-parse-nul-db.isolated.test.ts`（FIX-13）与 `files-access-db.isolated.test.ts`（FIX-17）都写了 `source: "upload"`。
- `web-next-step-db.isolated.test.ts`、`corporate-memory/__tests__/t3-integration.test.ts` 不走选包。
- `scripts/` 下的手工 e2e 不在门禁里；其中会走选包的几个都写了 `upload` 或经上传接口建文件。

## 相邻改动与合并顺序

- **FIX-13**（#546，先合并）：
  - 改了 `package-coverage.ts`，加 `parseError`、`toAnalystCoverage`、`withoutParseErrors`。来源过滤行在 FIX-13 后的 `:76-77`，本 change 只换这一行的判定。
  - 也改了 `executive-brief.ts`、`v2-persist.ts`、`page-parse.ts`、`parse-content.ts`、`analysis-panel.tsx`、`analyst-synthesis-view.tsx`、`project-file-manager.tsx`，本 change 都不碰。
  - 本 change 在 FIX-13 合并后的 main 上实施。
- **FIX-18**（招标分析只留一个入口，四件套还在起草，`/home/user/wt/fix18/openspec/changes/tender-analysis-single-entry/` 目前是空目录）会改 `enqueue-package.ts`。
  - 本 change **不改** `enqueue-package.ts`、`enqueue.ts`、`trigger-service.ts`、`analysis-panel.tsx`，只改两条流程共用的选包与就绪函数。不论 FIX-18 留下哪个入口，新入口都经同一个选包函数，规则自动适用。
  - 本 change 的测试只调选包、就绪、覆盖与 workforce 校验输入这一步，不调旧流程的入队函数（t1b 里原有的旧流程用例除外，只是夹具补来源）。所以 FIX-18 删掉旧入口不会打坏本 change 的测试。
  - 两者谁先合都行：后合并的一方 rebase 时只会在 `scripts/test-all.sh` 注册行附近有文本冲突。如果 FIX-18 删了 t1b 里的旧流程用例，本 change 对那两个用例的夹具改动随之消失，不影响结论。
- **FIX-16**（`tender-analysis-incomplete-notes`）也改 `runs/[runId]/route.ts`：响应多两样字段。本 change 改同一文件的文档查询（`:57-63`）与标签函数（`:122-140`，挪走后改为引用），不同段落；后合并的一方手工合并。
- **FIX-17**（`project-files-access-guard`）改 `files/[fileId]/route.ts`、`files/process-next/route.ts`，不改 `files/route.ts`。它的守卫测试检查 `files/` 下每个接口先过项目权限，本 change 在 `files/route.ts:172` 只换一个常量，不影响那条守卫。
- 推荐顺序：FIX-13 → FIX-17 → FIX-19 → FIX-18。FIX-18 改入口，放在最后，便于它直接基于「选包已经只认上传文件」来写规格；顺序反过来也成立。

## 与八条硬纪律的关系

1. **零 schema**：遵守。不加字段、不加表、不写迁移，判定只用既有的 `ProjectDocument.source`。
2. **出站先审批**：不涉及，没有对外发送。
3. **禁止第三套队列**：不涉及。不新增队列、调度或 worker；入队与取代逻辑不动。
4. **脱敏**：遵守，而且更严。内部生成文件与客户报价 PDF 里的我方报价、预估金额、中标价，不再经文件包进入分析结果、综合解读（它会进投标草稿的模型提示，`src/lib/tender-bid-draft/gather.ts:199` → `synthesize.ts:73`）、备忘录语料与项目情报（规格第 6 条）。分析详情接口只改标签的值，不新增来源或正文字段。不改 `src/lib/muse-bridge/**`。
5. **不爬登录页**：不涉及。外部链接照旧不抓取。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。来源判定是等值比较，不新增模型调用。项目情报、备忘录、agent 技能的模型输入只会变少；受影响项目的重新分析是人发起的既有调用，或者是 D6 第 3 条在旧流程自动开关开着时多出的一轮。
8. **测试注册**：
   - `document-source.test.ts` 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
   - `package-source-db.isolated.test.ts` 注册进 `scripts/test-all.sh`，写法同 `requirement-batch-confirm-db.isolated.test.ts`（`test-all.sh:618`）。
   - `bash scripts/check-test-registry.sh` 通过，不动 `ci/test-registry-baseline.txt`。

## 验证方式

- `npx tsx src/lib/files/__tests__/document-source.test.ts`：真值表、标签、写入端与读取端的接线断言全过。
- `npx tsx src/lib/tender-auto-analysis/__tests__/package-ready.test.ts`、`package-coverage.test.ts`、`package-fingerprint.test.ts`、`obs-p4-page-limit.test.ts`（它的源码探针 `:101-109` 仍要匹配 `package.ts`）、`npx tsx src/lib/tender-understanding/__tests__/input-completeness.test.ts` 全过。
- 隔离库：
  - `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/tender-auto-analysis/__tests__/package-source-db.isolated.test.ts` 全过；在只有测试的代码上失败，输出贴进报告。
  - `t1b-integration.test.ts` 全过。
- 门禁：
  - `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`
  - `npm run lint:baseline`
  - `bash scripts/check-test-registry.sh`
  - CI 环境变量下 `bash scripts/test-ci-unit.sh`
  - `bash scripts/test-runtime-architecture.sh`
  - `npm test`，与既有失败清单对照无新增
  - `openspec validate tender-package-exclude-generated --strict`
  - `git diff origin/main -- prisma/` 为空
- 本机手工：建一个投标项目，上传两份 PDF，在「一键生成文档」生成国内供应商简报，再发起分析。分析面板的文件列表只有两份，「上传 2 · 纳入分析 2」。截图进报告。

## 生产只读核对（上线前由有生产只读权限的人执行；只有 SELECT）

```sql
-- 1. 来源值分布：确认没有白名单之外、实为上传的来源值
SELECT source, "fileType", count(*) AS n,
       count(*) FILTER (WHERE "blobUrl" IS NOT NULL)     AS with_blob,
       count(*) FILTER (WHERE "contentHash" IS NOT NULL) AS with_hash,
       min("createdAt") AS first_at, max("createdAt") AS last_at
FROM "ProjectDocument"
GROUP BY source, "fileType"
ORDER BY source, "fileType";

-- 2. 来源不是 upload、却有存储内容、又不在生成 / 报价导入目录下的行（应为 0；不为 0 就进「留给 GATE」第 2 条）
SELECT id, "projectId", title, "fileType", source, "createdAt"
FROM "ProjectDocument"
WHERE source <> 'upload'
  AND "blobUrl" IS NOT NULL
  AND "blobUrl" NOT LIKE '%/generated/%'
  AND "blobUrl" NOT LIKE '%/quote-imports/%'
ORDER BY "createdAt";

-- 3. 最新一份分析里纳入了非上传文件的项目（上线后逐个重新分析的名单）
WITH latest AS (
  SELECT DISTINCT ON ("projectId") id, "projectId", status, "createdAt"
  FROM "TenderAnalysisRun"
  WHERE status <> 'SUPERSEDED'
  ORDER BY "projectId", "createdAt" DESC
)
SELECT p.name, l."projectId", l.id AS run_id, l.status, l."createdAt",
       count(*) AS non_upload_docs,
       string_agg(d.title || ' [' || d.source || ' / ' || rd.role || ']', '; ') AS docs
FROM latest l
JOIN "TenderAnalysisRunDocument" rd ON rd."runId" = l.id
JOIN "ProjectDocument" d ON d.id = rd."documentId"
JOIN "Project" p ON p.id = l."projectId"
WHERE d.source <> 'upload'
GROUP BY p.name, l."projectId", l.id, l.status, l."createdAt"
ORDER BY l."createdAt" DESC;

-- 4. 现在被可分析类型的外部链接挡住分析的项目（上线后这些项目有上传文件就能分析）
SELECT "projectId", count(*) AS n
FROM "ProjectDocument"
WHERE source = 'external_link'
  AND lower("fileType") IN ('pdf','application/pdf','docx','xlsx','xls','csv','txt','text/plain','text/csv')
  AND "contentHash" IS NULL AND "blobUrl" IS NULL
GROUP BY "projectId";
```

## Risks / Trade-offs

- **2026-08-25 之前的真上传文件可能是 `external_link`，会被排除** → 上线前跑第 1、2 条 SQL；不为 0 就停下来，按「留给 GATE」第 2 条处理。
- **报价导入的文件不进分析后，有人习惯把招标文件经报价工具导入** → 报价导入只收供应商报价（xlsx / xls / csv / pdf），产物进报价引擎的成本行，不是招标文件的入口；招标文件只能从项目文件上传。报告里写明。
- **受影响的旧分析全都显示过期** → 这正是要的提示；数量由第 3 条 SQL 给出。
- **旧流程自动开关开着时，受影响项目各多一轮分析** → 有界（每个项目一轮），而且是需要的恢复；生产开关的值留给人确认。
- **外部链接文件让文件流水线反复空转的既有问题仍在**（`parse-content.ts:90` 没有存储地址就直接返回，`project-file-manager.tsx:168` 的循环不结束）→ 不在本次，另开任务；第 4 条 SQL 能看出生产上有没有这种行。
- **文件抽屉里生成文件仍归在「外部链接」** → 只是显示问题，另开小改动。

## 留给 GATE

1. **判定口径**
   - A 白名单 `upload`（推荐）：生成文件、客户报价 PDF、投标准备清单、报价导入、外部链接、今后的新入口都不进包；外部链接不再挡住分析。
   - B 黑名单 {generated, generated_customer_quotation, ai_checklist, quote_import}：外部链接照旧挡住分析；以后每加一种系统写入都要回来加名单。
   - 推荐 A，理由见 D1。
2. **生产只读核对的结果不干净时怎么办**（第 2 条 SQL 不为 0）
   - A 先停，看清是哪些行，再决定（推荐）。
   - B 在判定里额外放行「`external_link` 且有存储地址、不在生成 / 报价导入目录下」：规则变复杂，且按存储路径判来源。
   - C 照白名单上线，让人重新上传这些文件：要人手工补。
   - 推荐 A：先看数据；可见历史里上传接口一直写 `upload`，预计为 0。
3. **受影响旧分析的恢复**
   - A 人逐个点「重新分析」，名单来自第 3 条 SQL（推荐）。
   - B 写一次性脚本自动重跑：新增模型费用，也与 FIX-12 / FIX-13「不补救、人来重跑」的做法不一致。
   - C 不处理，只靠标签和过期提示：旧分析里的生成文件内容仍留在事实与要求里，直到有人重跑。
   - 推荐 A。同时要接受 D6 第 3 条：旧流程自动开关开着的组织，受影响项目会自动多起一轮。另一个选项是在入队里压住这一轮，但那要改 `enqueue-package.ts`，与 FIX-18 冲突，而且这一轮本来就是需要的恢复。
4. **报价导入的供应商报价不进招标文件包**
   - A 排除（推荐）：它是供应商对我方的报价，不是采购方的招标要求；纳入会把供应商价格当成招标事实抽取。
   - B 纳入：要在白名单里加 `quote_import`。
   - 推荐 A。
5. **外部链接（BidToGo 建项带的链接）不进招标文件包**
   - A 排除（推荐）：青砚没有它的内容，本来就分析不了；现在可分析类型的外部链接会让整个项目的分析失败。
   - B 保留现状：要在判定里加例外，项目继续被挡住。
   - BidToGo 现在还推不推标，仓库里查不到（`docs/QINGYAN_TENDER_FLOW_BASELINE.md:174`）。推荐 A。

## Migration Plan

- 合并前：跑「生产只读核对」第 1、2、4 条，结果写进报告；第 2 条不为 0 时先回 GATE。
- 合并即生效：没有开关，也没有数据迁移。
- 合并部署后：跑第 3 条拿到受影响项目名单，按 D6 的步骤逐个重新分析；12-3 与 FIX-13 的「重新解析附录 B」一起做。
- 回退：revert 本 PR 即可。没有写任何数据；回退后生成文件重新进包，旧行为全部恢复。
