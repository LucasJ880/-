# Design：交付前检查清单由已确认的要求确定性生成（FLOW-H4b）

## Context

- 「提交」页签现在有两块「清单」：
  - **投标准备清单**（`src/components/project-checklist/bid-checklist.tsx`，接口 `/api/projects/[id]/checklist`）：模型生成。提示词（`src/lib/ai/prompts/project.ts`）只喂项目概况、任务统计、询价、成员、文件名，不喂要求与交付物；每一项的「已完成 / 进行中 / 有风险」是模型给的。存成一条 `source = "ai_checklist"` 的项目文件。只要有读权限就能触发生成；项目页上的 `AutoAiPanelsRunner` 在打开约 0.8 秒后、以及文件解析完成后会自动触发。
  - **交付物**（招标分析面板的一个页签）：只读列表。
- 招标分析（V2）已经有一份确定性的提交清单：`buildSubmissionChecklist` 取「有效、强制、类别属于提交类」的要求，存进该次分析的 `summaryJson.submissionChecklist`，再逐条投影成 `TenderDeliverable`（`buildGroundedDeliverables`，键由要求编号派生）。但它定格在分析那一刻：人之后的确认与驳回不反映进去。
- `TenderDeliverable` 有 `status`（PENDING / IN_PROGRESS / DONE / WAIVED）、`relatedDocumentId`，没有任何写接口；重新投影时 `update` 分支不碰 `status`。
- 要求本身在 `TenderExtractedRequirement`：`category`（小写）、`mandatory`、`reviewStatus`（AI_EXTRACTED / CONFIRMED / REJECTED）、`complianceStatus`、`sourcePage`、中文与原文。
- 分析的 `summaryJson.criticalFacts` 里有 `closing_datetime`、`question_deadline`、`submission_method`、`bond`、`insurance`，每项是 `{ status: KNOWN | UNKNOWN, text }`。
- 「当前可用的那份分析」：最近一份等待审核或已批准的（与投标判断、提问、标书草稿这些接口的取法相同）。比它更新的一次还在进行或失败了，仍用它。
- **旧的分析（V1）不能用**：招标分析有两种。`TENDER_ANALYSIS_V2_ENABLED` 关着时（代码里的默认值；生产上的取值我没有核实）走旧的那一种，它只把要求分成 `mandatory_general` / `mandatory_technical` 两类，认不出哪些是提交类的，也没有 `criticalFacts`。拿它生成会得出「这份招标分析里没有提交类的强制要求」——一句不对的话（独立审查发现，H1）。
- 要求审核面板（「要求」页签）显示的是最近一次分析，不论状态。

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

### D1b 只用逐条带依据的分析；不可用时一切照旧

分析摘要里有逐条对应要求的提交清单（`summaryJson.submissionChecklist` 是数组，交付物投影读的也是它）才用。当前可用的那份不是这一种、或者还没有可用的分析时，确定性清单**不可用**：新接口返回 `{ view: null, unavailable }`，「提交」页签照旧显示模型生成的那份，模型清单的接口照旧生成，自动触发器照旧。页面显示哪一份、模型接口拦不拦，用同一个判断（`isDeterministicChecklistAvailable`）。

- 否决：没有分析时显示确定性清单（「先完成招标分析」）。初稿的做法。在 V2 关着的环境里，分析完成之后又会换回模型那份，来回变；而且没有分析时模型那份至少还有内容。
- 否决：把开关与 V2 开关绑在一起。两件事分开上线更好查问题；按每份分析判断也照顾到 V2 中途打开的项目。

### D2 「提交类」沿用分析里已有的那七个类别

提交、行政、报价、样品、深化图、保证金、保险——与 `buildSubmissionChecklist` 相同。

- 否决：把所有强制要求都列进来。产品规格、交货期这类要求有几十上百条，属于「能不能投」，不是「交标前要备齐什么」；它们里判为不满足的，单列在废标风险里。

### D3 没确认的单列，不混进来，也不藏起来

- 否决：没确认的也算进要备齐的。模型抽取可能有错，人还没看过。
- 否决：没确认的不显示。那样清单看着很短，人会以为齐了。

### D4 状态存进已有的交付物行

每条清单项对应该次分析里以要求编号派生键的 `TenderDeliverable` 行；标状态时没有这一行就建（已确认但分析时没被投影的要求会遇到）。只用三个值：PENDING（待办）、DONE（备好了）、WAIVED（不适用）。两条要求的编号派生出同一个键（如 `R.1` 与 `R-1`）时共用一行、共用一个状态：只有前一条有按钮，后一条跟着显示，进度里各算一条。

交付物表别的地方也读：分析面板的「交付物」列表会显示这里标的状态，也会列出标状态时现建的那几行（它原本只列分析时投影出来的）。重新投影时 `update` 分支不碰 `status`，人标的不会被冲掉。

- 否决：新建一张表。零 schema。
- 否决：存进审计日志、读最新一条（FLOW-H4a 的做法）。这里已经有一张为此而设、带状态列的表，没有理由绕开。
- 否决：把状态跨分析带过去。重新分析之后要求可能变了，旧的「备好了」不一定还成立。

### D5 系统不替人判断「备好了没有」

清单只列该备什么、显示人标的状态。不根据文件名、任务完成情况去推断。

- 否决：自动打勾。那正是模型清单的毛病。

### D6 开关开启时，模型清单的接口不再调模型

`POST /api/projects/[id]/checklist` 在确定性清单可用时（开关开着、招投标项目、当前分析带依据）直接返回 409「已由确定性清单取代」，不调模型；`GET` 照旧返回已存的内容并带上 `replaced: true`（不删历史）。页面上的自动触发器先读这个 `GET`：已被取代时不发生成请求（包括文件解析完成后的强制刷新）。

- 否决：只换页面上的组件。自动触发器仍会在后台调模型，钱照花、结果没人看。

### D7 独立的开关

`TENDER_SUBMISSION_CHECKLIST_ENABLED` + 组织名单，默认关。

- 否决：挂在 FLOW-H4a 的开关下。两件事可以分开上线：这一个不写项目，只写交付物的状态。

## 与八条硬纪律的关系

1. **零 schema**：遵守。只读既有的要求表与分析；状态写既有的交付物表。
2. **出站先审批**：不涉及。没有任何对外动作。
3. **禁止第三套队列**：遵守。没有后台执行。
4. **脱敏**：清单不新增金额字段，也不读我方的成本、毛利、报价（取数只碰项目的两个时间、分析、要求、交付物）。要求原文与提交条件照招标文件原文显示——里面写了金额（保证金比例、保险额度、预算上限）就照原文显示，这些是招标方写的、「要求」页签上本来就能看到的文字（独立审查 H2）。Muse 通道没有新增内容。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守，并且减少一次模型调用。
8. **测试注册**：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-submission-checklist/__tests__/checklist.test.ts`（新，纯逻辑）：分组规则逐条；关键事实的两种状态；进度的算法；开关；接线的源码断言。
- `npx tsx src/lib/tender-submission-checklist/__tests__/checklist-db.isolated.test.ts`（新，隔离库，真实路由）：规格里的每个场景。模型清单接口拦没拦，靠测试环境没有模型密钥来区分：被拦下返回 409；没被拦、往下走到调模型那一步返回 500「AI 服务未配置」。
- 组件渲染测试：清单各组的呈现。
- 变异核对；真实浏览器里走一遍，截图存 `docs/acceptance/flow-h4b/`。
- 开 PR 前请一个不带结论的独立审查。
- 全量：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate tender-submission-checklist --strict`。

## Risks / Trade-offs

- **清单变短了**：模型清单会列「公司资质」「团队简历」这类通用项；确定性清单只有招标文件里写了、人确认了的。没写进招标文件的东西不会出现。
- **依赖要求被确认**：没人确认要求的项目，「要备齐的」是空的，全在「还没确认」里。页面写明要先去确认。
- **类别是模型抽取时定的**：一条该算提交类的要求被归到了别的类别，就不会进清单。不满足的强制要求不受此限（任何类别都列）。
- **重新分析后状态清零**（D4）：新的一份一进入等待审核就换过去，那时它的要求都还没确认，「要备齐的」是空的，之前标过的看不到了（还在旧的那份的行上）。确认之后再标。
- **「去确认」跳过去看到的可能不是同一份**：要求审核面板显示最近一次分析、不论状态。之后又发起的一次还在进行或失败时，跳过去看到的是那一次；清单上写明了「之后又发起了一次分析……」。
- **V2 没开的环境里不起作用**（D1b）：开关开着也照旧显示模型那份。
- **没取到清单（出错、网络、超时 15 秒）**：显示「没有取到」与重试，不退回模型那份（那份已被取代，它的生成按钮会得到 409）。
- **开关开启后模型清单不再更新**：已存的那份留在库里，不再显示。

## Migration Plan

无数据迁移。回滚 = 关开关：页面回到模型清单，接口恢复生成；已标的交付物状态留在库里，无人读取。

## Open Questions

- 要不要把清单完成情况接到 FLOW-H4a 的「记录提交」上（没备齐时提醒）。本次不做。
