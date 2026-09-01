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
    kind: "WEB_DOMAIN",
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
  assert.deepEqual(hints.observedWebDomains, ["xxfurniture.cn"]);
  assert.deepEqual(hints.platformAccounts, [{ platform: "DOUYIN", accountKey: "DOUYIN:user:ms4wabc123" }]);
  const contentOnly = extractEntityHints({
    accountName: null, accountUrl: null,
    contentUrl: "https://v.douyin.com/f1video/",
    title: null, description: null, rawText: null,
  });
  assert.deepEqual(contentOnly.observedWebDomains, []);
  assert.deepEqual(contentOnly.platformAccounts, []);

  console.log("强键（自有官网域名）→ MATCHED_EXISTING 0.92（仅预填）");
  const m1 = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: "91440605MA4W2XY70B", phones: [], observedWebDomains: ["xxfurniture.cn"], platformAccounts: [] },
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
    platformAccounts: new Map([["DOUYIN:user:account_a", new Set(["sup_a"])]]),
  };
  const accountB = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [], observedWebDomains: [], platformAccounts: [{ platform: "DOUYIN", accountKey: "DOUYIN:user:account_b" }] },
    suppliers,
    priorWithA,
  );
  assert.equal(accountB.decision, "NEW_SUPPLIER_CANDIDATE", "不同账号（同 host）不得命中");
  assert.equal(accountB.supplierId, undefined);

  console.log("S2-FR-T5：同一精确账号再现 → MATCHED_EXISTING 预填（仍不自动 LINK）");
  const accountA = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [], observedWebDomains: [], platformAccounts: [{ platform: "DOUYIN", accountKey: "DOUYIN:user:account_a" }] },
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
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [], observedWebDomains: [], platformAccounts: [{ platform: "DOUYIN", accountKey: "DOUYIN:user:platformshop" }] },
    suppliers,
    noPrior, // 无人工 LINKED 沉淀 → 即使账号同名也不匹配（账号键只认 prior 表）
  );
  assert.equal(platformSite.decision, "NEW_SUPPLIER_CANDIDATE");

  console.log("已档自有域名与联系电话各自可 MATCHED_EXISTING");
  const m2 = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [], observedWebDomains: ["factory-b-site.example"], platformAccounts: [] },
    suppliers,
    { ownedDomains: new Map([["factory-b-site.example", new Set(["sup_b"])]]), platformAccounts: new Map() },
  );
  assert.equal(m2.decision, "MATCHED_EXISTING");
  assert.equal(m2.supplierId, "sup_b");
  const m3 = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: ["13800138000"], observedWebDomains: [], platformAccounts: [] },
    suppliers,
    noPrior,
  );
  assert.equal(m3.decision, "MATCHED_EXISTING");
  assert.equal(m3.supplierId, "sup_a");

  console.log("归一名等值 ≠ 强键（0.72 人审）；多强键冲突必人审；模糊仅候选；无线索=NEW");
  const nameOnly = resolveSupplierEntityPure(
    { companyNameCandidates: ["东莞YY金属制品厂"], unifiedSocialCreditCode: null, phones: [], observedWebDomains: [], platformAccounts: [] },
    suppliers.filter((s) => s.id === "sup_b"),
    noPrior,
  );
  assert.equal(nameOnly.decision, "NEEDS_HUMAN_REVIEW");
  assert.equal(nameOnly.confidence, 0.72);
  const conflicted = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: ["13800138000"], observedWebDomains: ["factory-b-site.example"], platformAccounts: [] },
    suppliers,
    { ownedDomains: new Map([["factory-b-site.example", new Set(["sup_b"])]]), platformAccounts: new Map() },
  );
  assert.equal(conflicted.decision, "NEEDS_HUMAN_REVIEW");
  assert.ok(conflicted.conflicts.some((c) => c.includes("不得自动挑选")));
  const fuzzy = resolveSupplierEntityPure(
    { companyNameCandidates: ["XX家具源头工厂"], unifiedSocialCreditCode: null, phones: [], observedWebDomains: [], platformAccounts: [] },
    suppliers,
    noPrior,
  );
  assert.equal(fuzzy.decision, "NEEDS_HUMAN_REVIEW");
  assert.equal(fuzzy.confidence, 0.55);
  const none = resolveSupplierEntityPure(
    { companyNameCandidates: ["毫不相关的词条组合体"], unifiedSocialCreditCode: null, phones: [], observedWebDomains: [], platformAccounts: [] },
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
  assert.ok(!evil.observedWebDomains.includes("xxfurniture.cn"));
  const t25 = resolveSupplierEntityPure({ ...evil, companyNameCandidates: [] }, suppliers, noPrior);
  assert.notEqual(t25.decision, "MATCHED_EXISTING");

  console.log("S2-FR-T10：同一精确账号历史关联 A 与 B → 冲突 fail-closed（绝不 first-wins）");
  const collidedAccounts: PriorLinkedIdentities = {
    ownedDomains: new Map(),
    platformAccounts: new Map([["DOUYIN:user:account_x", new Set(["sup_b", "sup_a"])]]),
  };
  const t10 = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [], observedWebDomains: [], platformAccounts: [{ platform: "DOUYIN", accountKey: "DOUYIN:user:account_x" }] },
    suppliers,
    collidedAccounts,
  );
  assert.equal(t10.decision, "NEEDS_HUMAN_REVIEW");
  assert.equal(t10.supplierId, undefined, "冲突时不得选任何一家");
  assert.ok(t10.confidence < 0.9, "冲突不得给高置信");
  assert.ok(
    t10.conflicts.some((c) => c.includes("强身份冲突") && c.includes("platform_account") && c.includes("supplierIds=[sup_a,sup_b]")),
    `冲突元数据确定性（id 排序）：${JSON.stringify(t10.conflicts)}`,
  );
  const t10Ids = new Set(t10.matchedSources.filter((m) => m.kind === "platform_account").map((m) => m.supplierId));
  assert.deepEqual([...t10Ids].sort(), ["sup_a", "sup_b"], "两个 id 都对内暴露");

  console.log("S2-FR-T11：同一自有域名历史关联 A 与 B → NEEDS_HUMAN_REVIEW");
  const t11 = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [], observedWebDomains: ["shared-legacy.example"], platformAccounts: [] },
    suppliers,
    { ownedDomains: new Map([["shared-legacy.example", new Set(["sup_a", "sup_b"])]]), platformAccounts: new Map() },
  );
  assert.equal(t11.decision, "NEEDS_HUMAN_REVIEW");
  assert.equal(t11.supplierId, undefined);
  assert.ok(t11.conflicts.some((c) => c.includes("强身份冲突") && c.includes("reviewed_owned_domain")));

  console.log("S2-FR-T12：多条历史 LINK 但同指 A（Set 去重后 size=1）→ 仍可 MATCHED_EXISTING 预填");
  const t12 = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [], observedWebDomains: [], platformAccounts: [{ platform: "DOUYIN", accountKey: "DOUYIN:user:account_a" }] },
    suppliers,
    { ownedDomains: new Map(), platformAccounts: new Map([["DOUYIN:user:account_a", new Set(["sup_a"])]]) },
  );
  assert.equal(t12.decision, "MATCHED_EXISTING");
  assert.equal(t12.supplierId, "sup_a");

  console.log("S2-FR-T13：自有域名→A、精确账号→B（跨键分裂）→ NEEDS_HUMAN_REVIEW，不按求值顺序偏袒");
  const t13 = resolveSupplierEntityPure(
    {
      companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [],
      observedWebDomains: ["factory-b-site.example"],
      platformAccounts: [{ platform: "DOUYIN", accountKey: "DOUYIN:user:account_a" }],
    },
    suppliers,
    {
      ownedDomains: new Map([["factory-b-site.example", new Set(["sup_b"])]]),
      platformAccounts: new Map([["DOUYIN:user:account_a", new Set(["sup_a"])]]),
    },
  );
  assert.equal(t13.decision, "NEEDS_HUMAN_REVIEW");
  assert.equal(t13.supplierId, undefined);

  console.log("B4-T3（纯核）：一般 web contentUrl 独木不成强匹配（无 canonical 官网对质 → NEW）");
  const blogHints = extractEntityHints({
    accountName: null, accountUrl: null,
    contentUrl: "https://industry-blog.example/articles/factory-b",
    title: null, description: null, rawText: null,
  });
  assert.deepEqual(blogHints.observedWebDomains, ["industry-blog.example"], "观察级域名可收集");
  const b4t3 = resolveSupplierEntityPure(
    { ...blogHints, companyNameCandidates: [] },
    suppliers, // 无任何供应商 website=industry-blog.example
    noPrior,
  );
  assert.equal(b4t3.decision, "NEW_SUPPLIER_CANDIDATE");
  assert.equal(b4t3.supplierId, undefined);

  console.log("B4-T4（纯核）：平台精确账号页分类不回退");
  assert.equal(classifyUrlForIdentity("https://www.douyin.com/user/exactid1234").kind, "PLATFORM_ACCOUNT_IDENTITY");
  assert.equal(classifyUrlForIdentity("https://www.xiaohongshu.com/user/profile/abcd1234").kind, "PLATFORM_ACCOUNT_IDENTITY");
  assert.equal(classifyUrlForIdentity("https://myshop123.1688.com/").kind, "PLATFORM_ACCOUNT_IDENTITY");

  console.log("B4-T5（纯核）：平台视频/帖子/商品页仍是纯 provenance");
  assert.equal(classifyUrlForIdentity("https://www.douyin.com/video/999").kind, "CONTENT_URL");
  assert.equal(classifyUrlForIdentity("https://www.xiaohongshu.com/explore/n99").kind, "CONTENT_URL");
  assert.equal(classifyUrlForIdentity("https://detail.1688.com/offer/99.html").kind, "CONTENT_URL");

  console.log("B5（纯核）：scanComplete=false → 本可 MATCHED 的强命中降级 NEEDS + IDENTITY_SCAN_INCOMPLETE");
  const b5pure = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [], observedWebDomains: ["xxfurniture.cn"], platformAccounts: [] },
    suppliers,
    noPrior,
    { scanComplete: false },
  );
  assert.equal(b5pure.decision, "NEEDS_HUMAN_REVIEW");
  assert.equal(b5pure.supplierId, undefined);
  assert.ok(b5pure.conflicts.some((c) => c.includes("IDENTITY_SCAN_INCOMPLETE")));

  console.log("\nentity-resolution（B2 + S2-FR-T4/T5/T6）全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
