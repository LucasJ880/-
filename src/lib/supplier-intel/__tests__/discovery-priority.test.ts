/**
 * S4-B §62 — 找厂优先级（discovery-priority-v1）纯核。
 * D1–D6 + 纯度守卫：不写评分列、不猜缺失值、同输入同结果、平台≠优先级。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DISCOVERY_PRIORITY_DISCLAIMER, DISCOVERY_PRIORITY_V1, computeDiscoveryPriority, termMatches } from "../discovery-priority";

const brief = { productKeywords: ["办公椅", "网布椅"], productCategory: "办公家具", commercialSearchTermsZh: ["办公椅厂家", "办公椅 OEM"], capabilitySearchTermsZh: ["网布椅 定制"], searchTermsEn: ["office chair manufacturer", "mesh chair"] };

async function main() {
  console.log("模块纯度：discovery-priority.ts 不 import 任何模块，无 fetch / db / Date.now / random");
  const src = readFileSync(join(__dirname, "..", "discovery-priority.ts"), "utf8");
  assert.ok(!/^\s*import\s/m.test(src), "不得 import");
  assert.ok(!/fetch\(|prisma|\bdb\.|Date\.now|new Date\(|Math\.random/.test(src), "不得有 IO / 时钟 / 随机");
  assert.ok(!/technicalScore|commercialScore|totalScore|recommendation\s*[:=]/.test(src), "不得触碰候选评分列 / 推荐");

  console.log("D1：ONE688 高相关 + 厂家 / OEM 明确 → P1");
  const d1 = computeDiscoveryPriority(brief, { platform: "ONE688", title: "办公椅 网布椅 定制 源头工厂 OEM 办公家具", description: "办公椅厂家直销，网布椅 定制，支持 OEM，office chair manufacturer", accountName: "某某家具厂", contentUrl: "https://detail.1688.com/offer/1.html", rawMetadataJson: { sourceQuery: "办公椅厂家" } });
  assert.equal(d1.bucket, "P1", `D1 total=${d1.total}`);
  assert.equal(d1.components.relevance, 42, "3/3 产品词 → 30；3/5 检索词 → 12");
  assert.equal(d1.components.factory, 20); assert.equal(d1.components.actionability, 10);
  assert.ok(d1.reasons.factoryTermsMatched.includes("oem") && d1.reasons.factoryTermsMatched.includes("源头工厂"));
  assert.equal(d1.disclaimer, DISCOVERY_PRIORITY_DISCLAIMER);

  console.log("D2：ONE688 低相关 → 不能因为 platform=ONE688 自动 P1");
  const d2 = computeDiscoveryPriority(brief, { platform: "ONE688", title: "不锈钢水杯 批发", description: "保温杯", contentUrl: "https://detail.1688.com/offer/2.html" });
  assert.equal(d2.components.relevance, 0); assert.equal(d2.bucket, "P3", `D2 total=${d2.total}`);

  console.log("D3：抖音高相关可以排在 ONE688 低相关前");
  const d3 = computeDiscoveryPriority(brief, { platform: "DOUYIN", title: "办公椅 网布椅 工厂实拍", rawText: "我们是办公椅厂家，网布椅 定制，办公家具一站式", accountName: "椅子工厂" , contentUrl: "https://v.douyin.com/x" });
  assert.ok(d3.total > d2.total, `D3 ${d3.total} > D2 ${d2.total}`);
  assert.equal(d3.components.actionability, 4);

  console.log("D4：1688 写「UL认证」→ 只是命中文本，不产生 VERIFIED 认证（结果里没有任何 VERIFIED 字段）");
  const d4 = computeDiscoveryPriority(brief, { platform: "ONE688", title: "办公椅 UL认证 CSA ETL certified 厂家" });
  assert.ok(!JSON.stringify(d4).includes("VERIFIED"));
  assert.ok(d4.reasons.factoryTermsMatched.includes("厂家"));

  console.log("D5：同一输入两次结果字节相同");
  assert.equal(JSON.stringify(computeDiscoveryPriority(brief, { platform: "ONE688", title: "办公椅 厂家" })), JSON.stringify(computeDiscoveryPriority(brief, { platform: "ONE688", title: "办公椅 厂家" })));

  console.log("D6：没有 rawMetadata → 不猜店龄 / 销量 / 交易量；完整度只看已有字段");
  const d6 = computeDiscoveryPriority(brief, { platform: "ONE688", title: "办公椅" });
  assert.equal(d6.reasons.sourceQuery, null);
  assert.deepEqual(d6.reasons.completeness, { url: false, title: true, body: false, account: false });
  assert.equal(d6.components.completeness, 1.25);
  assert.ok(!/years|sales|volume|店龄|销量|成交/.test(JSON.stringify(d6)));

  console.log("出口词只加优先级，不产生能力核验；英文词边界（'export' 不命中 'exporting-x'）");
  const e1 = computeDiscoveryPriority(brief, { platform: "WEBSITE", title: "办公椅 出口 加拿大 北美" });
  assert.equal(e1.components.export, 15); assert.ok(!JSON.stringify(e1).includes("CANADA_EXPORT"));
  assert.equal(termMatches("export", "we are exporting-x"), false); assert.equal(termMatches("export", "export to canada"), true);
  assert.equal(termMatches("办公椅", "高端办公椅批发"), true);

  console.log("桶阈值冻结：P1 ≥ 70，P2 50–69.99，P3 < 50；可操作性表冻结");
  assert.equal(DISCOVERY_PRIORITY_V1.buckets.P1, 70); assert.equal(DISCOVERY_PRIORITY_V1.buckets.P2, 50);
  assert.deepEqual(DISCOVERY_PRIORITY_V1.actionability, { ONE688: 10, WEBSITE: 8, OPEN_WEB: 6, MANUAL: 6, DOUYIN: 4, XIAOHONGSHU: 4, WECHAT_CHANNELS: 4 });
  assert.equal(DISCOVERY_PRIORITY_V1.max.relevance + DISCOVERY_PRIORITY_V1.max.factory + DISCOVERY_PRIORITY_V1.max.export + DISCOVERY_PRIORITY_V1.max.actionability + DISCOVERY_PRIORITY_V1.max.completeness, 100);

  console.log("空 Brief：相关性 0，不因空词表报错");
  assert.equal(computeDiscoveryPriority({}, { platform: "MANUAL", title: "x" }).components.relevance, 0);

  console.log("\nS4-B 找厂优先级纯核全部通过");
}
main().catch((e) => { console.error(e); process.exit(1); });
