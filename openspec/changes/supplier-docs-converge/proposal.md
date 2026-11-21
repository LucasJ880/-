# Proposal：菜单里的供应商文件收口到询价单（RFQ-PDF-1）

TASKFLOW：RFQ-PDF-1（Phase F（续）— 询价单 PDF；任务书 `docs/QINGYAN_RFQ-PDF_TASKBRIEF.md` 2026-11-20，Evan「全部按照你推荐的开始做」）。核对基线：main `91d928e4`。后续 change：RFQ-PDF-2 `rfq-sheet-template-v2`（询价单模板第 2 版，本次不做）。

## Why

「一键生成文档」里的「国内供应商询价 PDF」走的是内容最少的生成路径：没有分析综合时只有 7 行固定英文，有分析综合时把 AI 写给我方看的说明印给工厂、且不查内部敏感词。「国内供应商简报」的面板还会把一句内部提醒当作默认备注印进正文。

## What Changes

- 改 `supplier_rfq` 的生成：用发询价时同一个询价单生成器排内容（当前可用分析里已确认的供应商侧要求、关键事实、组织询价设置里的发件抬头与回复截止提前量），用询价邮件附件的同一个模板渲染；发起人填写项（数量阶梯、目的地、范围说明、附加问题）与贸易条款一律为空。
- 停止读 AI 分析综合来生成任何供应商侧文件；`supplier_rfq` 不再分「有分析 / 无分析」两条路径。
- 拒绝生成没有内容或内容有问题的询价单：没有已确认的供应商侧要求、命中内部财务信息、命中招标身份时，`POST /api/projects/{id}/generate-pdf` 返回 422 与中文说明，不写文件、不建记录。
- 让生成的 PDF 过询价附件同一套检查（是 PDF、内嵌 Noto Sans SC、不超过 5 MB）；不过就不写文件、不建记录、返回中文说明。`supplier_rfq` 不再回落成 HTML 文件；内部文件的 HTML 回落不变。
- 改生成记录：标题「询价单-{询价编号} vN」，版本号与「可能过期」标记照旧按 `supplier_rfq` 这一类计；记录的元数据写入询价编号、起草时刻与日期、内容指纹、版式版本。
- 下线 `tech_confirm`（供应商技术确认表）与 `china_supplier_brief`（国内供应商简报）的生成：去掉两个菜单项与「标书与报价」页签里的简报面板；接口对这两个类型返回 400；之前生成的文件与记录保留，列表里照常打开、下载。**BREAKING**（对仍在调用这两个类型的客户端）。
- 改菜单项名称：「国内供应商询价 PDF」→「供应商询价单 PDF」；生成失败时菜单原样显示接口返回的说明。
- 清理不再被调用的代码与测试：分析综合版的供应商询价表模板、简报正文拼装与预览、旧的供应商侧文字替换函数；保留仍被询价生成、催单、供应商情报引用的敏感词判断函数。情报室默认交付物清单里去掉「国内供应商中文 PDF」一项（它指的是已下线的简报；「厂家询价表」一项保留）。
- 存任务书 `docs/QINGYAN_RFQ-PDF_TASKBRIEF.md`；TASKFLOW 新增 RFQ-PDF-1、RFQ-PDF-2 两行。

## 受影响的 Muse 意图

无。不改 `src/lib/muse-bridge/**`；询价的起草、审批、执行行为不变（起草流程里两处内联代码抽成共用函数，输出逐字节不变，由既有测试不改期望值通过来证明）。

## Out of scope

- 询价单模板的文字、栏目与版式（报价表、分组、去掉页码与序号、联系人、合规取证清单等）：RFQ-PDF-2。本次合并后到 RFQ-PDF-2 合并前，简报里原有的合规取证清单不在任何生成文件里。
- 询价邮件正文、发询价审批卡、执行器、附件开关 `TENDER_RFQ_ATTACHMENT_ENABLED`（不打开）、附件预览接口。
- 内部文件（分析师备忘录、内部项目分析、同事任务单、RFI 问题清单、投标文件起草）的内容与 HTML 回落。
- 回信解析、比价、催单与追问。
- 让菜单生成的询价单带发起人填写项（数量阶梯、目的地、范围说明、附加问题、贸易条款）。
- 删除或改写已生成的旧文件、旧记录与已建情报室里存下的交付物清单。
- 任何 schema 改动、任何新的模型调用、任何新的出站路径。

## Capabilities

### New Capabilities

- `tender/rfq-sheet-download`：项目页「一键生成文档」生成并下载的供应商询价单——内容来源、与邮件附件同一份模板、不输出什么、各种不生成的情形与接口响应、PDF 检查、生成记录、菜单入口，以及已停用的两类供应商文件与内部文件回落的边界。

### Modified Capabilities

- `tender/supplier-identity-guard`：「供应商侧生成文件」改为只有供应商询价单一种（去掉分析综合版询价表、技术确认表、China Brief 的生成规则）；「供应商侧文件命中时不生成」的受检内容改为询价单（去掉 China Brief 预览与分析综合的要求）。两条的既有场景名全部保留、内容改写为现状（校验器不允许 MODIFIED 丢场景），另加一个场景。

## Impact

- 代码：`src/lib/projects/generate/generate-docs.ts`、`tender-doc-html.ts`、`pdf-common.ts`；`src/app/api/projects/[id]/generate-pdf/route.ts`；`src/lib/bid-workflow/pdf-doc-types.ts`、`china-supplier-brief.ts`、`start-intelligence.ts`；`src/lib/tender-rfq/`（新增菜单询价单的生成模块；`attachment-service.ts`、`build.ts`、`service.ts` 抽共用函数）；`src/components/project-generate/project-generate-menu.tsx`、`src/components/project-detail/tabs/bid-tab.tsx`；删除 `src/components/bid-workflow/china-supplier-brief-panel.tsx`；`scripts/cjk-pdf-e2e.ts`（改用仍存在的文件类型）。
- 接口：`POST /api/projects/{id}/generate-pdf` 的 `supplier_rfq` 多出 422 / 503 响应；`tech_confirm`、`china_supplier_brief` 返回 400；请求体不再读 `previewOnly`、`includePublicHistoricalAmounts`、`confirmNotes`，响应不再有 `fontLimitation` 字段。`GET` 不变。
- 测试：新增两个（纯逻辑与接线、隔离库端到端），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；改 `tender-doc-html`、`china-supplier-brief`、`project-identity-deny`、`cjk-pdf`、`analyst-memo-v1`、`bid-workflow-phase1` 六个既有测试里指向被删代码的断言。
- 数据：零 schema。新记录只用 `ProjectGeneratedDocument` / `ProjectDocument` 既有字段与 `metaJson`。
- 与在途 PR：#538（CHAIN-2d）也改 `generate-docs.ts`，后合并的一方 rebase，两边改动都保留。
