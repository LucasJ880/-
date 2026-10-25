/**
 * 微信「回数字确认」的候选范围：只取白名单类型（给买家 / 供应商发邮件等对外动作不进数字批次；内部备注只取写内部可见目标的）；
 * 只取当前组织（或无组织的个人旧动作）。
 * 纯函数（Prisma where 结构），无 DB；真实库上的行为见 owner-today-db.isolated.test.ts、wechat-binding-confirm-db.isolated.test.ts。
 * 分类本身见 wechat-confirm-policy.test.ts。
 * 运行：npx tsx src/lib/ai-grader/actions/__tests__/wechat-confirm-scope.test.ts
 */
import assert from "node:assert/strict";
import { weChatConfirmableActionWhere, weChatPendingActionWhere, weChatWebOnlyPendingWhere } from "../wechat-confirm";
import { WECHAT_CONFIRMABLE_ACTION_TYPES } from "../wechat-confirm-policy";
import { INQUIRY_REPLY_ACTION_TYPE } from "@/lib/revenue-spine/fde/inbound-sales";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

console.log("wechat-confirm scope");
const NOW = new Date("2026-10-24T02:00:00Z");

ok("询盘回复草稿（含无回复跟进，同一类型）不在白名单", () => {
  assert.ok(!(WECHAT_CONFIRMABLE_ACTION_TYPES as readonly string[]).includes(INQUIRY_REPLY_ACTION_TYPE));
});

const NOTE_TARGETS_OR = ["OPPORTUNITY", "CUSTOMER", "PROJECT"].map((t) => ({ payload: { path: ["targetType"], equals: t } }));

ok("可确认条件：白名单类型（in，而非 notIn；内部备注除外）或 内部备注且 payload.targetType 在内部目标白名单（不含 QUOTE）", () => {
  const c = weChatConfirmableActionWhere();
  assert.deepEqual(c, {
    OR: [
      { type: { in: WECHAT_CONFIRMABLE_ACTION_TYPES.filter((t) => t !== "grader.internal_note") } },
      { type: "grader.internal_note", OR: NOTE_TARGETS_OR },
    ],
  });
  assert.ok(!JSON.stringify(c).includes("QUOTE"));
  assert.ok(!JSON.stringify(c).includes(INQUIRY_REPLY_ACTION_TYPE));
});

ok("有当前组织：本人创建、待处理、未过期、可确认、组织 = 当前组织或无组织", () => {
  const w = weChatPendingActionWhere("u1", "org_a", NOW);
  assert.equal(w.createdById, "u1");
  assert.equal(w.status, "pending");
  assert.deepEqual(w.expiresAt, { gt: NOW });
  assert.equal(w.type, undefined, "不再用顶层 type 条件");
  assert.deepEqual(w.AND, [{ OR: [{ orgId: "org_a" }, { orgId: null }] }, weChatConfirmableActionWhere()]);
});

ok("没有组织上下文：只取无组织的个人动作（不会跨组织取到别家的草稿）", () => {
  const w = weChatPendingActionWhere("u1", null, NOW);
  assert.deepEqual(w.AND, [{ OR: [{ orgId: null }] }, weChatConfirmableActionWhere()]);
});

ok("提示计数范围：可确认条件取反（含写报价备注的内部备注）、本人发起或指定本人审批、组织范围与批次一致", () => {
  const w = weChatWebOnlyPendingWhere("u1", "org_a", NOW);
  assert.equal(w.status, "pending");
  assert.deepEqual(w.expiresAt, { gt: NOW });
  assert.deepEqual(w.NOT, weChatConfirmableActionWhere());
  assert.deepEqual(w.AND, [
    { OR: [{ orgId: "org_a" }, { orgId: null }] },
    { OR: [{ createdById: "u1" }, { approverUserId: "u1" }] },
  ]);
  assert.deepEqual((weChatWebOnlyPendingWhere("u1", null, NOW).AND as unknown[])[0], { OR: [{ orgId: null }] });
});

console.log(`  ${pass} passed`);
