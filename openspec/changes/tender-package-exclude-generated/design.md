# Design：系统生成的文件不进招标文件包

## Context

本文行号以 main `13c7ed33` 为准，它已含 FIX-13（#546，2026-11-22 合并）。没被 FIX-13 改过的文件，行号与 `2ef4f9c8` 相同。

**生成的文件怎么进了文件包**
- 「一键生成文档」卡片（`src/components/project-generate/project-generate-menu.tsx:9-18,94-101`）调用 `POST /api/projects/:id/generate-pdf`。另外 4 个入口调用同一个接口：
  - `china-supplier-brief-panel.tsx:29,53`
  - `bid-draft-card.tsx:72`
  - `analyst-memo-card.tsx:45`
  - `org-award-intel-slots.tsx:415`
- 落库函数在 `src/lib/projects/generate/generate-docs.ts:445-530`。除了写 `ProjectGeneratedDocument`，它还写一行 `ProjectDocument`（`:516-528`），字段如下：
  - `title` 为「<标题> v<n>」（`:499`，8 种标题见 `:36-45`）
  - `url` / `blobUrl` 为 `/api/files/projects/<pid>/generated/<docType>-v<n>-<ts>.pdf`（`:470`）
  - `fileType` 为 `"pdf"`，PDF 渲染失败时回落为 `"html"`
  - `parseStatus` 为 `"done"`，`source` 为 `"generated"`（`:524-525`）
  - `uploadedById` 为当前用户
  - 不写 `contentHash`
- 选包只有一个函数，`src/lib/tender-auto-analysis/package.ts:138-230`。
  - 查询条件只有 `where: { projectId }`（`:146`），过滤只看类型、解析状态、页数、只作补遗的文件（`:162-182`）。
  - 缺内容指纹但有存储地址时，它会读出内容补写指纹（`:184-199`）。
  - 生成的 PDF 因此进包，还被补上指纹。
- 角色只看标题（`:49-67`），什么关键词都不命中时默认 PRIMARY（`:66`）。
  - 不按文件名判补遗（注释 `:45-48`），所以「Addendum 1.pdf」也判 PRIMARY。
  - 我用 tsx 实际跑过：8 种生成标题加上客户报价标题，全部判为 PRIMARY。
  - 分析详情接口把 PRIMARY 显示成「主文件」（`src/app/api/projects/[id]/tender-analysis/runs/[runId]/route.ts:122-140`，默认分支在 `:138`），显示位置是分析面板覆盖清单下的文件列表（`analysis-panel.tsx:487-535`，标签在 `:501`、`:529`）。

**两条流程共用这一个函数**
- 旧流程：
  - `enqueue-package.ts:191`（入队）
  - `:374`（重新分析）
  - `enqueue.ts:100`（上传后按文件入队）
- 一键 AI 分析：`src/lib/tender-workforce/tools.ts:501-521` → `analysis-run-service.ts:133`。LLM 计划与确定性计划都从这一步开始（`deterministic-plan.ts:59`）。
- 执行摘要算当前指纹：`executive-brief.ts:368-375`。
- 后面的步骤都按记下的清单走：
  - 页级解析：`worker.ts:360-379`、`tools.ts:530-557`
  - 抽取与澄清：`extract.ts:45-62`、`clarifications.ts:37-50`
  - V2 分析器输入：`v2-persist.ts:60-124`
- 建分析记录的只有三处（`enqueue-package.ts:250`、`:452`、`analysis-run-service.ts:191`），全都先经选包函数。单条记录的重新分析接口也转到 `reanalyzeTenderPackage`（`review.ts:216-255`）。

**写入 `ProjectDocument` 的入口一共 6 个**

依据：`src` 下非测试代码只有 5 处 `create`、1 处 `createMany`，没有嵌套写入，也没有原生 SQL。

| 入口 | 位置 | `source` |
|---|---|---|
| 项目文件上传（文件抽屉、新建项目的文件夹导入 `project-import-banner.tsx:34`） | `src/app/api/projects/[id]/files/route.ts:164-176` | `"upload"`（`:172`） |
| 一键生成与其它生成入口 | `generate-docs.ts:516-528` | `"generated"` |
| 投标准备清单 | `src/app/api/projects/[id]/checklist/route.ts:58-71` | `"ai_checklist"`（常量 `:17`；`fileType "json"`、`url internal://bid-checklist`） |
| 客户报价 PDF | `src/lib/quote-engine/quotation-pdf.ts:84` | `"generated_customer_quotation"`（存储路径同在 `/generated/` 下，`:75`） |
| 报价工具导入供应商报价 | `src/lib/quote-engine/import/import-service.ts:137-140` | `"quote_import"`（xlsx / xls / csv / pdf，写内容指纹，随后做页级解析 `:162`） |
| 外部系统建项（BidToGo，`POST /api/v1/projects`） | `src/app/api/v1/projects/route.ts:211-221` | 不写 → 库默认 `"external_link"`（`prisma/schema.prisma:1847`） |

其它看起来像入口的地方都不写 `ProjectDocument`：
- 邮件与询价回信的附件、知识库（`KnowledgeDocument`）、Muse 通道（`src/lib/muse-bridge/**` 不碰这张表）。
- 交接（`handoff/execute.ts:130` 只读）。

**现有的三处来源判定，口径各不相同**
- `package-coverage.ts:76-77`：白名单 `source == null || source === "upload"`。只影响「上传 N」的计数，不影响选包。
- `src/lib/tender-understanding/package-input.ts:276,530-532`：黑名单 `{"ai_checklist"}`，用于 agent「标书分析」技能。
- `src/lib/files/intelligence-extractor.ts:174`：`source: { not: "ai_checklist" }`。
- 另有两处：
  - `reply-resolution.ts:94-99` 用字面量 `source: "upload"` 白名单；
  - 分析师备忘录 v2 的语料（`src/lib/tender-analyst-memo/v2/pipeline.ts:37-41`）读项目全部文件的页面，不看来源。
- 文件抽屉也已经只把 `source === "upload"` 归为「上传」（`project-file-manager.tsx:374`）。

**agent「标书分析」技能的完整性判定**
- 技能读项目全部文件（`load-package.ts:87-124`），逐份判纳入与排除，再算完整性（`package-input.ts:644-723`）。
- 「相关文档」只排除角色为 NON_TENDER 的文件（`:650`），被排除原因为 `SYSTEM_GENERATED` 的文件仍算相关文档。补遗数也一样（`:654-659`）。
- 相关文档里有没纳入的，结论就是「不完整」，局限说明里加「相关文档 N 份中仅 M 份纳入分析」。技能的提示词要求模型开篇写明不完整（`src/lib/agent/skills/tender-analysis.ts:124-156`）。
- 我用 tsx 跑过：
  - 投标准备清单的标题带「投标」，角色判为 OTHER_TENDER_EVIDENCE。所以今天任何有这份清单的项目，技能都判「不完整」。
  - 一份上传 RFP 加一份被页级解析过的生成简报：现在判「完整」，因为简报被当证据纳入了。
  - 若只按来源排除、不改相关文档的算法，同一组文件会判「不完整」。
  - 报价导入表都被页级解析过，有正文（`import-service.ts:162`），结果相同。

## Goals / Non-Goals

**Goals**
- 招标文件包只纳入用户上传的文件，两条流程、所有入口同一个判定。
- 以下几处用同一口径：
  - 就绪判断、内容指纹、覆盖计数
  - agent 技能的清单与完整性判定
  - 项目情报的模型输入
  - 备忘录语料
- 已经误纳入的旧分析能看出问题、能恢复。

**Non-Goals**（具体到文件）
- `src/lib/tender-auto-analysis/enqueue-package.ts`、`enqueue.ts`、`enqueue-helpers.ts`、`idempotency.ts`、`src/lib/tender-workforce/trigger-service.ts`：入队、幂等、取代、workforce 改派都不动。这几个文件由 FIX-18 改；幂等键的既有缺陷见 D6。
- 以下写入方的来源值不动，照旧写进 `ProjectDocument`：
  - `src/lib/projects/generate/generate-docs.ts`
  - `src/lib/quote-engine/quotation-pdf.ts`
  - `src/lib/quote-engine/import/import-service.ts`
  - `src/app/api/projects/[id]/checklist/route.ts`
  - `src/app/api/v1/projects/route.ts`
- 文件流水线不动，理由见 proposal「Out of scope」：
  - `src/app/api/projects/[id]/files/process-next/route.ts`
  - `src/lib/files/ai-summary.ts`
  - `src/lib/files/parse-content.ts`
  - `src/lib/projects/apply-document-metadata.ts`
- `src/components/project-files/project-file-manager.tsx`：文件抽屉的分组与图标不动。
- 项目 AI 上下文与同类读取不动：
  - `src/lib/projects/project-ai-context.ts`
  - `src/lib/ai/context.ts`
  - `src/lib/bid-workflow/start-intelligence.ts`
  - `src/lib/agent/skills/supply-chain-analysis.ts`
  - `src/lib/agent-core/tools/enterprise-readonly.ts`
- `src/lib/projects/structured-summary.ts`：项目类型标签不动。
- 「有没有招标文件」的计数不动：
  - `src/lib/tender-next-step/service.ts`
  - `src/lib/tender-next-step/web-next-step.ts`
  - `src/lib/tender-bid-workspace/store.ts`
  - `src/lib/tender-bid-workspace/workspace-view.ts`
- `src/lib/tender-auto-analysis/executive-brief.ts`：不改代码，它经选包函数自动跟上。
- 以下文件不动，它们按清单走：
  - `src/lib/tender-auto-analysis/page-parse.ts`
  - `worker.ts`
  - `v2-persist.ts`
  - `src/lib/tender-workforce/tools.ts`
- `src/lib/agent/skills/tender-analysis.ts`、`src/lib/tender-understanding/load-package.ts`：不改，只改它们调用的 `package-input.ts`。
- `src/components/tender-analysis/analysis-panel.tsx`：不改，新标签经接口原样显示。
- `prisma/**`：零 schema。

## Decisions

### D1 判定依据：只认 `source = "upload"`（白名单）

**两种做法逐类比较**（以各来源在现状下的行为为依据）

| 来源 | 是不是招标文件 | 现在进包时怎样 | 白名单 | 黑名单（generated / generated_customer_quotation / ai_checklist / quote_import） |
|---|---|---|---|---|
| `upload` | 是。用户在文件抽屉或建项时传的招标文件 | 正常 | 纳入 | 纳入 |
| `generated`（8 种生成文件） | 不是，是我方根据分析写的文字 | 进包、判成主文件。其中「内部项目分析」的旧文本路径把项目 AI 上下文拼进正文（`generate-docs.ts:119,331`），上下文里有预估金额、我方报价、中标价（`project-ai-context.ts:138-146`） | 排除 | 排除 |
| `generated_customer_quotation` | 不是，是我方给客户的报价 | PDF、已解析，进包，正文是我方报价合计 | 排除 | 排除 |
| `ai_checklist` | 不是 | `fileType "json"` 不在可分析类型里，现在本来就进不了包 | 排除 | 排除 |
| `quote_import` | 不是。是供应商发给我方的报价，进报价引擎做成本（`import-service.ts:137-140` → `QuoteCostImport.sourceDocumentId`） | xlsx / csv / pdf 都可分析，已解析，有指纹，**现在会进包**，标题按文件名判角色 | 排除 | 排除（这一项是这次专门列进名单的） |
| `external_link`（BidToGo 建项带的链接） | 指向采购方的招标文件，但青砚**没有它的内容**：没有存储地址、没有指纹 | 见表下说明 | 排除。项目里有上传文件就能照常分析 | 现状不变：可分析类型的外部链接继续挡住整个项目的分析 |
| 今后新增的写入入口 | 未知 | 不写 `source` 时用默认值 `external_link` | 排除，要显式写 `upload` 才进 | 纳入，要记得加黑名单才排除 |

外部链接现在进包时的情况：
- `fileType` 取外部传来的 `file_type`，缺省为 `"link"`（`v1/projects/route.ts:217`）。`"link"` 不可分析，被静默跳过。
- 若外部给的是 `"pdf"` 等可分析类型，parseStatus 停在默认的 pending（`schema.prisma:1843`）。没有存储地址时解析函数直接返回、不改状态（`parse-content.ts:98`）。选包时它既没有指纹，也读不出内容，于是：
  - 一键分析、分析投标文件、重新分析、上传后与就绪后的自动入队，都要求不缺指纹，一律以「缺少内容指纹」失败（`package.ts:200-203,216-218`；`enqueue-package.ts:191-203`；`analysis-run-service.ts:133-145`）；
  - 就绪判断永远是「仍在处理」（`package-ready.ts:75-85`）。

**结论**：选白名单。
- 招标文件只有一个入口（项目文件上传），那里固定写 `upload`。
- 白名单失败时偏向不纳入：新入口忘写或写错来源，结果是文件没进分析，覆盖清单的「上传 N」也不计它，人能看出来；而不是把系统文字悄悄当证据。
- 它与现有的覆盖计数（`package-coverage.ts:76-77`）、业主回复匹配（`reply-resolution.ts:94-99`）、文件抽屉的「上传」分组（`project-file-manager.tsx:374`）口径一致。
- 外部链接本来就没有内容可分析。白名单让它不再挡住手动发起的分析。
  - 自动入队对这类项目仍不触发：文件流水线每次先挑中这份待解析的外部链接（`process-next/route.ts:105-124`），解析函数直接返回，流水线一直报「解析」这一步、`done` 为 false，走不到自动入队（`:166,206,225`）。这个空转是既有问题，不在本次。

**否决：黑名单**。
- 每多一种系统写入，都要记得回来加。
- 现在就要把 `quote_import` 与 `external_link` 一个个想到。
- 漏一个就会重演 12-3。

**历史数据里有没有别的来源值**
- 仓库能查到的：
  - 可见历史从 2026-08-25 开始，是浅克隆。
  - 对可见历史里所有增删 `projectDocument.create/createMany` 的提交，抽出 `source:` 字面量，只有 `upload`、`generated`、`generated_customer_quotation`、`quote_import`。`ai_checklist` 经常量写入。
- `external_link` 默认值从 2026-04-16 的基线迁移起就在（`prisma/migrations_legacy_pre_greenfield_baseline/20260416120000_baseline_before_launch/migration.sql:983`）。
- 2026-08-25 之前上传接口写什么来源，仓库里查不到。如果当年上传没写来源，真上传的文件会是 `external_link`，白名单会把它排除。
- 所以开工前要用下面「生产只读核对」的第 1、2 条 SQL 确认；结果不干净就不开工，进「留给 GATE」第 2 条。

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

- `summarizePackageCoverage` 的过滤（`package-coverage.ts:76-77`）改为 `isUserUploadedSource(r.source ?? USER_UPLOAD_SOURCE)`。
- `CoverageRow.source` 是可选字段（`:22-23`），覆盖测试都不传它，靠「缺省即计入」。数据库这一列非空，取数时一定带上（`:193`、`:212`），缺省只出现在纯函数调用里。所以库里的数据计数结果不变，既有测试不用改。
- 否决：把 `source` 改成必填。要改 FIX-13 刚加的约 200 行测试的构造方式，零收益。

### D5 另外四处读取改用同一判定，agent 技能的完整性判定不计非上传文件

| 位置 | 现在 | 改成 | 行为变化 |
|---|---|---|---|
| `src/lib/tender-understanding/package-input.ts:276,530-532`（agent「标书分析」技能的清单） | `SYSTEM_SOURCES = {"ai_checklist"}` | `!isUserUploadedSource(doc.source)` → 排除 | 生成文件、客户报价、报价导入、外部链接也被排除，排除原因沿用 `SYSTEM_GENERATED` |
| 同文件 `:644-723`（完整性判定） | 相关文档 = 角色不是 NON_TENDER（`:650`）；补遗 = 补遗状态为补遗 / 修订 / 疑似补遗（`:654-659`） | 两者都再去掉排除原因为 `SYSTEM_GENERATED` 的项 | 非上传文件不再让结论变「不完整」，也不出现在原因里。总文件数、排除数照实计入它们，清单里照旧列出并标排除 |
| `src/lib/files/intelligence-extractor.ts:171-180`（项目情报，所有项目） | `parseStatus "done"` 且 `source ≠ ai_checklist`，`take: 10` | `parseStatus "done"` 且 `source = USER_UPLOAD_SOURCE` | 不再读已被解析过的生成文件与报价导入。没有正文的生成文件（解析状态为 done）原来也可能占掉 10 个名额中的一个，再在正文过滤时被丢掉；现在 10 个名额只给上传文件 |
| `src/lib/tender-analyst-memo/v2/pipeline.ts:37` | 读项目全部文件的页面 | 只读上传文件的页面 | 备忘录语料不再含已被解析过的生成文件（包括上一版备忘录）与报价导入的页面 |
| `src/lib/tender-auto-analysis/reply-resolution.ts:97` | 字面量 `"upload"` | 常量 | 无 |

- 排除原因码沿用 `SYSTEM_GENERATED`。这个码只出现在 agent 技能写给模型的文件清单文本里（`package-input.ts:761-778`），没有界面显示它，也没有测试断言它（全仓 grep 测试为 0）。
- 完整性判定这样改之后：
  - 只有上传文件时，结果与改动前相同；
  - 只有系统文件时，相关文档数为 0，结论为完整，技能回答「未找到可分析的标书/招标文档」（`tender-analysis.ts:88-104`），与分析入口的「没有可分析的投标文件」一致。
- 否决：
  - 新增 `NOT_USER_UPLOAD` 码：要改类型联合与清单文本，读者只有模型，收益为零。
  - 这四处保持不变、只改选包：今后生成文件虽然不进分析，却仍会进 agent 技能与备忘录语料，「系统文字当招标证据」的问题只修了一半。
  - 只改清单的排除、不改完整性判定：有正文的生成文件与报价导入从「被当证据纳入」变成「被排除却算相关文档」，技能对这些项目从判「完整」变成判「不完整」，这是新的退化；投标准备清单造成的误判也留着。
  - 把非上传文件的角色直接改判为 NON_TENDER，让完整性判定自动不计：角色会写进给模型的清单（`role=…`），一份报价导入表被写成「不是招标文件」的角色，与它「是报价表、但不是采购方给的」的事实不符；两种排除原因也混在一起。

### D6 已有分析：不迁移、不自动重跑，靠标签与过期提示让人重新分析

**这次合并之后会变的**

1. **执行摘要过期**：
   - 执行摘要取的是项目最新的一份分析，不分状态（`executive-brief.ts:349-359`）。
   - 这份分析处在等待审核或已批准、它的文件清单里有非上传文件时，当前文件包的指纹（只算上传文件）与它记下的指纹不同，执行摘要标为过期（`:222-225`）。
   - 显示为工作台「文件有更新，摘要可能过期」（`workbench-command-deck.tsx:196-199`）与情报页「招标文件有更新，建议重新分析」（`project-intel-sections.tsx:372-373`）。这是我们要的恢复提示。
   - 最新一份是失败或未完成的，摘要走失败的分支，不显示过期。FIX-22 四件套记下的 12-3 就是这种情况：最新一份是「AI 分析未完成」，较早的一份待审。这一点我没在生产核实。12-3 的恢复不靠这条提示，见下面的恢复步骤。
   - 反过来，现在「分析之后又生成了文件」的项目被误标过期的情况，从此消失：当前指纹不再算生成文件。
2. **旧分析的文件列表**：那份生成文件改标「不是上传的招标文件（重新分析后不再纳入）」（D7）。
3. **旧流程自动入队可能多起一轮分析**。条件：组织没把自动入队改派到一键分析，且旧流程自动入队开关（`TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED`）开着。
   - 下一次文件流水线跑到「全部处理完」时会走自动入队（`process-next/route.ts:166,206,225`）。
   - 新指纹找不到活跃的同指纹分析（`enqueue-package.ts:226-243`；活跃集合不含 APPROVED，见 `enqueue-helpers.ts:8-13`），于是新建一份 PENDING 的完整分析（`:250-284`）。这份就是我们要的恢复，每个受影响的项目只多一轮：它还在进行或等待审核时，之后同指纹的调用都复用它。不受影响的项目指纹不变，不会多起。
   - **限定条件：项目此前没有任何一份分析的指纹等于当前只含上传文件的指纹**。
     - 背景：旧流程不强制新建时，幂等键只由「项目 + 指纹 + 两个版本号」算出（`idempotency.ts:10-23`），而这一列在库里唯一（`schema.prisma:2328`）。
     - 常见的时间线：先只用上传文件分析过一次（R1），之后生成简报、再重新分析（R2）。FIX-19 之后，当前指纹回到 R1 的值。
     - 查重只看进行中的状态（`enqueue-package.ts:62-84`），查不到已被替代或已批准的 R1。于是新建时撞唯一键，并发兜底同样只查进行中状态，原样抛错（`:285-303`）。
     - 文件流水线把这个错误吞掉，只记下错误类型（`process-next/route.ts:50-58`），这一轮建不出来。
     - 重新分析的键里带时间戳（`enqueue-package.ts:461-466`），一键分析的键按作业算（`analysis-run-service.ts:162`），两者都不受影响。
     - 这是既有缺陷，同一项目的指纹回到旧值时都会发生。本次不修（`enqueue-package.ts` 由 FIX-18 改），写进报告「没做的」，另开任务。
   - 改派到一键分析的组织：
     - FIX-18 合并前，自动路径用固定的 `requestId`（`enqueue-package.ts:611`）重放已有任务（`trigger-service.ts:130-140`），不会自动重跑。
     - FIX-18 按它推荐的做法 B 合并后，这类组织上传后、处理完后都不再自动发起分析。
     - 两种情况都要人点卡片的「重新分析」。
   - 生产上两个开关的实际值，仓库里查不到（`docs/QINGYAN_TENDER_FLOW_BASELINE.md:172`）。
4. 已经被页级解析过的生成文件，页面行与正文都保留。但选包、agent 技能、项目情报、备忘录都不再读它们（D3、D5）。

**恢复步骤**（写进报告）
1. FIX-19 部署之后，用第 3 条 SQL 列出受影响的项目。
   - 12-3 应在名单里。
   - 不在时，说明它最新的一份分析没有纳入生成文件，再单独查它较早那份待审分析的文件清单。
2. 逐个打开项目页，按组织走的流程点「重新分析」：
   - 一键分析组织：点「AI 数字员工 · 投标分析」卡片上的「重新分析」。这一步取消旧任务，按新清单再建（`trigger-service.ts:151-168`）。FIX-18 合并后，这是页面上唯一的发起按钮。
   - 旧流程组织：点分析面板的「重新分析当前投标文件包」。键里带时间戳，不会撞上面的唯一键（`enqueue-package.ts:461-466`）。同一项目 5 分钟内最多 3 次（`constants.ts:17-18`）。
   - 不要等自动入队：它按指纹建键，会撞上面的唯一键。空态的「分析投标文件」也按指纹建键，但它只在项目还没有分析时出现，受影响的项目用不到。
3. 新的分析清单只含上传文件。在分析面板核对「上传 N · 纳入分析 N」，文件列表里不再有「China Supplier Sourcing Brief」。
4. 提醒做恢复的人：
   - 旧分析上的要求确认、矩阵标注不会自动出现在新分析上。FIX-22 合并后矩阵读最新一份分析；合规记忆里有的，可以经 FIX-22 的「采纳全部历史建议」带入，其余要重新标注。
   - 12-3 与 FIX-13 的「重新解析附录 B」一起做，先重新解析，再重新分析。

**否决**
- 写一次性脚本，把旧分析清单里的非上传文件删掉或改角色：分析结果（事实、要求、章节、引用）已经引用了这些文件的页面，只删清单会让结果与清单对不上；改写记录还会破坏审计。
- 合并后自动对所有受影响项目重跑：会新增模型调用与费用，也和「不补救」的既定做法（FIX-12 / FIX-13 都是人来重新分析）不一致。

### D7 旧分析的标签在展示层改，不改记录

- 分析详情接口在 `route.ts:57-63` 的文档查询里多选 `document.source`。
- 角色标签函数从 `route.ts:122-140` 挪到 `src/lib/tender-auto-analysis/display-labels.ts`，导出成纯函数，入参为（角色、来源）：
  - 来源不是上传 → 「不是上传的招标文件（重新分析后不再纳入）」
  - 是上传 → 照旧的 7 种标签
- 响应里的 `documents`（`route.ts:182-188`）只改标签的值，不加 `source` 字段，不加正文（规格的敏感项要求：不返回来源值与正文）。
- 面板原样显示接口给的标签（`analysis-panel.tsx:501,529`），不用改前端。
- 否决：
  - 不改标签，只靠过期提示：12-3 的人在面板上仍看到「China Supplier Sourcing Brief v1 · 主文件」，看不出问题在哪；而且最新一份失败时根本没有过期提示（D6 第 1 条）。
  - 前端按标题猜：标题不可靠，「主文件」本身就是按标题猜错的。

### D8 测试：纯函数与接线进 CI，选包用隔离库端到端，先在旧代码上证明会失败

**新增 `src/lib/files/__tests__/document-source.test.ts`**（不用库，进 `scripts/test-ci-unit.sh`）
- 判定的真值表：`upload` 为真；`generated`、`generated_customer_quotation`、`ai_checklist`、`quote_import`、`external_link`、空串、`null`、`undefined`、`Upload` 都为假。
- 角色标签函数：非上传文件给新标签；上传文件 7 种角色的标签与改动前相同。
- 写入端源码断言：
  - 上传接口写常量。
  - 四个系统写入方的来源值分别是 `generated` / `generated_customer_quotation` / `ai_checklist` / `quote_import`。
  - 外部 API 的 `createMany` 不写来源。
  - `src` 非测试代码里不再有 `source: "upload"` 字面量（现在只有 `files/route.ts:172` 与 `reply-resolution.ts:97` 两处）。
- 读取端接线断言：
  - 选包查询选了 `source`，来源判定出现在 `readBlobBuffer(` 之前。
  - 就绪的取数映射带 `source`。
  - 覆盖、agent 技能、项目情报、备忘录、业主回复都引用共享判定或常量。
  - `package-input.ts` 里不再有 `SYSTEM_SOURCES`，`intelligence-extractor.ts` 里不再有 `not: "ai_checklist"`。
  - 分析详情接口引用标签函数，响应的 `documents` 映射里没有 `source:` 键。

**扩既有测试**
- `package-ready.test.ts`：辅助函数默认 `source: "upload"`；加用例「待解析的外部链接、生成文件、报价导入不挡就绪、不计数」。
- `package-coverage.test.ts`：加混合来源的用例「上传 2 · 纳入分析 2」。
- `input-completeness.test.ts`：辅助函数 `inv` 已默认 `source: "upload"`（`:30-48`）。新增三组用例：
  - 生成文件、报价导入标 `SYSTEM_GENERATED`，上传照旧。
  - 上传 RFP（有正文）+ 被解析过的生成简报 + 被解析过、正文含单价的报价导入表 + 投标准备清单 → 结论为完整，相关文档数 1，纳入数 1，原因里没有「相关文档 N 份中仅 M 份纳入分析」。改动前这一组失败，因为生成文件被纳入、清单被算作相关文档。
  - 正文含「Addendum No. 1」的生成文件 + 上传 RFP → 补遗数 0；只有系统文件 → 结论为完整、纳入数 0。

**新增 `src/lib/tender-auto-analysis/__tests__/package-source-db.isolated.test.ts`**（隔离库，没有隔离库时跳过）

夹具与断言：

| 夹具文件 | 来源 | 状态 | 断言 |
|---|---|---|---|
| 「RFP Window Coverings.pdf」「Pricing Form.pdf」 | `upload` | 已解析、有指纹、有页面 | 选包恰好这 2 份；被判为主文件的只有 RFP；没有分类歧义提示 |
| China Supplier Sourcing Brief v1 | `generated` | 已解析、**有指纹**（模拟生产里被补写过的状态）、有页面 | 不进包 |
| 内部项目分析 v1 | `generated` | 已解析、有指纹、正文含「我方报价：」 | 不进包 |
| 供应商报价表 xlsx | `quote_import` | 已解析、有指纹 | 不进包 |
| 外部链接 PDF | `external_link` | 待解析、无指纹、无存储地址 | 带「缺指纹即失败」的选包不抛错 |
| 投标准备清单 | `ai_checklist` | — | 不进包 |
| 生成文件 | `generated` | 无指纹；有存储地址，测试开本地存储（`PRODUCT_CONTENT_LOCAL_STORE=1`，`blob-access.ts:38-40`），文件真实存在 | 选包后指纹仍为空、不进包（改动前会被读出、补写指纹、进包） |

- 上传的第二份用「Pricing Form.pdf」不用「Addendum 1.pdf」：选包的角色判定不按文件名判补遗（`package.ts:45-48`），「RFP」加「Addendum 1」两份上传文件本身就会出「2 份被判为主文件」的歧义提示（tsx 实测）。换成「Pricing Form.pdf」（判为报价）之后：
  - 改动后没有歧义提示；
  - 改动前生成文件、报价导入也判为主文件，一定有歧义提示。
  - 断言不依赖具体计数。
- 本地存储目录用 `PRODUCT_CONTENT_LOCAL_STORE_DIR` 指到系统临时目录下本测试独有的子目录，结束时删掉。不设的话，默认写到当前目录下的 `.data/product-content-blobs`（`blob-access.ts:42-47`）。
- 其余断言：
  - 就绪为已就绪、文件数 2。
  - 当前指纹等于两份上传文件的指纹。
  - 覆盖为「上传 2」。
- 在只有测试、没有改动的代码上运行，必须有用例失败：
  - 生成文件和报价导入进了包；
  - 无指纹的生成文件被补写了指纹；
  - 外部链接让带「缺指纹即失败」的选包抛错；
  - 就绪为「仍在处理」；
  - 有分类歧义提示。
- 失败输出贴进报告。

**扩 `src/lib/tender-workforce/__tests__/t1b-integration.test.ts`**
- 夹具 `:97-120` 的两份文件补 `source: "upload"`。它们现在没写来源，用的是默认 `external_link`，白名单会把它们排除，整个测试会以 INPUT_MISSING 失败。
- 在同一个建项辅助函数里再加一份 `source: "generated"`、有指纹、有页面的「China Supplier Sourcing Brief v1」。断言：
  - workforce 校验输入这一步的清单 `documents.length` 为 2、清单里没有它；
  - 旧流程用例（`:830-842`）入队结果的文件数为 2。
- 这个测试不断言分类歧义，「RFP」加「Addendum 1」的夹具标题不用改。

**否决：只做纯函数测试**
- 选包、就绪、指纹都是带库的取数函数，生产问题恰好出在取数那一步。
- 只有隔离库端到端能证明真实的行进不进包。

**不用改的既有夹具**（逐个核对过）
- `page-parse-nul-db.isolated.test.ts`（FIX-13）与 `src/lib/projects/__tests__/files-access-db.isolated.test.ts`（FIX-17）都写了 `source: "upload"`。
- `web-next-step-db.isolated.test.ts`、`corporate-memory/__tests__/t3-integration.test.ts` 建的文件没写来源，但它们不走选包、就绪、覆盖、agent 技能。
- `scripts/` 下的手工 e2e 不在门禁里；其中会走选包的几个都写了 `upload` 或经上传接口建文件。

## 相邻改动与合并顺序

定的顺序：**FIX-13（已合并）→ FIX-17 → FIX-19 → FIX-18 → FIX-22**。FIX-16 按 FIX-22 四件套定的放在 FIX-22 之后。

**FIX-13**（#546，已合并，main `13c7ed33`）
- 它改的 `package-coverage.ts` 本 change 只换一行判定（`:76-77`）。
- 它改的以下文件本 change 都不碰：`executive-brief.ts`、`v2-persist.ts`、`page-parse.ts`、`parse-content.ts`、`analysis-panel.tsx`、`analyst-synthesis-view.tsx`、`project-file-manager.tsx`。
- 本文行号都按合并后的 main 写。

**FIX-17**（`project-files-access-guard`）
- 改 `files/[fileId]/route.ts`、`files/process-next/route.ts`，不改 `files/route.ts`。
- 它的守卫测试检查 `files/` 下每个接口先过项目权限。本 change 在 `files/route.ts` 只加一个导入、在守卫之后的 `create` 里换一个常量，不影响那条守卫。

**FIX-18**（`tender-analysis-single-entry`，四件套 `b040390b`）
- 改的文件：`enqueue-package.ts`、`enqueue.ts`、`enqueue-outcome.ts`、`trigger-service.ts`、新增 `single-entry.ts` 与 `agent-card-view.ts`、`agent-card.tsx`、`analysis-panel.tsx`、两个接口。本 change 一个都不碰。文本冲突只会在 `scripts/test-all.sh` / `scripts/test-ci-unit.sh` 的注册行附近。
- 它对本 change 的影响：
  - 它推荐的做法 B 删掉「自动入队改派一键分析」与固定 `requestId`（`enqueue-package.ts:587-621`）。合并后 D6 第 3 条里「改派组织」那一条随之改变：这类组织不再自动发起。D6 已按两种情况写。
  - 它让旧流程的发起在一键分析有一单在跑（包括等人处理）时返回 409。一键分析组织的恢复本来就走卡片，不受影响。
  - 它的卡片多返回 `packageHint`，用到就绪判断与覆盖计数（FIX-18 tasks 2）。FIX-19 先合并后，这两样都只算上传文件，提示句不用改；生成文件不会再让卡片说「文件已就绪」或「还有 N 个没纳入」。
- 本 change 对它的要求：
  - **FIX-19 先合并时，FIX-18 新写的 `single-entry-db.isolated.test.ts` 建的每一份 `ProjectDocument` 夹具都必须写 `source: "upload"`**。没写的会落成 `external_link`，不进文件包，它的「旧管线照常新建」「文件提示」等用例会失败。这条由协调人转告，写进 FIX-18 tasks 的开工前提。
  - FIX-18 不改 `t1b-integration.test.ts`（它的 T1B-14 原样保留）。本 change 只给这个文件的夹具补来源、加一份生成文件，T1B-14 的断言意思不变。
- 选包函数仍是 FIX-18 两条入口共用的那一个，选包规则自动适用于它留下的入口。

**FIX-22**（`tender-requirements-tab-converge`，四件套在分支 `claude/zen-turing-azudvx-fix22`，`ba1cc12f`）
- 改的文件：`bid-fit/route.ts`、`bid-fit/translate/route.ts`、新增 `requirement-matrix.ts` / `requirement-matrix-write.ts` / `zh-backfill.ts`、`bid-fit-matrix-card.tsx`、`analysis-panel.tsx`、`requirements-tab.tsx`。本 change 一个都不碰。
- 它对本 change 的影响：
  - 它写明分析面板的覆盖清单那一块「一字不改」（FIX-22 design 第 110 行）。D7 的新标签就显示在这一块的文件列表里（`analysis-panel.tsx:501,529`）。FIX-22 合并后，这份带角色标签的文件列表必须仍在，否则旧分析的问题又看不出来。按它现在的四件套，这一点成立。
  - 它让矩阵读最新一份分析。受影响项目重新分析之后，矩阵显示新的一份，旧分析上的标注不带过去（D6 恢复步骤第 4 条）。
  - 它不改分析详情接口 `runs/[runId]/route.ts`，与 D7 不冲突。
- 本 change 对它的要求：**FIX-22 的 `requirements-tab-converge-db.isolated.test.ts` 若建 `ProjectDocument` 夹具，必须写 `source: "upload"`**，否则覆盖清单与文件包不计它们。由协调人转告。

**FIX-16**（`tender-analysis-incomplete-notes`）
- 也改 `runs/[runId]/route.ts`，响应多一个 `incompleteNotes`。本 change 改同一文件的文档查询（`:57-63`）与标签函数（`:122-140`，挪走后改为引用），段落不同，后合并的一方手工合并。
- FIX-16 的四件套指出 agent「标书分析」技能会当场重算完整性喂给模型。本 change 改的正是这个判定的相关文档口径（D5），两者的改动点不重叠。

**FIX-21**（`project-intel-bidpackage-access`）
- 不改 `intelligence-extractor.ts`（它的 Non-Goals）。本 change 只改同文件的一行查询条件，行数不变，它引用的行号（`:184-194`）不受影响。

## 与八条硬纪律的关系

1. **零 schema**：遵守。不加字段、不加表、不写迁移，判定只用既有的 `ProjectDocument.source`。
2. **出站先审批**：不涉及，没有对外发送。
3. **禁止第三套队列**：不涉及。不新增队列、调度或 worker；入队与取代逻辑不动。
4. **脱敏**：遵守，而且更严。
   - 内部生成文件与客户报价 PDF 里有我方报价、预估金额、中标价。它们不再经文件包进入以下几处（规格「系统生成文件里的我方报价与估值」一条）：
     - 分析结果
     - 综合解读（它会进投标草稿的模型提示，`src/lib/tender-bid-draft/gather.ts:199` → `synthesize.ts:73`）
     - 备忘录语料
     - 项目情报
     - agent 技能交给模型的文件
   - 分析详情接口只改标签的值，不新增来源或正文字段。
   - 不改 `src/lib/muse-bridge/**`。
5. **不爬登录页**：不涉及。外部链接照旧不抓取。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。
   - 来源判定是等值比较，完整性判定的改动是查表式的过滤，不新增模型调用。
   - 项目情报、备忘录、agent 技能的模型输入只会变少。
   - 受影响项目的重新分析是人发起的既有调用。只有 D6 第 3 条的情况（没改派、旧流程自动开关开着）会多出一轮，走的也是既有的自动路径。
8. **测试注册**：
   - `document-source.test.ts` 注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
   - `package-source-db.isolated.test.ts` 注册进 `scripts/test-all.sh`，写法同 `requirement-batch-confirm-db.isolated.test.ts`（`test-all.sh:620`）。
   - `bash scripts/check-test-registry.sh` 通过，不动 `ci/test-registry-baseline.txt`。

## 验证方式

- `npx tsx src/lib/files/__tests__/document-source.test.ts`：真值表、标签、写入端与读取端的接线断言全过。
- 以下测试全过：
  - `npx tsx src/lib/tender-auto-analysis/__tests__/package-ready.test.ts`
  - `package-coverage.test.ts`
  - `package-fingerprint.test.ts`
  - `obs-p4-page-limit.test.ts`（它的源码探针 `:101-109` 仍要匹配 `package.ts`）
  - `npx tsx src/lib/tender-understanding/__tests__/input-completeness.test.ts`（含 D8 的三组新用例）
  - `npx tsx src/lib/tender-analyst-memo/v2/__tests__/memo-v2.test.ts`
- 隔离库：
  - `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/tender-auto-analysis/__tests__/package-source-db.isolated.test.ts` 全过；在只有测试的代码上失败，输出贴进报告。
  - `NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/tender-workforce/__tests__/t1b-integration.test.ts` 全过。
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

## 生产只读核对（由有生产只读权限的人执行；只有 SELECT）

第 1、2 条在开工前跑（tasks 开头）；第 4 条在开 PR 前跑；第 3 条在部署后跑。

```sql
-- 1. 来源值分布：确认没有白名单之外、实为上传的来源值
SELECT source, "fileType", count(*) AS n,
       count(*) FILTER (WHERE "blobUrl" IS NOT NULL)     AS with_blob,
       count(*) FILTER (WHERE "contentHash" IS NOT NULL) AS with_hash,
       min("createdAt") AS first_at, max("createdAt") AS last_at
FROM "ProjectDocument"
GROUP BY source, "fileType"
ORDER BY source, "fileType";

-- 2. 来源不是 upload、却有存储内容或内容指纹、又不在生成 / 报价导入目录下的行
--    （应为 0；不为 0 就不开工，进「留给 GATE」第 2 条）
SELECT id, "projectId", title, "fileType", source, "createdAt",
       "blobUrl" IS NOT NULL AS has_blob, "contentHash" IS NOT NULL AS has_hash
FROM "ProjectDocument"
WHERE source <> 'upload'
  AND ("blobUrl" IS NOT NULL OR "contentHash" IS NOT NULL)
  AND COALESCE("blobUrl", url) NOT LIKE '%/generated/%'
  AND COALESCE("blobUrl", url) NOT LIKE '%/quote-imports/%'
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

-- 4. 现在被可分析类型的外部链接挡住分析的项目（上线后这些项目有上传文件就能手动分析）
--    类型列表与 enqueue-helpers.ts:45-58 一致，并去掉前导的点
SELECT "projectId", count(*) AS n
FROM "ProjectDocument"
WHERE source = 'external_link'
  AND lower(ltrim(trim("fileType"), '.')) IN (
    'pdf','application/pdf',
    'docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'xls','application/vnd.ms-excel',
    'csv','text/csv','txt','text/plain')
  AND "contentHash" IS NULL AND "blobUrl" IS NULL
GROUP BY "projectId";
```

## Risks / Trade-offs

- **2026-08-25 之前的真上传文件可能是 `external_link`，会被排除** → 开工前跑第 1、2 条 SQL；第 2 条不为 0 就不开工，按「留给 GATE」第 2 条处理。
- **报价导入的文件不进分析后，有人习惯把招标文件经报价工具导入** → 报价导入只收供应商报价（xlsx / xls / csv / pdf），产物进报价引擎的成本行，不是招标文件的入口；招标文件只能从项目文件上传。报告里写明。
- **用户把下载下来的生成 PDF 再上传回项目** → 它的来源是 `upload`，会进文件包。按来源判定挡不住这种情况。报告里写明「生成文件不要再上传」。
- **受影响的旧分析显示过期**（最新一份处在等待审核或已批准时）→ 这正是要的提示；数量由第 3 条 SQL 给出。
- **旧流程自动开关开着、没改派的组织，受影响项目各多一轮分析** → 有界（每个项目一轮），而且是需要的恢复；生产开关的值留给人确认。
- **同一类项目的自动入队会撞唯一键、建不出那一轮**（D6 第 3 条的限定条件）→ 不出错页，只在日志里留错误类型；恢复按 D6 的步骤点「重新分析」。既有缺陷另开任务。
- **外部链接让文件流水线反复空转的既有问题仍在**（`parse-content.ts:98` 没有存储地址就直接返回，`project-file-manager.tsx:169` 的循环不结束）。自动入队对这类项目也因此不触发。→ 不在本次，另开任务；第 4 条 SQL 能看出生产上有没有这种行。
- **网页「下一步」与投标工作区仍按全部文件判「有招标文件」**（proposal「Out of scope」）→ 只影响提示文字，另开任务。
- **文件抽屉里生成文件仍归在「外部链接」** → 只是显示问题，另开小改动。

## 留给 GATE

1. **判定口径**
   - A 白名单 `upload`（推荐）：
     - 生成文件、客户报价 PDF、投标准备清单、报价导入、外部链接、今后的新入口都不进包；
     - 外部链接不再挡住手动发起的分析。
   - B 黑名单 {generated, generated_customer_quotation, ai_checklist, quote_import}：外部链接照旧挡住分析；以后每加一种系统写入都要回来加名单。
   - 推荐 A，理由见 D1。
2. **开工前的生产只读核对结果不干净时怎么办**（第 2 条 SQL 不为 0）
   - A 先停，看清是哪些行，再决定（推荐）。
   - B 在判定里额外放行「`external_link` 且有存储地址、不在生成 / 报价导入目录下」：规则变复杂，且按存储路径判来源。
   - C 照白名单上线，让人重新上传这些文件：要人手工补，补之前这些文件不进分析。
   - 推荐 A：先看数据。可见历史里上传接口一直写 `upload`，文件抽屉与覆盖计数也一直只认 `upload`，预计为 0。这一步挪到开工前，结果不干净时不会白写代码。
3. **受影响旧分析的恢复**
   - A 人逐个点「重新分析」，名单来自第 3 条 SQL（推荐）：
     - 一键分析组织点卡片的「重新分析」；
     - 旧流程组织点面板的「重新分析当前投标文件包」；
     - 不等自动入队，因为它可能撞幂等键（D6 第 3 条）。
   - B 写一次性脚本自动重跑：新增模型费用，也与 FIX-12 / FIX-13「不补救、人来重跑」的做法不一致。
   - C 不处理，只靠标签和过期提示：旧分析里的生成文件内容仍留在事实与要求里，直到有人重跑；最新一份失败的项目（如 12-3）连过期提示都没有。
   - 推荐 A。同时要接受 D6 第 3 条：没改派、旧流程自动开关开着的组织，受影响项目可能自动多起一轮。另一个选项是在入队里压住这一轮，但那要改 `enqueue-package.ts`，与 FIX-18 冲突，而且这一轮本来就是需要的恢复。
4. **报价导入的供应商报价不进招标文件包**
   - A 排除（推荐）：它是供应商对我方的报价，不是采购方的招标要求；纳入会把供应商价格当成招标事实抽取。
   - B 纳入：要在白名单里加 `quote_import`。
   - 推荐 A。
5. **外部链接（BidToGo 建项带的链接）不进招标文件包**
   - A 排除（推荐）：青砚没有它的内容，本来就分析不了；现在可分析类型的外部链接会让整个项目的分析失败。
   - B 保留现状：要在判定里加例外，项目继续被挡住。
   - BidToGo 现在还推不推标，仓库里查不到（`docs/QINGYAN_TENDER_FLOW_BASELINE.md:174`）。推荐 A。

## Migration Plan

- 开工前：跑「生产只读核对」第 1、2 条，结果写进报告草稿；第 2 条不为 0 时不开工，回 GATE 第 2 条。
- 开 PR 前：跑第 4 条，结果写进报告。
- 合并即生效：没有开关，也没有数据迁移。
- 合并部署后：跑第 3 条拿到受影响项目名单，按 D6 的恢复步骤逐个重新分析。
- 回退：revert 本 PR 即可。没有写任何数据；回退后生成文件重新进包，旧行为全部恢复。
