/**
 * 微信「回数字确认」的候选范围：给买家发邮件的询盘回复草稿不进数字批次；只取当前组织（或无组织的个人旧动作）。
 * 纯函数（Prisma where 结构），无 DB；真实库上的行为见 owner-today-db.isolated.test.ts。
 * 运行：npx tsx src/lib/ai-grader/actions/__tests__/wechat-confirm-scope.test.ts
 */
import assert from "node:assert/strict";
import { WECHAT_EXCLUDED_ACTION_TYPES, weChatPendingActionWhere } from "../wechat-confirm";
import { INQUIRY_REPLY_ACTION_TYPE } from "@/lib/revenue-spine/fde/inbound-sales";

let pass = 0;
function ok(name: string, fn: () => void) {
  fn();
  pass++;
  console.log(`  ✓ ${name}`);
}

console.log("wechat-confirm scope");
const NOW = new Date("2026-10-24T02:00:00Z");

ok("排除的类型就是询盘回复草稿（含无回复跟进，同一类型）", () => {
  assert.ok((WECHAT_EXCLUDED_ACTION_TYPES as readonly string[]).includes(INQUIRY_REPLY_ACTION_TYPE));
});

ok("有当前组织：本人创建、待处理、未过期、类型不在排除表、组织 = 当前组织或无组织", () => {
  const w = weChatPendingActionWhere("u1", "org_a", NOW);
  assert.equal(w.createdById, "u1");
  assert.equal(w.status, "pending");
  assert.deepEqual(w.expiresAt, { gt: NOW });
  assert.deepEqual(w.type, { notIn: [INQUIRY_REPLY_ACTION_TYPE] });
  assert.deepEqual(w.OR, [{ orgId: "org_a" }, { orgId: null }]);
});

ok("没有组织上下文：只取无组织的个人动作（不会跨组织取到别家的草稿）", () => {
  const w = weChatPendingActionWhere("u1", null, NOW);
  assert.deepEqual(w.OR, [{ orgId: null }]);
  assert.deepEqual(w.type, { notIn: [INQUIRY_REPLY_ACTION_TYPE] });
});

console.log(`  ${pass} passed`);
