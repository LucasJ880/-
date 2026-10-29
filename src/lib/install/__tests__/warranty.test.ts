/**
 * INSTALL-2c：质保设置种子 / 校验 / 读取，到期日，生成条件，邮件渲染（内容与不出金额），状态推导
 * INSTALL-2g：Shutters 新条款（1 / 15 / 25）、报修联系方式与抄送种子、抄送校验、旧设置原样读取、报价单质保文字与种子交叉比对
 * 运行：npx tsx src/lib/install/__tests__/warranty.test.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  addYears,
  deriveWarrantyStatus,
  readWarrantySettings,
  parseWarrantyCc,
  renderWarrantyEmail,
  seedWarrantySettings,
  validateWarrantySettings,
  warrantyBlockers,
  warrantyCcProblem,
  type WarrantySettings,
  type WarrantyUnit,
} from "../warranty";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string, detail?: unknown) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.error(`  ✗ ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

console.log("INSTALL-2c 质保设置种子");
const seed = seedWarrantySettings();
const terms = (s: WarrantySettings, c: "shades" | "drapery" | "vinyl") => s.terms[c].map((t) => `${t.part}:${t.years}`).join(",");
ok(terms(seed, "vinyl") === "labour:1,components:15,frame:25", "Shutters：人工 1 / 部件 15 / 框架与叶片 25（官网新条款，INSTALL-2g）", terms(seed, "vinyl"));
ok(terms(seed, "shades") === "labour:1,fabric:5,components:15" && terms(seed, "drapery") === "labour:1,fabric:5,components:15", "帘类 / 窗帘：人工 1 / 面料 5 / 部件 15");
ok(seed.contact.phone === "647-857-8669" && seed.contact.email === "service@sunnyshutter.ca", "报修电话 647-857-8669、邮箱 service@sunnyshutter.ca（INSTALL-2g）", seed.contact);
ok(seed.cc.join() === "miki@sunnyshutter.ca", "抄送种子 miki@sunnyshutter.ca（INSTALL-2g）", seed.cc);
ok(validateWarrantySettings(seed).ok, "种子本身通过校验");
ok(seed.contact.companyName === "Sunny Shutter Inc" && seed.contact.address === "2-680 Progress Avenue, Scarborough, ON M1H 3A5" && seed.contact.warrantyUrl === "https://sunnyshutter.ca/warranty-service/", "公司名 / 地址 / 条款链接");
ok(readWarrantySettings(null).saved === false && readWarrantySettings({ timezone: "America/Toronto" }).saved === false, "从未保存 → 种子");

console.log("INSTALL-2c 质保设置校验");
const good = { ...seed, contact: { ...seed.contact, phone: "647-555-0100", email: "Service@Example.com" } };
const v = validateWarrantySettings(good);
ok(v.ok && v.settings.contact.email === "service@example.com", "合法设置通过，邮箱转小写");
ok(readWarrantySettings({ sunnyWarranty: good }).saved === true && readWarrantySettings({ sunnyWarranty: good }).settings.contact.phone === "647-555-0100", "读取已保存设置");
for (const [bad, name] of [
  [{ ...good, terms: { ...good.terms, vinyl: [{ part: "components", years: 99 }] } }, "Shutters 部件 99 年"],
  [{ ...good, terms: { ...good.terms, vinyl: [{ part: "components", years: 2.5 }] } }, "非整数年限"],
  [{ ...good, terms: { ...good.terms, shades: [{ part: "paint", years: 1 }] } }, "未知部件"],
  [{ ...good, terms: { ...good.terms, shades: [{ part: "labour", years: 1 }, { part: "labour", years: 2 }] } }, "部件重复"],
  [{ ...good, terms: { ...good.terms, curtains: [] } }, "未知品类"],
  [{ ...good, contact: { ...good.contact, email: "not-an-email" } }, "邮箱格式"],
  [{ ...good, contact: { ...good.contact, warrantyUrl: "http://x.com" } }, "非 https 链接"],
  [{ ...good, contact: { ...good.contact, companyName: "" } }, "公司名为空"],
] as Array<[unknown, string]>) {
  const r = validateWarrantySettings(bad);
  ok(!r.ok, `拒绝：${name}`, r);
}
ok(readWarrantySettings({ sunnyWarranty: { terms: "bad" } }).saved === false, "已存坏数据 → 回退种子");
const legacy = {
  terms: { shades: seed.terms.shades, drapery: seed.terms.drapery, vinyl: [{ part: "labour", years: 1 }, { part: "components", years: 5 }] },
  contact: { ...seed.contact, phone: "647-555-0100", email: "service@example.com" },
};
const legacyRead = readWarrantySettings({ sunnyWarranty: legacy });
ok(legacyRead.saved && terms(legacyRead.settings, "vinyl") === "labour:1,components:5" && legacyRead.settings.cc.length === 0, "已保存的旧设置原样读取：Shutters 1 / 5、无抄送项 = 不抄送（不被种子覆盖）", legacyRead.settings);

console.log("INSTALL-2g 抄送");
const ccOk = validateWarrantySettings({ ...good, cc: "Miki@Fixture.test, miki@fixture.test；office@fixture.test" });
ok(ccOk.ok && ccOk.settings.cc.join() === "miki@fixture.test,office@fixture.test", "分隔字符串 → 小写去重", ccOk);
ok(parseWarrantyCc(["A@x.co", " a@x.co ", ""]).join() === "a@x.co" && parseWarrantyCc(undefined).length === 0, "数组同样小写去重；缺省为空");
ok(!validateWarrantySettings({ ...good, cc: "not-an-email" }).ok, "拒绝：抄送格式不对");
ok(!validateWarrantySettings({ ...good, cc: ["a@x.co", "b@x.co", "c@x.co", "d@x.co", "e@x.co", "f@x.co"] }).ok, "拒绝：6 个抄送");
ok(validateWarrantySettings({ ...good, cc: ["a@x.co", "b@x.co", "c@x.co", "d@x.co", "e@x.co", "A@X.CO"] }).ok, "合并重复后 5 个 → 通过");
ok(warrantyCcProblem(undefined) === null && warrantyCcProblem(["miki@fixture.test"]) === null, "执行器：缺省或合法抄送通过");
ok(warrantyCcProblem("miki@fixture.test") !== null && warrantyCcProblem(["bad"]) !== null && warrantyCcProblem(["a@x.co", "b@x.co", "c@x.co", "d@x.co", "e@x.co", "f@x.co"]) !== null, "执行器：非数组 / 格式不对 / 超过 5 个 → 拒绝");
const withMotor = validateWarrantySettings({ ...good, terms: { ...good.terms, shades: [{ part: "motor", years: "5" }, { part: "labour", years: 1 }] } });
ok(withMotor.ok && withMotor.settings.terms.shades.map((t) => t.part).join() === "labour,motor", "可加电机年限，部件按固定顺序排列");
const reordered = validateWarrantySettings({ ...good, terms: { ...good.terms, vinyl: [{ part: "frame", years: 25 }, { part: "labour", years: 1 }, { part: "components", years: 15 }] } });
ok(reordered.ok && terms(reordered.settings, "vinyl") === "labour:1,components:15,frame:25", "框架与叶片排在部件之后", reordered);

console.log("INSTALL-2c 到期日");
ok(addYears("2026-10-28", 1) === "2027-10-28" && addYears("2026-10-28", 5) === "2031-10-28", "同月同日");
ok(addYears("2028-02-29", 1) === "2029-02-28" && addYears("2028-02-29", 4) === "2032-02-29", "2 月 29 日：平年顺延 28 日，闰年保留");

console.log("INSTALL-2c 生成条件");
const ready: WarrantySettings = (v.ok ? v.settings : seed);
const vinylUnits: WarrantyUnit[] = [
  { itemNumber: 1, location: "Living Room", productType: "Vinyl 百叶", fabricSku: "", category: "vinyl" },
  { itemNumber: 2, location: "Kitchen", productType: "Vinyl 百叶", fabricSku: "", category: "vinyl" },
];
ok(warrantyBlockers({ balanceConfirmed: true, customerEmail: "home@fixture.test", units: vinylUnits, settings: ready }).length === 0, "资料齐全 → 无阻断");
const noContact = { ...seed, contact: { ...seed.contact, phone: "", email: "" } };
const b1 = warrantyBlockers({ balanceConfirmed: true, customerEmail: "home@fixture.test", units: vinylUnits, settings: noContact });
ok(b1.includes("缺报修电话") && b1.includes("缺报修邮箱"), "电话 / 邮箱被清空 → 缺报修电话、缺报修邮箱", b1);
ok(warrantyBlockers({ balanceConfirmed: true, customerEmail: "home@fixture.test", units: vinylUnits, settings: seed }).length === 0, "种子（已带报修电话 / 邮箱）→ 无阻断");
ok(warrantyBlockers({ balanceConfirmed: true, customerEmail: "", units: vinylUnits, settings: ready }).includes("客户没有邮箱"), "客户没有邮箱");
ok(warrantyBlockers({ balanceConfirmed: false, customerEmail: "a@b.co", units: vinylUnits, settings: ready }).includes("尾款尚未确认"), "尾款未确认");
ok(warrantyBlockers({ balanceConfirmed: true, customerEmail: "a@b.co", units: [], settings: ready }).includes("没有收口单元"), "没有收口单元");
const unknown = warrantyBlockers({ balanceConfirmed: true, customerEmail: "a@b.co", units: [{ itemNumber: 3, location: "Den", productType: "百叶窗X", fabricSku: "", category: null }], settings: ready });
ok(unknown.some((r) => r.includes("第 3 项（Den）无法识别品类")), "无法识别品类的单元", unknown);
const noVinyl = { ...ready, terms: { ...ready.terms, vinyl: [] } };
ok(warrantyBlockers({ balanceConfirmed: true, customerEmail: "a@b.co", units: vinylUnits, settings: noVinyl }).includes("Shutters未配置质保年限"), "单内品类未配置年限");

console.log("INSTALL-2c 邮件内容");
const mail = renderWarrantyEmail({ orderCode: "SUN-1024", customerName: "Example Homeowner", address: "6 Example Ct", installDate: "2026-10-28", units: vinylUnits, settings: ready });
ok(mail.warrantyNo === "W-SUN-1024", "质保编号 W-<单号>");
ok(mail.subject === "Your Sunny Shutter installation is complete — Warranty W-SUN-1024 (Order SUN-1024)", "主题格式", mail.subject);
ok(
  mail.text.includes("Shutters: Labour 1 yr (until 2027-10-28) · Components 15 yr (until 2041-10-28) · Frame & Panels 25 yr (until 2051-10-28)"),
  "Shutters 覆盖：人工到 2027-10-28、部件到 2041-10-28、框架与叶片到 2051-10-28",
  mail.text.split("\n").find((l) => l.includes("Shutters:")),
);
ok(!/Fabric|Shades & Blinds|Drapes/.test(mail.text), "只列单内出现的品类（只有 Shutters）");
ok(mail.text.includes("1. Living Room — Vinyl 百叶") && mail.text.includes("2. Kitchen — Vinyl 百叶"), "每个单元：位置 / 产品");
ok(mail.text.includes("Installed on:   2026-10-28") && mail.text.includes("Order No.:      SUN-1024") && mail.text.includes("6 Example Ct"), "单号 / 安装日 / 地址");
ok(mail.text.includes("https://sunnyshutter.ca/warranty-service/") && mail.text.includes("647-555-0100") && mail.text.includes("service@example.com"), "条款链接与报修联系方式");
ok(mail.html.startsWith("<!doctype html>") && mail.html.includes("Labour 1 yr (until 2027-10-28)") && mail.html.includes("W-SUN-1024"), "HTML 与正文同内容");
const again = renderWarrantyEmail({ orderCode: "SUN-1024", customerName: "Example Homeowner", address: "6 Example Ct", installDate: "2026-10-28", units: [...vinylUnits].reverse(), settings: ready });
ok(again.text === mail.text && again.html === mail.html, "同样输入 → 完全相同（单元顺序按序号）");
const xss = renderWarrantyEmail({ orderCode: "X1", customerName: "<script>alert(1)</script>", address: null, installDate: "2026-10-28", units: vinylUnits, settings: ready });
ok(!xss.html.includes("<script>alert") && xss.html.includes("&lt;script&gt;"), "HTML 转义客户输入");

console.log("INSTALL-2g 报价单质保文字与种子一致");
const quoteSrc = readFileSync(path.join(process.cwd(), "src/app/(main)/sales/quote-sheet/quote-pdf.ts"), "utf8");
const yrs = (n: number) => `${n} year${n === 1 ? "" : "s"}`;
const yearsOf = (c: "shades" | "drapery" | "vinyl", part: string) => seed.terms[c].find((t) => t.part === part)?.years ?? -1;
const shutterLine = `Warranty: ${yrs(yearsOf("vinyl", "labour"))} labour / ${yrs(yearsOf("vinyl", "components"))} components / ${yrs(yearsOf("vinyl", "frame"))} frame & panels.`;
ok(shutterLine === "Warranty: 1 year labour / 15 years components / 25 years frame & panels." && quoteSrc.includes(shutterLine), "报价单 Shutters 段 = 种子 1 / 15 / 25", shutterLine);
ok(!quoteSrc.includes("1 year labour / 5 years components"), "报价单不再有 Shutters 旧文字（1 year labour / 5 years components）");
for (const c of ["shades", "drapery"] as const) {
  const line = `Warranty: ${yrs(yearsOf(c, "labour"))} labour · ${yrs(yearsOf(c, "fabric"))} fabric · ${yrs(yearsOf(c, "components"))} components.`;
  ok(quoteSrc.split(line).length - 1 === 2, `报价单帘类 / 窗帘段 = 种子 ${c} 1 / 5 / 15`, line);
}

console.log("INSTALL-2c 邮件不输出金额");
for (const part of [mail.subject, mail.text, mail.html]) {
  ok(!/2600|2500|\$|CAD/.test(part), "主题 / 正文 / HTML 不含金额与货币", part.slice(0, 80));
}

console.log("INSTALL-2c 状态推导");
ok(deriveWarrantyStatus({ sentAt: "2026-10-28T20:00:00Z", latestAction: { id: "a1", status: "failed", failureReason: "x" }, blockers: [] }).status === "sent", "已发送优先");
ok(deriveWarrantyStatus({ sentAt: null, latestAction: { id: "a1", status: "pending", failureReason: null }, blockers: [] }).status === "pending_approval", "待批准");
const f = deriveWarrantyStatus({ sentAt: null, latestAction: { id: "a1", status: "failed", failureReason: "NO_ORG_SENDER" }, blockers: [] });
ok(f.status === "failed" && f.canRegenerate && f.reason === "NO_ORG_SENDER", "发送失败可重新生成");
ok(deriveWarrantyStatus({ sentAt: null, latestAction: { id: "a1", status: "failed", failureReason: "已过期" }, blockers: [] }).status === "expired", "过期");
ok(deriveWarrantyStatus({ sentAt: null, latestAction: { id: "a1", status: "rejected", failureReason: null }, blockers: [] }).status === "rejected", "已拒绝");
const bl = deriveWarrantyStatus({ sentAt: null, latestAction: null, blockers: ["缺报修电话"] });
ok(bl.status === "blocked" && bl.blockers?.[0] === "缺报修电话" && bl.canRegenerate, "阻断附原因");
ok(deriveWarrantyStatus({ sentAt: null, latestAction: null, blockers: [] }).status === "none", "从未生成");

console.log(`\n结果: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
