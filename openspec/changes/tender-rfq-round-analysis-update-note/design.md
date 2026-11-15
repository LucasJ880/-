# Design：询价发出之后招标分析更新过，在那一轮上标出来（FLOW-H3）

## Context

- 方案 §7 的 H3 原本写「接受补遗变更后受影响的要求回到待确认；已发询价引用了被改的要求就标出」。只读调查（交接文档「H3 调查要点」）发现：
  - 生产上没有增量分析：补遗来了 = 一份新的完整分析（`enqueue-package.ts` 写死 `runKind: "FULL"`），全部要求重新抽取、都是待确认。「回到待确认」已经发生，而且是全部。
  - 要求跨分析没有稳定标识：V2 的 `requirementCode` 是去重之后按位置编的 `R-001…`。
  - 询价轮次不记它用了哪些要求：`ProjectInquiry` / `InquiryItem` 没有相关字段；发送卡载荷（`TenderSendRfqPayload`）只存渲染好的正文。
- 询价引擎发出的轮次：发送卡（`PendingAction`，`type = tender.send_rfq`，载荷带 `inquiryId`）在准备阶段创建，正文那时就定下（`src/lib/tender-rfq/build.ts` 从当时可用的分析取已确认的要求）；批准执行后状态为 `executed`。询价入口接口（`GET /api/projects/[id]/tender-rfq/entry`，`src/lib/tender-rfq/web-entry.ts`）已经在读这些已执行的卡，算每一轮的耗时。
- 分析完成进入等待审核时写 `completedAt`（`worker.ts` 的 FINALIZE）；有一条路径（`enqueue-package.ts`）直接写成等待审核而不写 `completedAt`。

## Goals / Non-Goals

**Goals**

- 人看询价区时知道：这一轮是在分析更新之前起草的。

**Non-Goals（具体到文件）**

- 不改 `src/lib/tender-rfq/build.ts`、`execute.ts`（起草与发出）。
- 不改 `src/lib/tender-auto-analysis/**`（分析、变更候选、接受按钮）。
- 不改 `src/components/tender-analysis/analysis-panel.tsx`。
- 不改 `prisma/schema.prisma`。

## Decisions

### D1 只按时间判断：发送卡创建之后有没有可用的分析完成

参照时刻是发送卡的创建时间（正文定下的时刻），不是发出时间：卡起草之后、批准之前分析更新了，正文仍是旧的。

- 否决：比较要求编号或原文。编号跨分析不稳定；轮次也没存要求。
- 否决：按发出时间比。会漏掉「起草之后、批准之前」更新的情形。
- 否决：给轮次加一列记分析 id。要改 schema；而且旧轮次没有。

### D2 「完成时间」缺失时按创建时间

有一条路径直接写成等待审核而不写完成时间。按创建时间算会偏早（可能少提示），但不会多提示。

- 否决：完成时间缺失就不算。那条路径产生的分析永远不会触发提示。

### D3 只管询价引擎发出的轮次

人工标记已发送的轮次，正文不是这里生成的，而且询价区只在引擎发出的轮次上显示状态行。

- 否决：所有轮次都提示。人工轮次没有可靠的「正文定下」时刻。

### D4 只提示，措辞写「可能」

不说具体哪条变了，也不自动做任何事。分析更新了不等于询价里引用的要求变了。

- 否决：自动起草新一轮。出站先审批；而且不一定需要。

### D5 新开关，默认关

`TENDER_RFQ_ANALYSIS_UPDATE_NOTE_ENABLED` + 组织名单。任务书要求新功能默认关。

## 与八条硬纪律的关系

1. **零 schema**：遵守。只读既有的发送卡与分析记录。
2. **出站先审批**：遵守。只提示，不起草、不发信。
3. **禁止第三套队列**：不涉及。
4. **脱敏**：提示里只有两个日期与固定文字，不带要求原文与邮件正文（spec 有一条 SHALL NOT）。Muse 通道没有新增内容。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。按时间比较，不调模型。
8. **测试注册**：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-rfq/__tests__/analysis-update-note.test.ts`（新，纯逻辑）：判断规则逐条（之后完成 / 之前完成 / 恰好同一时刻 / 完成时间缺失 / 没有分析）、日期按时区、文字里没有编号；开关；接线。
- `npx tsx src/lib/tender-rfq/__tests__/analysis-update-note-db.isolated.test.ts`（新，隔离库，真实路由）：spec 的每个场景；读取前后什么都没变。
- 变异核对；独立审查。
- 全量：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate tender-rfq-round-analysis-update-note --strict`。

## Risks / Trade-offs

- **会多提示**：分析更新了、但这一轮引用的要求其实没变，也会提示。措辞写「可能」。
- **会少提示**：完成时间缺失的分析按创建时间算，偏早；同一份分析批准时又确认了更多要求（要求集合变了）不算「更新」。
- **入口接口多一次查询**（开关开着、项目有引擎发出的轮次时）。

## Migration Plan

无数据迁移。回滚 = 关开关。

## Open Questions

- 补遗变更候选（V2 在完整分析里写的）要不要显示、「接受」按钮怎么办：单独定，不在这里。
