# Design：交付前检查清单由已确认的要求确定性生成（FLOW-H4b）

## Context

- 「提交」页签现在有两块「清单」：
  - **投标准备清单**（`src/components/project-checklist/bid-checklist.tsx`，接口 `/api/projects/[id]/checklist`）：模型生成。提示词（`src/lib/ai/prompts/project.ts`）只喂项目概况、任务统计、询价、成员、文件名，不喂要求与交付物；每一项的「已完成 / 进行中 / 有风险」是模型给的。存成一条 `source = "ai_checklist"` 的项目文件。只要有读权限就能触发生成；项目页上的 `AutoAiPanelsRunner` 在打开约 0.8 秒后、以及文件解析完成后会自动触发。
  - **交付物**（招标分析面板的一个页签）：只读列表。
- 招标分析（V2）已经有一份确定性的提交清单：`buildSubmissionChecklist` 取「有效、强制、类别属于提交类」的要求，存进该次分析的 `summaryJson.submissionChecklist`，再逐条投影成 `TenderDeliverable`（`buildGroundedDeliverables`，键由要求编号派生）。但它定格在分析那一刻：人之后的确认与驳回不反映进去。
- `TenderDeliverable` 有 `status`（PENDING / IN_PROGRESS / DONE / WAIVED）、`relatedDocumentId`，没有任何写接口；重新投影时 `update` 分支不碰 `status`。
- 要求本身在 `TenderExtractedRequirement`：`category`（小写）、`mandatory`、`reviewStatus`（AI_EXTRACTED / CONFIRMED / REJECTED）、`complianceStatus`、`sourcePage`、中文与原文。
- 分析的 `summaryJson.criticalFacts` 里有 `closing_datetime`、`question_deadline`、`submission_method`、`bond`、`insurance`，每项是 `{ status: KNOWN | UNKNOWN, text }`。
- FLOW-H1 取数时已经定好「当前可用的那份分析」的取法（最近一次失败而之前有可用的，用之前那份）。

## Goals / Non-Goals

**Goals**

- 清单里的每一条都能回到招标文件的原文，并且只包含人确认过的。
- 少一次模型调用（打开项目页不再自动生成清单）。

**Non-Goals（具体到文件）**

- 不改 `src/lib/tender-understanding/**`、`src/lib/tender-auto-analysis/deliverables.ts`（分析时怎么生成交付物）。
- 不删 `src/components/project-checklist/bid-checklist.tsx` 与 `src/lib/ai/prompts/project.ts`；已存的模型清单不动。
- 不改 `src/lib/agent-core/skills/tender-seed.ts`（对话里的废标风险检查技能）。
- 不改 `src/lib/muse-bridge/**`、`prisma/schema.prisma`。

## Decisions

### D1 清单在读取时从要求表现算，不读分析时存下的那份

读取时查当前可用的那份分析的要求，按「强制 + 提交类 + 已确认」筛。

- 否决：直接用 `summaryJson.submissionChecklist` 或交付物表。它们定格在分析那一刻，驳回的还在、确认与否不反映——这正是要解决的问题。
- 否决：另存一份清单。又多一处会过时的副本。

### D2 「提交类」沿用分析里已有的那七个类别

提交、行政、报价、样品、深化图、保证金、保险——与 `buildSubmissionChecklist` 相同。

- 否决：把所有强制要求都列进来。产品规格、交货期这类要求有几十上百条，属于「能不能投」，不是「交标前要备齐什么」；它们里判为不满足的，单列在废标风险里。

### D3 没确认的单列，不混进来，也不藏起来

- 否决：没确认的也算进要备齐的。模型抽取可能有错，人还没看过。
- 否决：没确认的不显示。那样清单看着很短，人会以为齐了。

### D4 状态存进已有的交付物行

每条清单项对应该次分析里以要求编号派生键的 `TenderDeliverable` 行；标状态时没有这一行就建（已确认但分析时没被投影的要求会遇到）。只用三个值：PENDING（待办）、DONE（备好了）、WAIVED（不适用）。

- 否决：新建一张表。零 schema。
- 否决：存进审计日志、读最新一条（FLOW-H4a 的做法）。这里已经有一张为此而设、带状态列的表，没有理由绕开。
- 否决：把状态跨分析带过去。重新分析之后要求可能变了，旧的「备好了」不一定还成立。

### D5 系统不替人判断「备好了没有」

清单只列该备什么、显示人标的状态。不根据文件名、任务完成情况去推断。

- 否决：自动打勾。那正是模型清单的毛病。

### D6 开关开启时，模型清单的接口不再调模型

`POST /api/projects/[id]/checklist` 在新开关对该组织开启时直接返回「已由确定性清单取代」，不调模型；`GET` 照旧返回已存的内容（不删历史）。这样页面上的自动触发器不用改也不会再产生调用；另外让它在新接口可用时跳过这一项，少发一个请求。

- 否决：只换页面上的组件。自动触发器仍会在后台调模型，钱照花、结果没人看。

### D7 独立的开关

`TENDER_SUBMISSION_CHECKLIST_ENABLED` + 组织名单，默认关。

- 否决：挂在 FLOW-H4a 的开关下。两件事可以分开上线：这一个不写项目，只写交付物的状态。

## 与八条硬纪律的关系

1. **零 schema**：遵守。只读既有的要求表与分析；状态写既有的交付物表。
2. **出站先审批**：不涉及。没有任何对外动作。
3. **禁止第三套队列**：遵守。没有后台执行。
4. **脱敏**：清单只有要求原文、出处、日期与提交条件，没有金额字段；保证金、保险两项是招标文件的原文摘录。Muse 通道没有新增内容。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守，并且减少一次模型调用。
8. **测试注册**：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-submission-checklist/__tests__/checklist.test.ts`（新，纯逻辑）：分组规则逐条；关键事实的两种状态；进度的算法；开关；接线的源码断言。
- `npx tsx src/lib/tender-submission-checklist/__tests__/checklist-db.isolated.test.ts`（新，隔离库，真实路由）：规格里的每个场景；模型清单接口在开关开启时不调模型（注入一个会报错的假模型来证明没有被调用）。
- 组件渲染测试：清单各组的呈现。
- 变异核对；真实浏览器里走一遍，截图存 `docs/acceptance/flow-h4b/`。
- 开 PR 前请一个不带结论的独立审查。
- 全量：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate tender-submission-checklist --strict`。

## Risks / Trade-offs

- **清单变短了**：模型清单会列「公司资质」「团队简历」这类通用项；确定性清单只有招标文件里写了、人确认了的。没写进招标文件的东西不会出现。
- **依赖要求被确认**：没人确认要求的项目，「要备齐的」是空的，全在「还没确认」里。页面写明要先去确认。
- **类别是模型抽取时定的**：一条该算提交类的要求被归到了别的类别，就不会进清单。不满足的强制要求不受此限（任何类别都列）。
- **重新分析后状态清零**（D4）。
- **开关开启后模型清单不再更新**：已存的那份留在库里，不再显示。

## Migration Plan

无数据迁移。回滚 = 关开关：页面回到模型清单，接口恢复生成；已标的交付物状态留在库里，无人读取。

## Open Questions

- 要不要把清单完成情况接到 FLOW-H4a 的「记录提交」上（没备齐时提醒）。本次不做。
