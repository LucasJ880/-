/**
 * CHAIN-4b 禁出清单 — 纯逻辑测试
 * 运行：npx tsx src/lib/bid-workflow/__tests__/project-identity-deny.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildProjectIdentityDenyList,
  cityLevelDestination,
  describeIdentityHits,
  identityLeakFieldMessageZh,
  identityLeakMessageZh,
  normalizeIdentityText,
  rfqReference,
  scanIdentity,
  scanOutboundRfqEmail,
  SupplierIdentityLeakError,
  type ProjectIdentitySources,
} from "../project-identity-deny";

let passed = 0;
function ok(name: string, cond: boolean) {
  assert.equal(cond, true, name);
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const emptyFacts = () => ({ tenderNumber: [], buyer: [], projectTitle: [], closingDatetime: [], location: [] });
const src = (o: Partial<ProjectIdentitySources> = {}): ProjectIdentitySources => ({
  projectName: null,
  solicitationNumber: null,
  clientOrganization: null,
  closeDate: null,
  timeZone: "America/Toronto",
  facts: emptyFacts(),
  allowedEmails: ["project@sunnyshutter.ca", "lucas@sunnyshutter.ca"],
  ...o,
});

const FEDERAL = src({
  projectName: "Sleeping Bags and Mats",
  solicitationNumber: "24062-27-057",
  clientOrganization: "Treasury Board of Canada Secretariat",
  closeDate: new Date("2026-12-05T19:00:00Z"),
  facts: { ...emptyFacts(), location: ["Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9"] },
});
const has = (list: ReturnType<typeof buildProjectIdentityDenyList>, category: string, normalized: string) =>
  list.entries.some((e) => e.category === category && e.normalized === normalized);

console.log("project-identity-deny");

// ── 禁出清单的类别与来源 / 派生的词条 ──
{
  const list = buildProjectIdentityDenyList(FEDERAL);
  ok("联邦标：招标编号原值进清单", has(list, "tender_number", "24062 27 057"));
  ok("联邦标：采购方规整后进清单", has(list, "buyer_name", "treasury board of canada secretariat"));
  ok("联邦标：截标日期 ISO 写法（组织时区）", has(list, "close_date", "2026 12 05"));
  ok("联邦标：截标日期 YYYY/MM/DD 规整后与 ISO 相同，不重复", list.entries.filter((e) => e.category === "close_date" && e.normalized === "2026 12 05").length === 1);
  ok("联邦标：截标日期中文写法", has(list, "close_date", "2026年12月5日"));
  ok("联邦标：截标日期 Month D, YYYY", has(list, "close_date", "december 5 2026"));
  ok("联邦标：截标日期 Mon D, YYYY", has(list, "close_date", "dec 5 2026"));
  ok("联邦标：截标日期 D Month YYYY", has(list, "close_date", "5 december 2026"));
  ok("联邦标：邮编带空格", has(list, "delivery_address", "k1a 0k9"));
  ok("联邦标：邮编不带空格", has(list, "delivery_address", "k1a0k9"));
  ok("联邦标：门牌号开头的街道段", has(list, "delivery_address", "2 constellation crescent"));
  ok("联邦标：含街道 / 邮编时整段地点原文也进清单", has(list, "delivery_address", normalizeIdentityText("Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9")));
  ok("联邦标：项目名称进清单", has(list, "project_name", "sleeping bags and mats"));
  ok("允许的我方邮箱统一小写", list.allowedEmails.includes("project@sunnyshutter.ca"));
}
{
  const late = buildProjectIdentityDenyList(src({ closeDate: new Date("2026-12-06T03:30:00Z") }));
  ok("截标日期按组织时区取日期（UTC 已是次日，多伦多仍是 12-05）", has(late, "close_date", "2026 12 05") && !has(late, "close_date", "2026 12 06"));
}
{
  const list = buildProjectIdentityDenyList(src({ clientOrganization: "NRC", facts: { ...emptyFacts(), location: ["Ottawa, ON"] } }));
  ok("不足 4 个字符的采购方不进清单", !list.entries.some((e) => e.category === "buyer_name"));
  ok("只有「城市, 省」的地点不派生交货地址词条", !list.entries.some((e) => e.category === "delivery_address"));
}
{
  const list = buildProjectIdentityDenyList(src({ clientOrganization: "Ottawa, City of" }));
  ok("倒装采购方：原文规整", has(list, "buyer_name", "ottawa city of"));
  ok("倒装采购方：复位为 city of ottawa", has(list, "buyer_name", "city of ottawa"));
}
{
  const list = buildProjectIdentityDenyList(src({ facts: { ...emptyFacts(), tenderNumber: ["Solicitation No. EN578-170432/B"], buyer: ["加拿大财政委员会秘书处"] } }));
  ok("编号事实：取出含 ≥4 位数字的编号片段", has(list, "tender_number", normalizeIdentityText("EN578-170432/B")));
  ok("编号事实：不含数字的词不当编号片段", !has(list, "tender_number", "solicitation"));
  ok("中文采购方：标为中日韩词条", list.entries.some((e) => e.category === "buyer_name" && e.cjk));
}

// ── 比对规则 ──
{
  const list = buildProjectIdentityDenyList(FEDERAL);
  const hits = scanIdentity(list, [
    { where: "要求 R-01", text: "TREASURY BOARD OF CANADA, SECRETARIAT will inspect", kind: "tender" },
    { where: "要求 R-02", text: "Ref 24062/27/057", kind: "tender" },
  ]);
  ok("写法不同：大写与逗号照样命中采购方", hits.some((h) => h.where === "要求 R-01" && h.category === "buyer_name"));
  ok("写法不同：斜杠分隔照样命中编号", hits.some((h) => h.where === "要求 R-02" && h.category === "tender_number"));
}
{
  const list = buildProjectIdentityDenyList(src({ clientOrganization: "Metro" }));
  ok("词的一部分不算命中", scanIdentity(list, [{ where: "要求 R-01", text: "Metropolitan grade fabric", kind: "tender" }]).length === 0);
  ok("整词出现算命中", scanIdentity(list, [{ where: "要求 R-01", text: "Ship to Metro depot", kind: "tender" }]).length === 1);
}
{
  const list = buildProjectIdentityDenyList(src({ facts: { ...emptyFacts(), buyer: ["加拿大财政委员会秘书处"] } }));
  ok("中日韩词条按字面子串命中", scanIdentity(list, [{ where: "要求 R-01", text: "交付给加拿大财政委员会秘书处仓库", kind: "tender" }]).length === 1);
}

// ── 邮箱与电话格式检查 ──
{
  const list = buildProjectIdentityDenyList(src());
  const hits = scanIdentity(list, [{ where: "要求 R-05", text: "Contact j.doe@tbs-sct.gc.ca or 613-555-0142 to book delivery", kind: "tender" }]);
  ok("要求里的联系人邮箱命中", hits.some((h) => h.category === "email_address" && h.where === "要求 R-05"));
  ok("要求里的北美电话命中", hits.some((h) => h.category === "phone_number" && h.where === "要求 R-05"));
  const clean = scanIdentity(list, [
    { where: "正文", text: "Reply to PROJECT@sunnyshutter.ca. Meets CAN/CGSB-4.162-2015 and ISO 9001:2015; size 1200 x 600 x 25 mm; ref 24062-27-057; batch 12-345-678.", kind: "tender" },
  ]);
  ok("我方地址、标准号、尺寸、编号不算邮箱或电话", clean.length === 0);
  ok("括号区号电话命中", scanIdentity(list, [{ where: "x", text: "Tel (780) 427-0104", kind: "tender" }]).some((h) => h.category === "phone_number"));
  ok("带 +1 的电话命中", scanIdentity(list, [{ where: "x", text: "Call +1 613.555.0142", kind: "tender" }]).some((h) => h.category === "phone_number"));
  ok("国际号码（+86 ≥ 8 位）命中", scanIdentity(list, [{ where: "x", text: "WhatsApp +86 138 0013 8000", kind: "tender" }]).some((h) => h.category === "phone_number"));
  ok("中国手机号命中", scanIdentity(list, [{ where: "x", text: "联系 13800138000", kind: "tender" }]).some((h) => h.category === "phone_number"));
  ok("区号或局号以 0 / 1 开头的编号不算电话", scanIdentity(list, [{ where: "x", text: "Part 100-123-4567 and 613-155-0142", kind: "tender" }]).length === 0);
  ok("温度与公差不算电话", scanIdentity(list, [{ where: "x", text: "Rated -20C to +40C, tolerance +/- 5 mm", kind: "tender" }]).length === 0);
}

// ── 项目名称只在我方撰写的部分比对 ──
{
  const list = buildProjectIdentityDenyList(FEDERAL);
  ok("招标原文里的项目名称不拦", scanIdentity(list, [{ where: "要求 R-01", text: "Sleeping bags and mats shall be rated to -20C", kind: "tender" }]).length === 0);
  const human = scanIdentity(list, [{ where: "补充说明", text: "本轮只询 Sleeping Bags and Mats", kind: "human" }]);
  ok("人工栏目里的项目名称命中", human.length === 1 && human[0].category === "project_name" && human[0].kind === "human");
  const mail = scanOutboundRfqEmail(list, { subject: "询价：Sleeping Bags and Mats", body: "1.【强制】R-01 Sleeping bags and mats shall be rated to -20C" }, "第 2 家");
  ok("发出邮件复查：标题查项目名称", mail.some((h) => h.category === "project_name" && h.where === "第 2 家邮件标题"));
  ok("发出邮件复查：正文不查项目名称", !mail.some((h) => h.where === "第 2 家邮件正文"));
  ok("发出邮件复查：正文仍查编号", scanOutboundRfqEmail(list, { subject: "询价 RFQ-X", body: "see 24062-27-057" }).some((h) => h.category === "tender_number" && h.where === "邮件正文"));
}

// ── 说明文字 ──
{
  const hits = [
    { category: "buyer_name" as const, where: "要求 R-02", kind: "tender" as const },
    { category: "delivery_address" as const, where: "目的地", kind: "human" as const },
    { category: "email_address" as const, where: "要求 R-05", kind: "tender" as const },
    { category: "phone_number" as const, where: "要求 R-05", kind: "tender" as const },
  ];
  ok("类别·位置，超过 3 处写等 N 处", describeIdentityHits(hits) === "采购方名称·要求 R-02、交货地址·目的地、邮箱地址·要求 R-05 等 4 处");
  ok("入口说明", identityLeakMessageZh(hits.slice(0, 1)) === "询价内容含招标身份信息（命中：采购方名称·要求 R-02），本轮整单不发。");
  ok("人工栏目说明以「你填的」开头", identityLeakFieldMessageZh(hits[1], hits) === "你填的目的地里含招标身份信息（命中：交货地址），改掉再提交。");
  const err = new SupplierIdentityLeakError(hits.slice(0, 1));
  ok("生成文件错误带 IDENTITY_LEAK 与说明", err.errorCode === "IDENTITY_LEAK" && err.message === "供应商侧文件含招标身份信息（命中：采购方名称·要求 R-02），未生成。");
  ok("说明不复述原文", !JSON.stringify(scanIdentity(buildProjectIdentityDenyList(FEDERAL), [{ where: "要求 R-01", text: "Treasury Board of Canada Secretariat", kind: "tender" }])).includes("Treasury"));
}

// ── 询价编号 ──
{
  const base = { projectId: "proj_abc123", projectCreatedAt: new Date("2026-03-01T12:00:00Z"), orgCode: "sunny-home-deco", timeZone: "America/Toronto" };
  const ref = rfqReference(base);
  ok("编号形如 RFQ-SUNNY-2026-5 位码", /^RFQ-SUNNY-2026-[0-9A-HJKMNP-TV-Z]{5}$/.test(ref));
  ok("同一项目编号不变", rfqReference(base) === ref);
  ok("另一个项目编号不同", rfqReference({ ...base, projectId: "proj_abc124" }) !== ref);
  ok("组织代码为空时用 QY", rfqReference({ ...base, orgCode: null }).startsWith("RFQ-QY-2026-"));
  ok("组织代码最多 8 个字符", rfqReference({ ...base, orgCode: "verylongorgname-x" }).startsWith("RFQ-VERYLONG-2026-"));
  ok("年份按组织时区（UTC 已是 2027，多伦多仍是 2026）", rfqReference({ ...base, projectCreatedAt: new Date("2027-01-01T03:00:00Z") }).includes("-2026-"));
  ok("编号本身不撞联邦标清单", scanIdentity(buildProjectIdentityDenyList(FEDERAL), [{ where: "邮件标题", text: `询价 ${ref}`, kind: "authored" }]).length === 0);
}

// ── 城市级目的地 ──
{
  ok("精确地址取城市, 省", cityLevelDestination("Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9") === "Ottawa, ON");
  ok("省用全称", cityLevelDestination("9820 106 Street NW, Edmonton, Alberta T5K 2J6") === "Edmonton, Alberta");
  ok("城市前的小写词不算城市", cityLevelDestination("Delivery to Sault Ste. Marie, ON") === "Sault Ste. Marie, ON");
  ok("本来就是城市级", cityLevelDestination("Toronto, ON") === "Toronto, ON");
  ok("找不到城市, 省 → null", cityLevelDestination("渥太华市中心仓库") === null && cityLevelDestination(null) === null);
  ok("取最后一处", cityLevelDestination("Head office Toronto, ON; deliver to Kingston, ON") === "Kingston, ON");
}

// ── 源码断言：不读环境变量、不引用模型客户端、调用处没有开关判断 ──
{
  const root = process.cwd();
  const mod = readFileSync(path.join(root, "src/lib/bid-workflow/project-identity-deny.ts"), "utf8");
  ok("防护模块不读环境变量", !/process\.env/.test(mod));
  ok("防护模块不引用数据库与模型客户端", !/@\/lib\/(db|ai|llm|openai|anthropic)\b/.test(mod) && !/openai|anthropic|generateText|chatCompletion/i.test(mod));
  const callers = [
    "src/lib/tender-rfq/build.ts",
    "src/lib/tender-rfq/service.ts",
    "src/lib/tender-rfq/execute.ts",
    "src/lib/projects/generate/generate-docs.ts",
    "src/lib/bid-workflow/china-supplier-brief.ts",
  ];
  for (const f of callers) {
    const s = readFileSync(path.join(root, f), "utf8");
    ok(`${f} 接上了防护且没有身份防护开关`, /project-identity-(deny|sources)/.test(s) && !/IDENTITY_GUARD_ENABLED|SUPPLIER_IDENTITY_[A-Z_]*ENABLED/.test(s));
  }
}

console.log(`project-identity-deny: ${passed} passed`);
