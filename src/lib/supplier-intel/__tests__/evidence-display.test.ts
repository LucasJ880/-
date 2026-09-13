/**
 * S3-B Slice 2 纯核：证据工作台的文案诚实性与「资料状态」计算（CI 可执行，无 DB）。
 *
 * 守三件事：
 *   1. CLAIMED 永远不显示成「已认证」；VERIFIED 但日期已过必须明说「按日期已过期」；
 *   2. 缺价显示「价格待确认」，不是错误；
 *   3. 资料状态只有事实状态，不产生任何分数 / 合格率 / 排名。
 */
import assert from "node:assert/strict";

async function main() {
  const m = await import("../evidence-display");

  console.log("A1：CLAIMED 不是「已认证」");
  const claimed = m.certificationStatusDisplay("CLAIMED", false);
  assert.equal(claimed.label, "厂家声称 / 待核验");
  assert.ok(!claimed.label.includes("已认证"));
  assert.ok(!claimed.label.includes("已核验"));

  console.log("A2：VERIFIED 但按日期已过期，必须明说");
  const expired = m.certificationStatusDisplay("VERIFIED", true);
  assert.ok(expired.label.includes("按日期已过期"), expired.label);
  assert.equal(expired.tone, "danger", "不能继续是绿色");
  const live = m.certificationStatusDisplay("VERIFIED", false);
  assert.equal(live.label, "已独立核验");

  console.log("A3：四种状态文案互不相同（不用颜色作唯一区分）");
  const labels = ["CLAIMED", "VERIFIED", "REJECTED", "EXPIRED"].map(
    (s) => m.certificationStatusDisplay(s, false).label,
  );
  assert.equal(new Set(labels).size, 4);

  console.log("B1：缺价显示「价格待确认」");
  assert.deepEqual(m.priceDisplay({ unitPrice: null, currency: null, priceStatus: "UNKNOWN" }), {
    text: "价格待确认",
    pending: true,
  });
  assert.deepEqual(
    m.priceDisplay({ unitPrice: "120.5", currency: null, priceStatus: "UNKNOWN" }),
    { text: "价格待确认", pending: true },
    "priceStatus=UNKNOWN 时即使有数字也按待确认（数字可能是随手记的）",
  );
  assert.equal(m.priceDisplay({ unitPrice: "120.5", currency: "CNY", priceStatus: "KNOWN" }).text, "CNY 120.5");
  assert.equal(
    m.priceDisplay({ unitPrice: "120.5", currency: "CNY", priceStatus: "ESTIMATED" }).text,
    "CNY 120.5（估算）",
  );

  console.log("C1：空供应商——全部未记录，且没有任何数字型评分字段");
  const empty = m.computeInformationCompleteness({
    offerings: [],
    certifications: [],
    capabilities: [],
    linkedSignals: [],
  });
  assert.ok(empty.length >= 8);
  assert.ok(empty.every((r) => r.status === "MISSING"), JSON.stringify(empty.map((r) => r.status)));
  for (const r of empty) {
    const keys = Object.keys(r).sort();
    assert.deepEqual(keys, ["detail", "key", "label", "status"], "行结构里不许出现 score/percent/rank");
  }
  assert.ok(
    empty.every((r) => !/合格|评分|得分|排名|Score|score|%/.test(`${r.label}${r.detail ?? ""}`)),
    "文案里不许出现合格/评分/排名/百分比",
  );

  console.log("C2：一个缺价产品——价格「待确认」，其余按事实");
  const one = m.computeInformationCompleteness({
    offerings: [
      { description: "办公椅", attributes: {}, unitPrice: null, priceStatus: "UNKNOWN", moq: 100, leadTimeDays: null },
    ],
    certifications: [{ status: "CLAIMED", expiredByDate: false }],
    capabilities: [],
    linkedSignals: [{ id: "s1" }],
  });
  const by = Object.fromEntries(one.map((r) => [r.key, r]));
  assert.equal(by.offering.status, "RECORDED");
  assert.equal(by.spec.status, "RECORDED", "有说明就算有规格");
  assert.equal(by.price.status, "PENDING");
  assert.ok(by.price.detail?.includes("缺价不是不合格"));
  assert.equal(by.moq.status, "RECORDED");
  assert.equal(by.leadTime.status, "PENDING");
  assert.equal(by.cert.status, "CLAIMED");
  assert.equal(by.certVerify.status, "PENDING");
  assert.equal(by.source.status, "RECORDED");
  assert.equal(by.capability.status, "MISSING");

  console.log("C3：混合——部分产品有价格 → PARTIAL；一项核验且未过期 → VERIFIED");
  const mixed = m.computeInformationCompleteness({
    offerings: [
      { description: null, attributes: { 材质: "钢" }, unitPrice: "10", priceStatus: "KNOWN", moq: null, leadTimeDays: 30 },
      { description: null, attributes: {}, unitPrice: null, priceStatus: "UNKNOWN", moq: null, leadTimeDays: 30 },
    ],
    certifications: [
      { status: "VERIFIED", expiredByDate: false },
      { status: "CLAIMED", expiredByDate: false },
    ],
    capabilities: [{ type: "CNC_CAPABILITY" }],
    linkedSignals: [{ id: "s1" }, { id: "s2" }],
  });
  const mb = Object.fromEntries(mixed.map((r) => [r.key, r]));
  assert.equal(mb.price.status, "PARTIAL");
  assert.equal(mb.spec.status, "PARTIAL");
  assert.equal(mb.leadTime.status, "RECORDED");
  assert.equal(mb.moq.status, "PENDING");
  assert.equal(mb.cert.status, "VERIFIED");
  assert.equal(mb.certVerify.status, "PENDING", "还有一项 CLAIMED 没核验");
  assert.equal(mb.capability.status, "RECORDED");

  console.log("C4：核验过但按日期已过期，不算「已核验」");
  const stale = m.computeInformationCompleteness({
    offerings: [],
    certifications: [{ status: "VERIFIED", expiredByDate: true }],
    capabilities: [],
    linkedSignals: [],
  });
  const sb = Object.fromEntries(stale.map((r) => [r.key, r]));
  assert.notEqual(sb.cert.status, "VERIFIED");
  assert.ok(sb.cert.detail?.includes("按日期已过期"));

  console.log("D1：能力证据状态——VERIFIED 有文案但本入口不会产生它（服务层拦）");
  assert.equal(m.evidenceStatusDisplay("CLAIMED").label, "厂家声称");
  assert.ok(!m.evidenceStatusDisplay("OBSERVED").label.includes("核验"));

  console.log("\nS3-B 证据工作台纯核全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
