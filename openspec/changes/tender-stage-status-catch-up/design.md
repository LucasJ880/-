# Design：阶段已到、招投标状态落后时，人确认推进就补上状态（FIX-6）

## Context

- 阶段推进 `advanceProjectStage`（`src/lib/tender/stage-transition.ts`）由对话里的推进卡片调用（`/api/projects/{id}/advance-stage`），要人确认。推进时同时写阶段时间与招投标状态，写讨论区消息与审计，通知成员，项目有来源系统时发 BidToGo 状态回调（`notifyProjectStatusChange`，`src/lib/webhook/dispatcher.ts`——全仓库只有这里调用它）。
- 推进的目标阶段已到时（阶段记录已在这一段，或这一段的时间已有值），它直接返回「无需重复推进」，什么也不改。
- 有几处只写阶段时间、不改招投标状态：分析收尾（`src/lib/tender-auto-analysis/worker.ts`，项目解读）、询价发出（`src/lib/tender-rfq/execute.ts`，供应商询价），以及 FLOW-H1c（#449，开关默认关）打开后的录入报价与标记已发送。于是阶段记录在前、招投标状态在后。
- 对话 AI 的项目上下文读的是招投标状态（`src/lib/ai/context.ts`），不是阶段记录。所以状态落后时，AI 会按状态提议推进到已经到了的那一段；人点确认，得到「无需重复推进」——状态与回调永远补不上。

## Goals / Non-Goals

**Goals**

- 人确认推进到已到的阶段时，落后的招投标状态被补上，BidToGo 收到这一次（人确认过的）状态回调。

**Non-Goals（具体到文件）**

- 不改推进卡片 `src/components/work-suggestion/stage-advance-card.tsx`、AI 提示词 `src/lib/ai/prompts/common.ts`、上下文 `src/lib/ai/context.ts`。
- 不改分析收尾、询价发出、FLOW-H1c 的自动写入。
- 不改 `advanceProjectStage` 正常推进那一段（写库事务、任务、通知、回调）；只在两处「无需重复推进」的提前返回之前加一步。
- 不改 `src/lib/webhook/dispatcher.ts`。

## Decisions

### D1 补在人确认的推进里，不在自动写入里

- 否决：自动写阶段时间时顺带改招投标状态、不发回调。状态与回调是一对，只改一边，BidToGo 那边就永远不知道这一次变化。
- 否决：自动写阶段时间时也改状态并发回调。回调是对外发送，原来要人确认后才发；自动发违反「出站先审批」。
- 否决：自动写入时为回调建一张审批卡。每个项目每一段一张卡，太吵；人本来就会在对话里点推进。

### D2 只补状态，不重复推进时的其它副作用

补状态只改招投标状态、写讨论区的状态变化（沿用推进时的 `emitProjectPatchEvents`）与审计、有来源系统时发回调。不写阶段时间（已有），不建不关任务（自动写入时已收建过，或以后由下一次推进处理），不发「项目已推进到某某」的成员通知（阶段并没有在这一刻推进）。

- 否决：当作一次完整推进再走一遍。会重复通知全体成员、重复写「推进到某某」的讨论区消息。

### D3 怎样算落后：按状态对应的阶段比

用既有的状态 → 阶段映射（`src/lib/tender/stage.ts` 的 `STATUS_TO_STAGE`，新导出 `tenderStatusStageOf` 读它）：状态为空或对应的阶段比目标靠前才算落后。已是结果、认不出的状态不动。

- 否决：只要状态不等于目标对应的值就改。会把「投标准备」「已提交」这类更靠后的状态往回改，也会覆盖认不出的人工状态。

### D4 条件写入，只补一次

写入条件带上读到的招投标状态与「进行中」：同时点两次只有一个写成功；读之后别人记了结果也不写。没写成就按原来的「无需重复推进」返回。

- 否决：不加条件直接改。同时点两次会发两次回调。

## 与八条硬纪律的关系

1. **零 schema**：遵守。只改既有的 `tenderStatus`。
2. **出站先审批**：遵守。BidToGo 回调只在人确认推进之后发，与正常推进相同；没有新的出站点。
3. **禁止第三套队列**：遵守。同步执行。
4. **脱敏**：不涉及。回调内容与正常推进相同（状态、项目编号、操作人）。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。查表比较，不调模型。
8. **测试注册**：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender/__tests__/stage-status-catch-up.test.ts`（新，纯逻辑与接线，CI 里跑）：落后的规则表；两处提前返回之前都先试补状态；补状态那一段不写阶段时间、不碰任务与成员通知。
- `npx tsx src/lib/tender/__tests__/stage-status-catch-up-db.isolated.test.ts`（新，隔离库）：补状态、回调（造一个接收地址，拦截请求）、只改状态、不补的各种情形、同时点两次。同一份测试在改动之前的代码上要失败。
- 读到 `stage-transition.ts` 的既有测试照跑。
- 变异核对；独立审查。
- 全量：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate tender-stage-status-catch-up --strict`。

## Risks / Trade-offs

- **没有开关，合并即生效**：之后人确认推进到已到的阶段时，会真的改状态、发回调（以前什么也不发生）。这是人点了「确认推进」想要的结果。
- **只在人点的时候补**：没人点，状态就一直落后，直到下一次推进；推进到更靠后的阶段时状态会直接跳过去（中间那一次回调不补）。
- **与 #446 的关系**：#446 也改 `advanceProjectStage`，但改的是正常推进那一段；试合并没有冲突。

## Migration Plan

无数据迁移。回滚 = 回滚代码。

## Open Questions

无。
