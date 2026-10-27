/**
 * PERM-2：审批人选择 / 批准人资格 / 设置审批 payload（纯函数）
 * 运行：npx tsx src/lib/sales/__tests__/quote-settings-approval.test.ts
 */
import { checkApproverEligibility, pickApprovalRecipients } from "../approvers";
import {
  buildQuoteSettingsApprovalPayload,
  describeQuoteSettingsPatch,
  quoteSettingsIdempotencyKey,
} from "../quote-settings-approval";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`); }
}

console.log("PERM-2 审批人选择");
const picked = pickApprovalRecipients({ holders: ["bob", "bill", "miki"], fallback: ["owner"], requesterId: "miki" });
ok(picked.join(",") === "bob,bill", "持有者排除提交人");
ok(pickApprovalRecipients({ holders: [], fallback: ["owner", "admin1"], requesterId: "x" }).join(",") === "owner,admin1", "无持有者 → 回退");
ok(pickApprovalRecipients({ holders: [], fallback: ["owner"], requesterId: "owner" }).length === 0, "回退集也排除提交人");
ok(pickApprovalRecipients({ holders: ["bob", "bob"], fallback: [], requesterId: "x" }).length === 1, "去重");

console.log("PERM-2 批准人资格");
const self = checkApproverEligibility({ approverId: "bob", requesterId: "bob", isPlatformSuperAdmin: false, hasPermission: true, enforcement: true });
ok(!self.ok && !!(self as { reason: string }).reason.includes("自己"), "提交人自批 → 拒绝");
const noPerm = checkApproverEligibility({ approverId: "x", requesterId: "bob", isPlatformSuperAdmin: false, hasPermission: false, enforcement: true });
ok(!noPerm.ok, "无权 → 拒绝（强校验）");
const transitional = checkApproverEligibility({ approverId: "x", requesterId: "bob", isPlatformSuperAdmin: false, hasPermission: false, enforcement: false });
ok(transitional.ok, "过渡态（企业无人持权）→ 只拒自批，无权放行");
const transitionalSelf = checkApproverEligibility({ approverId: "bob", requesterId: "bob", isPlatformSuperAdmin: false, hasPermission: false, enforcement: false });
ok(!transitionalSelf.ok, "过渡态仍拒自批");
const good = checkApproverEligibility({ approverId: "bill", requesterId: "bob", isPlatformSuperAdmin: false, hasPermission: true, enforcement: true });
ok(good.ok && !(good as { selfApproved: boolean }).selfApproved, "另一位持权者 → 通过");
const platformSelf = checkApproverEligibility({ approverId: "lucas", requesterId: "lucas", isPlatformSuperAdmin: true, hasPermission: false, enforcement: true });
ok(platformSelf.ok && (platformSelf as { selfApproved: boolean }).selfApproved, "super_admin 自批 → 通过且标 selfApproved");
const platformOther = checkApproverEligibility({ approverId: "lucas", requesterId: "bob", isPlatformSuperAdmin: true, hasPermission: false, enforcement: true });
ok(platformOther.ok && !(platformOther as { selfApproved: boolean }).selfApproved, "super_admin 批他人 → 通过不标自批");

console.log("PERM-2 设置审批 payload");
const p1 = buildQuoteSettingsApprovalPayload({
  orgId: "org1",
  requestedById: "bob",
  settingsVersion: 3,
  numericPatch: { zebra: 0.4 },
  depositOverrideCodeHash: "$2b$10$hashhashhash",
});
ok(!JSON.stringify(p1).includes("1234") && JSON.stringify(p1).includes("$2b$10$"), "payload 只含哈希不含明文");
ok(p1.resourceType === "quote_discount_settings" && p1.riskLevel === "CRITICAL" && p1.metadata.orgId === "org1", "payload 元信息");
const p2 = buildQuoteSettingsApprovalPayload({ orgId: "org1", requestedById: "bob", settingsVersion: 3, numericPatch: { zebra: 0.4 }, depositOverrideCodeHash: "$2b$10$hashhashhash" });
ok(quoteSettingsIdempotencyKey(p1) === quoteSettingsIdempotencyKey(p2), "同内容同版本 → 同一幂等键");
const p3 = buildQuoteSettingsApprovalPayload({ orgId: "org1", requestedById: "bob", settingsVersion: 4, numericPatch: { zebra: 0.4 }, depositOverrideCodeHash: "$2b$10$hashhashhash" });
ok(quoteSettingsIdempotencyKey(p1) !== quoteSettingsIdempotencyKey(p3), "版本变 → 键变");
const p4 = buildQuoteSettingsApprovalPayload({ orgId: "org1", requestedById: "bill", settingsVersion: 3, numericPatch: { zebra: 0.4 } });
ok(quoteSettingsIdempotencyKey(p1) !== quoteSettingsIdempotencyKey(p4), "内容 / 提交人不同 → 键不同");
ok(describeQuoteSettingsPatch(p1) === "zebra=0.4，更新定金解锁码", "审批中心描述不含码值");
ok(describeQuoteSettingsPatch(buildQuoteSettingsApprovalPayload({ orgId: "o", requestedById: "b", settingsVersion: 1, numericPatch: {}, lineDiscountUnlockCodeHash: null })) === "清空行折扣解锁码", "清空码描述");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
