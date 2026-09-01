/**
 * S2 — Entity Resolution 纯核（B2 重构后）：
 * URL 身份分级 / 平台 host 永不强键（S2-FR-T4/T6）/ 精确账号可预填（S2-FR-T5）/
 * 强键预填 / 归一名非强键 / 冲突必人审 / 永不自动合并。
 */
import assert from "node:assert/strict";
import {
  classifyUrlForIdentity,
  extractEntityHints,
  resolveSupplierEntityPure,
  type PriorLinkedIdentities,
  type SupplierRowForResolution,
} from "../entity-resolution";

const suppliers: SupplierRowForResolution[] = [
  { id: "sup_a", name: "佛山市XX家具有限公司", website: "https://xxfurniture.cn", contactPhone: "13800138000" },
  { id: "sup_b", name: "东莞YY金属制品厂", website: null, contactPhone: null },
  { id: "sup_dup", name: "佛山市XX家具有限公司", website: null, contactPhone: null },
  // B2 守卫用：website 填了平台链接的供应商——不得因此获得「自有域名」强键
  { id: "sup_platform_site", name: "平台官网供应商", website: "https://www.douyin.com/user/platformshop", contactPhone: null },
];

const noPrior: PriorLinkedIdentities = { ownedDomains: new Map(), platformAccounts: new Map() };

async function main() {
  console.log("B2：URL 身份分级——自有域名 / 平台账号页 / 内容页 / 未知");
  assert.deepEqual(classifyUrlForIdentity("https://xxfurniture.cn/about"), {
    kind: "SUPPLIER_OWNED_DOMAIN",
    domain: "xxfurniture.cn",
  });
  const douyinAccount = classifyUrlForIdentity("https://www.douyin.com/user/MS4wAbc123");
  assert.equal(douyinAccount.kind, "PLATFORM_ACCOUNT_IDENTITY");
  assert.equal(douyinAccount.accountKey, "DOUYIN:user:ms4wabc123");
  assert.equal(classifyUrlForIdentity("https://v.douyin.com/f1video/").kind, "CONTENT_URL");
  assert.equal(classifyUrlForIdentity("https://www.douyin.com/video/7123").kind, "CONTENT_URL");
  assert.equal(classifyUrlForIdentity("https://detail.1688.com/offer/9.html").kind, "CONTENT_URL");
  assert.equal(classifyUrlForIdentity("https://shop88factory.1688.com/page/index.html").accountKey, "ONE688:shop:shop88factory");
  assert.equal(classifyUrlForIdentity("https://www.alibaba.com/product-detail/x.html").kind, "CONTENT_URL", "marketplace 宽域=平台，非自有域名");
  assert.equal(classifyUrlForIdentity("https://www.made-in-china.com/showroom/x").kind, "CONTENT_URL");
  assert.equal(classifyUrlForIdentity("javascript:alert(1)").kind, "UNKNOWN_URL");

  console.log("抽取：域名仅收自有域名；平台账号进 platformAccounts；内容页两边都不进");
  const hints = extractEntityHints({
    accountName: "佛山办公椅老周",
    accountUrl: "https://www.douyin.com/user/MS4wAbc123",
    contentUrl: "https://xxfurniture.cn/about",
    title: null,
    description: "统一社会信用代码 91440605MA4W2XY70B 联系 13800138000",
    rawText: "佛山市XX家具有限公司 源头工厂",
  });
  assert.deepEqual(hints.domains, ["xxfurniture.cn"]);
  assert.deepEqual(hints.platformAccounts, [{ platform: "DOUYIN", accountKey: "DOUYIN:user:ms4wabc123" }]);
  const contentOnly = extractEntityHints({
    accountName: null, accountUrl: null,
    contentUrl: "https://v.douyin.com/f1video/",
    title: null, description: null, rawText: null,
  });
  assert.deepEqual(contentOnly.domains, []);
  assert.deepEqual(contentOnly.platformAccounts, []);

  console.log("强键（自有官网域名）→ MATCHED_EXISTING 0.92（仅预填）");
  const m1 = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: "91440605MA4W2XY70B", phones: [], domains: ["xxfurniture.cn"], platformAccounts: [] },
    suppliers,
    noPrior,
  );
  assert.equal(m1.decision, "MATCHED_EXISTING");
  assert.equal(m1.supplierId, "sup_a");
  assert.ok(m1.matchedSignals.some((s) => s.startsWith("supplier_owned_domain:")));
  assert.ok(m1.conflicts.some((c) => c.includes("统一社会信用代码")));

  console.log("S2-FR-T4：同平台 host ≠ 同供应商——A 的抖音已 LINKED，B 的另一账号不得匹配 A");
  const priorWithA: PriorLinkedIdentities = {
    ownedDomains: new Map(),
    platformAccounts: new Map([["DOUYIN:user:account_a", "sup_a"]]),
  };
  const accountB = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [], domains: [], platformAccounts: [{ platform: "DOUYIN", accountKey: "DOUYIN:user:account_b" }] },
    suppliers,
    priorWithA,
  );
  assert.equal(accountB.decision, "NEW_SUPPLIER_CANDIDATE", "不同账号（同 host）不得命中");
  assert.equal(accountB.supplierId, undefined);

  console.log("S2-FR-T5：同一精确账号再现 → MATCHED_EXISTING 预填（仍不自动 LINK）");
  const accountA = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [], domains: [], platformAccounts: [{ platform: "DOUYIN", accountKey: "DOUYIN:user:account_a" }] },
    suppliers,
    priorWithA,
  );
  assert.equal(accountA.decision, "MATCHED_EXISTING");
  assert.equal(accountA.supplierId, "sup_a");
  assert.ok(accountA.matchedSignals.some((s) => s.startsWith("platform_account:")));

  console.log("S2-FR-T6：内容页 URL 永不强身份（extract 阶段即弃 → 无任何域名/账号键可匹配）");
  const t6 = resolveSupplierEntityPure(
    { ...contentOnly, companyNameCandidates: [] },
    suppliers,
    priorWithA,
  );
  assert.equal(t6.decision, "NEW_SUPPLIER_CANDIDATE");

  console.log("B2 守卫：供应商 website 填平台链接 → 不构成自有域名强键");
  const platformSite = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [], domains: [], platformAccounts: [{ platform: "DOUYIN", accountKey: "DOUYIN:user:platformshop" }] },
    suppliers,
    noPrior, // 无人工 LINKED 沉淀 → 即使账号同名也不匹配（账号键只认 prior 表）
  );
  assert.equal(platformSite.decision, "NEW_SUPPLIER_CANDIDATE");

  console.log("已档自有域名与联系电话各自可 MATCHED_EXISTING");
  const m2 = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [], domains: ["factory-b-site.example"], platformAccounts: [] },
    suppliers,
    { ownedDomains: new Map([["factory-b-site.example", "sup_b"]]), platformAccounts: new Map() },
  );
  assert.equal(m2.decision, "MATCHED_EXISTING");
  assert.equal(m2.supplierId, "sup_b");
  const m3 = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: ["13800138000"], domains: [], platformAccounts: [] },
    suppliers,
    noPrior,
  );
  assert.equal(m3.decision, "MATCHED_EXISTING");
  assert.equal(m3.supplierId, "sup_a");

  console.log("归一名等值 ≠ 强键（0.72 人审）；多强键冲突必人审；模糊仅候选；无线索=NEW");
  const nameOnly = resolveSupplierEntityPure(
    { companyNameCandidates: ["东莞YY金属制品厂"], unifiedSocialCreditCode: null, phones: [], domains: [], platformAccounts: [] },
    suppliers.filter((s) => s.id === "sup_b"),
    noPrior,
  );
  assert.equal(nameOnly.decision, "NEEDS_HUMAN_REVIEW");
  assert.equal(nameOnly.confidence, 0.72);
  const conflicted = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: ["13800138000"], domains: ["factory-b-site.example"], platformAccounts: [] },
    suppliers,
    { ownedDomains: new Map([["factory-b-site.example", "sup_b"]]), platformAccounts: new Map() },
  );
  assert.equal(conflicted.decision, "NEEDS_HUMAN_REVIEW");
  assert.ok(conflicted.conflicts.some((c) => c.includes("不得自动挑选")));
  const fuzzy = resolveSupplierEntityPure(
    { companyNameCandidates: ["XX家具源头工厂"], unifiedSocialCreditCode: null, phones: [], domains: [], platformAccounts: [] },
    suppliers,
    noPrior,
  );
  assert.equal(fuzzy.decision, "NEEDS_HUMAN_REVIEW");
  assert.equal(fuzzy.confidence, 0.55);
  const none = resolveSupplierEntityPure(
    { companyNameCandidates: ["毫不相关的词条组合体"], unifiedSocialCreditCode: null, phones: [], domains: [], platformAccounts: [] },
    suppliers,
    noPrior,
  );
  assert.equal(none.decision, "NEW_SUPPLIER_CANDIDATE");

  console.log("S2-T25：仿冒域名（xxfurniture.cn.evil.com）不得匹配正主");
  const evil = extractEntityHints({
    accountName: null, accountUrl: null,
    contentUrl: "https://xxfurniture.cn.evil.com/phish",
    title: null, description: null, rawText: null,
  });
  assert.ok(!evil.domains.includes("xxfurniture.cn"));
  const t25 = resolveSupplierEntityPure({ ...evil, companyNameCandidates: [] }, suppliers, noPrior);
  assert.notEqual(t25.decision, "MATCHED_EXISTING");

  console.log("\nentity-resolution（B2 + S2-FR-T4/T5/T6）全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
