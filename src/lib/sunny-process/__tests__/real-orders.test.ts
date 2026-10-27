/**
 * 真实订单回归：Sunny 已下给工厂的工艺单（G0927 梦幻帘 / G1024 蛇形 / G1025 韩褶）
 * 输入取订单里销售填写的值，期望取订单里保存的结果；与原件对照夹具互补——
 * 夹具证明公式一致，这里证明"按真实数据算出来就是工厂收到的那张单"。
 * 运行：npx tsx src/lib/sunny-process/__tests__/real-orders.test.ts
 */
import { buildDomesticLabels, computeDomesticRow, type DomesticRowInput } from "../domestic-calc";
import { computeDrapeRow, FINISHED_HEIGHT_ALLOWANCE_CM, totalDrapeMaterials, type DrapeRowInput } from "../drapes-calc";
import { loadFixture, Tally, type ExcelValue } from "./oracle-helpers";

type Mat = Record<"rodM" | "fabricSqm" | "beadBagM" | "hooks" | "pleatBeads", number>;
interface DrapeSaved {
  widthCm: number; heightCm: number; pleatTopCm: number; finishedWidthCm: number; finishedHeightCm: number;
  finishedHeightIsFormula: boolean; beadBagCount: number; beadClip: ExcelValue; beadCount: number; materials: Mat;
}
type RealCase =
  | { id: string; kind: "domestic"; input: { orderNo: string; rows: DomesticRowInput[] };
      saved: { rows: { widthCm: number; heightCm: number; sqm: number }[]; labels: (string | null)[][] } }
  | { id: string; kind: "drapes-6cm"; input: { orderNo: string; rows: (DrapeRowInput & { code: string })[] };
      saved: { rows: DrapeSaved[]; totals: Mat } };

const fx = loadFixture<RealCase>("real-orders");
const t = new Tally();
console.log(`真实订单回归 ${fx.cases.length} 张：${fx.cases.map((c) => c.id).join(" / ")}`);

for (const c of fx.cases) {
  if (c.kind === "domestic") {
    c.input.rows.forEach((row, k) => {
      const r = computeDomesticRow(row);
      const e = c.saved.rows[k]!;
      t.eq(r.widthCm, e.widthCm, `${c.id} ${row.code} 厘米宽`);
      t.eq(r.heightCm, e.heightCm, `${c.id} ${row.code} 厘米高`);
      t.eq(r.sqm, e.sqm, `${c.id} ${row.code} 平方`);
    });
    const labels = buildDomesticLabels(c.input.orderNo, c.input.rows);
    t.eq(labels.length, c.saved.labels.length, `${c.id} 标签张数`);
    labels.forEach((lines, k) => lines.forEach((line, j) => t.eq(line, c.saved.labels[k]?.[j] ?? null, `${c.id} 标签${k + 1} 第${j + 1}行`)));
    continue;
  }
  const results = c.input.rows.map((row) => computeDrapeRow(row, "6cm"));
  const manualMinus2 = c.saved.rows.every((e) => !e.finishedHeightIsFormula && e.finishedHeightCm === e.heightCm - FINISHED_HEIGHT_ALLOWANCE_CM);
  results.forEach((r, k) => {
    const e = c.saved.rows[k]!;
    const L = (f: string) => `${c.id} ${c.input.rows[k]!.code} ${f}`;
    t.eq(r.widthCm, e.widthCm, L("测量宽cm"));
    t.eq(r.heightCm, e.heightCm, L("成品高cm"));
    t.eq(r.pleatTopCm, e.pleatTopCm, L("韩褶上端宽"));
    t.eq(r.finishedWidthCm, e.finishedWidthCm, L("成品帘子宽"));
    t.eq(r.beadCount, e.beadCount, L("颗数"));
    t.eq(r.beadBagCount, e.beadBagCount, L("走珠布袋颗数"));
    t.eq(r.beadClip, e.beadClip === 0 ? null : e.beadClip, L("走珠扣"));
    for (const m of ["rodM", "beadBagM", "hooks", "pleatBeads"] as const) t.eq(r.materials[m], e.materials[m], L(`物料 ${m}`));
    // X-6：成品帘子高 = 成品高 − 2；布料平方随之变
    t.eq(r.finishedHeightCm, e.heightCm - FINISHED_HEIGHT_ALLOWANCE_CM, L("成品帘子高 = 成品高 − 2"));
    t.eq(r.materials.fabricSqm, (e.finishedWidthCm / 100) * ((e.heightCm - FINISHED_HEIGHT_ALLOWANCE_CM) / 100) * c.input.rows[k]!.qty, L("布料平方按减后的高"));
    if (manualMinus2) {
      t.eq(r.finishedHeightCm, e.finishedHeightCm, L("与订单手工改的成品帘子高一致"));
      t.eq(r.materials.fabricSqm, e.materials.fabricSqm, L("物料 fabricSqm 与订单一致"));
    } else {
      t.skip("X-6");
      t.skip("X-6");
    }
  });
  const tot = totalDrapeMaterials(results);
  for (const m of ["rodM", "beadBagM", "hooks", "pleatBeads"] as const) t.eq(tot[m], c.saved.totals[m], `${c.id} 合计 ${m}`);
  if (manualMinus2) t.eq(tot.fabricSqm, c.saved.totals.fabricSqm, `${c.id} 合计 fabricSqm`);
  else t.skip("X-6");
}

// G1025 正是拍板原话里的那张（测量 268 → 266）
{
  const g = fx.cases.find((c) => c.id === "G1025");
  t.ok(!!g && g.kind === "drapes-6cm" && g.saved.rows.some((e) => e.heightCm === 268 && e.finishedHeightCm === 266), "G1025：成品高 268 → 成品帘子高 266（拍板原话）");
}

t.report("真实订单回归");
