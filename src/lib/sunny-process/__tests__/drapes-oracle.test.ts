/**
 * 窗帘工艺引擎 × Excel 原件逐值对照（6cm / 7cm 两版）
 * 运行：npx tsx src/lib/sunny-process/__tests__/drapes-oracle.test.ts
 */
import { computeDrapeRow, totalDrapeMaterials, type DrapeRowInput, type DrapeVersion } from "../drapes-engine";
import { loadFixture, Tally, type ExcelValue } from "./oracle-helpers";

interface DrapeCase {
  id: string;
  input: { rows: DrapeRowInput[] };
  expected: {
    rows: {
      widthCm: number; heightCm: number; pleatTopCm: number; finishedWidthCm: number; finishedHeightCm: number;
      beadBagCount: number; beadClip: ExcelValue; beadCount: number; beadCountPlus: number;
      materials: Record<"rodM" | "fabricSqm" | "beadBagM" | "hooks" | "pleatBeads", number>;
    }[];
    totals: Record<"rodM" | "fabricSqm" | "beadBagM" | "hooks" | "pleatBeads", number>;
  };
}

const t = new Tally();

for (const version of ["6cm", "7cm"] as DrapeVersion[]) {
  const fx = loadFixture<DrapeCase>(`drapes-${version}`);
  console.log(`窗帘 ${version} × 原件《${fx.source.title}》 用例 ${fx.cases.length}`);
  for (const c of fx.cases) {
    const results = c.input.rows.map((row) => computeDrapeRow(row, version));
    results.forEach((r, k) => {
      const e = c.expected.rows[k]!;
      const L = (f: string) => `${c.id} 行${k + 1} ${c.input.rows[k]!.craft || "(空工艺)"} ${f}`;
      t.eq(r.widthCm, e.widthCm, L("测量宽cm"));
      t.eq(r.heightCm, e.heightCm, L("成品高cm"));
      t.eq(r.pleatTopCm, e.pleatTopCm, L("韩褶上端宽"));
      t.eq(r.finishedWidthCm, e.finishedWidthCm, L("成品宽"));
      t.eq(r.finishedHeightCm, e.finishedHeightCm, L("成品高"));
      t.eq(r.beadCount, e.beadCount, L("颗数"));
      t.eq(r.beadBagCount, e.beadCountPlus, L("走珠布袋颗数"));
      t.eq(r.beadBagCount, e.beadBagCount, L("O 列 = X 列"));
      t.eq(r.beadClip, e.beadClip === 0 ? null : e.beadClip, L("走珠扣"));
      for (const m of ["rodM", "fabricSqm", "beadBagM", "hooks", "pleatBeads"] as const) {
        t.eq(r.materials[m], e.materials[m], L(`物料 ${m}`));
      }
    });
    const tot = totalDrapeMaterials(results);
    for (const m of ["rodM", "fabricSqm", "beadBagM", "hooks", "pleatBeads"] as const) {
      t.eq(tot[m], c.expected.totals[m], `${c.id} 合计 ${m}`);
    }
  }
}

// 两版差异的直接断言（spec：6cm 与 7cm 版本差异）
{
  const row: DrapeRowInput = { widthIn: 100, heightIn: 96, sku: "635", qty: 2, craft: "蛇型R", layer: "布", liner: "否", fullness: 1.8, mount: "顶装C", rod: "", rodColor: "" };
  const a = computeDrapeRow(row, "6cm");
  const b = computeDrapeRow(row, "7cm");
  t.ok(a.beadClip === "6cm" && b.beadClip === "7cm", "走珠扣随版本 6cm / 7cm");
  t.ok(a.beadCount === Math.ceil((254 / 2) * 1.8 / 10.7) && b.beadCount === Math.ceil((254 / 2) * 1.8 / 12.5), "颗数分别按 10.7 / 12.5 求", { a: a.beadCount, b: b.beadCount });
  t.ok(computeDrapeRow({ ...row, fullness: 1.5 }, "7cm").beadClip === "8cm", "倍数 ≤1.5 走珠扣 8cm");
}

t.report("窗帘原件对照");
