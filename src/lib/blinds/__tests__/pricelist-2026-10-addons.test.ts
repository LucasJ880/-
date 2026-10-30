/**
 * PRICE-3：附加项目目录对照 2026-10-28 价表文件
 *
 * 1) 目录 36 项，每项单价等于 config/pricelist/2026-10-28-lucas-quote.json 中来源行的数值
 * 2) Excel ADD ON参考 40 行全部归类（24 / 10 / 4 / 1 / 1），无未归类行
 * 3) 按英尺项、对客名称、企业价、resolveAddonLines 的取价规则
 *
 * 运行：npx tsx src/lib/blinds/__tests__/pricelist-2026-10-addons.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ADDON_CATALOG,
  EXCEL_ADDON_DISPOSITION,
  CUSTOM_ADDON_KEY,
  addonCustomerLabel,
  calcAddonSubtotal,
  effectiveAddonPrice,
  formatAddonUnitPrice,
  getAddonDef,
  normalizeAddonInputs,
  partBRowsToAddonInputs,
  resolveAddonLines,
} from "../pricing-addons";
import { calculateQuoteTotal } from "../pricing-engine";

const ROOT = join(__dirname, "..", "..", "..", "..");
const seed = JSON.parse(readFileSync(join(ROOT, "config/pricelist/2026-10-28-lucas-quote.json"), "utf8")) as {
  retailAddonsCsv: string;
  excelAddons: { id: string; name: string; price: number | null; rawPrice: string }[];
  fees: { downtown: number };
};

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** 最小 CSV 解析（价表 CSV 只有双引号转义） */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

const retail = parseCsv(seed.retailAddonsCsv);
const retailByKey = new Map(retail.map((r) => [r.addon_key, r]));
const excelById = new Map(seed.excelAddons.map((e) => [e.id, e]));

/** "$30/feet" / "$4/ft" → 30 / 4 */
function perFootPrice(raw: string): number {
  const m = raw.match(/^\$(\d+(?:\.\d+)?)\/(?:ft|feet)$/);
  assert.ok(m, `rawPrice 不是按英尺格式：${raw}`);
  return Number(m[1]);
}

console.log("附加项目目录对照 2026-10-28 价表");

test("目录 36 项、键唯一", () => {
  assert.equal(ADDON_CATALOG.length, 36);
  assert.equal(new Set(ADDON_CATALOG.map((a) => a.key)).size, 36);
});

test("零售表 11 项：键、名称、对客名、单价、适用产品与 CSV 一致，顺序按 display_order", () => {
  const fromRetail = ADDON_CATALOG.filter((a) => a.source.kind === "retail");
  assert.equal(fromRetail.length, 11);
  assert.equal(retail.length, 11);
  const csvOrder = [...retail].sort((a, b) => Number(a.display_order) - Number(b.display_order)).map((r) => r.addon_key);
  assert.deepEqual(fromRetail.map((a) => a.key), csvOrder);
  for (const a of fromRetail) {
    assert.equal(a.source.kind === "retail" && a.source.key, a.key);
    const r = retailByKey.get(a.key)!;
    assert.ok(r, `零售表缺 ${a.key}`);
    assert.equal(a.displayName, r.display_name, a.key);
    assert.equal(a.printLabel, r.print_label, a.key);
    assert.equal(a.unitPrice, Number(r.unit_price), a.key);
    assert.deepEqual([...a.eligibleProducts].sort(), r.eligible_products_csv.split(";").sort(), a.key);
    assert.equal(a.unit, "each");
    assert.equal(r.enabled, "TRUE");
  }
});

test("Excel 进目录 24 项：单价等于来源行（固定价取 price，按英尺取 rawPrice 数字）", () => {
  const fromExcel = ADDON_CATALOG.filter((a) => a.source.kind === "excel");
  assert.equal(fromExcel.length, 24);
  for (const a of fromExcel) {
    const id = a.source.kind === "excel" ? a.source.id : "";
    const e = excelById.get(id);
    assert.ok(e, `${a.key} 来源 ${id} 不在 excelAddons`);
    if (a.unit === "ft") {
      assert.equal(e.price, null, `${a.key} 按英尺项的 price 应为 null`);
      assert.equal(a.unitPrice, perFootPrice(e.rawPrice), a.key);
    } else {
      assert.equal(a.unitPrice, e.price, a.key);
    }
    assert.ok(a.key.includes("_"), `新键须含下划线：${a.key}`);
    assert.deepEqual(EXCEL_ADDON_DISPOSITION[id], { kind: "catalog", ref: a.key });
  }
  assert.equal(fromExcel.filter((a) => a.unit === "ft").length, 4);
});

test("Downtown 服务费来自 fees.downtown", () => {
  const d = getAddonDef("downtown_fee")!;
  assert.deepEqual(d.source, { kind: "fee", path: "downtown" });
  assert.equal(d.unitPrice, seed.fees.downtown);
  assert.equal(d.unitPrice, 150);
});

test("关键价格：motor_plugin 350 / drape_motor_plugin_matter 700 / hub 240 / downtown_fee 150；原 7 项不变", () => {
  assert.equal(getAddonDef("motor_plugin")!.unitPrice, 350);
  assert.equal(getAddonDef("drape_motor_plugin_matter")!.unitPrice, 700);
  assert.equal(getAddonDef("hub")!.unitPrice, 240);
  assert.equal(getAddonDef("downtown_fee")!.unitPrice, 150);
  assert.deepEqual(
    ["motor", "hub", "remote", "track6", "track8", "track10", "track12"].map((k) => getAddonDef(k)!.unitPrice),
    [150, 240, 40, 60, 80, 100, 120],
  );
});

test("Excel 40 行全部归类：24 / 10 / 4 / 1 / 1，无未归类、无多余", () => {
  assert.equal(seed.excelAddons.length, 40);
  const ids = seed.excelAddons.map((e) => e.id);
  assert.deepEqual(Object.keys(EXCEL_ADDON_DISPOSITION).sort(), [...ids].sort());
  const count: Record<string, number> = {};
  for (const id of ids) {
    const d = EXCEL_ADDON_DISPOSITION[id];
    assert.ok(d, `未归类：${id}`);
    count[d.kind] = (count[d.kind] ?? 0) + 1;
    if (d.kind === "catalog" || d.kind === "duplicate" || d.kind === "superseded") {
      assert.ok(d.ref && getAddonDef(d.ref), `${id} ref 不在目录：${d.ref}`);
    }
    if (d.kind !== "catalog") assert.ok(d.reason || d.kind === "duplicate", `${id} 缺理由`);
  }
  assert.deepEqual(count, { catalog: 24, duplicate: 10, engine: 4, superseded: 1, skip: 1 });
});

test("重复项价格与零售表一致；Hub 300 为旧值；Door Screen / Open roll 归引擎；+15% 不做", () => {
  for (const [id, d] of Object.entries(EXCEL_ADDON_DISPOSITION)) {
    if (d.kind !== "duplicate") continue;
    assert.equal(excelById.get(id)!.price, getAddonDef(d.ref!)!.unitPrice, `${id} → ${d.ref}`);
  }
  assert.equal(EXCEL_ADDON_DISPOSITION["excel-addon-7"].kind, "superseded");
  assert.equal(excelById.get("excel-addon-7")!.price, 300);
  for (const id of ["excel-addon-34", "excel-addon-35", "excel-addon-42", "excel-addon-43"]) {
    assert.equal(EXCEL_ADDON_DISPOSITION[id].kind, "engine", id);
  }
  assert.match(excelById.get("excel-addon-34")!.name, /Door Screen Sheer/);
  assert.match(excelById.get("excel-addon-42")!.name, /Open roll Valance/);
  assert.equal(EXCEL_ADDON_DISPOSITION["excel-addon-46"].kind, "skip");
});

test("按英尺：Motorized Drape Track × 13 = 390；单价显示带 /ft", () => {
  assert.equal(getAddonDef("drape_track_extra_ft")!.unit, "ft");
  assert.equal(calcAddonSubtotal([{ addonKey: "drape_track_extra_ft", qty: 13 }]), 390);
  assert.deepEqual(
    ["drape_track_extra_ft", "channel_uhl_ft", "shutter_frame_vinyl_ft", "shutter_frame_wood_ft"].map((k) => getAddonDef(k)!.unitPrice),
    [30, 18, 4, 7],
  );
  assert.equal(formatAddonUnitPrice("drape_track_extra_ft", 30), "$30.00/ft");
  assert.equal(formatAddonUnitPrice("hub", 240), "$240.00");
});

test("对客名称：目录取 printLabel；自定义取销售填写名；内部提示不进名称", () => {
  assert.equal(addonCustomerLabel("track6"), "Track 6 ft");
  assert.equal(addonCustomerLabel("motor_charger"), "Sunny Motor Tube Charging cable");
  assert.equal(addonCustomerLabel(CUSTOM_ADDON_KEY, "  Extra bracket "), "Extra bracket");
  assert.equal(addonCustomerLabel(CUSTOM_ADDON_KEY, ""), "Custom item");
  for (const a of ADDON_CATALOG) {
    if (a.hint) assert.ok(!a.printLabel.includes(a.hint), a.key);
    assert.ok(!/[一-鿿]/.test(a.printLabel), `对客名称不含中文：${a.key}`);
  }
});

test("企业价：覆盖优先，缺省回目录价", () => {
  assert.equal(effectiveAddonPrice("motor", { motor: 160 }), 160);
  assert.equal(effectiveAddonPrice("motor", {}), 150);
  assert.equal(effectiveAddonPrice("nope", { nope: 1 }), undefined);
  assert.equal(calcAddonSubtotal([{ addonKey: "motor", qty: 2 }], { motor: 160 }), 320);
});

test("resolveAddonLines：提交单价优先 / 预设缺单价取企业价 / 自定义名 / 未知键按 0 并提示", () => {
  const r = resolveAddonLines(
    [
      { addonKey: "hub", qty: 1, unitPrice: 200 },
      { addonKey: "motor", qty: 2 },
      { addonKey: CUSTOM_ADDON_KEY, qty: 2, unitPrice: 15, displayName: "Extra bracket" },
      { addonKey: "mystery", qty: 1 },
    ],
    { motor: 160 },
  );
  assert.deepEqual(r.lines.map((l) => [l.addonKey, l.displayName, l.unitPrice, l.qty, l.subtotal]), [
    ["hub", "Hub", 200, 1, 200],
    ["motor", "Motor tube", 160, 2, 320],
    ["custom", "Extra bracket", 15, 2, 30],
    ["mystery", "mystery", 0, 1, 0],
  ]);
  assert.equal(r.subtotal, 550);
  assert.equal(r.warnings.length, 1);
  // 非法单价（负数 / NaN）回企业价；数量非法按 1
  const bad = resolveAddonLines([{ addonKey: "remote", qty: 0, unitPrice: -5 }, { addonKey: "remote", qty: NaN, unitPrice: NaN }]);
  assert.deepEqual(bad.lines.map((l) => [l.unitPrice, l.qty]), [[40, 1], [40, 1]]);
});

test("normalizeAddonInputs 丢弃坏项", () => {
  assert.deepEqual(normalizeAddonInputs(null), []);
  assert.deepEqual(
    normalizeAddonInputs([null, 3, { qty: 1 }, { addonKey: " hub ", qty: "2", unitPrice: 200, displayName: 5 }]),
    [{ addonKey: "hub", qty: 2, unitPrice: 200 }],
  );
});

test("Part B 行 → 提交附加项目：只取已选且数量 > 0；单价带销售填写值；自定义带名称", () => {
  const out = partBRowsToAddonInputs([
    { skuItem: "", qty: 1, price: 10 },
    { skuItem: "hub", qty: 0, price: 240 },
    { skuItem: "hub", qty: 1, price: 200 },
    { skuItem: "drape_track_extra_ft", qty: 13, price: 30 },
    { skuItem: "__custom", customName: " Extra bracket ", qty: 2, price: 15 },
    { skuItem: "__custom", qty: 1, price: 5 },
  ]);
  assert.deepEqual(out, [
    { addonKey: "hub", qty: 1, unitPrice: 200 },
    { addonKey: "drape_track_extra_ft", qty: 13, unitPrice: 30 },
    { addonKey: "custom", qty: 2, unitPrice: 15, displayName: "Extra bracket" },
    { addonKey: "custom", qty: 1, unitPrice: 5, displayName: "Custom item" },
  ]);
  assert.equal(resolveAddonLines(out).subtotal, 200 + 390 + 30 + 5);
});

test("calculateQuoteTotal：Part B 计入税前与含税总额（650 + 2 × 15 = 680）", () => {
  const base = calculateQuoteTotal({ items: [], taxRate: 0.13 });
  const withB = calculateQuoteTotal({
    items: [],
    taxRate: 0.13,
    addons: [
      { addonKey: "drape_motor_battery", qty: 1, unitPrice: 650 },
      { addonKey: CUSTOM_ADDON_KEY, qty: 2, unitPrice: 15, displayName: "Extra bracket" },
    ],
  });
  assert.equal(withB.addonsSubtotal, 680);
  assert.equal(Math.round((withB.grandTotal - base.grandTotal) * 100) / 100, 768.4);
});

console.log(`附加项目目录对照通过（${passed} 条）`);
