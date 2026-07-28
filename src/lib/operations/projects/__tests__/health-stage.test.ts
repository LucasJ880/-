/**
 * Phase 4：交付阶段 + 健康度规则
 * 运行：npx tsx src/lib/operations/projects/__tests__/health-stage.test.ts
 */

import assert from "node:assert/strict";
import {
  canTransitionDeliveryStage,
  isDeliveryStageActive,
  isDeliveryStageComplete,
  normalizeDeliveryStage,
} from "../stage";
import { computeDeliveryHealth } from "../health";
import {
  assertProjectWorkDomain,
  isDeliveryProject,
  isGeneralProject,
  isTenderProject,
  normalizeProjectWorkDomain,
} from "@/lib/projects/work-domain";
import { canTransitionDeliveryStage as _alias } from "../stage";

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

function section(title: string) {
  console.log(`\n${title}`);
}

section("workDomain");
ok(normalizeProjectWorkDomain("TENDER") === "tender", "normalize tender");
ok(normalizeProjectWorkDomain("bogus") === null, "非法 workDomain → null");
ok(isTenderProject("tender"), "isTender");
ok(isDeliveryProject("delivery"), "isDelivery");
ok(isGeneralProject("general"), "isGeneral");
ok(!isDeliveryProject("tender"), "tender 不是 delivery");
try {
  assertProjectWorkDomain("xyz");
  ok(false, "非法 assert 应抛错");
} catch {
  ok(true, "非法 assert 抛错");
}

section("deliveryStage");
ok(normalizeDeliveryStage("Site_Measurement") === "site_measurement", "normalize stage");
ok(normalizeDeliveryStage("nope") === null, "非法 stage → null");
ok(isDeliveryStageComplete("completed"), "completed");
ok(!isDeliveryStageComplete("on_hold"), "on_hold 不是完成");
ok(isDeliveryStageActive("on_hold"), "on_hold 仍活跃");
ok(!isDeliveryStageActive("cancelled"), "cancelled 非活跃");
ok(!isDeliveryStageActive("completed"), "completed 非活跃");

const skipOk = canTransitionDeliveryStage({
  from: "handoff",
  to: "procurement",
});
ok(skipOk.ok, "允许跳过阶段");

const reopenDenied = canTransitionDeliveryStage({
  from: "completed",
  to: "installation",
  allowReopenCompleted: false,
});
ok(!reopenDenied.ok, "completed 恢复需高级权限");

const reopenOk = canTransitionDeliveryStage({
  from: "completed",
  to: "installation",
  allowReopenCompleted: true,
});
ok(reopenOk.ok, "高级权限可从 completed 恢复");

section("health priority");
const now = new Date("2026-07-13T12:00:00Z");

ok(
  computeDeliveryHealth({
    deliveryStage: "completed",
    ownerId: "u1",
    plannedCompletionDate: new Date("2026-08-01"),
    openTasks: [{ status: "blocked" }],
    now,
  }).status === "completed",
  "completed 优先于 blocked",
);

ok(
  computeDeliveryHealth({
    deliveryStage: "on_hold",
    ownerId: "u1",
    plannedCompletionDate: new Date("2026-08-01"),
    openTasks: [],
    now,
  }).status === "blocked",
  "on_hold → blocked",
);

ok(
  computeDeliveryHealth({
    deliveryStage: "procurement",
    ownerId: "u1",
    plannedCompletionDate: new Date("2026-08-01"),
    openTasks: [{ status: "blocked" }],
    now,
  }).status === "blocked",
  "BLOCKED Task → blocked",
);

ok(
  computeDeliveryHealth({
    deliveryStage: "procurement",
    ownerId: "u1",
    plannedCompletionDate: new Date("2026-07-01"),
    openTasks: [],
    now,
  }).status === "at_risk",
  "计划完成已过 → at_risk",
);

ok(
  computeDeliveryHealth({
    deliveryStage: "procurement",
    ownerId: "u1",
    plannedCompletionDate: new Date("2026-08-01"),
    openTasks: [{ status: "todo", dueDate: new Date("2026-07-01") }],
    now,
  }).status === "at_risk",
  "逾期任务 → at_risk",
);

ok(
  computeDeliveryHealth({
    deliveryStage: "procurement",
    ownerId: "u1",
    plannedCompletionDate: new Date("2026-08-01"),
    openTasks: [
      {
        status: "waiting_external",
        waitingUntil: new Date("2026-07-01T00:00:00Z"),
      },
    ],
    now,
  }).status === "at_risk",
  "waitingUntil 已到期 → at_risk",
);

ok(
  computeDeliveryHealth({
    deliveryStage: "procurement",
    ownerId: null,
    plannedCompletionDate: new Date("2026-08-01"),
    openTasks: [],
    updatedAt: now,
    now,
  }).status === "attention",
  "无负责人 → attention",
);

ok(
  computeDeliveryHealth({
    deliveryStage: "procurement",
    ownerId: "u1",
    plannedCompletionDate: new Date("2026-08-01"),
    openTasks: [
      {
        status: "waiting_internal",
        waitingUntil: new Date("2026-08-01T00:00:00Z"),
      },
    ],
    updatedAt: now,
    now,
  }).status === "attention",
  "未到期 waiting → attention",
);

ok(
  computeDeliveryHealth({
    deliveryStage: "procurement",
    ownerId: "u1",
    plannedCompletionDate: new Date("2026-08-01"),
    openTasks: [{ status: "todo", dueDate: new Date("2026-08-10") }],
    updatedAt: now,
    now,
  }).status === "healthy",
  "无异常 → healthy",
);

ok(
  computeDeliveryHealth({
    deliveryStage: "cancelled",
    ownerId: "u1",
    now,
  }).status !== "completed",
  "cancelled 不映射为 completed 健康度",
);

void _alias;
void assert;

console.log(`\n结果: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
