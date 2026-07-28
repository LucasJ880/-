/**
 * Phase 5 handoff domain tests（不依赖共享 DB）
 * npx tsx src/lib/projects/handoff/__tests__/handoff-domain.test.ts
 */

import {
  buildHandoffIdempotencyKey,
  buildHandoffIdempotencyPlain,
  buildHandoffTaskBatchKey,
} from "../idempotency";
import { resolveHandoffContractAmount } from "../amount";
import { evaluateHandoffEligibility } from "../eligibility";
import {
  buildHandoffTaskPlan,
  inferConditionalFlagsFromProjectTypes,
  mergeConditionalFlags,
} from "../tasks";
import {
  canExecuteHandoff,
  canOverrideHandoff,
  canPreviewHandoff,
} from "../access";
import { resolveHandoffAfterUniqueConflict } from "../conflict";
import type { ProjectHandoff } from "@prisma/client";

let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

console.log("\nidempotency");
const k1 = buildHandoffIdempotencyKey({
  orgId: "org1",
  sourceTenderProjectId: "p1",
});
const k2 = buildHandoffIdempotencyKey({
  orgId: "org1",
  sourceTenderProjectId: "p1",
});
const k3 = buildHandoffIdempotencyKey({
  orgId: "org1",
  sourceTenderProjectId: "p2",
});
ok(k1 === k2, "同来源幂等键稳定");
ok(k1 !== k3, "不同来源幂等键不同");
ok(
  buildHandoffIdempotencyPlain({
    orgId: "org1",
    sourceTenderProjectId: "p1",
  }).startsWith("award-to-delivery:"),
  "明文业务键前缀",
);
ok(buildHandoffTaskBatchKey("h1") === "handoff:h1", "任务 batch key");

console.log("\namount");
ok(
  resolveHandoffContractAmount({
    winningBidPrice: 12000,
    ourBidPrice: 11000,
    currency: "CAD",
    awardDate: new Date(),
    tenderStatus: "won",
  }).confirmed,
  "winningBidPrice 可靠",
);
ok(
  !resolveHandoffContractAmount({
    winningBidPrice: null,
    ourBidPrice: 999,
    currency: "CAD",
    awardDate: new Date(),
    tenderStatus: "won",
  }).confirmed,
  "仅 ourBidPrice 不确认合同金额",
);

console.log("\neligibility");
const baseBid = {
  layerAvailable: true,
  hasRevisions: false,
  finalRevisionId: null,
  finalStatus: null,
  technicalApproved: null,
  financialApproved: null,
  locked: null,
  ready: false,
  message: null,
  failureCode: null as null | "BID_DATA_UNAVAILABLE" | "BID_DATA_INCOMPLETE",
};
ok(
  !evaluateHandoffEligibility({
    workDomain: "delivery",
    tenderStatus: "won",
    orgId: "o1",
    expectedOrgId: "o1",
    bidData: baseBid,
    existingHandoffStatus: null,
    useHistoricalOverride: true,
    canOverride: true,
    overrideReason: "ok",
  }).ok,
  "delivery 拒绝",
);
ok(
  !evaluateHandoffEligibility({
    workDomain: "tender",
    tenderStatus: "lost",
    orgId: "o1",
    expectedOrgId: "o1",
    bidData: baseBid,
    existingHandoffStatus: null,
    useHistoricalOverride: true,
    canOverride: true,
    overrideReason: "ok",
  }).ok,
  "非 won 拒绝",
);
ok(
  !evaluateHandoffEligibility({
    workDomain: "tender",
    tenderStatus: "won",
    orgId: "o1",
    expectedOrgId: "o2",
    bidData: baseBid,
    existingHandoffStatus: null,
    useHistoricalOverride: true,
    canOverride: true,
    overrideReason: "ok",
  }).ok,
  "跨组织拒绝",
);
ok(
  !evaluateHandoffEligibility({
    workDomain: "tender",
    tenderStatus: "won",
    orgId: "o1",
    expectedOrgId: "o1",
    bidData: baseBid,
    existingHandoffStatus: "completed",
    useHistoricalOverride: true,
    canOverride: true,
    overrideReason: "ok",
  }).ok,
  "已完成拒绝重复",
);
ok(
  !evaluateHandoffEligibility({
    workDomain: "tender",
    tenderStatus: "won",
    orgId: "o1",
    expectedOrgId: "o1",
    bidData: baseBid,
    existingHandoffStatus: null,
    useHistoricalOverride: false,
    canOverride: true,
    overrideReason: null,
  }).ok,
  "无 Bid Data 需 override",
);
ok(
  !evaluateHandoffEligibility({
    workDomain: "tender",
    tenderStatus: "won",
    orgId: "o1",
    expectedOrgId: "o1",
    bidData: baseBid,
    existingHandoffStatus: null,
    useHistoricalOverride: true,
    canOverride: false,
    overrideReason: "reason",
  }).ok,
  "普通用户不可 override",
);
ok(
  evaluateHandoffEligibility({
    workDomain: "tender",
    tenderStatus: "won",
    orgId: "o1",
    expectedOrgId: "o1",
    bidData: baseBid,
    existingHandoffStatus: null,
    useHistoricalOverride: true,
    canOverride: true,
    overrideReason: "历史中标无 Bid Data",
  }).ok,
  "管理层 override 可通过",
);
ok(
  evaluateHandoffEligibility({
    workDomain: "tender",
    tenderStatus: "won",
    orgId: "o1",
    expectedOrgId: "o1",
    bidData: {
      ...baseBid,
      hasRevisions: true,
      ready: true,
      finalRevisionId: "r1",
      technicalApproved: true,
      financialApproved: true,
      locked: true,
    },
    existingHandoffStatus: null,
    useHistoricalOverride: false,
    canOverride: false,
  }).ok,
  "完整 Bid Data 可通过",
);
ok(
  !evaluateHandoffEligibility({
    workDomain: "tender",
    tenderStatus: "won",
    orgId: "o1",
    expectedOrgId: "o1",
    bidData: {
      ...baseBid,
      hasRevisions: true,
      ready: false,
      message: "未锁定",
      technicalApproved: true,
      financialApproved: true,
      locked: false,
    },
    existingHandoffStatus: null,
    useHistoricalOverride: true,
    canOverride: true,
    overrideReason: "x",
  }).ok,
  "有 Revision 但未锁定拒绝（不可用历史 override 绕过）",
);

const unavailable = evaluateHandoffEligibility({
  workDomain: "tender",
  tenderStatus: "won",
  orgId: "o1",
  expectedOrgId: "o1",
  bidData: {
    ...baseBid,
    layerAvailable: false,
    failureCode: "BID_DATA_UNAVAILABLE",
    message: "Bid Data 表不可用",
  },
  existingHandoffStatus: null,
  useHistoricalOverride: false,
  canOverride: true,
  overrideReason: null,
});
ok(!unavailable.ok, "Bid Data 不可用默认拒绝");
ok(
  unavailable.blockers.some((b) => b.code === "BID_DATA_UNAVAILABLE"),
  "返回 BID_DATA_UNAVAILABLE 而非静默放行",
);
ok(
  evaluateHandoffEligibility({
    workDomain: "tender",
    tenderStatus: "won",
    orgId: "o1",
    expectedOrgId: "o1",
    bidData: {
      ...baseBid,
      layerAvailable: false,
      failureCode: "BID_DATA_UNAVAILABLE",
      message: "Bid Data 表不可用",
    },
    existingHandoffStatus: null,
    useHistoricalOverride: true,
    canOverride: true,
    overrideReason: "表不可用历史交接",
  }).ok,
  "管理层 override 可绕过 BID_DATA_UNAVAILABLE",
);

console.log("\nconflict recovery");
function stubHandoff(
  partial: Pick<ProjectHandoff, "id" | "status" | "targetDeliveryProjectId">,
): ProjectHandoff {
  return partial as ProjectHandoff;
}
ok(
  resolveHandoffAfterUniqueConflict(
    stubHandoff({
      id: "h1",
      status: "completed",
      targetDeliveryProjectId: "d1",
    }),
  ).kind === "completed",
  "P2002 后 completed 可恢复",
);
ok(
  resolveHandoffAfterUniqueConflict(
    stubHandoff({
      id: "h2",
      status: "processing",
      targetDeliveryProjectId: null,
    }),
  ).kind === "processing",
  "P2002 后 processing 可识别",
);
ok(
  resolveHandoffAfterUniqueConflict(
    stubHandoff({
      id: "h3",
      status: "failed",
      targetDeliveryProjectId: null,
    }),
  ).kind === "retryable",
  "P2002 后 failed 可重试",
);
ok(
  resolveHandoffAfterUniqueConflict(null).kind === "missing",
  "P2002 后无记录 → missing",
);

console.log("\ntasks");
const inferred = inferConditionalFlagsFromProjectTypes(["install", "china_sourcing"]);
ok(inferred.installation && inferred.procurement, "projectTypes 明确标签");
ok(
  !inferConditionalFlagsFromProjectTypes(["random_name"]).installation,
  "不用名称猜测安装",
);
const plan = buildHandoffTaskPlan(
  mergeConditionalFlags(inferred, { siteMeasurement: true }),
  { amountUnconfirmed: true, dateMissing: true },
);
ok(plan.baseTasks.length >= 4, "基础任务存在");
ok(
  plan.baseTasks.some((t) => t.templateKey === "confirm_contract_amount"),
  "未确认金额生成确认任务",
);
ok(
  plan.conditionalTasks.some((t) => t.templateKey === "site_measurement"),
  "条件任务仅在确认后生成",
);
ok(
  plan.conditionalTasks.some((t) => t.templateKey === "installation_window"),
  "安装条件任务",
);

console.log("\naccess");
ok(
  !canPreviewHandoff(
    { platformRole: "operations", userId: "u1" },
    { canReadTender: true },
  ),
  "普通 operations 不能仅凭角色预览",
);
ok(
  canPreviewHandoff(
    { platformRole: "admin", userId: "u1" },
    { canReadTender: true },
  ),
  "管理层可预览",
);
ok(
  !canExecuteHandoff(
    { platformRole: "user", userId: "u1" },
    { canManageTender: false },
  ),
  "裸 user 不可执行",
);
ok(
  canOverrideHandoff({ platformRole: "admin", userId: "u1" }),
  "管理层可 override",
);
ok(
  !canOverrideHandoff({ platformRole: "operations", userId: "u1" }),
  "普通 operations 不可 override",
);

console.log(`\n结果: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
