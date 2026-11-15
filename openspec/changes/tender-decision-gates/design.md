# Design：两道闸生效（FLOW-H5）

## Context

- 投标决定：`setGoHoldNoGo`（`src/lib/bid-workflow/go-decision.ts`）在一个事务里写 `BidIntelligenceRoom.goDecision`（GO / HOLD / NO_GO）、`goDecidedAt`、`goDecisionById`，同时写 `Project.bidPhaseStatus` 与审计 `bid_go_decision`。可以反复改。唯一的入口是工作台的三个按钮。
- 断点 G4（基线）：`tender-rfq`、`tender-bid-draft`、文档生成里没有任何地方读投标决定。
- 询价入口状态（`decideRfqEntryState`，`web-entry-pure.ts`）有一个 `warnings` 数组，注释写明「不阻断的提醒」，页面在按钮旁与抽屉里都会显示；「下一步」卡片也读这个入口。阻断原因（`EntryBlockReason`）是另一回事，自动起草询价也看它。
- 投标文件起草：卡片 `bid-draft-card.tsx` → `POST generate-pdf`（`docType = bid_draft`）→ `generateProjectDocument`（`src/lib/projects/generate/generate-docs.ts`）→ `gatherBidDraftInputs`（取最新的等待审核或已批准的分析，不记它的状态）→ 模型合成 → `renderBidDraftHtml`。结果元信息写进 `room.summaryJson.bidDraft`，元信息接口 `GET …/bid-draft` 读它。断点 G5：未批准的分析也能起草，起草出来的东西看不出来。

## Goals / Non-Goals

**Goals**

- 定了不投之后去询价或起草，页面上有一句话。
- 基于未批准的分析起草的投标文件，起草前、起草后都看得出来。

**Non-Goals（具体到文件）**

- 不改 `src/lib/tender-rfq/web-entry-pure.ts` 的阻断原因与 `auto-draft-*.ts`（自动起草询价）。
- 不改 `src/lib/muse-bridge/**`。
- 不改 `src/lib/tender-bid-draft/synthesize.ts`（提示词）与起草用哪些要求。
- 不改 `src/lib/bid-workflow/**`（投标决定的写入）。
- 不改 `prisma/schema.prisma`。

## Decisions

### D1 只提醒，不拦

方案 §9 第 6 条：No-Go 常被翻案，硬拦会逼人去改记录。提醒写明是哪天定的不投，人自己决定。

- 否决：No-Go 之后入口不可用。见上。

### D2 询价的提醒放进入口的 `warnings`，不加阻断原因

`warnings` 本来就是不阻断的提醒，页面两处都会显示，「下一步」卡片也会读到。加阻断原因会改变入口可用与否，还会挡住自动起草。

- 否决：新加一种阻断原因。见上。

### D3 No-Go 以 `BidIntelligenceRoom.goDecision` 为准

那是决定本身；`bidPhaseStatus` 是阶段字段，两者一起写但可能不一致。没有情报室的项目没有决定。

### D4 起草时记下所用分析与是否已批准；与起草取的是同一份

把起草取数改成同时返回所用分析的标识与状态（不进模型的输入），起草之后写进 `bidDraft` 元信息；草稿文件在 AI DRAFT 横幅下加一行。元信息接口另外返回「当前分析是否已批准」，供起草前提示。

- 否决：起草之后另查一次分析。中间可能换了一份，记下的不是起草用的那份。
- 否决：把状态塞进起草的输入。输入会进模型的提示词。

### D5 新开关，默认关

`TENDER_DECISION_GATES_ENABLED` + 组织名单。关闭时元信息不多写、接口不多返回、草稿文件不加横幅。

## 与八条硬纪律的关系

1. **零 schema**：遵守。读既有字段；标注写进既有的 `room.summaryJson.bidDraft`。
2. **出站先审批**：不涉及。只提醒，不拦、不发。
3. **禁止第三套队列**：不涉及。
4. **脱敏**：提醒只有日期与固定文字，不带决定的备注；Muse 通道没有新增内容。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。规则固定，不调模型；起草本身的模型调用不变。
8. **测试注册**：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-decision-gates/__tests__/decision-gates.test.tsx`（新）：文字、开关、草稿横幅、卡片呈现、接线。
- `npx tsx src/lib/tender-decision-gates/__tests__/decision-gates-db.isolated.test.ts`（新，隔离库，真实路由；起草用假的合成函数，不调模型）：spec 的每个场景。
- 变异核对；独立审查；真实浏览器截图。
- 全量门禁与 `openspec validate tender-decision-gates --strict`。

## Risks / Trade-offs

- **提醒可能被忽略**：只提醒的代价。
- **起草仍然不按确认状态筛要求**：已批准的分析里也可能有没确认的要求（批准时没勾「全部确认」）；本次只按分析是否批准来标注。
- **询价入口多一次查询**（开关开着时）。

## Migration Plan

无数据迁移。回滚 = 关开关；已写进 `bidDraft` 的标注留着，无人读取。

## Open Questions

无。
