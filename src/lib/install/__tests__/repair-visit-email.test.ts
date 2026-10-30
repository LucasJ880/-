/**
 * INSTALL-2j：返修时间确认邮件——渲染（首次 / 改期主题、企业时区日期与到达时间段、英文问题说明、联系方式、HTML 同内容、
 * 同输入同输出）、不出内部信息、生成条件
 * 运行：npx tsx src/lib/install/__tests__/repair-visit-email.test.ts
 */
import { ISSUE_TYPES } from "../repair";
import {
  formatVisitDate,
  formatVisitTime,
  ISSUE_TYPE_LABEL_EN,
  renderRepairVisitEmail,
  repairVisitEmailBlockers,
  type RepairVisitEmailInput,
} from "../repair-visit-email";
import { seedWarrantySettings } from "../warranty";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

const contact = seedWarrantySettings().contact;
const base: RepairVisitEmailInput = {
  repairNo: "R-SUN-1024-1",
  orderCode: "SUN-1024",
  customerName: "Example Homeowner",
  address: "6 Example Ct, Toronto",
  // 多伦多 2026-11-05 10:00–12:00（11 月 1 日起为 EST，UTC-5）
  startAt: "2026-11-05T15:00:00.000Z",
  endAt: "2026-11-05T17:00:00.000Z",
  timeZone: "America/Toronto",
  rows: [
    { location: "Kitchen", itemNumber: 3, issueType: "missing_parts" },
    { location: "Den", itemNumber: 2, issueType: "wrong_size" },
  ],
  contact,
  rescheduled: false,
};

console.log("INSTALL-2j 日期 / 时间（企业时区）");
ok(formatVisitDate(base.startAt, "America/Toronto") === "Thursday, November 5, 2026", "长日期", formatVisitDate(base.startAt, "America/Toronto"));
ok(formatVisitTime(base.startAt, "America/Toronto") === "10:00 AM" && formatVisitTime(base.endAt, "America/Toronto") === "12:00 PM", "12 小时制、普通空格");
ok(formatVisitDate("2026-11-06T03:30:00.000Z", "America/Toronto") === "Thursday, November 5, 2026", "UTC 已是次日、企业时区仍是当天");

console.log("INSTALL-2j 邮件内容");
const mail = renderRepairVisitEmail(base);
ok(mail.subject === "Your repair visit is scheduled — Thursday, November 5, 2026 (Repair R-SUN-1024-1)", "首次排期主题", mail.subject);
ok(mail.text.includes("Arrival:     10:00 AM – 12:00 PM") && mail.text.includes("Address:     6 Example Ct, Toronto"), "到达时间段与地址");
ok(mail.text.includes("Repair No.:  R-SUN-1024-1") && mail.text.includes("Order No.:   SUN-1024") && mail.text.startsWith("Hi Example Homeowner,"), "单号 / 工艺单号 / 客户名");
ok(mail.text.indexOf("1. Den — Size adjustment / remake") > 0 && mail.text.indexOf("2. Kitchen — Missing parts") > mail.text.indexOf("1. Den"), "各行按序号：位置 + 英文问题说明");
ok(mail.text.includes("call 647-857-8669 or email service@sunnyshutter.ca"), "改期请联系的报修电话与邮箱");
ok(mail.html.startsWith("<!doctype html>") && mail.html.includes("10:00 AM – 12:00 PM") && mail.html.includes("Den — Size adjustment / remake") && mail.html.includes("Repair visit confirmation"), "HTML 同内容");
const again = renderRepairVisitEmail({ ...base, rows: [...base.rows].reverse() });
ok(again.text === mail.text && again.html === mail.html, "同样输入 → 完全相同（行按序号）");
const re = renderRepairVisitEmail({ ...base, rescheduled: true });
ok(re.subject === "Your repair visit has been rescheduled — Thursday, November 5, 2026 (Repair R-SUN-1024-1)" && re.text.includes("has been rescheduled. Here are the new details") && re.html.includes("Repair visit rescheduled"), "改期主题与开头");
ok(renderRepairVisitEmail({ ...base, address: null, rows: [{ location: "", itemNumber: 4, issueType: "other" }] }).text.includes("Address:     —") && renderRepairVisitEmail({ ...base, rows: [{ location: "", itemNumber: 4, issueType: "other" }] }).text.includes("1. Item 4 — Adjustment"), "无地址 → —；无位置 → Item 序号");
ok(ISSUE_TYPES.every((t) => !!ISSUE_TYPE_LABEL_EN[t]) && !Object.values(ISSUE_TYPE_LABEL_EN).some((s) => /[一-鿿]|customer/i.test(s)), "每种问题类型都有英文说明，且不带中文 / 客户归因");
const xss = renderRepairVisitEmail({ ...base, customerName: "<script>alert(1)</script>" });
ok(!xss.html.includes("<script>alert") && xss.html.includes("&lt;script&gt;"), "HTML 转义客户输入");

console.log("INSTALL-2j 不输出的内容");
// 维修单的内部字段不在渲染入参里——这里确认邮件不出现金额 / 照片 / 中文标签 / 员工名
for (const part of [mail.subject, mail.text, mail.html, re.text]) {
  ok(!/\$|CAD|proxy|\/api\/files|小李|客户原因|尺寸不符|备注/.test(part), "不含金额、照片地址、员工名、中文问题标签、备注", part.slice(0, 60));
}

console.log("INSTALL-2j 生成条件");
ok(repairVisitEmailBlockers({ customerEmail: "home@fixture.test", contact }).length === 0, "资料齐全 → 无阻断");
const b = repairVisitEmailBlockers({ customerEmail: "", contact: { ...contact, phone: "", email: "" } });
ok(b.includes("客户没有邮箱") && b.includes("缺报修电话") && b.includes("缺报修邮箱"), "全部原因一起返回", b);
ok(repairVisitEmailBlockers({ customerEmail: "not-an-email", contact }).some((x) => x.startsWith("客户邮箱格式不对")), "客户邮箱格式不对");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
