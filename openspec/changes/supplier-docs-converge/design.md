# Design：菜单里的供应商文件收口到询价单（RFQ-PDF-1）

## Context

动机见 proposal.md「Why」。这里只写决定做法所需的现状（main `91d928e4`，逐个读过代码）：

- `src/lib/projects/generate/generate-docs.ts` 的 `generateProjectDocument` 里有三种供应商侧文件、四条路径：
  - `supplier_rfq` 有分析综合时：`tender-doc-html.ts` 的 `buildSupplierRfqHtml`，内容是分析综合的 `technicalRequirements` + `commercialAndDelivery`（标题与说明）；只过招标身份检查，不过敏感词。
  - `supplier_rfq` 没有分析综合时、`tech_confirm`：固定英文模板 + 询价编号，过 `pdf-common.ts` 的 `sanitizeSupplierFacing`（把几个词替换成「[已隐藏]」）。
  - `china_supplier_brief`：`china-supplier-brief.ts` 的 `buildChinaSupplierBriefText`，带预览（`previewOnly`）；面板 `china-supplier-brief-panel.tsx` 的备注框默认值是一句内部提醒，会作为 `confirmNotes` 印进「Editor notes」。
  - 四条路径最后都进 `persistGeneratedHtml`：Chromium 转 PDF，失败就改存 HTML（`renderMode: html_fallback:…`）。
- 询价单的生成与检查在 `src/lib/tender-rfq/`：`build.ts` `buildRfqDocument`（纯函数；只收已确认的供应商侧要求；敏感词两档；招标身份逐字段）→ `attachment.ts` `renderRfqAttachmentHtml`（固定模板，同输入同输出）→ `attachment-service.ts` `renderRfqAttachmentPdf`（Chromium + `checkRfqAttachmentPdf`：魔数、内嵌 Noto Sans SC、≤ 5 MB）。起草时 `service.ts` `prepareRfqRound` 内联构造「把招标原文留空的那一份」给模板文字过禁出清单；`draftRfqAttachment` 生成 PDF 后只留元数据、丢弃字节。
- 取数：`service.ts` `loadRfqRequirementInputs`（最新一份等待审核或已批准的分析的要求与五类关键事实）、`project-identity-sources.ts` `loadProjectIdentity`（禁出清单与询价编号）、`round-pure.ts` `readTenderRfqSettings`（发件抬头、回复截止提前量）、`automation/registry.ts` `resolveOrgTimezone`。
- 路由 `src/app/api/projects/[id]/generate-pdf/route.ts`：类型白名单来自 `pdf-doc-types.ts`；只把 `SupplierIdentityLeakError` 映射成 422，其余异常一律 500。`next.config.ts` 已给这条路由带上 Chromium 与中文字体。
- 菜单 `project-generate-menu.tsx` 用 `apiJson`，失败时抛出的就是响应里的 `error`，并显示在菜单下方——「原样显示说明」不需要新代码，只需要接口给出说明。
- `start-intelligence.ts` `seedModuleData` 在**新建**情报室时把默认交付物清单写进该情报室的模块数据；清单第一项 `{ key: "china_supplier_brief", title: "国内供应商中文 PDF" }` 的 key 就是简报的文件类型，同一清单里另有 `{ key: "rfq_form", title: "厂家询价表" }`。清单只在 `module-data-view.tsx` 里显示，没有代码把 `ready` 置为 true。

## Goals / Non-Goals

**Goals**：菜单生成的 `supplier_rfq` 与询价邮件附件是同一份内容规则、同一个模板、同一套检查；内容有问题或 PDF 不合格就不保存；两类旧文件停止生成；删掉因此不再被调用的代码。

**Non-Goals（不动的）**：

- `src/lib/tender-rfq/attachment.ts` 的模板文字、结构、样式与 `RFQ_ATTACHMENT_TEMPLATE_VERSION`（仍是 1；RFQ-PDF-2 才改）。
- `src/lib/tender-rfq/build.ts` 的 `buildRfqDocument`、`renderRfqEmail`、`rfqCommercialTermsZh` 的规则与文字。
- `src/lib/tender-rfq/execute.ts`、`web-entry*.ts`、`auto-draft-*.ts`、`chase-*.ts`、`followup-*.ts`、`inbound-*.ts`、`attachment-flags.ts`、`attachment-view.ts`；`src/app/api/projects/[id]/tender-rfq/**`。
- `src/lib/muse-bridge/**`。
- `src/lib/bid-workflow/project-identity-deny.ts`、`project-identity-sources.ts`（只调用）。
- `src/lib/pdf/html-to-pdf.ts`（只调用）。
- `generate-docs.ts` 里 `analyst_memo`、`internal_analysis`、`teammate_tasks`、`owner_clarification`、`bid_draft` 五条内部路径的内容；`tender-doc-html.ts` 的 `buildInternalDecisionMemoHtml`、`STYLE`、`TenderDocHeader`；`rfi-export.ts`、`analyst-memo-html.ts`、`legacy-doc-filter.ts`。
- `china-supplier-brief.ts` 的 `SENSITIVE_PATTERNS` 与 `containsSensitiveSupplierBriefText`（`tender-rfq/build.ts`、`chase-pure.ts`、`followup-coverage.ts`、`rounds/route.ts`、`supplier-intel/discovery-service.ts` 在用）；文件名不改。
- `pdf-common.ts` 的 `createProjectPdfDoc`、`writeWrappedText`（本次之前就没人调用，不是本次造成的，不在清理范围）。
- `GET /api/projects/{id}/generate-pdf`；`version-history-drawer.tsx`。
- Prisma schema、`vercel.json`、`next.config.ts`、cron、任何环境变量。

## Decisions

### D1 菜单询价单 = 询价单生成器 + 附件模板，放在 `tender-rfq` 里

新增两个文件（与 `attachment.ts` / `attachment-service.ts` 同样的分法）：`src/lib/tender-rfq/sheet-download.ts` 是纯函数（排内容 `composeRfqSheet`、失败的错误码与说明、异常类型），`sheet-download-service.ts` 导出服务端函数 `buildProjectRfqSheet`：读项目（截标日期、组织设置）→ `loadRfqRequirementInputs` → `loadProjectIdentity` → `buildRfqDocument`（`quantityTiers` 不传、`incoterm: null`、`destination: null`、`extraQuestions: []`、`scopeNote: null`，其余入参与 `prepareRfqRound` 一一对应）→ 模板文字过禁出清单 → 渲染并检查 PDF。成功返回 HTML、PDF 字节、询价编号、起草时刻与日期、内容指纹、页数；失败在写任何东西之前直接抛出（见 D6）。`generate-docs.ts` 的 `supplier_rfq` 分支只调用它并落库，放在函数最前面——不再执行那条读项目名称、描述、情报摘要的大查询。

- 否决：把这段逻辑写在 `generate-docs.ts` 里——询价单的取数与检查散到第二个目录，下次改生成规则（RFQ-PDF-2 就要改）得两处一起改。
- 否决：直接调用 `draftRfqAttachment`——它生成 PDF 后丢弃字节，菜单要存这份字节，等于渲染两次（每次约 5 秒）。

### D2 起草流程里的两段内联代码抽成共用函数（输出不变）

「同一套检查」要落到同一段代码上，否则两边会各改各的：

1. `build.ts` 新增 `rfqTemplateOnlyDocument(doc, humanDestination)`：把规格、交付要求、从地点派生的目的地留空。`service.ts` 现有的那一行内联构造改为调用它。
2. `attachment-service.ts` 新增 `renderCheckedRfqSheet({ doc, templateOnlyDoc, denyList, draftedOn })`：模板文字过禁出清单 → 渲染 HTML → `renderRfqAttachmentPdf`，返回 HTML 与 PDF 字节。`draftRfqAttachment` 改为调用它再组元数据。

这两处是不改变输出的重排，任务书说的「不改询价起草、审批、执行」指行为：`attachment.test.ts`、`build.test.ts`、`attachment-db.isolated.test.ts`、`supplier-identity-guard-db.isolated.test.ts` 不改期望值通过即为证明。

- 否决：`service.ts`、`attachment-service.ts` 一行不动，菜单路径把这两段各抄一份——约 10 行的重复，但「模板文字查不查、先查后渲染」的顺序从此有两份；逐字节相同的测试只守得住 HTML，守不住检查顺序。若审核方坚持不碰这两个文件，这是可行的退路。

### D3 起草时刻用请求时刻，起草日期用组织时区

`now` 取接口被调用的时刻（可注入，测试用），回复截止 = `computeReplyBy(截标日期, now, 提前量)`；起草日期 = `rfqAttachmentDraftedOn(now, resolveOrgTimezone(组织设置))`，与附件相同。项目没有所属组织时 `resolveOrgTimezone` 回退到系统默认时区，发件抬头与提前量回退到询价设置的默认值（与起草询价同一个读取函数）。

- 否决：沿用 `generate-docs.ts` 现在的 `new Date().toISOString().slice(0, 10)`（UTC 日期）——多伦多晚上 7 点以后生成会印成第二天，也和同一时刻起草的附件对不上，「逐字节相同」的验收过不了。

### D4 继续用 `supplier_rfq` 这一类的版本号与过期标记

版本号 = 该项目 `supplier_rfq` 已有记录数 + 1（旧版记录计入），同类未过期的旧记录标为可能过期；标题「询价单-{询价编号} v{N}」（菜单用标题拼下载文件名，所以文件名里有询价编号）；Blob 路径沿用 `projects/{id}/generated/supplier_rfq-v{N}-{时间戳}.pdf`。`metaJson` 保留通用键（`docType`、`version`、`generatedAt`、`renderMode`、`createdById`、`conclusionVersion`），加 `reference`、`draftedAt`、`draftedOn`、`contentHash`、`templateVersion`、`replyLeadDays`、`pages`；内部文件才有的 `projectName` 与 `addendumFingerprint` 不写（它们来自 D1 跳过的那条查询，仓库里没有任何代码读这两个键）；`conclusionVersion` 写 `rfq_sheet_v{版式版本}`，`renderMode` 写 `chromium_pdf`（列表的乱码过滤只认这个值与 `html_fallback:`）。

- 否决：新开一个文件类型（如 `rfq_sheet`）——菜单、白名单、版本历史抽屉都要认新类型，同一个菜单项的旧记录与新记录分成两串版本，「可能过期」也标不到旧记录上。

### D5 `supplier_rfq` 直接存检查过的 PDF，不经过会回落的那条落库路径

把 `persistGeneratedHtml` 里的三段拆成三个小函数：算版本号、写 Blob、建记录（标旧记录过期 + 生成记录 + 项目文件记录），先后顺序与现在相同。内部文件照旧：转 PDF 并写 Blob 放在同一个 try 里，任一步失败都改存 HTML 并标注原因（现状是「转换失败或 PDF 写入失败都回落」，拆开后保持）。`supplier_rfq` 拿 D1 返回的 PDF 字节依次走这三步，没有回落；D1 失败时在写任何东西之前抛出，旧记录的过期标记不会被动到。

版本号「先数后建」不在事务里、也没有唯一约束，两个并发请求可能得到同一个版本号——这是现状（所有文件类型共用），本次不改；菜单在生成期间禁用按钮，实际撞上的机会很小。

- 否决：给 `persistGeneratedHtml` 加一个「不许回落」的参数、仍由它渲染——它的渲染不检查内嵌字体与 5 MB，要么再检查一遍（两套检查），要么渲染两次。

### D6 不生成的情形：一个带错误码的异常类型，路由按码映射

`sheet-download.ts` 导出 `SupplierRfqSheetError`（`errorCode`、`status`、中文说明）；`buildProjectRfqSheet` 失败时直接抛出它（`generateProjectDocument` 不拦，原样到路由），招标身份命中仍抛既有的 `SupplierIdentityLeakError`（命中项沿用询价单生成器返回的类别与位置）。路由在既有的 422 分支旁加一个分支。

| 情形 | 状态码 | `errorCode` | 说明 |
|---|---|---|---|
| 没有已确认的供应商侧要求 | 422 | `NO_CONFIRMED_REQUIREMENTS` | 询价单生成器的原句：「没有已确认且属于供应商侧的要求，先在青砚「招标要求」里逐条确认后再生成询价。」 |
| 命中内部财务信息 | 422 | `SENSITIVE_LEAK` | 「询价内容里有不能发给供应商的内容（如我方价格或内部备注），询价单没有生成，也没有保存文件。请到「招标要求」核对已确认的要求，并看一下询价设置里的发件抬头；页面上改不了的请联系管理员。」 |
| 命中招标身份（含模板文字） | 422 | `IDENTITY_LEAK` | 既有的「供应商侧文件含招标身份信息（命中：{类别}·{位置}），未生成。」 |
| PDF 生成出错 / 不是 PDF / 没有内嵌中文字体 | 503 | `RFQ_SHEET_RENDER_FAILED` | 「询价单 PDF 没能生成，没有保存任何文件。请稍后再试；一直不行请联系管理员。」 |
| PDF 超过 5 MB | 422 | `RFQ_SHEET_TOO_LARGE` | 「询价单 PDF 超过 5 MB，没有保存。通常是已确认的供应商侧要求太多，请联系管理员处理。」 |

说明里的地方用界面上的叫法（页签叫「招标要求」）；已确认的要求在页面上改不了（只有未确认的能确认 / 驳回），所以两句都不叫人去「减少」或「修改」，改不了的找管理员。发件抬头保存时不查敏感词，所以内部财务信息那句也提到它。

- 否决：`SENSITIVE_LEAK` 直接用生成器的原句「…请检查范围说明/自定义问题」——菜单生成没有这两栏，会把人引去找不存在的东西。错误码沿用，说明按文件场景写（网页询价入口也是自己写的说明，不用原句）。
- 否决：PDF 生成失败也回 422——它不是内容问题，稍后重试可能成功；附件预览接口对同一种失败用的也是 503。
- 否决：让这些情形落进既有的 500 分支——500 会把内容问题记成服务器错误，也拿不到错误码。

### D7 已下线的类型：400 + `DOC_TYPE_RETIRED` + 指路的说明

`pdf-doc-types.ts` 的白名单去掉两项，另加一张「已停用类型 → 名称」表；路由在白名单判断之前先查这张表，命中就回 400、`errorCode: "DOC_TYPE_RETIRED"`、「「{名称}」已停用，请改用「供应商询价单 PDF」。之前生成的文件仍可在列表里打开、下载。」，名称分别是「供应商技术确认表」「国内供应商简报」。带 `previewOnly` 的简报预览请求走同一个分支。`GenerateDocType` 去掉这两个成员，`generateProjectDocument` 的入参去掉 `previewOnly`、`includePublicHistoricalAmounts`、`confirmNotes`；路由不再读这三个字段，响应去掉只为简报服务的 `fontLimitation`。`GET` 列表不按类型白名单过滤（现状如此），旧记录照常列出。

- 否决：410 Gone——任务书要求「按无效类型拒绝」，400 与无效类型同码；调用方只有本仓库的菜单与面板，不需要区分语义的状态码。
- 否决：统一回「docType 无效」——部署前就开着的页面上还有旧菜单项，点了应当知道该改用哪一项、旧文件还在不在。

### D8 清理范围与情报室清单

- 删：`tender-doc-html.ts` 的 `buildSupplierRfqHtml`、`supplierRfqScanSegments`、`supplierRfqRows`、`supplierHeaderBlock`、`SupplierDocHeader`、`SUPPLIER_RFQ_TITLE`、`htmlToText`（只被前者与测试使用；测试里那条「改前的抬头会被拦下」保留，去标签的几行挪进测试）；`china-supplier-brief.ts` 的 `buildChinaSupplierBriefText`、`assertNoForbiddenLeak`、`scrubSensitiveSupplierBriefText` 与相关类型和私有函数；`pdf-common.ts` 的 `sanitizeSupplierFacing`；`generate-docs.ts` 的 `loadChinaBriefFacts`、`assertSupplierDocClean`、两段固定英文模板；`china-supplier-brief-panel.tsx` 整个文件与 `bid-tab.tsx` 里的引用。
- 改测试：`tender-doc-html.test.ts`（留内部备忘录的用例与「改前的抬头（夹具）过禁出清单」那一条，分析综合版供应商表的用例移除）、`china-supplier-brief.test.ts`（只留敏感词判断的用例；注册表里的名称改为「供应商侧敏感词判断」）、`project-identity-deny.test.ts`（「接上了防护」的调用方名单：去掉 `china-supplier-brief.ts`，加上 `sheet-download-service.ts`）、`cjk-pdf.test.ts`（CJK-GEN-03 改为「旧的文字替换已随旧路径删除」，新增 CJK-GEN-04 断言供应商询价单不走回落，CJK-CFG-03 改为面板文件已删）、`analyst-memo-v1.test.ts`（AM-16c 断言的取证清单随简报移除，这条用例删去，RFQ-PDF-2 把清单并入询价单时在那边加回）、`bid-workflow-phase1.test.ts`（白名单断言改为不含已下线类型）。
- `scripts/cjk-pdf-e2e.ts`（手工脚本）：把两处已下线类型换成仍存在的内部类型，保证类型检查通过。`scripts/bid-workflow-cotton-iso-fixture.ts` 直接写库造一条旧记录，不动。
- `start-intelligence.ts`：默认交付物清单删去 `china_supplier_brief`「国内供应商中文 PDF」一项。核实结果：它的 key 就是简报的文件类型，指的是已下线的简报；询价单已由同一清单里的「厂家询价表」代表。只影响之后新建的情报室。
  - 否决：把这一项改成指向询价单——与「厂家询价表」重复成两项。
  - 否决：回写已建情报室里存下的清单——改写存量数据，而这份清单只是展示，没有任何逻辑读它。
- 否决：把 `china-supplier-brief.ts` 改名为反映现状的名字（如 `supplier-sensitive-terms.ts`）——牵动 5 个模块的 import 与在途 PR，纯改名另开任务。

### D9 测试的注入点

PDF 生成沿用既有的 `__setRfqAttachmentPdfRendererForTest`（菜单路径经 D2 的共用函数自然走到它）；`now` 经 `generateProjectDocument` 的可选入参传入；文件存储用既有的本地存储模式（`PRODUCT_CONTENT_LOCAL_STORE=1` + 临时目录），所以「没有文件落库」可以直接数目录里的文件。隔离库测试直接调用路由导出的 `POST` / `GET`（与 `attachment-db.isolated.test.ts` 调预览路由同一做法）。

- 否决：为测试给落库函数再加一个可注入的存储写入函数——既有的本地存储模式已经够用，不为测试多开一个口子。

## 与八条硬纪律的关系

1. 零 schema：遵守。只用 `ProjectGeneratedDocument`、`ProjectDocument` 既有字段，新增信息写进既有的 `metaJson` 字符串；`git diff origin/main -- prisma/` 为空。
2. 出站先审批：不涉及新的出站。菜单文件仍是内部成员下载；不建审批卡、不发信（规格有零出站场景）。附件开关不动、不打开。
3. 禁止第三套队列：不涉及。同步请求内完成，没有任何排队、调度、认领。
4. 脱敏：触碰，方向是收紧。AI 分析综合的文字不再进入任何供应商文件；菜单询价单与询价邮件一样过敏感词两档与招标身份检查，命中即整份不生成，不做局部替换（旧的「替换成[已隐藏]」函数删除）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。只读询价设置里的发件抬头与提前量，不读、不印任何邮箱；RFQ-PDF-2 才印展示发件人。
7. 确定性优先：遵守。零模型调用；内容全部来自已确认的要求与规则。
8. 测试注册：两个新测试在创建它们的同一条 task 里注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`bash scripts/check-test-registry.sh` 通过，`ci/test-registry-baseline.txt` 不增。

## 验证方式

- `npx tsx src/lib/tender-rfq/__tests__/sheet-download.test.ts`（纯逻辑与接线：起草日期时区、截标当天、错误码与说明、源码断言）。
- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated … npx tsx src/lib/tender-rfq/__tests__/sheet-download-db.isolated.test.ts`（本机隔离库：内容来源、与附件内容指纹相同、零出站、分析综合带不进来、五种不生成、记录与版本、下线类型、旧记录在列表里、内部文件回落）。
- 不改期望值通过：`attachment.test.ts`、`build.test.ts`、`round-pure.test.ts`、`web-entry-pure.test.ts`、`auto-draft-pure.test.ts`，隔离库 `attachment-db.isolated.test.ts`、`supplier-identity-guard-db.isolated.test.ts`、`auto-draft-db.isolated.test.ts`。
- 改过断言后通过：D8 列出的六个既有测试。
- 真实 Chromium 抽检一次：用隔离库里的联邦标样例从菜单路径生成，确认是 PDF、内嵌 Noto Sans SC、页数与同一样例的附件相同；结果写进报告。
- 门禁：`npm test`（失败项与开工前基线逐项对照）、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate supplier-docs-converge --strict`、`git diff origin/main -- prisma/ vercel.json` 为空。

## Risks / Trade-offs

- [合规取证清单出现空窗] 简报下线后、RFQ-PDF-2 合并前，营业执照 / 工厂照片 / 劳工制度那份清单不在任何生成文件里 → 两个 PR 相继合并；RFQ-PDF-2 的任务书第 6 项把它并入询价单。报告里写明。
- [以前点了就有文件，现在会被拒] 没有已确认要求的项目，旧路径会出一份 7 行英文的文件，现在回 422 → 这是本次的目的；说明里写了去哪里确认。
- [并发生成] 见 D5：同一项目同一类并发生成可能出现重复版本号与两条「未过期」记录，这是现状，本次接受，不在本 change 里改。
- [身份命中的说明没有出路] 「供应商侧文件含招标身份信息（命中：…），未生成。」是 CHAIN-4b 定下的句子，位置名「询价附件」在下载场景也不贴切 → 任务书要求沿用既有结果，本次不改；与「回复截止落在截标当天」一起在后续 change 里处理。
- [部署前打开的页面] 旧菜单项与简报面板还在浏览器里 → D7 的说明指向新菜单项；刷新后消失。
- [与 #538 改同一个文件] 两边都动 `generate-docs.ts` → 后合并的一方 rebase，两边改动都保留；本次的改动集中在 `supplier_rfq` 分支、三条供应商路径与落库函数，合并前对照 #538 的 diff 逐段核对。
- [生成多几秒] 询价单要过一次真实 Chromium（实测约 5 秒，冷启动更久） → 路由 `maxDuration` 已是 800 秒，旧路径本来也要转 PDF，耗时相当。
- [5 MB 上限对下载是否过严] 下载本身不受邮件大小限制 → 任务书要求同一套检查；CHAIN-4a 实测 120 行约 93 KB，离上限很远。
- [回复截止落在截标当天会被拦] 回复截止的下限是「今天 + 2 天」，截标前 2 天（或把提前量设成 0）时它等于截标日期，模板文字过禁出清单就会命中「截标日期·询价附件」，菜单询价单与起草询价都生成不了 → 这是询价单生成规则里的既有行为，本次只在规格里写明、在测试里固定；根治（回复截止不印成截标当天）要改 `build.ts` 的规则并升版式版本，另开任务。既有的 `attachment-db.isolated.test.ts` 用真实时钟与 2026-12-05 的截标日，2026-12-03 那天会因此失败，同一任务里修。
- [D2 触碰起草流程的两个文件] → 输出不变由既有测试不改期望值证明；退路见 D2 的否决项。

## Migration Plan

无数据迁移、无环境变量、无开关。合并即生效；回滚 = revert 这个 PR（新路径生成的记录是合法 PDF，回滚后照常能打开；旧菜单项与面板随 revert 回来）。

## Open Questions

无会改变规格、做法或任务拆分的未决问题。
