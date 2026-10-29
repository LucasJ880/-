/**
 * INSTALL-2d：问题类型表 / 标记问题入参 / 维修单表头 / 目标日 / 单号 / 记录解析 / 品类 / 打印补行
 * INSTALL-2e：维修单事件 / 进度（按品类出单、排期、关闭）/ 可执行操作与出单判定 / 出单与排返修入参 / 排期提示
 * 运行：npx tsx src/lib/install/__tests__/repair.test.ts
 */
import {
  addDays,
  factoryCategoriesOf,
  issueDecision,
  parseRepairEvent,
  repairActions,
  repairProgress,
  scheduleWarnings,
  validateFactoryIssue,
  validateRepairSchedule,
  type RepairEvent,
  type RepairRow,
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

console.log("INSTALL-2e 维修单进度");
{
  const row = (category: RepairRow["category"], needsFactory = true): RepairRow => ({
    n: 1, unitId: "u", itemNumber: 1, section: "vinyl", location: "Den", description: "d", issueType: needsFactory ? "wrong_size" : "customer", needsFactory, category, photos: [],
  });
  const rec = { id: "r1", rows: [row("vinyl"), row("drapery"), row(null), row("shades", false)] };
  ok(factoryCategoriesOf(rec.rows).join() === "vinyl,drapery,unknown", "需工厂品类：Vinyl、布帘、待确认（不需工厂的 Roller 行不算）");
  const ev = (id: string, action: string, at: string, data: Record<string, unknown>, userId = "u1"): RepairEvent => ({ id, action, repairId: "r1", at, userId, data });
  const events: RepairEvent[] = [
    ev("e1", "install.repair.factory_issued", "2026-10-29T10:00:00Z", { categories: ["vinyl"], readyDate: "2026-11-02", note: "已下单" }),
    ev("e2", "install.repair.scheduled", "2026-10-29T11:00:00Z", { appointmentId: "a1", installAt: "2026-11-03T14:00:00Z", assignedToId: "xw" }),
    ev("e3", "install.repair.scheduled", "2026-10-29T12:00:00Z", { appointmentId: "a1", installAt: "2026-11-04T13:00:00Z", assignedToId: "xl" }),
    ev("e4", "install.repair.factory_issued", "2026-10-29T13:00:00Z", { categories: ["drapery", "unknown"], readyDate: "2026-11-05" }),
    { ...ev("x", "install.repair.factory_issued", "2026-10-29T09:00:00Z", { categories: ["shades"] }), repairId: "other" },
  ];
  const p1 = repairProgress(rec, events.slice(0, 1));
  ok(p1.issued.map((i) => i.category).join() === "vinyl" && p1.pendingCategories.join() === "drapery,unknown" && p1.readyDate === "2026-11-02", "只登记 Vinyl：待登记 布帘、待确认", p1);
  const p2 = repairProgress(rec, events);
  ok(p2.pendingCategories.length === 0 && p2.readyDate === "2026-11-05", "全部登记：无待登记，预计备好日取最晚", p2);
  ok(p2.schedule?.installAt === "2026-11-04T13:00:00Z" && p2.schedule.assignedToId === "xl" && p2.schedule.appointmentId === "a1", "改期以最新一条排期为准", p2.schedule);
  ok(p2.closed === null && !p2.issued.some((i) => i.category === "shades"), "别的维修单的事件不计入");
  const p3 = repairProgress(rec, [...events, ev("e5", "install.repair.completed", "2026-11-04T16:00:00Z", { reason: "superseded", supersededBy: "R-SO-1-2" })]);
  ok(p3.closed?.reason === "superseded" && p3.closed.supersededBy === "R-SO-1-2", "关闭：转入 R-SO-1-2", p3.closed);
  ok(parseRepairEvent({ id: "x", action: "install.repair.scheduled", afterData: "{}", createdAt: new Date(), userId: "u" }) === null && parseRepairEvent({ id: "x", action: "install.window.issue", afterData: '{"repairId":"r1"}', createdAt: new Date(), userId: "u" }) === null, "缺 repairId 或非维修单事件 → null");

  console.log("INSTALL-2e 可执行操作与出单判定");
  const vinylIssuer = { categoryKeys: ["vinyl" as const], umbrella: false, canAssign: false };
  const shadesIssuer = { categoryKeys: ["shades" as const], umbrella: false, canAssign: false };
  const ops = { categoryKeys: [], umbrella: false, canAssign: true };
  const owner = { categoryKeys: [], umbrella: true, canAssign: true };
  const p0 = repairProgress(rec, []);
  ok(repairActions(p0, vinylIssuer).issueCategories.join() === "vinyl,unknown" && !repairActions(p0, vinylIssuer).canSchedule, "出单·Vinyl：可登记 Vinyl 与待确认，不能排返修");
  ok(repairActions(p0, ops).issueCategories.length === 0 && repairActions(p0, ops).canSchedule, "运营主管：不能登记出单，能排返修");
  ok(repairActions(p0, owner).issueCategories.join() === "vinyl,drapery,unknown", "老板（伞键）：可登记全部待登记品类");
  ok(repairActions(p3, owner).issueCategories.length === 0 && !repairActions(p3, owner).canSchedule, "已关闭：没有可执行操作");
  const d1 = issueDecision(p0, vinylIssuer);
  ok(d1.ok && d1.categories.join() === "vinyl,unknown", "出单·Vinyl 登记 → Vinyl + 待确认", d1);
  const onlyVinyl = { id: "r1", rows: [row("vinyl")] };
  const dShades = issueDecision(repairProgress(onlyVinyl, []), shadesIssuer);
  ok(!dShades.ok && dShades.status === 403, "出单·Roller 对只有 Vinyl 行的单 → 403", dShades);
  const dAgain = issueDecision(repairProgress(onlyVinyl, events.slice(0, 1)), vinylIssuer);
  ok(!dAgain.ok && dAgain.code === "ALREADY_ISSUED" && dAgain.status === 409, "重复登记 → 409 ALREADY_ISSUED", dAgain);
  const dNone = issueDecision(repairProgress({ id: "r1", rows: [row("vinyl", false)] }, []), vinylIssuer);
  ok(!dNone.ok && dNone.code === "NOT_NEEDED", "只有客户原因 → 409 NOT_NEEDED", dNone);
  const dOps = issueDecision(p0, ops);
  ok(!dOps.ok && dOps.status === 403, "不持出单键 → 403", dOps);
  const dClosed = issueDecision(p3, vinylIssuer);
  ok(!dClosed.ok && dClosed.code === "CLOSED", "已关闭 → 409 CLOSED", dClosed);
  // 判定与可执行操作一致：列出 ⇔ 判定通过
  for (const h of [vinylIssuer, shadesIssuer, ops, owner]) {
    for (const p of [p0, p1, p2, p3]) {
      const listed = repairActions(p, h).issueCategories.length > 0;
      ok(listed === issueDecision(p, h).ok, "可执行操作与出单判定一致");
    }
  }

  console.log("INSTALL-2e 入参与提示");
  ok(validateFactoryIssue({ readyDate: "2026-11-02", note: " 已下单 " }, { fillDate: "2026-10-28" }).ok, "预计备好日合法");
  ok(!validateFactoryIssue({ readyDate: "2026-10-27" }, { fillDate: "2026-10-28" }).ok, "预计备好日早于填写日 → 拒绝");
  ok(!validateFactoryIssue({ readyDate: "2026/11/02" }, { fillDate: "2026-10-28" }).ok, "格式不对 → 拒绝");
  ok(!validateFactoryIssue({ readyDate: "2026-11-02", note: "x".repeat(501) }, { fillDate: "2026-10-28" }).ok, "备注超过 500 字 → 拒绝");
  const now = new Date("2026-10-28T15:00:00Z");
  const sv = validateRepairSchedule({ installAt: "2026-11-03T14:00:00Z", assignedToId: " xw " }, now);
  ok(sv.ok && sv.value.assignedToId === "xw", "排返修入参合法");
  const sNo = validateRepairSchedule({ installAt: "2026-11-03T14:00:00Z" }, now);
  ok(!sNo.ok && sNo.code === "NO_INSTALLER", "没选安装工 → NO_INSTALLER");
  const sBad = validateRepairSchedule({ installAt: "not a date", assignedToId: "xw" }, now);
  ok(!sBad.ok && sBad.code === "NO_INSTALL_DATE", "时间不合法 → NO_INSTALL_DATE");
  ok(!validateRepairSchedule({ installAt: "2028-01-01T10:00:00Z", assignedToId: "xw" }, now).ok, "一年以后 → 拒绝");
  ok(scheduleWarnings(p0, "2026-11-03").join().includes("出单尚未登记：Vinyl、布帘、品类待确认"), "未登记 → 提示出单尚未登记");
  ok(scheduleWarnings(p2, "2026-11-03").join().includes("2026-11-05 才备好"), "备好日晚于返修日 → 提示");
  ok(scheduleWarnings(p2, "2026-11-06").length === 0, "备好日早于返修日且已全部登记 → 无提示");
}

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
