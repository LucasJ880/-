/**
 * S2 — Entity Resolution 纯核：抽取保守 / 强键预填 / 归一名非强键 / 冲突必人审 / 永不自动合并
 */
import assert from "node:assert/strict";
import {
  extractEntityHints,
  resolveSupplierEntityPure,
  type SupplierRowForResolution,
} from "../entity-resolution";

const suppliers: SupplierRowForResolution[] = [
  { id: "sup_a", name: "佛山市XX家具有限公司", website: "https://xxfurniture.cn", contactPhone: "13800138000" },
  { id: "sup_b", name: "东莞YY金属制品厂", website: null, contactPhone: null },
  { id: "sup_dup", name: "佛山市XX家具有限公司", website: null, contactPhone: null },
];

async function main() {
  console.log("抽取：USCC/手机号/公司名/域名——抽不出=空，不猜");
  const hints = extractEntityHints({
    accountName: "佛山办公椅老周",
    accountUrl: null,
    contentUrl: "https://xxfurniture.cn/about",
    title: null,
    description: "统一社会信用代码 91440605MA4W2XY70B 联系 13800138000",
    // 账号简介风格（名字句首）；散文内嵌（如「我们是佛山市…」）会连前缀捕获——
    // 已知局限：抽取只产候选、候选只进人审，不构成匹配强键，故可接受
    rawText: "佛山市XX家具有限公司 源头工厂",
  });
  assert.equal(hints.unifiedSocialCreditCode, "91440605MA4W2XY70B");
  assert.deepEqual(hints.phones, ["13800138000"]);
  assert.ok(hints.companyNameCandidates.includes("佛山办公椅老周"));
  assert.ok(hints.companyNameCandidates.includes("佛山市XX家具有限公司"));
  assert.ok(hints.domains.includes("xxfurniture.cn"));
  const emptyHints = extractEntityHints({ accountName: null, accountUrl: null, contentUrl: null, title: null, description: null, rawText: null });
  assert.equal(emptyHints.unifiedSocialCreditCode, null);
  assert.deepEqual(emptyHints.companyNameCandidates, []);

  console.log("强键（官网域名）→ MATCHED 0.92（仅预填，LINKED 仍人工）；USCC 无字段可比 → 记入 conflicts");
  const m1 = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: "91440605MA4W2XYZ0B", phones: [], domains: ["xxfurniture.cn"] },
    suppliers,
    new Map(),
  );
  assert.equal(m1.decision, "MATCHED_EXISTING");
  assert.equal(m1.supplierId, "sup_a");
  assert.equal(m1.confidence, 0.92);
  assert.ok(m1.conflicts.some((c) => c.includes("统一社会信用代码")));

  console.log("强键（已档来源域名）与强键（联系电话）各自可 MATCHED");
  const m2 = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [], domains: ["douyin-shop.example"] },
    suppliers,
    new Map([["douyin-shop.example", "sup_b"]]),
  );
  assert.equal(m2.decision, "MATCHED_EXISTING");
  assert.equal(m2.supplierId, "sup_b");
  const m3 = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: ["13800138000"], domains: [] },
    suppliers,
    new Map(),
  );
  assert.equal(m3.decision, "MATCHED_EXISTING");
  assert.equal(m3.supplierId, "sup_a");

  console.log("归一名等值 ≠ 强键：只到 NEEDS_HUMAN_REVIEW 0.72（同名不同实体可合法共存）");
  const nameOnly = resolveSupplierEntityPure(
    { companyNameCandidates: ["东莞YY金属制品厂"], unifiedSocialCreditCode: null, phones: [], domains: [] },
    suppliers.filter((s) => s.id === "sup_b"),
    new Map(),
  );
  assert.equal(nameOnly.decision, "NEEDS_HUMAN_REVIEW");
  assert.equal(nameOnly.confidence, 0.72);

  console.log("冲突：多供应商命中强键 → NEEDS_HUMAN_REVIEW + 冲突说明（绝不自动挑）");
  const conflicted = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: ["13800138000"], domains: ["douyin-shop.example"] },
    suppliers,
    new Map([["douyin-shop.example", "sup_b"]]),
  );
  assert.equal(conflicted.decision, "NEEDS_HUMAN_REVIEW");
  assert.ok(conflicted.conflicts.some((c) => c.includes("不得自动挑选")));

  console.log("模糊相似：只产候选（NEEDS 0.55），永不 MATCHED；无线索 → NO_MATCH");
  const fuzzy = resolveSupplierEntityPure(
    { companyNameCandidates: ["XX家具源头工厂"], unifiedSocialCreditCode: null, phones: [], domains: [] },
    suppliers,
    new Map(),
  );
  assert.equal(fuzzy.decision, "NEEDS_HUMAN_REVIEW");
  assert.equal(fuzzy.confidence, 0.55);
  const none = resolveSupplierEntityPure(
    { companyNameCandidates: ["毫不相关的词条组合体"], unifiedSocialCreditCode: null, phones: [], domains: [] },
    suppliers,
    new Map(),
  );
  assert.equal(none.decision, "NEW_SUPPLIER_CANDIDATE");

  console.log("S2-T23：同名但域名指向另一供应商 → 强键冲突 NEEDS_HUMAN_REVIEW");
  const t23 = resolveSupplierEntityPure(
    { companyNameCandidates: ["佛山市XX家具有限公司"], unifiedSocialCreditCode: null, phones: ["13800138000"], domains: ["douyin-shop.example"] },
    suppliers,
    new Map([["douyin-shop.example", "sup_b"]]), // 电话→sup_a，已档域名→sup_b：冲突
  );
  assert.equal(t23.decision, "NEEDS_HUMAN_REVIEW");

  console.log("S2-T25：supplier.com.evil.com 不得匹配 supplier.com（域名规范化安全）");
  const evilHints = extractEntityHints({
    accountName: null, accountUrl: null,
    contentUrl: "https://xxfurniture.cn.evil.com/phish",
    title: null, description: null, rawText: null,
  });
  assert.ok(!evilHints.domains.includes("xxfurniture.cn"), "仿冒域名不得归一成正主");
  const t25 = resolveSupplierEntityPure(
    { companyNameCandidates: [], unifiedSocialCreditCode: null, phones: [], domains: evilHints.domains },
    suppliers,
    new Map(),
  );
  assert.notEqual(t25.decision, "MATCHED_EXISTING");

  console.log("matchedSignals 摘要存在（kind:key）");
  assert.ok(m1.matchedSignals.some((s) => s.startsWith("website_domain:")));

  console.log("\nentity-resolution 全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
