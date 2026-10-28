/**
 * INSTALL-2b：应收尾款口径 / 确认入参校验 / 差额说明 / 记录解析 / 销售首页合计 / 通知落点
 * 运行：npx tsx src/lib/install/__tests__/balance.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  balanceMismatch,
  installNotificationHref,
  isAwaitingBalance,
  parseBalanceRecord,
  quoteBalanceDue,
  sumBalanceDue,
  todayInTimeZone,
  validateBalanceConfirm,
} from "../balance";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

console.log("INSTALL-2b 应收尾款口径");
ok(quoteBalanceDue({ grandTotal: 5000, agreedBalanceAmount: 2500, depositAmount: 1500 }) === 2500, "有约定尾款 → 取约定尾款 2500");
ok(quoteBalanceDue({ grandTotal: 5000, agreedBalanceAmount: null, depositAmount: 1500 }) === 3500, "无约定尾款 → 5000 − 已登记定金 1500 = 3500");
ok(quoteBalanceDue({ grandTotal: 5000, agreedBalanceAmount: null, depositAmount: null }) === 5000, "未登记定金按 0 → 5000");
ok(quoteBalanceDue({ grandTotal: 1000, agreedBalanceAmount: null, depositAmount: 1200 }) === 0, "定金超过总价 → 不小于 0");
ok(quoteBalanceDue(null) === null, "手工单（无关联报价）→ null");
ok(quoteBalanceDue({ grandTotal: 1000.005, agreedBalanceAmount: null, depositAmount: 0.001 }) === 1000, "两位小数取整：1000.005 − 0.001 → 1000");

console.log("INSTALL-2b 确认入参校验");
const today = "2026-10-28";
const v = (raw: Record<string, unknown>, expected: number | null = 2500) => validateBalanceConfirm(raw, { expected, today });
const good = v({ amount: 2500, method: "visa", receivedAt: today, note: "" });
ok(good.ok && good.value.amount === 2500 && good.value.method === "visa" && !good.mismatch, "实收 = 应收、visa、今天 → 通过");
ok(v({ amount: "2500.00", method: "cash", receivedAt: "2026-10-01" }).ok, "金额字符串、之前的日期 → 通过");
for (const [raw, name] of [
  [{ amount: 0, method: "visa", receivedAt: today }, "金额 0"],
  [{ amount: -5, method: "visa", receivedAt: today }, "金额为负"],
  [{ amount: 12.345, method: "visa", receivedAt: today }, "三位小数"],
  [{ amount: "abc", method: "visa", receivedAt: today }, "金额非数字"],
  [{ amount: 2500, method: "mastercard", receivedAt: today }, "方式 mastercard"],
  [{ amount: 2500, method: "etransfer", receivedAt: today }, "方式 etransfer（已下线）"],
  [{ amount: 2500, method: "visa", receivedAt: "2026-10-29" }, "收款日期是明天"],
  [{ amount: 2500, method: "visa", receivedAt: "2026-02-30" }, "不存在的日期"],
  [{ amount: 2500, method: "visa", receivedAt: "10/28/2026" }, "日期格式错误"],
  [{ amount: 2500, method: "visa", receivedAt: today, note: "x".repeat(501) }, "备注超过 500 字"],
] as Array<[Record<string, unknown>, string]>) {
  const r = v(raw);
  ok(!r.ok && r.code === "INVALID", `非法：${name} → INVALID`, r);
}
ok(!validateBalanceConfirm(null, { expected: null, today }).ok, "空请求体 → 拒绝");

console.log("INSTALL-2b 差额必须说明");
const short = v({ amount: 2400, method: "visa", receivedAt: today, note: "  " });
ok(!short.ok && short.code === "NOTE_REQUIRED", "应收 2500、实收 2400、备注为空 → NOTE_REQUIRED", short);
const shortNoted = v({ amount: 2400, method: "visa", receivedAt: today, note: "客户扣 100 作为划痕补偿" });
ok(shortNoted.ok && shortNoted.mismatch && shortNoted.value.note === "客户扣 100 作为划痕补偿", "带说明 → 通过，标记有差额");
ok(!balanceMismatch(2500, 2500) && balanceMismatch(2500, 2499.99) && !balanceMismatch(null, 1), "差额判定：相等 / 差 0.01 / 无应收");
ok(v({ amount: 1800, method: "check", receivedAt: today }, null).ok, "手工单（应收为空）不比较差额");

console.log("INSTALL-2b 确认记录解析");
const rec = parseBalanceRecord({
  afterData: JSON.stringify({ quoteId: "q1", expected: 2500, received: 2400, method: "visa", receivedAt: today, note: "扣 100", byUserId: "miki" }),
  createdAt: "2026-10-28T15:00:00Z",
  userId: "miki",
});
ok(rec?.quoteId === "q1" && rec.expected === 2500 && rec.received === 2400 && rec.confirmedAt === "2026-10-28T15:00:00.000Z", "解析完整记录");
ok(parseBalanceRecord({ afterData: "{bad", createdAt: new Date(), userId: "x" }) === null && parseBalanceRecord({ afterData: JSON.stringify({ expected: 1 }), createdAt: new Date(), userId: "x" }) === null, "坏 JSON / 缺实收 → null");

console.log("INSTALL-2b 销售首页待收尾款");
const quotes = [
  { id: "qa", grandTotal: 3000, agreedBalanceAmount: 1000, depositAmount: 2000 },
  { id: "qb", grandTotal: 3000, agreedBalanceAmount: 1000, depositAmount: 2000 },
  { id: "qc", grandTotal: 1500, agreedBalanceAmount: null, depositAmount: 500 },
];
ok(sumBalanceDue(quotes, new Set()) === 3000, "逐单求和：1000 + 1000 + (1500 − 500)");
ok(sumBalanceDue(quotes.slice(0, 2), new Set(["qb"])) === 1000, "两张各 1000、一张已确认 → 1000");

console.log("INSTALL-2b 通知落点");
ok(installNotificationHref({ type: "install_completed", entityType: "install_balance", entityId: "ord 1" }) === "/accounting?tab=balance&order=ord%201", "会计：install_balance → /accounting?tab=balance&order=<id>");
ok(installNotificationHref({ type: "install_completed", entityType: "blinds_order", entityId: "o2" }) === "/blinds-orders/o2", "销售：install_completed + blinds_order → 工艺单详情");
ok(installNotificationHref({ type: "install_balance_confirmed", entityType: "blinds_order", entityId: "o3" }) === "/blinds-orders/o3", "销售：尾款已确认 → 工艺单详情");
ok(installNotificationHref({ type: "process_order_generated", entityType: "blinds_order", entityId: "o4" }) === null, "其他类型 → null（走既有分支）");
// INSTALL-2c：质保邮件通知
ok(installNotificationHref({ type: "install_warranty_sent", entityType: "blinds_order", entityId: "o5" }) === "/blinds-orders/o5", "质保邮件已发出（销售）→ 工艺单详情");
ok(installNotificationHref({ type: "install_warranty_failed", entityType: "install_balance", entityId: "o6" }) === "/accounting?tab=balance&order=o6", "质保邮件未发出（批准人）→ 会计待收尾款页签");
ok(installNotificationHref({ type: "install_completed", entityType: "install_balance", entityId: null }) === null, "无实体 id → null");
// INSTALL-2d：维修单通知
ok(installNotificationHref({ type: "install_repair_submitted", entityType: "install_repair", entityId: "rep 1" }) === "/install/repairs/rep%201", "出单 / 运营 / 会计：install_repair → 维修单详情");
ok(installNotificationHref({ type: "install_repair_submitted", entityType: "blinds_order", entityId: "o7" }) === "/blinds-orders/o7", "销售：维修单已提交 + blinds_order → 工艺单详情状态卡");
{
  // 头部通知下拉与通知页必须都先调同一个落点函数（spec「通知落点」：两处同一规则）
  const root = path.resolve(__dirname, "../../../..");
  for (const rel of ["src/components/header.tsx", "src/app/(main)/notifications/page.tsx"]) {
    const src = readFileSync(path.join(root, rel), "utf8");
    ok(/installNotificationHref\(/.test(src) && /from "@\/lib\/install\/balance"/.test(src), `${rel} 调用 installNotificationHref`);
  }
}

console.log("INSTALL-2b 待收尾款判定（任务书 §12 Q11）");
{
  const closed = new Set(["appt-sys"]);
  const none = { confirmed: false, closedOutAppointmentIds: closed };
  ok(isAwaitingBalance({ status: "installed", appointmentId: null }, none), "已安装、未确认 → 待收尾款");
  ok(isAwaitingBalance({ status: "completed", appointmentId: "appt-sys" }, none), "已完工、当前预约有完成收口记录 → 待收尾款");
  ok(!isAwaitingBalance({ status: "completed", appointmentId: "appt-legacy" }, none), "已完工、当前预约无收口记录（历史手工完工）→ 不算");
  ok(!isAwaitingBalance({ status: "completed", appointmentId: null }, none), "已完工、没有安装预约 → 不算");
  ok(!isAwaitingBalance({ status: "installed", appointmentId: null }, { ...none, confirmed: true }), "已确认 → 不算");
  ok(!isAwaitingBalance({ status: "scheduled", appointmentId: "appt-sys" }, none), "已排期 → 不算");
}

console.log("INSTALL-2b 时区当天");
ok(todayInTimeZone("America/Toronto", new Date("2026-10-29T02:00:00Z")) === "2026-10-28", "多伦多 10/29 02:00Z 仍是 10/28");
ok(/^\d{4}-\d{2}-\d{2}$/.test(todayInTimeZone("Not/AZone")), "非法时区 → 回退 UTC 日期");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
