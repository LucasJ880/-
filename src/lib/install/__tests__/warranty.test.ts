/**
 * INSTALL-2c：质保设置种子 / 校验 / 读取，到期日，生成条件，邮件渲染（内容与不出金额），状态推导
 * 运行：npx tsx src/lib/install/__tests__/warranty.test.ts
 */
import {
  addYears,
  deriveWarrantyStatus,
  readWarrantySettings,
  renderWarrantyEmail,
  seedWarrantySettings,
  validateWarrantySettings,
  warrantyBlockers,
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
ok(terms(seed, "vinyl") === "labour:1,components:5", "Shutters：人工 1 / 部件 5（报价单口径）", terms(seed, "vinyl"));
ok(terms(seed, "shades") === "labour:1,fabric:5,components:15" && terms(seed, "drapery") === "labour:1,fabric:5,components:15", "帘类 / 窗帘：人工 1 / 面料 5 / 部件 15");
ok(seed.contact.phone === "" && seed.contact.email === "", "电话 / 邮箱不预置（未核实）");
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
const withMotor = validateWarrantySettings({ ...good, terms: { ...good.terms, shades: [{ part: "motor", years: "5" }, { part: "labour", years: 1 }] } });
ok(withMotor.ok && withMotor.settings.terms.shades.map((t) => t.part).join() === "labour,motor", "可加电机年限，部件按固定顺序排列");

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
const b1 = warrantyBlockers({ balanceConfirmed: true, customerEmail: "home@fixture.test", units: vinylUnits, settings: seed });
ok(b1.includes("缺报修电话") && b1.includes("缺报修邮箱"), "种子（无电话 / 邮箱）→ 缺报修电话、缺报修邮箱", b1);
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
ok(mail.text.includes("Labour 1 yr (until 2027-10-28)") && mail.text.includes("Components 5 yr (until 2031-10-28)"), "Shutters 覆盖：人工到 2027-10-28、部件到 2031-10-28");
ok(!/Fabric|Shades & Blinds|Drapes/.test(mail.text), "只列单内出现的品类（只有 Shutters）");
ok(mail.text.includes("1. Living Room — Vinyl 百叶") && mail.text.includes("2. Kitchen — Vinyl 百叶"), "每个单元：位置 / 产品");
ok(mail.text.includes("Installed on:   2026-10-28") && mail.text.includes("Order No.:      SUN-1024") && mail.text.includes("6 Example Ct"), "单号 / 安装日 / 地址");
ok(mail.text.includes("https://sunnyshutter.ca/warranty-service/") && mail.text.includes("647-555-0100") && mail.text.includes("service@example.com"), "条款链接与报修联系方式");
ok(mail.html.startsWith("<!doctype html>") && mail.html.includes("Labour 1 yr (until 2027-10-28)") && mail.html.includes("W-SUN-1024"), "HTML 与正文同内容");
const again = renderWarrantyEmail({ orderCode: "SUN-1024", customerName: "Example Homeowner", address: "6 Example Ct", installDate: "2026-10-28", units: [...vinylUnits].reverse(), settings: ready });
ok(again.text === mail.text && again.html === mail.html, "同样输入 → 完全相同（单元顺序按序号）");
const xss = renderWarrantyEmail({ orderCode: "X1", customerName: "<script>alert(1)</script>", address: null, installDate: "2026-10-28", units: vinylUnits, settings: ready });
ok(!xss.html.includes("<script>alert") && xss.html.includes("&lt;script&gt;"), "HTML 转义客户输入");

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
