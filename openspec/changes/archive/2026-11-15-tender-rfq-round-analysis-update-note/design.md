# Design：询价发出之后招标分析更新过，在那一轮上标出来（FLOW-H3）

## Context

- 方案 §7 的 H3 原本写「接受补遗变更后受影响的要求回到待确认；已发询价引用了被改的要求就标出」。只读调查（交接文档「H3 调查要点」）发现：
  - 生产上没有增量分析：补遗来了 = 一份新的完整分析（`enqueue-package.ts` 写死 `runKind: "FULL"`），全部要求重新抽取、都是待确认。「回到待确认」已经发生，而且是全部。
  - 要求跨分析没有稳定标识：V2 的 `requirementCode` 是去重之后按位置编的 `R-001…`。
  - 询价轮次不记它用了哪些要求：`ProjectInquiry` / `InquiryItem` 没有相关字段；发送卡载荷（`TenderSendRfqPayload`）只存渲染好的正文。
- 询价引擎发出的轮次：发送卡（`PendingAction`，`type = tender.send_rfq`，载荷带 `inquiryId`）在准备阶段创建，正文那时就定下（`src/lib/tender-rfq/build.ts` 从当时可用的分析取已确认的要求）；批准执行后状态为 `executed`。询价入口接口（`GET /api/projects/[id]/tender-rfq/entry`，`src/lib/tender-rfq/web-entry.ts`）已经在读这些已执行的卡，算每一轮的耗时。
- 询价单取要求用的是「最新创建的等待审核或已批准的分析」（`loadRfqRequirementInputs`，`service.ts`），只收其中已确认的要求。
- 分析进入等待审核只有一处（`worker.ts` 的 FINALIZE），总会写 `completedAt`；批准写 `approvedAt`，带「全部确认」时一并把待确认的要求改为已确认。

## Goals / Non-Goals

**Goals**

- 人看询价区时知道：这一轮是在分析更新之前起草的。

**Non-Goals（具体到文件）**

- 不改 `src/lib/tender-rfq/build.ts`、`execute.ts`（起草与发出）。
- 不改 `src/lib/tender-auto-analysis/**`（分析、变更候选、接受按钮）。
- 不改 `src/components/tender-analysis/analysis-panel.tsx`。
- 不改 `prisma/schema.prisma`。

## Decisions

### D1 只按时间判断：询价单用的那一份，在发送卡创建之后有没有完成或批准

参照时刻是发送卡的创建时间（正文定下的时刻），不是发出时间：卡起草之后、批准之前分析更新了，正文仍是旧的。比较的是询价单取要求时会用的那一份（最新创建的可用分析），不是「完成时间最晚的一份」：一份更早创建、失败后重试、最近才完成的分析，询价单不会用它（独立审查 L-1）。那一份之后才批准也算更新：批准时可能一并确认了更多要求，询价单只收已确认的（审查 M-1）。

- 否决：取所有可用分析里完成时间最晚的。会因为询价单根本不用的那一份而提示。
- 否决：看要求表的最后修改时间。单条确认、驳回也会改它；本次只认整份分析的完成与批准，单条的改动写进 Risks。

- 否决：比较要求编号或原文。编号跨分析不稳定；轮次也没存要求。
- 否决：按发出时间比。会漏掉「起草之后、批准之前」更新的情形。
- 否决：给轮次加一列记分析 id。要改 schema；而且旧轮次没有。

### D2 「完成时间」缺失时按创建时间（防御）

生产上进入等待审核时总会写完成时间（初稿以为有一条路径不写，独立审查 L-2 核实不是）。缺失时按创建时间，只是防御。

- 否决：完成时间缺失就报错。读取接口不该因为一条历史数据挂掉。

### D2b 更新之后又起草过一轮，之前的轮次不再提示

提示的建议是「需要时另发一轮」；已经另发了，再挂着就是噪音（审查 L-4）。

- 否决：一直挂着。人会习惯性忽略它。

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

- `npx tsx src/lib/tender-rfq/__tests__/analysis-update-note.test.tsx`（新，纯逻辑）：判断规则逐条（之后完成 / 之前完成 / 恰好同一时刻 / 完成时间缺失 / 没有分析）、日期按时区、文字里没有编号；开关；接线。
- `npx tsx src/lib/tender-rfq/__tests__/analysis-update-note-db.isolated.test.ts`（新，隔离库，真实路由）：spec 的每个场景；读取前后什么都没变。
- 变异核对；独立审查。
- 全量：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate tender-rfq-round-analysis-update-note --strict`。

## Risks / Trade-offs

- **会多提示**：分析更新了、但这一轮引用的要求其实没变，也会提示。措辞写「可能」。
- **会少提示**：单条要求的确认、驳回（不经批准）不算更新；起草时读要求与建发送卡之间有一个很短的窗口（毫秒到秒级），这期间完成的分析算作起草之前。
- **另发的一轮可能并不覆盖之前那一轮的供应商**：只要更新之后起草过任何一轮，之前的就不再提示。
- **入口接口多一次查询**（开关开着、项目有引擎发出的轮次时）。

## Migration Plan

无数据迁移。回滚 = 关开关。

## Open Questions

- 补遗变更候选（V2 在完整分析里写的）要不要显示、「接受」按钮怎么办：单独定，不在这里。
