/**
 * P1-1 RFQ 生成器 — 纯逻辑测试
 * 运行：npx tsx src/lib/tender-rfq/__tests__/build.test.ts
 */
import assert from "node:assert/strict";
import { buildRfqDocument, computeReplyBy, renderRfqEmail, rfqEmailQuantityZh, rfqLineGroups, rfqMaterialsZh, rfqQuantityZh, rfqTemplateOnlyDocument, type RfqRequirementInput } from "../build";
import { rfqContextFromBody } from "../inbound-contract";
import { rfqAttachmentFilename, rfqAttachmentTemplateSegments, rfqAttachmentTextBlocks } from "../attachment";
import { REQUIREMENT_CATEGORIES } from "@/lib/tender-understanding/contract";
import { buildProjectIdentityDenyList, scanIdentity, scanOutboundRfqEmail, type ProjectIdentitySources } from "@/lib/bid-workflow/project-identity-deny";

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

// RFQ-PDF-2：规格里写死的文字（不从代码常量取，改了代码这里会红）
const EVIDENCE_TITLE = "首次合作或尚未提供过的，请一并提供";
const EVIDENCE_SIX = ["营业执照复印件", "工厂照片（车间与生产现场）", "劳工与安全生产制度说明", "原材料来源（公司与国别）", "材质证书", "BSCI / SMETA / SA8000 审核报告（如有，非强制）"];
const QTY_UNKNOWN = "客户未明确数量，请按贵司常规阶梯（如 100 / 500 / 1000）分别报价。";
const MISSING_ZH = "（暂无中文译文，以原文为准）";
const CLOSING = "为便于比对，请按要求编号逐条回复；做不到的请直接写明，我们更看重准确。";
/** 邮件正文「一、规格要求」一节里的行（不含节标题） */
const specSection = (body: string) => body.slice(body.indexOf("一、规格要求"), body.indexOf("\n二、商务条件")).split("\n").slice(1).filter((l) => l !== "");

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
    ok("只收 CONFIRMED + 供应商侧，按组排好：R-01（产品）、R-05（样品）、R-02（交付）", d.lineItems.map((i) => i.requirementCode).join(",") === "R-01,R-05,R-02");
    ok("排除原因可核对", d.excluded.some((e) => e.requirementCode === "R-03" && e.reason === "not_supplier_facing") && d.excluded.some((e) => e.requirementCode === "R-04" && e.reason === "not_confirmed"));
    ok("行项带原要求编号与是否强制", d.lineItems[0].requirementCode === "R-01" && d.lineItems[0].mandatory === true && d.lineItems[2].requirementCode === "R-02" && d.lineItems[2].mandatory === false);
    ok("行项上没有来源页码与序号（来源页码不进询价单）", d.lineItems.every((i) => !("sourcePage" in i) && !("seq" in i)));
    ok("没填数量阶梯：不把事实当阶梯，留 HIGH 置信数量事实的中文原文与从原文解析出的数量 1500", d.quantityTiers === null && d.quantityFactZh === "最多 1,500 个" && d.quantityFactQty === 1500 && d.quantityNote === null);
    ok("显式 destination 优先于 LOW 置信 location 事实", d.destination === "Toronto, ON");
    ok("回复截止 = 截标 − 7 天", d.replyBy === "2026-11-07");
    ok("强制要求派生逐条回复问题，且只含强制项（R-01、R-05）", d.fixedQuestions[0].relatedCodes.join(",") === "R-01,R-05");
    ok("SAMPLES → 附件请求", d.attachmentsRequested.some((a) => a.includes("样品")));
    const mail = renderRfqEmail(d, { supplierName: "王总", roundNumber: 1 });
    ok("邮件标题用询价编号、含轮次与截止", mail.subject === "询价 RFQ-SUNNY-2026-7KQ4M（第 1 轮） — 请于 2026-11-07 前回复");
    ok("邮件标题与正文不含项目名称（CHAIN-4b）", !mail.subject.includes("RCMP 战术背包") && !mail.body.includes("RCMP 战术背包"));
    ok("正文用询价编号介绍项目", mail.body.includes("Sunny Trading Inc. 现就询价 RFQ-SUNNY-2026-7KQ4M 邀请贵司报价，请按以下清单逐项回复。"));
    ok("回信解析依赖的数量行仍以「- 数量：」开头：先写解析出的数量，括号里是数量事实的中文原文", mail.body.includes("\n- 数量：1500（最多 1,500 个）\n"));
    ok("回信解析从这封正文读出的首档数量与改版前相同（1500）", rfqContextFromBody(mail.body).firstTierQty === 1500);
    ok("必须类要求写作「{要求编号} 【必须】」，不再写【强制】", mail.body.includes("\nR-01 【必须】背包须为 1000D 考杜拉尼龙，容量不低于 30L。\n") && !mail.body.includes("【强制】"));
    ok("正文规格保留原文", mail.body.includes("\n   原文：Backpack shall be 1000D Cordura nylon, minimum 30L.\n"));
    ok("正文含编号问题", mail.body.includes("Q1.") && mail.body.includes("Q5."));
    ok("正文无内部字段", !/毛利|estimatedValue|ourBidPrice/i.test(mail.body));
  }
}
{
  const r = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", requirements: [req({ requirementCode: "R-01", reviewStatus: "AI_EXTRACTED" })], facts: [] });
  ok("无已确认要求 → NO_CONFIRMED_REQUIREMENTS", !r.ok && r.errorCode === "NO_CONFIRMED_REQUIREMENTS");
}
{
  const r = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", requirements: [req({ requirementCode: "R-01" })], facts: [], scopeNote: "我方 ourBidPrice 上限 60k，请压价" });
  ok("范围说明泄漏内部字段 → SENSITIVE_LEAK 整体拒绝", !r.ok && r.errorCode === "SENSITIVE_LEAK");
}
{
  const r = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", requirements: [req({ requirementCode: "R-01" })], facts: [], quantityTiers: [500, 100, 100, 1000] });
  ok("数量阶梯去重排序", r.ok && JSON.stringify(r.doc.quantityTiers) === "[100,500,1000]");
  const r2 = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", requirements: [req({ requirementCode: "R-01" })], facts: [] });
  ok("无数量 → 留给供应商注明，不编造", r2.ok && r2.doc.quantityTiers === null && r2.doc.quantityFactZh === null && r2.doc.quantityFactQty === null && r2.doc.quantityNote === "客户未明确数量，请按贵司常规阶梯（如 100 / 500 / 1000）分别报价。");
}
{
  const r = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", requirements: [req({ requirementCode: "R-01", originalRequirement: "Replacement parts shall be supplied at no additional cost for 2 years; unit price in CAD $." })], facts: [] });
  ok("招标原文含 cost / $ 这类合法词不误拒", r.ok);
  const r2 = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", requirements: [req({ requirementCode: "R-01", chineseTranslation: "我方毛利需保持 30%" })], facts: [] });
  ok("要求原文被内部字段污染 → 拒绝", !r2.ok && r2.errorCode === "SENSITIVE_LEAK");
}
// —— FIX-1：类别判定认得入库的写法（V2 入库为小写；V1 为旧式代码） ——
{
  const build = (requirements: RfqRequirementInput[]) =>
    buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", requirements, facts: [] });
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
  if (samples.ok) {
    const m = rfqMaterialsZh(samples.doc);
    ok("样品一项之后是固定的一组六项（组名与六项不随要求类别变化）",
      m.derived.join("|") === "样品（按要求里写的规格）" && m.groupTitle === EVIDENCE_TITLE && m.group.join("|") === EVIDENCE_SIX.join("|"));
    const noDerived = one("product");
    ok("没有派生项的询价单：固定的一组六项照样在", noDerived.ok && rfqMaterialsZh(noDerived.doc).derived.length === 0 && rfqMaterialsZh(noDerived.doc).group.join("|") === EVIDENCE_SIX.join("|"));
  }

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
    buildRfqDocument({ identity: ottawa, buyerDisplayName: "Qyan-Sunny Purchasing", closeDate: null, now, timeZone: "UTC", requirements: [req({ requirementCode: "R-01" })], facts: [], ...o });

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

// —— RFQ-PDF-2：行项的分组与顺序 ——
{
  // 按编号依次是交付、产品、安全、样品、技术、培训类；输入顺序另外打乱（结果与输入怎么排无关）
  const shuffled = [
    req({ requirementCode: "R-06", category: "TRAINING", mandatory: false }),
    req({ requirementCode: "R-05", category: "TECHNICAL" }),
    req({ requirementCode: "R-01", category: "DELIVERY" }),
    req({ requirementCode: "R-04", category: "SAMPLES" }),
    req({ requirementCode: "R-02", category: "PRODUCT" }),
    req({ requirementCode: "R-03", category: "SAFETY" }),
  ];
  const r = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", requirements: shuffled, facts: [] });
  ok("打乱类别的要求：生成成功", r.ok);
  if (r.ok) {
    ok("行项顺序：产品、技术、安全、样品、交付、培训（R-02,R-05,R-03,R-04,R-01,R-06）", r.doc.lineItems.map((i) => i.requirementCode).join(",") === "R-02,R-05,R-03,R-04,R-01,R-06");
    const groups = rfqLineGroups(r.doc);
    ok("四个组依次是「产品与规格 / 安全与认证 / 样品与图纸 / 交付、质保与服务」", groups.map((g) => g.titleZh).join("|") === "产品与规格|安全与认证|样品与图纸|交付、质保与服务");
    ok("四个组的条数分别是 2、1、1、2", groups.map((g) => g.items.length).join(",") === "2,1,1,2");
    ok("行项上没有序号与来源页码", r.doc.lineItems.every((i) => !("seq" in i) && !("sourcePage" in i)));
    ok("类型用词：强制 →「必须」，非强制 →「加分」", r.doc.lineItems.map((i) => i.kind).join(",") === "必须,必须,必须,必须,必须,加分");
    const reversed = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", requirements: [...shuffled].reverse(), facts: [] });
    ok("输入顺序反过来，行项顺序不变", reversed.ok && reversed.doc.lineItems.map((i) => i.requirementCode).join(",") === "R-02,R-05,R-03,R-04,R-01,R-06");
  }
  // 十个供应商侧类别各归哪一组；组内按要求编号升序（与类别在组里的先后无关）
  const all = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", facts: [], requirements: [
    req({ requirementCode: "A-10", category: "TRAINING" }), req({ requirementCode: "A-09", category: "INSTALLATION" }),
    req({ requirementCode: "A-08", category: "WARRANTY" }), req({ requirementCode: "A-07", category: "DELIVERY" }),
    req({ requirementCode: "A-06", category: "SHOP_DRAWINGS" }), req({ requirementCode: "A-05", category: "SAMPLES" }),
    req({ requirementCode: "A-04", category: "SAFETY" }),
    req({ requirementCode: "A-03", category: "PRODUCT" }), req({ requirementCode: "A-02", category: "PERFORMANCE" }), req({ requirementCode: "A-01", category: "TECHNICAL" }),
  ] });
  ok("十个类别归四组：3 / 1 / 2 / 4 条，组内按编号升序",
    all.ok && rfqLineGroups(all.doc).map((g) => g.items.map((i) => i.requirementCode).join("+")).join(" | ") === "A-01+A-02+A-03 | A-04 | A-05+A-06 | A-07+A-08+A-09+A-10");
  const onlyTwo = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", facts: [], requirements: [req({ requirementCode: "R-02", category: "WARRANTY" }), req({ requirementCode: "R-01", category: "SAFETY" })] });
  ok("没有条目的组不出现", onlyTwo.ok && rfqLineGroups(onlyTwo.doc).map((g) => `${g.titleZh}:${g.items.length}`).join("|") === "安全与认证:1|交付、质保与服务:1");
}
// —— RFQ-PDF-2：数量的三种写法 ——
{
  const qtyFact = (contentZh: string, o: Partial<{ confidence: string; manuallyConfirmed: boolean }> = {}) => ({ type: "quantity", contentZh, contentOriginal: null, confidence: "HIGH", manuallyConfirmed: false, ...o });
  const build = (o: Partial<Parameters<typeof buildRfqDocument>[0]> = {}) =>
    buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", requirements: [req({ requirementCode: "R-01" })], facts: [], ...o });
  const qtyLine = (body: string) => body.split("\n").find((l) => l.startsWith("- 数量："));

  const tiers = build({ quantityTiers: [500, 1000], facts: [qtyFact("约 1,240 套（三年合同期）")] });
  ok("发起人填了 500 与 1000 两档 → 「500 / 1000（请分档报价）」（有数量事实也以人填的为准）",
    tiers.ok && rfqQuantityZh(tiers.doc) === "500 / 1000（请分档报价）" && JSON.stringify(tiers.doc.quantityTiers) === "[500,1000]" && tiers.doc.quantityFactZh === null && tiers.doc.quantityFactQty === null && tiers.doc.quantityNote === null);
  ok("两档：邮件正文的数量行与附件同一写法", tiers.ok && qtyLine(renderRfqEmail(tiers.doc).body) === "- 数量：500 / 1000（请分档报价）" && rfqEmailQuantityZh(tiers.doc) === rfqQuantityZh(tiers.doc));
  ok("两档：回信解析读出首档 500", tiers.ok && rfqContextFromBody(renderRfqEmail(tiers.doc).body).firstTierQty === 500);

  const factOnly = build({ facts: [qtyFact("约 1,240 套（三年合同期）")] });
  ok("没填、数量事实为「约 1,240 套（三年合同期）」→ 数量一行照印事实的中文原文，不当成阶梯",
    factOnly.ok && rfqQuantityZh(factOnly.doc) === "约 1,240 套（三年合同期）" && factOnly.doc.quantityTiers === null && factOnly.doc.quantityNote === null);
  ok("数量事实：附件「询价内容」的数量行只印事实的中文原文", factOnly.ok && rfqAttachmentTextBlocks(factOnly.doc, { draftedOn: "2026-10-22" }).includes("数量：约 1,240 套（三年合同期）"));
  ok("数量事实：邮件正文的数量行开头先写解析出的数量", factOnly.ok && factOnly.doc.quantityFactQty === 1240 && qtyLine(renderRfqEmail(factOnly.doc).body) === "- 数量：1240（约 1,240 套（三年合同期））");

  // 事实原文与中文各有写法：数量取原文里的第一个数字（与改版前同一个解析），括号里印中文
  const bilingual = build({ facts: [{ ...qtyFact("三年合同期约 1,240 套"), contentOriginal: "Approximately 1,240 units over a 3-year term" }] });
  ok("事实原文 Approximately 1,240 units over a 3-year term、中文「三年合同期约 1,240 套」→ 邮件数量行「- 数量：1240（三年合同期约 1,240 套）」",
    bilingual.ok && bilingual.doc.quantityFactQty === 1240 && qtyLine(renderRfqEmail(bilingual.doc).body) === "- 数量：1240（三年合同期约 1,240 套）");
  ok("同一事实：回信解析读出首档数量 1240", bilingual.ok && rfqContextFromBody(renderRfqEmail(bilingual.doc).body).firstTierQty === 1240);
  ok("同一事实：附件数量行是「三年合同期约 1,240 套」（不带解析出的数字）",
    bilingual.ok && rfqQuantityZh(bilingual.doc) === "三年合同期约 1,240 套" && rfqAttachmentTextBlocks(bilingual.doc, { draftedOn: "2026-10-22" }).includes("数量：三年合同期约 1,240 套") && !rfqAttachmentTextBlocks(bilingual.doc, { draftedOn: "2026-10-22" }).some((b) => b.includes("1240（")));
  const yearFirst = build({ facts: [{ ...qtyFact("3 年合同期约 1,240 套"), contentOriginal: "Approximately 1,240 units over a 3-year term" }] });
  ok("中文把年数写在前面（3 年合同期约 1,240 套）：首档数量仍是原文里的 1240，不是 3",
    yearFirst.ok && qtyLine(renderRfqEmail(yearFirst.doc).body) === "- 数量：1240（3 年合同期约 1,240 套）" && rfqContextFromBody(renderRfqEmail(yearFirst.doc).body).firstTierQty === 1240);
  const confirmedFact = build({ facts: [qtyFact("三年合同期约 1,240 套", { confidence: "LOW", manuallyConfirmed: true })] });
  ok("人工确认的数量事实（置信度低）同样照印", confirmedFact.ok && rfqQuantityZh(confirmedFact.doc) === "三年合同期约 1,240 套" && confirmedFact.doc.quantityFactQty === 1240);
  const noDigits = build({ facts: [qtyFact("数量见分项清单")] });
  ok("数量事实里解析不出数字 → 邮件数量行只写事实原文，回信解析读不出首档数量",
    noDigits.ok && noDigits.doc.quantityFactQty === null && qtyLine(renderRfqEmail(noDigits.doc).body) === "- 数量：数量见分项清单" && rfqContextFromBody(renderRfqEmail(noDigits.doc).body).firstTierQty === null);
  const unclearInFact = build({ facts: [qtyFact("总量 500 套，分批数量未明确")] });
  ok("数量事实中文里带「未明确」三个字：首档数量仍读得出 500",
    unclearInFact.ok && qtyLine(renderRfqEmail(unclearInFact.doc).body) === "- 数量：500（总量 500 套，分批数量未明确）" && rfqContextFromBody(renderRfqEmail(unclearInFact.doc).body).firstTierQty === 500);

  const neither = build();
  ok("没填也没有数量事实 → 那句「客户未明确数量…」", neither.ok && rfqQuantityZh(neither.doc) === QTY_UNKNOWN && neither.doc.quantityFactQty === null);
  ok("都没有：邮件正文的数量行", neither.ok && qtyLine(renderRfqEmail(neither.doc).body) === `- 数量：${QTY_UNKNOWN}`);
  ok("都没有：回信解析当作正文没给数量（那句话里的 100 / 500 / 1000 不算）", neither.ok && rfqContextFromBody(renderRfqEmail(neither.doc).body).firstTierQty === null);
  const lowFact = build({ facts: [qtyFact("约 1,240 套", { confidence: "LOW" })] });
  ok("数量事实置信度不够且未人工确认 → 不印，写「客户未明确数量…」", lowFact.ok && lowFact.doc.quantityFactZh === null && lowFact.doc.quantityFactQty === null && rfqQuantityZh(lowFact.doc) === QTY_UNKNOWN);

  // 数量事实是招标文本：进招标身份检查，位置「数量」
  const ottawa = identityOf({ projectName: "Sleeping Bags and Mats", clientOrganization: "City of Ottawa", solicitationNumber: "24062-27-057",
    facts: { tenderNumber: [], buyer: [], projectTitle: [], closingDatetime: [], location: ["Delivery to 2 Constellation Crescent, Ottawa, ON K1A 0K9"] } });
  const buyerInQty = build({ identity: ottawa, facts: [qtyFact("City of Ottawa 三年合同期共 1,240 套")] });
  ok("数量事实写着采购方名称 → IDENTITY_LEAK，位置为「数量」",
    !buyerInQty.ok && buyerInQty.errorCode === "IDENTITY_LEAK" && buyerInQty.hits.length === 1 && buyerInQty.hits[0].category === "buyer_name" && buyerInQty.hits[0].where === "数量" && buyerInQty.hits[0].kind === "tender");
  ok("数量命中的说明写类别与位置、不复述原文", !buyerInQty.ok && buyerInQty.message.includes("命中：采购方名称·数量") && !buyerInQty.message.includes("City of Ottawa"));
  const addressInQty = build({ identity: ottawa, facts: [qtyFact("1,240 套，送至 2 Constellation Crescent")] });
  ok("数量事实写着门牌地址 → IDENTITY_LEAK，命中交货地址·数量",
    !addressInQty.ok && addressInQty.errorCode === "IDENTITY_LEAK" && addressInQty.hits.length === 1 && addressInQty.hits[0].category === "delivery_address" && addressInQty.hits[0].where === "数量");
  const buyerButTiers = build({ identity: ottawa, quantityTiers: [500], facts: [qtyFact("City of Ottawa 三年合同期共 1,240 套")] });
  ok("发起人填了阶梯时不印数量事实，事实里的采购方名称带不进来", buyerButTiers.ok && rfqQuantityZh(buyerButTiers.doc) === "500（请分档报价）" && !renderRfqEmail(buyerButTiers.doc).body.includes("City of Ottawa"));
}
// —— RFQ-PDF-2：回复截止早于截标日（组织时区 America/Toronto，截标为当地 2026-12-05） ——
{
  const TZ = "America/Toronto";
  const CLOSE = "2026-12-05T19:00:00Z"; // 多伦多当地 12-05 14:00
  const noon = (ymd: string) => new Date(`${ymd}T17:00:00Z`); // 多伦多当地 12:00（当地日期明确）
  const fed = identityOf({ projectName: "Sleeping Bags and Mats", closeDate: new Date(CLOSE) });
  const cases: Array<{ on: string; lead: number; want: string | null }> = [
    { on: "2026-11-19", lead: 7, want: "2026-11-28" },
    { on: "2026-12-03", lead: 7, want: "2026-12-04" },
    { on: "2026-12-04", lead: 7, want: "2026-12-04" },
    { on: "2026-12-05", lead: 7, want: null },
    { on: "2026-11-19", lead: 0, want: "2026-12-04" },
  ];
  for (const c of cases) {
    const label = `当地 ${c.on.slice(5)} 起草、提前量 ${c.lead} 天`;
    ok(`${label} → 回复截止 ${c.want ?? "不写日期（请尽快）"}`, computeReplyBy(CLOSE, noon(c.on), c.lead, TZ) === c.want);
    const r = buildRfqDocument({ identity: fed, buyerDisplayName: "Sunny Trading Inc.", closeDate: CLOSE, now: noon(c.on), timeZone: TZ, replyLeadDays: c.lead, requirements: [req({ requirementCode: "R-01" })], facts: [] });
    ok(`${label}：询价单生成得出来，回复截止不等于截标日期`, r.ok && r.doc.replyBy === c.want && r.doc.replyBy !== "2026-12-05");
    if (r.ok) {
      const mail = renderRfqEmail(r.doc, { roundNumber: 1 });
      ok(`${label}：邮件的回复截止一行与标题`, mail.body.includes(`\n- 回复截止：${c.want ?? "请尽快"}\n`) && mail.subject === `询价 RFQ-TEST-2026-ABCDE（第 1 轮）${c.want ? ` — 请于 ${c.want} 前回复` : ""}`);
      ok(`${label}：邮件与附件模板文字都不命中截标日期`,
        scanOutboundRfqEmail(fed.denyList, mail).length === 0
        && scanIdentity(fed.denyList, rfqAttachmentTemplateSegments(rfqTemplateOnlyDocument(r.doc, null), { draftedOn: c.on })).length === 0
        && !mail.subject.includes("2026-12-05") && !mail.body.includes("2026-12-05"));
      if (c.want === null) ok(`${label}：附件的回复截止写「请尽快」`, rfqAttachmentTextBlocks(r.doc, { draftedOn: c.on }).join("\n").includes("回复截止\n请尽快"));
    }
  }
  // 截标时刻在当地是前一天：按当地日期算
  const lateClose = "2026-12-06T03:00:00Z"; // 多伦多当地 12-05 22:00
  ok("截标 2026-12-06T03:00Z（当地 12-05 22:00）、12-04 起草 → 2026-12-04，不是当地的截标日 2026-12-05", computeReplyBy(lateClose, noon("2026-12-04"), 7, TZ) === "2026-12-04");
  ok("同一截标、当地 11-19 起草 → 当地截标日减 7 天 = 2026-11-28（不是 UTC 日期减出来的 11-29）", computeReplyBy(lateClose, noon("2026-11-19"), 7, TZ) === "2026-11-28");
  const lateDoc = buildRfqDocument({ identity: identityOf({ projectName: "Sleeping Bags and Mats", closeDate: new Date(lateClose) }), buyerDisplayName: "B", closeDate: lateClose, now: noon("2026-12-04"), timeZone: TZ, requirements: [req({ requirementCode: "R-01" })], facts: [] });
  ok("同一情形经询价单生成：回复截止 2026-12-04", lateDoc.ok && lateDoc.doc.replyBy === "2026-12-04");
  // 起草时刻在当地还是前一天（UTC 已过零点）：今天按当地日期
  ok("UTC 12-04 02:00（当地 12-03 21:00）起草 → 今天按当地 12-03 算，回复截止 2026-12-04", computeReplyBy(CLOSE, new Date("2026-12-04T02:00:00Z"), 7, TZ) === "2026-12-04");
  ok("UTC 12-05 02:00（当地 12-04 21:00）起草 → 当地还没到截标日，回复截止 2026-12-04", computeReplyBy(CLOSE, new Date("2026-12-05T02:00:00Z"), 7, TZ) === "2026-12-04");
  ok("截标已过（当地 12-06 起草）→ 不写日期", computeReplyBy(CLOSE, noon("2026-12-06"), 7, TZ) === null);
  ok("截标日期无效 → 不写日期", computeReplyBy("not-a-date", noon("2026-11-19"), 7, TZ) === null);
}
// —— RFQ-PDF-2：招标原文的内部字段检查（译文、原文、要求编号、数量事实） ——
{
  const build = (o: Partial<Parameters<typeof buildRfqDocument>[0]> = {}) =>
    buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", requirements: [req({ requirementCode: "R-01" })], facts: [], ...o });
  const leak = (r: ReturnType<typeof build>) => !r.ok && r.errorCode === "SENSITIVE_LEAK";
  ok("译文写着「我方报价 98.7 万」→ SENSITIVE_LEAK", leak(build({ requirements: [req({ requirementCode: "R-01", chineseTranslation: "我方报价 98.7 万" })] })));
  ok("原文写着 target margin 31% → SENSITIVE_LEAK", leak(build({ requirements: [req({ requirementCode: "R-01", originalRequirement: "Bags rated to -20C; target margin 31%." })] })));
  ok("要求编号是「底价-01」→ SENSITIVE_LEAK", leak(build({ requirements: [req({ requirementCode: "底价-01" })] })));
  ok("数量事实写着「内部成本 80 元，共 300 件」→ SENSITIVE_LEAK", leak(build({ facts: [{ type: "quantity", contentZh: "内部成本 80 元，共 300 件", contentOriginal: null, confidence: "HIGH", manuallyConfirmed: true }] })));
  ok("交付要求事实写着「我方成本」→ SENSITIVE_LEAK", leak(build({ facts: [{ type: "delivery", contentZh: "下单后 60 天交付（我方成本另计）", contentOriginal: null, confidence: "HIGH", manuallyConfirmed: true }] })));
  const mixed = build({ requirements: [req({ requirementCode: "R-01" }), req({ requirementCode: "R-02", chineseTranslation: "我方报价 98.7 万" })] });
  ok("命中时整份失败：不是删掉命中的那一条后继续", leak(mixed) && !("doc" in mixed));
  // 词表里的每一个词放进原文都拦（字段名三个 + 词十二个）
  const words = ["estimatedValue", "ourBidPrice", "winningBidPrice", "毛利", "利润率", "底价", "我方预算", "中标概率", "我方报价", "我方成本", "内部成本", "目标毛利", "our bid price", "Target Margin", "internal  cost"];
  const missed = words.filter((w) => !leak(build({ requirements: [req({ requirementCode: "R-01", originalRequirement: `Bags shall be rated to -20C (${w}).` })] })));
  ok(`内部字段与词共 ${words.length} 个，写进原文个个都拦`, missed.length === 0);
  const fine = build({ requirements: [req({ requirementCode: "R-01", originalRequirement: "Spare parts shall be supplied at no additional cost to the buyer, within budget.", chineseTranslation: "备件须免费提供，不超出预算。" })] });
  ok("原文写着 at no additional cost to the buyer, within budget 的要求照常进入询价单", fine.ok && fine.doc.lineItems.length === 1 && fine.doc.lineItems[0].specOriginal === "Spare parts shall be supplied at no additional cost to the buyer, within budget.");
  const money = build({ requirements: [req({ requirementCode: "R-01", originalRequirement: "Unit price shall not exceed CAD $45.00; total cost and budget ceiling are stated in Annex B.", chineseTranslation: "单价不超过 45 加元；总成本与预算上限见附件 B。" })] });
  ok("招标原文里的金额、cost、budget、成本、预算不拦", money.ok);
  ok("人写的范围说明仍按全量词表：写着 budget → SENSITIVE_LEAK", leak(build({ scopeNote: "within our budget" })));
  const acosta = build({ contactName: "Acosta" });
  ok("联系人不在询价单生成时过敏感词：经办人叫 Acosta（含 cost）照常生成并带进询价单", acosta.ok && acosta.doc.contactName === "Acosta");
}
// —— RFQ-PDF-2：没有中文译文的要求 ——
{
  const r = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", facts: [], requirements: [
    req({ requirementCode: "R-01", chineseTranslation: null, originalRequirement: "Bags shall be rated to -20C." }),
    req({ requirementCode: "R-02" }),
    req({ requirementCode: "R-03", chineseTranslation: "Zippers shall be YKK #10.", originalRequirement: "Zippers shall be YKK #10." }),
    req({ requirementCode: "R-04", chineseTranslation: "  ", originalRequirement: "拉链须为 YKK 10 号。" }),
    req({ requirementCode: "R-05", chineseTranslation: "提供 MSDS/SDS 与 OEKO-TEX Standard 100 证书", originalRequirement: "Provide MSDS/SDS and OEKO-TEX Standard 100 certificates." }),
  ] });
  ok("缺译文不影响生成", r.ok);
  if (r.ok) {
    ok("译文为空、原文是英文 → 缺译文；有中文译文 → 不缺", r.doc.lineItems[0].missingZh === true && r.doc.lineItems[1].missingZh === false);
    ok("译文与原文相同且是外文（没翻出来）→ 缺译文", r.doc.lineItems[2].missingZh === true);
    ok("没有译文但原文本来就是中文 → 不缺", r.doc.lineItems[3].missingZh === false && r.doc.lineItems[3].specZh === "拉链须为 YKK 10 号。");
    ok("中英混排的译文「提供 MSDS/SDS 与 OEKO-TEX Standard 100 证书」（中文占比很低）→ 不算缺，照印译文",
      r.doc.lineItems[4].missingZh === false && r.doc.lineItems[4].specZh === "提供 MSDS/SDS 与 OEKO-TEX Standard 100 证书");
    ok("询价单算出 2 条没有中文译文", r.doc.missingTranslationCount === 2);
    const body = renderRfqEmail(r.doc).body;
    ok("邮件正文：缺译文的行在中文位置印那一句，其下照印原文", body.includes(`\nR-01 【必须】${MISSING_ZH}\n   原文：Bags shall be rated to -20C.\n`));
    ok("邮件正文：没翻出来的行不把外文当中文印（只在原文行出现一次）", body.includes(`\nR-03 【必须】${MISSING_ZH}\n   原文：Zippers shall be YKK #10.\n`) && body.split("Zippers shall be YKK #10.").length === 2);
    ok("邮件正文：有译文的行照常", body.includes("\nR-02 【必须】背包须为 1000D 考杜拉尼龙，容量不低于 30L。\n   原文：Backpack shall be 1000D Cordura nylon, minimum 30L.\n"));
    ok("邮件正文：原文是中文且没有译文的行只印一遍，不加那一句", body.includes("\nR-04 【必须】拉链须为 YKK 10 号。\nR-05 【必须】"));
    ok("邮件正文：中英混排的译文照印，原文在下一行", body.includes("\nR-05 【必须】提供 MSDS/SDS 与 OEKO-TEX Standard 100 证书\n   原文：Provide MSDS/SDS and OEKO-TEX Standard 100 certificates.\n"));
    ok("那一句只出现在缺译文的两行", body.split(MISSING_ZH).length === 3);
  }
  const allZh = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", facts: [], requirements: [req({ requirementCode: "R-01" })] });
  ok("全部有译文 → 0 条", allZh.ok && allZh.doc.missingTranslationCount === 0 && !renderRfqEmail(allZh.doc).body.includes(MISSING_ZH));
}
// —— RFQ-PDF-2：询价邮件正文的写法（新正文） ——
{
  const r = buildRfqDocument({ identity: ID, buyerDisplayName: "Sunny Trading Inc.", closeDate: null, now, timeZone: "UTC", facts: [], extraQuestions: ["能否提供 FSC 认证？"], requirements: [
    req({ requirementCode: "R-01", category: "DELIVERY", originalRequirement: "Delivery within 60 days of PO.", chineseTranslation: "下单后 60 天内交付。", sourcePage: 14 }),
    req({ requirementCode: "R-02", category: "PRODUCT" }),
    req({ requirementCode: "R-03", category: "SAFETY", originalRequirement: "CPAI-84 flame resistance.", chineseTranslation: "符合 CPAI-84 阻燃标准。" }),
    req({ requirementCode: "R-04", category: "SAMPLES", originalRequirement: "Two pre-production samples.", chineseTranslation: "两件产前样。" }),
    req({ requirementCode: "R-05", category: "TECHNICAL", mandatory: false, originalRequirement: "YKK zippers preferred.", chineseTranslation: "优先选用 YKK 拉链。" }),
    req({ requirementCode: "R-06", category: "WARRANTY", originalRequirement: "24-month warranty.", chineseTranslation: "质保 24 个月。" }),
  ] });
  ok("新正文：生成成功", r.ok);
  if (r.ok) {
    const d = r.doc;
    const body = renderRfqEmail(d, { supplierName: "王总", roundNumber: 1 }).body;
    const lines = specSection(body);
    const titles = lines.filter((l) => /^【[^】]+】（\d+ 条）$/.test(l));
    const originals = lines.filter((l) => l.startsWith("   原文："));
    const rows = lines.filter((l) => !titles.includes(l) && !originals.includes(l));
    ok("每组一行组标题带条数", titles.join("|") === "【产品与规格】（2 条）|【安全与认证】（1 条）|【样品与图纸】（1 条）|【交付、质保与服务】（2 条）");
    ok("规格行条数与行项相同（6 行），每行以要求编号开头、接【必须】或【加分】", rows.length === 6 && rows.every((l) => /^R-0\d 【(?:必须|加分)】\S/.test(l)));
    ok("规格行顺序与行项（也就是附件）相同", rows.map((l) => l.split(" ")[0]).join(",") === d.lineItems.map((i) => i.requirementCode).join(",") && rows.map((l) => l.split(" ")[0]).join(",") === "R-02,R-05,R-03,R-04,R-01,R-06");
    const attRows = rfqAttachmentTextBlocks(d, { draftedOn: "2026-10-22" }).filter((b) => /^R-0\d$/.test(b));
    ok("附件规格行的编号顺序与正文一致", attRows.join(",") === rows.map((l) => l.split(" ")[0]).join(","));
    ok("组标题在各组第一行之前、组内行紧跟其后", lines.indexOf("【安全与认证】（1 条）") === lines.findIndex((l) => l.startsWith("R-03 ")) - 1 && lines.indexOf("【交付、质保与服务】（2 条）") === lines.findIndex((l) => l.startsWith("R-01 ")) - 1);
    ok("没有「1.」这样的序号", !/^\d+[.、]\s/m.test(body));
    ok("没有「招标文件 p.」（来源页码 14 不进正文）", !body.includes("招标文件") && !/p\.\s?14/.test(body));
    ok("出现【必须】【加分】，没有【强制】【评分】", body.includes("R-02 【必须】") && body.includes("R-05 【加分】优先选用 YKK 拉链。") && !body.includes("【强制】") && !body.includes("【评分】"));
    ok("原文与中文不同时下一行印「原文：…」", lines[lines.indexOf("R-05 【加分】优先选用 YKK 拉链。") + 1] === "   原文：YKK zippers preferred.");
    const q1 = body.split("\n").find((l) => l.startsWith("Q1. "));
    ok("Q1 写「以下必须满足的要求请逐条回复……」并列出必须类的编号（按正文顺序，不含加分项 R-05）",
      q1 === "Q1. 以下必须满足的要求请逐条回复「满足 / 部分满足（说明差异）/ 不满足」：R-02、R-03、R-04、R-01、R-06");
    ok("Q1 列出的编号就是必须类的那些", d.fixedQuestions[0].relatedCodes.join(",") === d.lineItems.filter((i) => i.mandatory).map((i) => i.requirementCode).join(","));
    const qs = body.split("\n").filter((l) => /^Q\d+\. /.test(l));
    ok("固定问题 Q1–Q5 保留，附加问题接着编号为 Q6", qs.length === 6 && qs[1].startsWith("Q2. 各数量档的单价") && qs[2].startsWith("Q3. 收到订单后的生产交期") && qs[3].startsWith("Q4. 报价有效期") && qs[4].startsWith("Q5. 可提供的认证") && qs[5] === "Q6. 能否提供 FSC 认证？");
    ok("结尾是按要求编号回复的那一句，其后只有落款", body.endsWith(`\n\n${CLOSING}\n\nSunny Trading Inc.`));
    const materials = body.slice(body.indexOf("四、请随报价提供"), body.indexOf(CLOSING)).split("\n").slice(1).filter((l) => l !== "");
    ok("材料清单：派生项（按行项顺序：安全、样品、质保），然后组名与固定六项", materials.join("\n") === [
      "- 安全/合规证书或检测报告", "- 样品（按要求里写的规格）", "- 质保条款书面说明",
      `${EVIDENCE_TITLE}：`, ...EVIDENCE_SIX.map((x) => `- ${x}`),
    ].join("\n"));
    const m = rfqMaterialsZh(d);
    ok("材料清单与附件同序同条数（3 项派生 + 6 项固定）", m.derived.length === 3 && m.group.length === 6 && materials.filter((l) => l.startsWith("- ")).map((l) => l.slice(2)).join("|") === [...m.derived, ...m.group].join("|"));
    ok("不带附件：正文没有附件那一句", !body.includes("附件《"));

    // 带附件的那一句（新文字），插在结尾那一句之前
    const fn = rfqAttachmentFilename(d.reference);
    const withA = renderRfqEmail(d, { supplierName: "王总", roundNumber: 1, attachmentFilename: fn }).body;
    const sentence = `附件《询价单-RFQ-TEST-2026-ABCDE.pdf》是上面清单的表格版，方便转给技术同事核对；可以直接在邮件里按编号回复，也可以把填好的表以 Excel 或可复制文字的 PDF 发回（请不要只发照片或扫描件）。`;
    ok("带附件：结尾那一句之前多一句（新文字）", withA.includes(`\n\n${sentence}\n\n${CLOSING}\n\nSunny Trading Inc.`));
    ok("带附件：除那一句之外正文不变", withA.replace(`${sentence}\n\n`, "") === body);
    ok("带附件那一句不再写「填好表格随报价一起发回」，不写页数", !withA.includes("填好表格随报价一起发回") && !/\d+ 页/.test(withA));
  }
  const onlyOptional = buildRfqDocument({ identity: ID, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", facts: [], requirements: [req({ requirementCode: "R-01", mandatory: false })] });
  ok("没有必须类要求：不出「以下必须满足的要求」一问，其余四问从 Q1 编起",
    onlyOptional.ok && onlyOptional.doc.fixedQuestions.length === 4 && !renderRfqEmail(onlyOptional.doc).body.includes("以下必须满足的要求") && renderRfqEmail(onlyOptional.doc).body.includes("\nQ1. 各数量档的单价（含包装），以及最小起订量（MOQ）。\n"));
}
// —— RFQ-PDF-2：联系人与邮箱（只印在附件抬头；不在询价单生成时过敏感词与身份检查，随附件模板文字一起查） ——
{
  const fed = identityOf({ projectName: "Sleeping Bags and Mats" });
  const build = (o: Partial<Parameters<typeof buildRfqDocument>[0]> = {}) =>
    buildRfqDocument({ identity: fed, buyerDisplayName: "B", closeDate: null, now, timeZone: "UTC", requirements: [req({ requirementCode: "R-01" })], facts: [], ...o });
  const r = build({ contactName: " 王工 ", contactEmail: "project@sunnyshutter.ca" });
  ok("联系人与邮箱由调用方传入，去首尾空白后带进询价单", r.ok && r.doc.contactName === "王工" && r.doc.contactEmail === "project@sunnyshutter.ca");
  const none = build({ contactName: "  " });
  ok("联系人为空白 / 邮箱不传 → 都是 null", none.ok && none.doc.contactName === null && none.doc.contactEmail === null);
  ok("邮件正文不印联系人与邮箱（落款仍是我方抬头）", r.ok && !renderRfqEmail(r.doc).body.includes("王工") && !renderRfqEmail(r.doc).body.includes("project@sunnyshutter.ca"));
  const named = build({ contactName: "Sleeping Bags and Mats" });
  ok("联系人恰好是项目名称：询价单照常生成（不带附件的询价不因它被拦）", named.ok && named.doc.contactName === "Sleeping Bags and Mats");
  if (named.ok) {
    const hits = scanIdentity(fed.denyList, rfqAttachmentTemplateSegments(rfqTemplateOnlyDocument(named.doc, null), { draftedOn: "2026-10-22" }));
    ok("联系人恰好是项目名称：附件模板检查命中项目名称·询价附件", hits.length === 1 && hits[0].category === "project_name" && hits[0].where === "询价附件" && hits[0].kind === "authored");
    ok("邮件正文不印联系人，所以邮件复查不命中", scanOutboundRfqEmail(fed.denyList, renderRfqEmail(named.doc, { roundNumber: 1 })).length === 0);
  }
}

ok("回复截止不早于今天+2（截标还远时）", computeReplyBy("2026-10-30", now) === "2026-10-24");
ok("截标就在明天 → 不晚于截标前一天（今天），不再落到截标之后", computeReplyBy("2026-10-23", now) === "2026-10-22");
ok("截标为空 → 无回复截止", computeReplyBy(null, now) === null);

console.log(`\ntender-rfq: ${passed} passed`);
