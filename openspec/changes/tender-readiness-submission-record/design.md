# Design：提交记录接进可投标判定（FLOW-H4c）

## Context

- 可投标判定（`src/lib/tender-bid-readiness/readiness.ts`，TI-3b）第一项是截标窗口：`deriveTenderWindowState`（`src/lib/tender-price-schedule/closing-time.ts`，TI-1）在截标之后看提交记录——有回执编号算已提交（只给一条「仅供复盘」的提示），没有就是已过期（阻断项「已过截标，且没有带回执的提交记录」）。「只有带平台回执的才算数」是 TI-1 定下的规则。
- 判定的唯一调用方是投标工作区（`src/lib/tender-bid-workspace/workspace-view.ts` 的 `readinessOf`），工作区读取接口与成本核算表接口都经过它；它的上下文由 `loadWorkspaceContext`（`store.ts`）从项目记录读截标时间。**它从来不传提交记录**，所以截标一过永远是已过期。
- FLOW-H4a（`src/lib/tender-submission/`）在项目页上记提交：每次追加一条审计行（`tender.submission.record`），里面有提交时间、方式、回执编号、备注；项目上的 `submittedAt` 是最后生效的那个时间。读取时显示的是「最新的、记的就是项目当前提交时间的那一条」（两个人同时第一次记录、填的不一样时，最后写进来的记录不一定对应最终生效的时间）。
- 项目的提交时间也可以由对话里的「阶段推进建议」写下，那时没有记录。
- 「下一步」卡片把「已过截标」列在不显示的阻断项里，不受影响。

## Goals / Non-Goals

**Goals**

- 记了带回执的提交之后，投标工作区不再说「已过截标、不可投标」。
- 有提交时间却没有回执编号时，说清楚差什么、去哪里补。

**Non-Goals（具体到文件）**

- 不改 `src/lib/tender-price-schedule/closing-time.ts`（「有回执才算已提交」的规则）。
- 不改 `src/lib/tender-next-step/**`。
- 不改 FLOW-H4a 的写入（`src/lib/tender-submission/service.ts` 的 `recordSubmission`）与接口。
- 不改 `src/components/tender/bid-workspace-panel.tsx`（它已经会显示判定的阻断项与提示）。
- 不改 `prisma/schema.prisma`。

## Decisions

### D1 用「与项目当前提交时间对得上的那条记录」，与提交记录卡片用同一个取法

把 FLOW-H4a 读取时的取法抽成一个纯函数，提交记录卡片与可投标判定都用它。

- 否决：取最新的一条记录。两人同时第一次记录、填的不一样时，最新的那条不一定对应最终生效的时间——会把一个人的回执配上另一个人的时间（FLOW-H4a 审查发现过）。
- 否决：另存一份「当前提交」。多一处会过时的副本。

### D2 不看提交记录的开关

记录只在 FLOW-H4a 的开关开着时才会被写下；读的时候不再看那个开关。开关后来关了，已经记下的回执仍然是事实。

- 否决：提交记录开关关着就当没有记录。会让同一个项目的判定随一个与它无关的开关来回变。

### D3 有提交时间但没有回执编号时，换一句话，不换判定

仍然是「已过截标」的阻断项（TI-1 的规则不变），文字改成写明去「提交」页签的「提交记录」补上回执编号。只有项目有提交时间时才换；没有提交时间时文字与原来相同。

- 否决：有提交时间就算已提交。那是在改 TI-1 的规则（点击记录、口头确认都不算）。
- 否决：不改文字。人记了提交、页面还说「没有带回执的提交记录」，看不出差的是回执编号。

### D4 不新增开关

判定只在投标工作区里显示，工作区有自己的开关 `TENDER_BID_WORKSPACE_ENABLED`（默认关）。

- 否决：再加一个开关。行为本来就该如此，而且只在一个已经默认关的地方可见。

## 与八条硬纪律的关系

1. **零 schema**：遵守。只读既有的审计行与项目记录。
2. **出站先审批**：不涉及。没有对外动作。
3. **禁止第三套队列**：不涉及。
4. **脱敏**：判定只用「有没有回执编号」，不带出回执编号、备注、提交方式（spec 有一条 SHALL NOT）。Muse 通道没有新增内容。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。纯规则，不调模型。
8. **测试注册**：新的隔离库测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（无库时跳过）；纯函数测试沿用既有的、已注册的文件。

## 验证方式

- `npx tsx src/lib/tender-bid-readiness/__tests__/readiness.test.ts`：有提交时间无回执、无提交时间、截标未到三种文字。
- `npx tsx src/lib/tender-submission/__tests__/submission-record.test.ts`：取法的纯函数（对得上的、对不上的、两条同时间取最新的、形状不对的）。
- `npx tsx src/lib/tender-bid-workspace/__tests__/readiness-submission-db.isolated.test.ts`（新，隔离库，真实路由）：spec 的每个场景；同一份测试在改动之前的代码上要失败。
- 既有：`workspace-view.test.ts`、`line-entry.test.ts`、`submission-record-db.isolated.test.ts`、`bid-workspace-db.isolated.test.ts` 不变地通过。
- 变异核对；独立审查。
- 全量：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate tender-readiness-submission-record --strict`。

## Risks / Trade-offs

- **没有回执编号的提交仍然「不可投标」**：交了标、但门户没给编号（或人没填）的项目，工作区会一直这样说。文字写明了去补，但补什么由人决定。
- **工作区读取多一次查询**（最多 20 条审计行，只在项目有提交时间时查）。

## Migration Plan

无数据迁移。回滚 = 回滚代码（回到截标之后永远「已过截标」）。

## Open Questions

无。
