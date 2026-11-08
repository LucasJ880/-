# Tasks

每条带验证；真实输出写进 `docs/QINGYAN_T-1_REPORT.md`。开工前先跑一遍 `tender-rfq` 与 `notifications` 下已注册测试记下基线通过数。

## 1. 类型与纯函数

- [x] 1.1 `constants.ts` 登记 `rfq_quote_received` / `rfq_reply_received` / `rfq_chase_ready` / `rfq_no_response` 与中文名，`delivery-gate.ts TYPE_INTRODUCED_AT` 四个都用 `9999-12-31T00:00:00Z`；先写 `src/lib/tender-rfq/__tests__/tracking-notify-pure.test.ts`（spec 文案表每行一例、文字规则、按段脱敏与 `isSensitiveText` 断言、四类去重键含「同一批卡顺序不同键相同」、催单待批合并与优先级、收件人组合、`INBOUND_MISSING_LABEL` 与 `hooks.ts` 表逐字相同），再写 `src/lib/tender-rfq/tracking-notify-pure.ts`；`collab-preferences.test.ts` 加四个类型的登记与哨兵断言；新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：两个测试全过，`bash scripts/check-test-registry.sh` 通过

## 2. 入站挂钩

- [x] 2.1 新增 `src/lib/tender-rfq/tracking-notify.ts`（补 orgId / 收件人、`actorId: null`，调 `deliverCollabNotification`；补上下文的查询失败只记日志）；`InboundSyncDeps` 加可选 `notifyTracking`，`syncOrgInbound` 在 `applyPlan` + `writeAudit` 成功后仅对 `quoted` / `replied` 调用并 `.catch`；`defaultInboundSyncDeps` 接上；`inbound-apply.test.ts` 加「quoted / replied 各调一次、解析失败 / 自己发出 / 未命中线程 / `none` 不调、`notifyTracking` 抛错时计数与审计不变」；verify：`npx tsx src/lib/tender-rfq/__tests__/inbound-apply.test.ts` 全过

## 3. 催单扫描挂钩

- [x] 3.1 `chase-service.ts`：`loadItems` select 加 `inquiry.roundNumber`、`inquiry.createdById`；`runForItems` opts 加可选 `onRoundDrafted`（本轮 `drafted` 非空时调用一次，带轮次 / 项目 / `days` / 每张卡的 `missingFields`），`onNoResponse` 加第三个上下文参数；`runChaseScan` 传两者（未响应先 Muse 再站内，各自 `try/catch`），`draftChasesForProject` 不传；先写 `src/lib/tender-rfq/__tests__/tracking-notify-wiring.test.ts` 的催单部分（源码断言）并注册进两个脚本；verify：wiring 测试全过，`npx tsx src/lib/tender-rfq/__tests__/chase-pure.test.ts` 与 `chase-execute.test.ts` 仍全过，`git diff --stat -- src/lib/tender-rfq/chase-pure.ts src/lib/muse-bridge` 为空

## 4. 跳转与首屏锚点

- [x] 4.1 `href.ts` 加 `tender_rfq_round` → `/projects/{projectId}?tab=bid#rfq-round-{entityId}`（缺 `projectId` 回落）；`web-entry-pure.ts` 加 `roundIdFromHash` 与 `initialExpandedRound`；`project-inquiry-section.tsx` 列表首次加载时按它们展开并滚动，锚点展开后待批 effect 不覆盖；`notification-href.test.ts` 与 `web-entry-pure.test.ts` 加用例，wiring 测试加「组件读 `location.hash` 并调用 `initialExpandedRound`」；verify：三个测试全过

## 5. 升级邮件与入站提醒

- [x] 5.1 `collab/escalation.ts ESCALATION_TYPES` 加 `rfq_chase_ready`；`INBOUND_NOTIFICATION_CATEGORY` 改 `"tender_rfq"`，`notifyFailed` 入参加 `inquiryId` 并改 `entityType: "tender_rfq_round"` / `entityId`，标题、摘要、优先级、`sourceKey` 不变；`collab-email-escalation.test.ts` 加「`rfq_chase_ready` 满 15 分钟未读进候选并发信、`rfq_quote_received` 不进候选、主题为 `【青砚】催单待批 · 项目「…」第 n 轮询价`、链接指向 `?tab=bid#rfq-round-`、正文无金额」；wiring 测试加两条提醒的类别 / 对象 / `sourceKey` 断言；verify：两个测试全过

## 6. 门禁与审查

- [ ] 6.1 全量门禁：`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate rfq-tracking-notify --strict`；再跑一遍开工前的基线测试对比通过数；交一个只拿任务书 + diff 的独立审查，应修项全部修正后复核；verify：以上命令全部 exit 0，审查结论与处理记入报告

## 7. 报告与 TASKFLOW

- [ ] 7.1 写 `docs/QINGYAN_T-1_REPORT.md`（交付、门禁输出、与任务书的偏差 D5 / D11、已知局限：Muse 旁路双通知 / 同页 hash 不重展开、staging 步骤）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：新增 Phase T 表（T-1 `[G]`、T-2 `[ ]`）；verify：报告存在，`grep -n "^| T-1 " docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行且状态为 `[G]`

## Workflow follow-up

- 审核通过后 `/opsx:apply rfq-tracking-notify`；PR 合并后 `/opsx:archive rfq-tracking-notify --yes`（独立小 PR），TASKFLOW T-1 → `[x]（#PR）`。
- T-2 `rfq-tracker` 另开 change，等本 change 合并后再 propose。
