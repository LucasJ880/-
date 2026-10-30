/**
 * 国内下单表 × Excel 原件逐值对照（厘米换算 / 平方 / 标签）
 * 运行：npx tsx src/lib/sunny-process/__tests__/domestic-oracle.test.ts
 */
import { buildDomesticLabels, computeDomesticRow, type DomesticRowInput } from "../domestic-calc";
import { loadFixture, Tally } from "./oracle-helpers";

interface DomesticCase {
  id: string;
  input: { orderNo: string; rows: DomesticRowInput[] };
  expected: { rows: { widthCm: number; heightCm: number; sqm: number }[]; labels: (string | null)[][]; labelCount: string };
}

const fx = loadFixture<DomesticCase>("domestic");
const t = new Tally();
console.log(`国内下单 × 原件《${fx.source.title}》 用例 ${fx.cases.length}`);

for (const c of fx.cases) {
  c.input.rows.forEach((row, k) => {
    const r = computeDomesticRow(row);
    const e = c.expected.rows[k]!;
    t.eq(r.widthCm, e.widthCm, `${c.id} 行${k + 1} 厘米宽`);
    t.eq(r.heightCm, e.heightCm, `${c.id} 行${k + 1} 厘米高`);
    t.eq(r.sqm, e.sqm, `${c.id} 行${k + 1} 平方`);
  });
  const labels = buildDomesticLabels(c.input.orderNo, c.input.rows);
  t.eq(labels.length, c.expected.labels.length, `${c.id} 标签张数`);
  t.eq(`当前标签：${labels.length} 张`, c.expected.labelCount, `${c.id} 标签计数文本`);
  labels.forEach((lines, k) => {
    const exp = c.expected.labels[k] ?? [];
    lines.forEach((line, j) => t.eq(line, exp[j] ?? null, `${c.id} 标签${k + 1} 第${j + 1}行`));
  });
}

t.ok(buildDomesticLabels("G1", [{ code: "A", widthIn: 36.5, heightIn: 60, productType: "蜂窝帘", sku: "C", measure: "内装", control: "无绳", side: "左", headrail: "", mount: "顶装", remark: "" }])[0]![3] === "36 8/16 W × 60 H (in)", "标签尺寸 16 分制不约分");

t.report("国内下单原件对照");
