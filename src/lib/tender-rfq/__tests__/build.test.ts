/**
 * P1-1 RFQ 生成器 — 纯逻辑测试
 * 运行：npx tsx src/lib/tender-rfq/__tests__/build.test.ts
 */
import assert from "node:assert/strict";
import { buildRfqDocument, computeReplyBy, renderRfqEmail, type RfqRequirementInput } from "../build";
import { REQUIREMENT_CATEGORIES } from "@/lib/tender-understanding/contract";
import { buildProjectIdentityDenyList, type ProjectIdentitySources } from "@/lib/bid-workflow/project-identity-deny";

let passed = 0;
function ok(name: string, cond: boolean) { assert.equal(cond, true, name); passed += 1; console.log(`  ✓ ${name}`); }

// CHAIN-4b：询价单的身份入参（禁出清单 + 中性询价编号）
const identityOf = (o: Partial<ProjectIdentitySources>, reference = "RFQ-TEST-2026-ABCDE") => ({
  denyList: buildProjectIdentityDenyList({
    projectName: null, solicitationNumber: null, clientOrganization: null, closeDate: null, timeZone: "America/Toronto",
    facts: { tenderNumber: [], buyer: [], projectTitle: [], closingDatetime: [], location: [] },
    allowedEmails: ["project@sunnyshutter.ca"], ...o,
  }),
  reference,
});
const ID = identityOf({ projectName: "P" });
const RCMP_ID = identityOf({ projectName: "RCMP 战术背包" }, "RFQ-SUNNY-2026-7KQ4M");

const now = new Date("2026-10-22T12:00:00Z");
const req = (o: Partial<RfqRequirementInput> & { requirementCode: string }): RfqRequirementInput => ({
  category: "PRODUCT", originalRequirement: "Backpack shall be 1000D Cordura nylon, minimum 30L.", chineseTranslation: "背包须为 1000D 考杜拉尼龙，容量不低于 30L。",
  mandatory: true, reviewStatus: "CONFIRMED", sourcePage: 12, ...o,
});

console.log("tender-rfq build");

{
  const r = buildRfqDocument({ identity: RCMP_ID, buyerDisplayName: "Sunny Trading Inc.", closeDate: "2026-11-14", now,
    requirements: [
      req({ requirementCode: "R-01" }),
      req({ requirementCode: "R-02", category: "DELIVERY", mandatory: false, originalRequirement: "Delivery within 60 days of PO.", chineseTranslation: "下单后 60 天内交付。", sourcePage: 15 }),
      req({ requirementCode: "R-03", category: "INSURANCE", originalRequirement: "CGL $5M", chineseTranslation: "商业综合责任险 500 万" }),
      req({ requirementCode: "R-04", reviewStatus: "AI_EXTRACTED" }),
      req({ requirementCode: "R-05", category: "SAMPLES", originalRequirement: "Two pre-production samples.", chineseTranslation: "两件产前样。" }),
    ],
    facts: [
      { type: "quantity", contentZh: "最多 1,500 个", contentOriginal: "up to 1,500 units", confidence: "HIGH", manuallyConfirmed: false },
      { type: "location", contentZh: "Ottawa, ON", contentOriginal: null, confidence: "LOW", manuallyConfirmed: false },
    ],
    incoterm: "DDP", destination: "Toronto, ON",
  });
  ok("生成成功", r.ok);
  if (r.ok) {
    const d = r.doc;
    ok("只收 CONFIRMED + 供应商侧：R-01/R-02/R-05", d.lineItems.map((i) => i.requirementCode).join(",") === "R-01,R-02,R-05");
    ok("排除原因可核对", d.excluded.some((e) => e.requirementCode === "R-03" && e.reason === "not_supplier_facing") && d.excluded.some((e) => e.requirementCode === "R-04" && e.reason === "not_confirmed"));
    ok("行项带来源页码", d.lineItems[0].sourcePage === 12);
    ok("数量从 HIGH 置信事实解析为 1500", JSON.stringify(d.quantityTiers) === "[1500]");
    ok("显式 destination 优先于 LOW 置信 location 事实", d.destination === "Toronto, ON");
    ok("回复截止 = 截标 − 7 天", d.replyBy === "2026-11-07");
    ok("强制要求派生逐条回复问题，且只含强制项（R-01、R-05）", d.questions[0].relatedCodes.join(",") === "R-01,R-05");
    ok("SAMPLES → 附件请求", d.attachmentsRequested.some((a) => a.includes("样品")));
    const mail = renderRfqEmail(d, { supplierName: "王总", roundNumber: 1 });
    ok("邮件标题用询价编号、含轮次与截止", mail.subject === "询价 RFQ-SUNNY-2026-7KQ4M（第 1 轮） — 请于 2026-11-07 前回复");
    ok("邮件标题与正文不含项目名称（CHAIN-4b）", !mail.subject.includes("RCMP 战术背包") && !mail.body.includes("RCMP 战术背包"));
    ok("正文用询价编号介绍项目", mail.body.includes("Sunny Trading Inc. 现就询价 RFQ-SUNNY-2026-7KQ4M 邀请贵司报价，请按以下清单逐项回复。"));
    ok("回信解析依赖的数量行与强制标记写法不变", mail.body.includes("- 数量：1500（请分档报价）") && mail.body.includes("【强制】R-01"));
    ok("正文规格保留原文", mail.body.includes("原文：Backpack shall be 1000D"));
    ok("正文含编号问题", mail.body.includes("Q1.") && mail.body.includes("Q5."));
    ok("正文无内部字段", !/毛利|estimatedValue|ourBidPrice/i.test(mail.body));
  }
}
{
  const r = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, requirements: [req({ requirementCode: "R-01", reviewStatus: "AI_EXTRACTED" })], facts: [] });
  ok("无已确认要求 → NO_CONFIRMED_REQUIREMENTS", !r.ok && r.errorCode === "NO_CONFIRMED_REQUIREMENTS");
}
{
  const r = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, requirements: [req({ requirementCode: "R-01" })], facts: [], scopeNote: "我方 ourBidPrice 上限 60k，请压价" });
  ok("范围说明泄漏内部字段 → SENSITIVE_LEAK 整体拒绝", !r.ok && r.errorCode === "SENSITIVE_LEAK");
}
{
  const r = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, requirements: [req({ requirementCode: "R-01" })], facts: [], quantityTiers: [500, 100, 100, 1000] });
  ok("数量阶梯去重排序", r.ok && JSON.stringify(r.doc.quantityTiers) === "[100,500,1000]");
  const r2 = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, requirements: [req({ requirementCode: "R-01" })], facts: [] });
  ok("无数量 → 留给供应商注明，不编造", r2.ok && r2.doc.quantityTiers === null && !!r2.doc.quantityNote);
}
{
  const r = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, requirements: [req({ requirementCode: "R-01", originalRequirement: "Replacement parts shall be supplied at no additional cost for 2 years; unit price in CAD $." })], facts: [] });
  ok("招标原文含 cost / $ 这类合法词不误拒", r.ok);
  const r2 = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, requirements: [req({ requirementCode: "R-01", chineseTranslation: "我方毛利需保持 30%" })], facts: [] });
  ok("要求原文被内部字段污染 → 拒绝", !r2.ok && r2.errorCode === "SENSITIVE_LEAK");
}
// —— FIX-1：类别判定认得入库的写法（V2 入库为小写；V1 为旧式代码） ——
{
  const build = (requirements: RfqRequirementInput[]) =>
    buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, requirements, facts: [] });
  const one = (category: string) => build([req({ requirementCode: "R-01", category })]);
  const included = (category: string) => { const r = one(category); return r.ok && r.doc.lineItems.length === 1; };

  const lower = build([
    req({ requirementCode: "R-01", category: "product" }),
    req({ requirementCode: "R-02", category: "delivery" }),
    req({ requirementCode: "R-03", category: "technical" }),
  ]);
  ok("小写入库的类别照常进入询价单（3 条）", lower.ok && lower.doc.lineItems.length === 3);
  ok("带空白与混合大小写与大写判定相同", included(" Product ") && included("PRODUCT"));

  const legacyTech = one("mandatory_technical");
  ok("旧式代码 mandatory_technical 进入询价单，行项类别为技术类", legacyTech.ok && legacyTech.doc.lineItems[0]?.category === "TECHNICAL");
  const mixedLegacy = build([req({ requirementCode: "R-01" }), req({ requirementCode: "R-02", category: "mandatory_general" })]);
  ok("旧式代码 mandatory_general 不进入，记 not_supplier_facing",
    mixedLegacy.ok && mixedLegacy.doc.lineItems.length === 1 && mixedLegacy.doc.excluded.some((e) => e.requirementCode === "R-02" && e.reason === "not_supplier_facing"));

  const unknown = build([req({ requirementCode: "R-01" }), req({ requirementCode: "R-02", category: "misc_notes" }), req({ requirementCode: "R-03", category: "" })]);
  ok("未知与空类别不进入，记 not_supplier_facing",
    unknown.ok && unknown.doc.lineItems.length === 1 && unknown.doc.excluded.filter((e) => e.reason === "not_supplier_facing").length === 2);

  const samples = one("samples");
  ok("小写 samples 触发样品提示，行项类别为标准写法",
    samples.ok && samples.doc.lineItems[0]?.category === "SAMPLES" && samples.doc.attachmentsRequested.some((a) => a.includes("样品")));

  const none = build([
    req({ requirementCode: "R-01", category: "insurance" }),
    req({ requirementCode: "R-02", category: "bonding" }),
    req({ requirementCode: "R-03", category: "administrative" }),
  ]);
  ok("全部非供应商侧 → NO_CONFIRMED_REQUIREMENTS", !none.ok && none.errorCode === "NO_CONFIRMED_REQUIREMENTS");

  const unconfirmed = build([req({ requirementCode: "R-01", category: "product", reviewStatus: "AI_EXTRACTED" })]);
  ok("归一不放进未确认的要求", !unconfirmed.ok && unconfirmed.errorCode === "NO_CONFIRMED_REQUIREMENTS");

  // 双源一致：分析契约里的每个类别，大写与小写写法的判定必须相同
  const drift = REQUIREMENT_CATEGORIES.filter((c) => included(c) !== included(c.toLowerCase()));
  ok(`分析契约 ${REQUIREMENT_CATEGORIES.length} 个类别大小写两种写法判定一致`, drift.length === 0);
  ok("分析契约里供应商侧类别恰为 10 个", REQUIREMENT_CATEGORIES.filter((c) => included(c.toLowerCase())).length === 10);
}
// —— CHAIN-4b：招标身份不进询价单 ——
{
  const ottawa = identityOf({ projectName: "Sleeping Bags and Mats", clientOrganization: "City of Ottawa", solicitationNumber: "24062-27-057",
    facts: { tenderNumber: [], buyer: [], projectTitle: [], closingDatetime: [], location: ["Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9"] } });
  const build = (o: Partial<Parameters<typeof buildRfqDocument>[0]> = {}) =>
    buildRfqDocument({ identity: ottawa, buyerDisplayName: "Qyan-Sunny Purchasing", closeDate: null, now, requirements: [req({ requirementCode: "R-01" })], facts: [], ...o });

  const buyerInReq = build({ requirements: [req({ requirementCode: "R-01" }), req({ requirementCode: "R-02", category: "DELIVERY", originalRequirement: "Deliver to the City of Ottawa warehouse.", chineseTranslation: "交付至仓库。" })] });
  ok("要求里写了采购方名称 → IDENTITY_LEAK", !buyerInReq.ok && buyerInReq.errorCode === "IDENTITY_LEAK");
  ok("说明含「命中：采购方名称·要求 R-02」且不复述原文", !buyerInReq.ok && buyerInReq.message.includes("命中：采购方名称·要求 R-02") && !buyerInReq.message.includes("City of Ottawa"));

  const genericTitle = build({ requirements: [req({ requirementCode: "R-01", originalRequirement: "Sleeping bags and mats shall be rated to -20C.", chineseTranslation: "睡袋与睡垫额定 -20C。" })] });
  ok("要求原文与项目名称相同的词不拦", genericTitle.ok && genericTitle.doc.lineItems.length === 1);
  const nameInScope = build({ scopeNote: "本轮只询 Sleeping Bags and Mats" });
  ok("自己填的补充说明写了项目名称 → 命中项目名称·补充说明", !nameInScope.ok && nameInScope.errorCode === "IDENTITY_LEAK" && nameInScope.hits.some((h) => h.category === "project_name" && h.where === "补充说明" && h.kind === "human"));
  const numberInQuestion = build({ extraQuestions: ["请注明是否已在 24062-27-057 投标"] });
  ok("附加问题写了招标编号 → 命中招标编号·第 1 条附加问题", !numberInQuestion.ok && numberInQuestion.errorCode === "IDENTITY_LEAK" && numberInQuestion.hits[0]?.where === "第 1 条附加问题");
  const contact = build({ requirements: [req({ requirementCode: "R-05", category: "DELIVERY", originalRequirement: "Contact j.doe@ottawa.ca or 613-555-0142 to book.", chineseTranslation: "预约交付。" })] });
  ok("要求里的联系人邮箱与电话 → 两类都报，位置为要求 R-05", !contact.ok && contact.errorCode === "IDENTITY_LEAK" && ["email_address", "phone_number"].every((c) => contact.hits.some((h) => h.category === c && h.where === "要求 R-05")));
  const both = build({ scopeNote: "City of Ottawa 的 ourBidPrice 上限" });
  ok("内部敏感词与身份同时出现 → 先报 SENSITIVE_LEAK", !both.ok && both.errorCode === "SENSITIVE_LEAK");

  const exactFact = { type: "location", contentZh: "Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9", contentOriginal: null, confidence: "HIGH", manuallyConfirmed: true };
  const derived = build({ facts: [exactFact] });
  ok("分析里是精确地址 → 目的地只写城市, 省", derived.ok && derived.doc.destination === "Ottawa, ON");
  if (derived.ok) {
    const mail = renderRfqEmail(derived.doc, { supplierName: "S", roundNumber: 1 });
    ok("邮件正文不含街道与邮编", !mail.body.includes("Constellation") && !mail.body.includes("K1A") && mail.body.includes("目的地 Ottawa, ON"));
  }
  const lowConf = build({ facts: [{ ...exactFact, confidence: "LOW", manuallyConfirmed: false }] });
  ok("地点事实置信度不够 → 不写目的地（与此前同一规则）", lowConf.ok && lowConf.doc.destination === null);
  const copied = build({ facts: [exactFact], destination: "2 Constellation Crescent, Ottawa" });
  ok("发起人照抄精确地址 → 命中交货地址·目的地", !copied.ok && copied.errorCode === "IDENTITY_LEAK" && copied.hits.some((h) => h.category === "delivery_address" && h.where === "目的地"));
  const human = build({ facts: [exactFact], destination: "Kanata, ON" });
  ok("人工填写的目的地优先", human.ok && human.doc.destination === "Kanata, ON");
}

ok("回复截止不早于今天+2", computeReplyBy("2026-10-23", now) === "2026-10-24");
ok("截标为空 → 无回复截止", computeReplyBy(null, now) === null);

console.log(`\ntender-rfq: ${passed} passed`);
