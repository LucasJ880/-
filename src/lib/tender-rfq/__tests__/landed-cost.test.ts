/**
 * P1-5 落地价归一化 — 表驱动测试（任务书 P1-5/6 §4 用例 1–5 逐条在此，编号 §4-1 … §4-5）
 * 运行：npx tsx src/lib/tender-rfq/__tests__/landed-cost.test.ts
 */
import assert from "node:assert/strict";
import {
  INCOTERM_STEPS,
  applyTenderRfqSettingsUpdate,
  tenderRfqSettingsPutSchema,
  evaluateQuoteChecks,
  normalizeQuote,
  readLandedCostSettings,
  type LandedCostSettings,
  type NormalizeContext,
} from "../landed-cost";

let passed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  assert.equal(cond, true, `${name}${detail === undefined ? "" : ` → ${JSON.stringify(detail)}`}`);
  passed += 1;
  console.log(`  ✓ ${name}`);
}
const close = (a: number | null, b: number) => a != null && Math.abs(a - b) < 0.005;

const NOW = new Date("2026-10-25T12:00:00Z");
const FULL: LandedCostSettings = {
  fxRates: { CNY: 0.19, USD: 1.36 },
  fxAsOf: "2026-10-20",
  fxSource: "MANUAL",
  freightEstimate: { mode: "per_unit", value: 6 },
  exportInlandEstimate: { mode: "per_shipment", value: 800 },
  insurancePct: 1,
  clearanceFlatCad: 150,
  projects: {},
};
const ctx = (o: Partial<NormalizeContext> = {}): NormalizeContext => ({ settings: FULL, dutyRatePct: 6.5, quantity: 1500, now: NOW, ...o });

console.log("tender-rfq landed-cost");

/* §4-1 */
{
  // A：CNY 280/个 FOB，汇率 0.19，运费 per_unit 6 CAD，保险 1%，关税 6.5%，清关 150 CAD，数量 1500
  //   货值   = 280 × 0.19 = 53.20 CAD/个；× 1500 = 79,800.00
  //   运费   = 6 × 1500                       =  9,000.00
  //   保险   = 1% × (79,800 + 9,000)          =    888.00
  //   关税   = 6.5% × 79,800（货值，不含运保） =  5,187.00
  //   清关   = 150                            =    150.00
  //   落地总 = 95,025.00；落地单价 = 95,025 / 1500 = 63.35
  const r = normalizeQuote({ unitPrice: 280, totalPrice: null, currency: "CNY", incoterm: "FOB" }, ctx());
  ok("§4-1 FOB/CNY → landedCad.total = 95,025.00", close(r.landedCad.total, 95025), r);
  ok("§4-1 landedCad.unit = 63.35", close(r.landedCad.unit, 63.35), r.landedCad);
  ok("§4-1 assumptions 5 条（汇率/运费/保险/关税/清关）", r.assumptions.length === 5 && /汇率 CNY→CAD 0.19（2026-10-20，手工）/.test(r.assumptions[0]), r.assumptions);
  ok("§4-1 无 blocker、无 warning", r.blockers.length === 0 && r.warnings.length === 0);
}

/* §4-2 */
{
  const noCny = { ...FULL, fxRates: { USD: 1.36 } };
  const r = normalizeQuote({ unitPrice: 280, totalPrice: null, currency: "CNY", incoterm: "FOB" }, ctx({ settings: noCny }));
  ok("§4-2 无 CNY 汇率 → landedCad=null", r.landedCad.total === null && r.landedCad.unit === null);
  ok("§4-2 blockers=[\"缺 CNY→CAD 汇率…\"]", r.blockers.length === 1 && r.blockers[0].startsWith("缺 CNY→CAD 汇率"), r.blockers);
}

/* §4-3 */
{
  const r = normalizeQuote({ unitPrice: null, totalPrice: 61000, currency: "CAD", incoterm: "DDP" }, ctx());
  ok("§4-3 CAD 61,000 DDP → 不加任何项", close(r.landedCad.total, 61000) && close(r.landedCad.unit, 61000 / 1500));
  ok("§4-3 assumptions=[]", r.assumptions.length === 0 && r.blockers.length === 0, r);
}

/* §4-4 */
{
  const r = normalizeQuote({ unitPrice: 40, totalPrice: null, currency: "CAD", incoterm: null }, ctx());
  ok("§4-4 贸易条款未注明 → landedCad=null", r.landedCad.total === null);
  ok("§4-4 blocker「贸易条款未注明」", r.blockers.includes("贸易条款未注明"), r.blockers);
  ok("§4-4 货值仍给出（只是不换算落地价）", close(r.goodsCad.total, 60000));
}

/* §4-5 */
{
  const stale = { ...FULL, fxAsOf: "2026-09-10" }; // 2026-09-10 → 2026-10-25 = 45 天
  const r = normalizeQuote({ unitPrice: 280, totalPrice: null, currency: "CNY", incoterm: "FOB" }, ctx({ settings: stale }));
  ok("§4-5 汇率 45 天前 → 照常换算", close(r.landedCad.total, 95025));
  ok("§4-5 warnings 含「45 天未更新」", r.warnings.some((w) => w.includes("45 天未更新")), r.warnings);
}

/* ── 表驱动：每种 Incoterm × 有/无汇率 × 有/无运费参数 ── */
{
  // 用 USD 报价（单价 10，数量 100，汇率 1.36）：货值 = 1,360.00
  //   运费 per_unit 6 × 100 = 600；内陆 per_shipment 800；保险 1%；关税 6.5%；清关 150
  const goods = 1360;
  const expected: Record<string, number> = {
    // EXW：内陆 800 + 运费 600 + 保险 1%×(1360+800+600)=27.6 + 关税 6.5%×(1360+800)=140.4 + 清关 150
    EXW: goods + 800 + 600 + 27.6 + 140.4 + 150,
    // FCA/FOB：运费 600 + 保险 1%×1960=19.6 + 关税 6.5%×1360=88.4 + 清关 150
    FCA: goods + 600 + 19.6 + 88.4 + 150,
    FOB: goods + 600 + 19.6 + 88.4 + 150,
    // CIF/CIP/DAP：关税 88.4 + 清关 150
    CIF: goods + 88.4 + 150,
    CIP: goods + 88.4 + 150,
    DAP: goods + 88.4 + 150,
    DDP: goods,
  };
  const needsFreight = (t: string) => INCOTERM_STEPS[t].includes("freight");
  for (const term of Object.keys(INCOTERM_STEPS)) {
    for (const hasFx of [true, false]) {
      for (const hasFreight of [true, false]) {
        const settings: LandedCostSettings = {
          ...FULL,
          fxRates: hasFx ? FULL.fxRates : {},
          freightEstimate: hasFreight ? FULL.freightEstimate : null,
        };
        const r = normalizeQuote({ unitPrice: 10, totalPrice: null, currency: "USD", incoterm: term }, { settings, dutyRatePct: 6.5, quantity: 100, now: NOW });
        const label = `${term} × ${hasFx ? "有汇率" : "无汇率"} × ${hasFreight ? "有运费参数" : "无运费参数"}`;
        if (!hasFx) {
          ok(`${label} → null + 缺汇率`, r.landedCad.total === null && r.blockers[0]?.startsWith("缺 USD→CAD 汇率"), r.blockers);
        } else if (!hasFreight && needsFreight(term)) {
          ok(`${label} → null + 缺运费参数`, r.landedCad.total === null && r.blockers.some((b) => b.includes("国际运费估算参数")), r.blockers);
        } else {
          ok(`${label} → ${expected[term].toFixed(2)}`, close(r.landedCad.total, expected[term]) && r.blockers.length === 0, r);
        }
      }
    }
  }
}

/* ── 其它缺参数 / 边界 ── */
{
  const r = normalizeQuote({ unitPrice: 10, totalPrice: null, currency: "CAD", incoterm: "FOB" }, ctx({ dutyRatePct: null }));
  ok("缺项目关税率 → null，blocker 点名 dutyRatePct", r.landedCad.total === null && r.blockers[0].includes("关税率"), r.blockers);
  const r2 = normalizeQuote({ unitPrice: 10, totalPrice: null, currency: "CAD", incoterm: "FOB" }, ctx({ settings: { ...FULL, insurancePct: null, clearanceFlatCad: null } }));
  ok("缺多项 → 一条 blocker 列出全部缺项", r2.blockers.length === 1 && r2.blockers[0].includes("保险费率") && r2.blockers[0].includes("清关杂费"), r2.blockers);
  const r3 = normalizeQuote({ unitPrice: 10, totalPrice: null, currency: "CNY", incoterm: "DDP" }, ctx({ settings: { ...FULL, fxSource: null } }));
  ok("汇率没写来源 → 不用（来源必须显式）", r3.landedCad.total === null && r3.blockers[0].includes("来源"), r3.blockers);
  const r4 = normalizeQuote({ unitPrice: 10, totalPrice: null, currency: "CAD", incoterm: "FOB" }, ctx({ quantity: null }));
  ok("只有单价、没有询价数量 → 无法算货值总额", r4.landedCad.total === null && r4.blockers[0].includes("询价数量"), r4.blockers);
  const r5 = normalizeQuote({ unitPrice: null, totalPrice: 15000, currency: "CAD", incoterm: "FOB" }, ctx({ quantity: null, settings: { ...FULL, freightEstimate: { mode: "per_shipment", value: 1200 } } }));
  ok("只有总价 + 按票运费 → 总价可算、单价 null", close(r5.landedCad.total, 15000 + 1200 + 162 + 975 + 150) && r5.landedCad.unit === null, r5);
  const r6 = normalizeQuote({ unitPrice: 10, totalPrice: null, currency: "CAD", incoterm: "CPT" }, ctx());
  ok("不支持的条款 → blocker，不猜", r6.landedCad.total === null && r6.blockers[0].includes("CPT"), r6.blockers);
  const r7 = normalizeQuote({ unitPrice: 10, totalPrice: null, currency: "CAD", incoterm: "FOB" }, ctx({ settings: { ...FULL, freightEstimate: { mode: "pct_of_goods", value: 8 } } }));
  ok("运费按货值百分比：8% × 15,000 = 1,200", close(r7.landedCad.total, 15000 + 1200 + 162 + 975 + 150), r7.assumptions);
}

/* ── 设置读取 ── */
{
  const s = readLandedCostSettings({ tenderRfq: { landedCost: { fxRates: { CNY: 0.19, usd: 1.3, EUR: -1 }, fxAsOf: "2026-10-20", fxSource: "MANUAL", freightEstimate: { mode: "per_unit", value: 6 }, insurancePct: "1" } } });
  ok("读设置：只收合法三位大写币种与正数汇率", Object.keys(s.fxRates).join() === "CNY");
  ok("读设置：类型不对的字段当作没填（不猜）", s.insurancePct === null && s.clearanceFlatCad === null && s.freightEstimate?.value === 6);
  ok("读设置：空设置全部 null", readLandedCostSettings(null).fxSource === null && Object.keys(readLandedCostSettings({}).fxRates).length === 0);
}

/* ── 设置写入（PUT /tender-rfq-settings 的合并与校验） ── */
{
  const before = { museBridge: { bindings: { u1: { userId: "x" } } }, tenderRfq: { fromName: "Old", landedCost: { insurancePct: 2, projects: { p1: { dutyRatePct: 5 } } } } };
  const body = tenderRfqSettingsPutSchema.parse({
    landedCost: { fxRates: { CNY: 0.19 }, fxAsOf: "2026-10-20", fxSource: "MANUAL", clearanceFlatCad: 150, projects: { p1: { deliveryDeadline: "2026-12-31" }, p2: { dutyRatePct: 6.5 } } },
  });
  const r = applyTenderRfqSettingsUpdate(before, body);
  assert.ok(r.ok);
  const lc = readLandedCostSettings(r.next);
  ok("设置写入：新键写入、没传的键保留（insurancePct=2）", lc.fxRates.CNY === 0.19 && lc.clearanceFlatCad === 150 && lc.insurancePct === 2);
  ok("设置写入：projects 按项目合并（p1 保留关税、加截止；新增 p2）", lc.projects.p1.dutyRatePct === 5 && lc.projects.p1.deliveryDeadline === "2026-12-31" && lc.projects.p2.dutyRatePct === 6.5, lc.projects);
  ok("设置写入：不动 museBridge 绑定与 fromName", JSON.stringify(r.next.museBridge) === JSON.stringify(before.museBridge) && (r.next.tenderRfq as { fromName: string }).fromName === "Old");
  const noSource = applyTenderRfqSettingsUpdate({}, tenderRfqSettingsPutSchema.parse({ landedCost: { fxRates: { CNY: 0.19 }, fxAsOf: "2026-10-20" } }));
  ok("设置写入：有汇率没来源 → 拒绝", !noSource.ok);
  const cleared = applyTenderRfqSettingsUpdate(r.next, tenderRfqSettingsPutSchema.parse({ landedCost: { insurancePct: null, projects: { p2: null } } }));
  ok("设置写入：null 清空字段 / 删除项目", cleared.ok && readLandedCostSettings(cleared.next).insurancePct === null && !("p2" in readLandedCostSettings(cleared.next).projects));
  ok("设置写入：schema 拒绝未知字段与小写币种", !tenderRfqSettingsPutSchema.safeParse({ landedCost: { fxRates: { cny: 0.19 } } }).success && !tenderRfqSettingsPutSchema.safeParse({ ourCost: 1 }).success);
}

/* ── §2.4 合规判断 ── */
{
  const t = { closeDate: "2026-11-14", deliveryDeadline: "2026-12-31", firstTierQty: 1500, mandatoryCodes: ["R-01", "R-05"] };
  const base = { emailDate: new Date("2026-10-25T00:00:00Z"), deliveryDays: 35, validUntil: "2026-11-30", moq: 500, mandatoryAnswers: [{ requirementCode: "R-01", answer: "满足" }, { requirementCode: "R-05", answer: "满足" }] };
  const all = evaluateQuoteChecks(base, t);
  ok("四项全满足 → 全 true", Object.values(all.checks).every((v) => v === true), all.checks);
  const late = evaluateQuoteChecks({ ...base, deliveryDays: 77 }, t); // 10-25 + 77 = 2027-01-10 → 超 10 天
  ok("交期超截止 10 天 → deliveryOk=false, lateDays=10", late.checks.deliveryOk === false && late.deliveryLateDays === 10, late);
  ok("交期 null → unknown", evaluateQuoteChecks({ ...base, deliveryDays: null }, t).checks.deliveryOk === "unknown");
  const noDeadline = evaluateQuoteChecks(base, { ...t, deliveryDeadline: null });
  ok("无交付截止 → 截标 +30 天并写 assumption", noDeadline.assumptions[0]?.includes("2026-12-14") && noDeadline.checks.deliveryOk === true, noDeadline);
  ok("有效期早于截标 → false", evaluateQuoteChecks({ ...base, validUntil: "2026-11-01" }, t).checks.validityOk === false);
  ok("没截标日 → 有效期 unknown", evaluateQuoteChecks(base, { ...t, closeDate: null }).checks.validityOk === "unknown");
  ok("MOQ 大于第一档 → false；没 MOQ → unknown", evaluateQuoteChecks({ ...base, moq: 2000 }, t).checks.moqOk === false && evaluateQuoteChecks({ ...base, moq: null }, t).checks.moqOk === "unknown");
  ok("强制项有「不满足」→ false", evaluateQuoteChecks({ ...base, mandatoryAnswers: [{ requirementCode: "R-01", answer: "不满足" }, { requirementCode: "R-05", answer: "满足" }] }, t).checks.mandatoryOk === false);
  ok("RFQ 里的强制项回信没提 → 按未答计 partial", evaluateQuoteChecks({ ...base, mandatoryAnswers: [{ requirementCode: "R-01", answer: "满足" }] }, t).checks.mandatoryOk === "partial");
}

console.log(`\ntender-rfq landed-cost: ${passed} passed`);
