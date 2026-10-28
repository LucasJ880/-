/**
 * INSTALL-2d：问题类型表 / 标记问题入参 / 维修单表头 / 目标日 / 单号 / 记录解析 / 品类 / 打印补行
 * 运行：npx tsx src/lib/install/__tests__/repair.test.ts
 */
import {
  addDays,
  ISSUE_TYPE_LABEL,
  ISSUE_TYPES,
  isRepairOverdue,
  needsFactoryFor,
  padPrintRows,
  parseRepairRecord,
  repairFactoryCategories,
  repairNumber,
  repairTargetDate,
  validateIssueInput,
  validateRepairHeader,
} from "../repair";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

console.log("INSTALL-2d 问题类型表");
ok(ISSUE_TYPES.length === 8 && ISSUE_TYPES.every((t) => !!ISSUE_TYPE_LABEL[t]), "8 种类型都有中文名");
ok(needsFactoryFor("wrong_size") && needsFactoryFor("missing_parts") && needsFactoryFor("damaged") && needsFactoryFor("wrong_color") && needsFactoryFor("motor"), "尺寸 / 部件 / 损坏 / 颜色 / 电机 → 需工厂");
ok(!needsFactoryFor("site_condition") && !needsFactoryFor("customer"), "现场条件 / 客户原因 → 不需工厂");
ok(needsFactoryFor("other") === true && needsFactoryFor("other", null) === true, "其他且未选 → 需工厂");
ok(needsFactoryFor("other", false) === false, "其他且安装工选不需 → 不需工厂");
ok(needsFactoryFor("customer", true) === false, "非其他类型忽略安装工选择（查表）");

console.log("INSTALL-2d 标记问题入参");
{
  const r = validateIssueInput({ issueType: "wrong_size", description: "  高度短 2cm  " });
  ok(r.ok && r.value.description === "高度短 2cm" && r.value.needsFactory === true, "合法：去空白、需工厂", r);
  const o = validateIssueInput({ issueType: "other", description: "x", needsFactory: "false" });
  ok(o.ok && o.value.needsFactory === false, "其他 + needsFactory=false（表单字符串）→ 不需工厂", o);
  ok(!validateIssueInput({ issueType: "broken", description: "x" }).ok, "类型不在表内 → 拒绝");
  ok(!validateIssueInput({ issueType: "damaged", description: "   " }).ok, "描述为空 → 拒绝");
  ok(!validateIssueInput({ issueType: "damaged", description: "x".repeat(301) }).ok, "描述超过 300 字 → 拒绝");
}

console.log("INSTALL-2d 目标日 / 单号 / 逾期");
ok(addDays("2026-10-28", 7) === "2026-11-04", "10-28 + 7 = 11-04");
ok(addDays("2026-12-28", 7) === "2027-01-04", "跨年");
ok(addDays("2028-02-25", 7) === "2028-03-03", "闰年二月");
ok(repairTargetDate("2026-10-28", null) === "2026-11-04", "无期望日 → 填写日 + 7");
ok(repairTargetDate("2026-10-28", "2026-11-10") === "2026-11-10", "有期望日 → 期望日");
ok(repairNumber("SO-1", 1) === "R-SO-1-1" && repairNumber("SO-1", 2) === "R-SO-1-2", "单号 R-<工艺单号>-<n>");
ok(isRepairOverdue("2026-11-04", "2026-11-05") && !isRepairOverdue("2026-11-04", "2026-11-04"), "过了目标日才算逾期");

console.log("INSTALL-2d 维修单表头");
{
  const today = "2026-10-28";
  const r = validateRepairHeader({ customerName: " Example Homeowner ", phone: "416-555-0105", notes: "周末再来", customerPreferredDate: "2026-11-10", customerConfirmed: true }, { today });
  ok(r.ok && r.value.customerName === "Example Homeowner" && r.value.customerPreferredDate === "2026-11-10" && r.value.customerConfirmed, "合法表头", r);
  const r2 = validateRepairHeader({ customerName: "A", customerPreferredDate: "" }, { today });
  ok(r2.ok && r2.value.customerPreferredDate === null && r2.value.customerConfirmed === false && r2.value.phone === "", "期望日留空 → null；未勾选 → false", r2);
  ok(!validateRepairHeader({ customerName: "  " }, { today }).ok, "客户名为空 → 拒绝");
  ok(!validateRepairHeader({ customerName: "A", customerPreferredDate: "2026-10-27" }, { today }).ok, "期望日早于今天 → 拒绝");
  ok(validateRepairHeader({ customerName: "A", customerPreferredDate: "2026-10-28" }, { today }).ok, "期望日 = 今天 → 允许");
  ok(!validateRepairHeader({ customerName: "A", customerPreferredDate: "2027-10-29" }, { today }).ok, "期望日晚于 365 天后 → 拒绝");
  ok(!validateRepairHeader({ customerName: "A", customerPreferredDate: "2026-02-30" }, { today }).ok, "非法日期 → 拒绝");
  ok(!validateRepairHeader(null, { today }).ok, "空入参 → 拒绝");
}

console.log("INSTALL-2d 记录解析与品类");
{
  const afterData = JSON.stringify({
    repairNo: "R-SO-1-1",
    seq: 1,
    orderId: "o1",
    orderCode: "SO-1",
    appointmentId: "a1",
    header: { customerName: "Example", phone: "1", notes: "n", takenById: "u1" },
    rows: [
      { n: 1, unitId: "i3", itemNumber: 3, section: "blinds", location: "Kitchen", description: "d", issueType: "damaged", needsFactory: true, category: "shades", photos: [{ proxyUrl: "/api/files/x", at: "t" }, { pathname: "raw" }] },
      { n: 2, unitId: "spec-vinyl-1", itemNumber: 5, section: "vinyl", location: "Den", description: "d2", issueType: "bogus" },
    ],
    fillDate: "2026-10-28",
    customerPreferredDate: null,
    targetDate: "2026-11-04",
    customerConfirmed: false,
  });
  const rec = parseRepairRecord({ id: "r1", afterData, createdAt: new Date("2026-10-28T15:00:00Z"), userId: "u1" });
  ok(!!rec && rec.id === "r1" && rec.repairNo === "R-SO-1-1" && rec.targetDate === "2026-11-04", "解析单号 / 目标日", rec);
  ok(rec?.rows.length === 1 && rec.rows[0].photos.length === 1 && rec.rows[0].photos[0].proxyUrl === "/api/files/x", "坏行（未知类型）与无代理地址的照片丢弃", rec?.rows);
  ok(parseRepairRecord({ id: "x", afterData: "{bad", createdAt: new Date(), userId: "u" }) === null, "坏 JSON → null");
  ok(parseRepairRecord({ id: "x", afterData: null, createdAt: new Date(), userId: "u" }) === null, "无内容 → null");

  const c1 = repairFactoryCategories([{ needsFactory: true, category: "vinyl" }, { needsFactory: false, category: "drapery" }]);
  ok(c1.any && !c1.unknown && c1.categories.join() === "vinyl", "只算需工厂行的品类：vinyl", c1);
  const c2 = repairFactoryCategories([{ needsFactory: true, category: null }]);
  ok(c2.any && c2.unknown && c2.categories.length === 0, "需工厂但品类推不出 → unknown", c2);
  const c3 = repairFactoryCategories([{ needsFactory: false, category: "vinyl" }]);
  ok(!c3.any && !c3.unknown, "没有需工厂行 → 不发出单岗", c3);
}

console.log("INSTALL-2d 打印补行");
{
  const p3 = padPrintRows([1, 2, 3]);
  ok(p3.length === 10 && p3.slice(0, 3).join() === "1,2,3" && p3.slice(3).every((x) => x === null), "3 行补到 10 行");
  ok(padPrintRows(Array.from({ length: 12 }, (_, i) => i)).length === 12, "超过 10 行全部列出");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
