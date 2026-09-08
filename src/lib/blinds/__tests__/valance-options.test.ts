/**
 * Valance 选项与定价联动（VAL-01..08）——2026-08-26 Lucas 口径
 * 运行：npx tsx src/lib/blinds/__tests__/valance-options.test.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { priceFor } from "@/lib/blinds/pricing-engine";
import { valanceOptionsFor, valanceRequiredFor, defaultValanceFor, rollerEngineFabricKey, parseRollerFabric, VALANCE_NONE } from "@/lib/blinds/valance-options";

let pass = 0, fail = 0;
const ok = (c: boolean, n: string, d?: unknown) => { if (c) { pass++; console.log(`  ✓ ${n}`); } else { fail++; console.error(`  ✗ ${n}`, d ?? ""); } };

console.log("Valance 选项与定价联动");

// VAL-01 Roller 三选一含 None；Zebra 不允许 None（Lucas：zebra 不能选 N/A）
ok(JSON.stringify(valanceOptionsFor("Roller")) === JSON.stringify(["None", "Cassette", "Fascia"]), "VAL-01a: Roller = None/Cassette/Fascia");
ok(JSON.stringify(valanceOptionsFor("Zebra")) === JSON.stringify(["Cassette", "Fascia"]) && !valanceOptionsFor("Zebra").includes(VALANCE_NONE), "VAL-01b: Zebra 只有 Cassette/Fascia（无 None/N.A）");
ok(valanceRequiredFor("Roller") && valanceRequiredFor("Zebra") && !valanceRequiredFor("Drapery"), "VAL-01c: Roller/Zebra 必选，其余可空");
ok(defaultValanceFor("Roller") === "None" && defaultValanceFor("Zebra") === "Cassette", "VAL-01d: 默认值 Roller=None、Zebra=Cassette");

// VAL-02 键映射与老数据回解
ok(rollerEngineFabricKey("Blackout", "None") === "Blackout (Open Roll)" && rollerEngineFabricKey("Light Filtering", "Cassette") === "Light Filtering w Cassette" && rollerEngineFabricKey("Blackout", "Fascia") === "Blackout w Fascia", "VAL-02a: base+valance → 引擎键");
const rt = ["Blackout (Open Roll)", "Light Filtering w Cassette", "Blackout w Fascia"].map(parseRollerFabric);
ok(rt[0]!.valance === "None" && rt[1]!.valance === "Cassette" && rt[2]!.valance === "Fascia" && rt[2]!.base === "Blackout", "VAL-02b: 引擎键/老数据 → base+valance 回解");

// VAL-03 价差实证：None 无加价；Cassette=+25（<50"）/+50（≥50"）；Fascia 与 Cassette 同价（Lucas 暂定）
const at = (fabric: string, w: number) => { const r = priceFor("Roller", fabric, w, 48, null, false); if ("error" in r) throw new Error(r.error); return r.price; };
const none36 = at("Blackout (Open Roll)", 36);
const cass36 = at("Blackout w Cassette", 36);
const fasc36 = at("Blackout w Fascia", 36);
ok(cass36 - none36 === 25, "VAL-03a: 36\" 宽 Cassette 比 None 贵 $25", { none36, cass36 });
ok(fasc36 === cass36, "VAL-03b: Fascia 与 Cassette 同价（暂定口径）");
const none60 = at("Blackout (Open Roll)", 60);
const cass60 = at("Blackout w Cassette", 60);
ok(cass60 - none60 === 50, "VAL-03c: 60\" 宽 Cassette 加价 $50");
ok(at("Light Filtering w Fascia", 60) === at("Light Filtering w Cassette", 60), "VAL-03d: LF Fascia=Cassette（宽档同验）");

// VAL-04 UI 结构守卫
{
  const root = join(__dirname, "../../../..");
  const partA = readFileSync(join(root, "src/app/(main)/sales/quote-sheet/part-a.tsx"), "utf-8");
  const orderS = readFileSync(join(root, "src/app/(main)/sales/quote-sheet/order-shades.tsx"), "utf-8");
  ok(partA.includes("valanceOptionsFor(line.product") && partA.includes("rollerEngineFabricKey") && partA.includes("defaultValanceFor"), "VAL-04a: 报价单 valance 按产品出选项 + Roller 联动定价键 + 切产品带默认");
  ok(partA.includes("ROLLER_BASE_FABRICS") && partA.includes("parseRollerFabric(line.fabric).base"), "VAL-04b: Roller 面料下拉只显示基础面料（罩型由 Valance 承载，不再双头表达）");
  ok(!orderS.includes('updateLine(line.id, "valance", e.target.value)') && orderS.includes("valanceOptionsFor(line.product)"), "VAL-04c: 订货单 valance 从手写输入改为选择");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
