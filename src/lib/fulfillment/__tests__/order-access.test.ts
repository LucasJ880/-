/**
 * PERM-3：工艺单访问判定（纯函数）
 * 运行：npx tsx src/lib/fulfillment/__tests__/order-access.test.ts
 */
import { canEditOrder, isPlainTransition, missingCategories, pickOrderOrgId, responsiblePositions } from "../order-access";

let pass = 0, fail = 0;
function ok(c: boolean, n: string) { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`); } }

const V = "orders.fulfillment.update.vinyl", D = "orders.fulfillment.update.drapery", S = "orders.fulfillment.update.shades", U = "orders.fulfillment.update";

console.log("PERM-3 canEditOrder 决策表");
ok(canEditOrder({ categories: ["shades"], heldKeys: [S] }).allowed, "shades 岗改 {shades} → 允许");
const d1 = canEditOrder({ categories: ["shades"], heldKeys: [V] });
ok(!d1.allowed && missingCategories(d1).join(",") === "shades", "vinyl 岗改 {shades} → 403，缺 shades");
ok(canEditOrder({ categories: ["shades"], heldKeys: [D] }).allowed === false, "drapery 岗改 {shades} → 403");
const d2 = canEditOrder({ categories: ["vinyl", "shades"], heldKeys: [V] });
ok(!d2.allowed && missingCategories(d2).join(",") === "shades", "混品类 {vinyl,shades} 只持 vinyl → 缺 shades（要求全部品类）");
ok(canEditOrder({ categories: ["vinyl", "shades"], heldKeys: [V, S] }).allowed, "混品类两键都有 → 允许");
const u = canEditOrder({ categories: ["vinyl", "drapery", "shades"], heldKeys: [U] });
ok(u.allowed && u.via === "umbrella", "伞键 → 任意品类允许");
const e = canEditOrder({ categories: [], heldKeys: [V, D, S] });
ok(!e.allowed && e.reason === "EMPTY_CATEGORIES", "空品类集合：三把品类键也不行");
ok(canEditOrder({ categories: [], heldKeys: [U] }).allowed, "空品类集合：伞键可以");
ok(canEditOrder({ categories: ["shades"], heldKeys: [] , isPlatformAdmin: true }).via === "platform_admin", "平台管理员 → 允许");
ok(canEditOrder({ categories: ["shades"], heldKeys: [] }).allowed === false, "无任何键 → 403");
ok(responsiblePositions(["shades", "vinyl"]).join("、") === "出单·Roller/Zebra/Roman、出单·Vinyl", "负责岗位名");

console.log("PERM-3 企业归属推导");
ok(pickOrderOrgId({ customerOrgId: "A", projectOrgId: "B", creatorOrgIds: ["C"] }) === "A", "客户企业优先");
ok(pickOrderOrgId({ customerOrgId: null, projectOrgId: "B", creatorOrgIds: ["C"] }) === "B", "无客户 → 项目企业");
ok(pickOrderOrgId({ creatorOrgIds: ["C"] }) === "C", "无客户无项目 → 创建人唯一企业");
ok(pickOrderOrgId({ creatorOrgIds: ["C", "D"] }) === null && pickOrderOrgId({ creatorOrgIds: [] }) === null, "创建人多企业 / 无企业 → null");

console.log("PERM-3 普通推进");
ok(isPlainTransition("draft", "confirmed") && isPlainTransition("confirmed", "draft") && isPlainTransition("scheduled", "installed"), "draft→confirmed、confirmed→draft 退回、scheduled→installed");
ok(!isPlainTransition("confirmed", "scheduled") && !isPlainTransition("confirmed", "cancelled") && !isPlainTransition("installed", "draft"), "scheduled / cancelled 不走普通推进；installed 不能退回 draft");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
