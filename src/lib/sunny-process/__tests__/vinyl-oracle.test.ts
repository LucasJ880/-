/**
 * Vinyl 百叶窗工艺引擎 × Excel 原件逐值对照（单窗工艺 / 下料总表 / 标签 / 订单汇总）
 * 原件：Vinyl shutters 工艺单 AIV1（整合版），每个用例一次填满 1–30 个窗位
 * 运行：npx tsx src/lib/sunny-process/__tests__/vinyl-oracle.test.ts
 */
import {
  buildVinylCutList,
  buildVinylLabels,
  computeVinylWindow,
  type VinylHeader,
  type VinylWindowInput,
  type VinylWindowResult,
} from "../vinyl-engine";
import { isExcelError, loadFixture, Tally, type ExcelValue } from "./oracle-helpers";

interface VinylCase {
  id: string;
  input: { header: VinylHeader; windows: VinylWindowInput[] };
  expected: {
    windows: Record<string, ExcelValue>[];
    cutList: Record<"A" | "B" | "C" | "D" | "E" | "F" | "G", ExcelValue>[];
    labels: ExcelValue[][];
    summary: { sfTotal: number; panelTotal: number; tPostTotal: number; hPostTotal: number; cutHeader: string };
  };
}

const fx = loadFixture<VinylCase>("vinyl");
const t = new Tally();
console.log(`Vinyl × 原件《${fx.source.title}》 用例 ${fx.cases.length}，窗 ${fx.cases.reduce((s, c) => s + c.input.windows.length, 0)}`);

/** 系统值 → 可与原件比较的形状：NaN ↔ 错误、布尔 ↔ 1/0、"" ↔ null */
function sys(v: unknown): unknown {
  if (typeof v === "number" && Number.isNaN(v)) return "#ERR";
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null) return "#NULL";
  return v;
}
function xl(v: ExcelValue, key: string): unknown {
  if (isExcelError(v)) return "#ERR";
  if (key === "postCount" || key === "postQty") return Number(v);
  if (v === "" && (key === "rodUpper2" || key === "rodLower2")) return "#NULL";
  return v;
}

const NULLABLE_ERR = new Set(["splitError", "message"]);

for (const c of fx.cases) {
  const { header, windows } = c.input;
  const computed = windows.map((w, k) => ({ input: w, result: computeVinylWindow(w, header), windowNo: k + 1 }));

  computed.forEach(({ input: w, result: r }, k) => {
    const e = c.expected.windows[k]!;
    for (const [key, ev] of Object.entries(e)) {
      let actual: unknown = (r as unknown as Record<string, unknown>)[key];
      if (NULLABLE_ERR.has(key) && actual === null) actual = Number.NaN;
      const label = `${c.id} 窗${k + 1} ${w.frame || "-"}/${w.inOut}/${w.frameCount}/${w.structure} ${w.openCode} ${key}`;
      if (key === "openKey" && header.louver === 2.5 && (w.openCode === "LLR" || w.openCode === "LTLR") && ev === 0) {
        t.skip("X-5");
        t.eq(actual, "4/2", `${label}（并集口径）`);
        continue;
      }
      t.eq(sys(actual), xl(ev, key), label);
    }
  });

  // 下料总表：原件口径（不含柱）逐行一致
  const cut = buildVinylCutList(computed, header, { includePosts: false });
  t.eq(cut.length, c.expected.cutList.length, `${c.id} 下料总表行数`);
  cut.forEach((row, i) => {
    const e = c.expected.cutList[i];
    if (!e) return;
    const L = `${c.id} 下料第${i + 1}行`;
    t.eq(row.seq, e.A, `${L} 顺序`);
    t.eq(row.type, e.B, `${L} 料型`);
    t.eq(row.spec, e.C ?? "", `${L} 规格`);
    t.eq(row.length, e.D, `${L} 长度`);
    t.eq(row.qty, e.E, `${L} 数量`);
    t.eq(row.ends, e.F, `${L} 端头`);
    t.eq(row.windows, e.G, `${L} 窗号×数量`);
  });

  // 系统口径（含 T柱 / 挂柱，偏离 X-4）：只比原件多出柱行，其余行内容不变
  const withPosts = buildVinylCutList(computed, header, { includePosts: true });
  const strip = (rows: typeof cut) => rows.filter((r) => r.type !== "T柱" && r.type !== "挂柱").map((r) => `${r.type}|${r.spec}|${r.length}|${r.qty}|${r.ends}|${r.windows}`);
  t.eq(JSON.stringify(strip(withPosts)), JSON.stringify(strip(cut)), `${c.id} 含柱模式去掉柱行后与原件口径一致`);
  const postPieces = computed.reduce((s, { input: w, result: r }) => s + (w.panels > 0 && /[TH]$/i.test(w.posts.trim()) && r.postLen > 0 ? r.postQty : 0), 0);
  const postRows = withPosts.filter((r) => r.type === "T柱" || r.type === "挂柱").reduce((s, r) => s + r.qty, 0);
  t.eq(postRows, postPieces, `${c.id} 含柱模式柱数量 = 各窗柱数之和`);
  if (postPieces > 0) t.skip("X-4");

  // 标签
  const labels = buildVinylLabels(computed, header);
  t.eq(labels.length, c.expected.labels.length, `${c.id} 标签张数`);
  labels.forEach((lab, i) => {
    const e = c.expected.labels[i] ?? [];
    lab.lines.forEach((line, j) => t.eq(line === null ? "#ERR" : line, isExcelError(e[j] as ExcelValue) ? "#ERR" : e[j], `${c.id} 标签${i + 1}(${lab.kind}) 第${j + 1}行`));
  });

  // 订单汇总（订单总表第 4–5 行）
  const s = c.expected.summary;
  const results: VinylWindowResult[] = computed.map((x) => x.result);
  t.eq(results.reduce((a, r) => a + r.sf, 0), s.sfTotal, `${c.id} 合计 SF`);
  t.eq(windows.reduce((a, w) => a + (w.panels || 0), 0), s.panelTotal, `${c.id} 百叶总扇数`);
  const postsOf = (suffix: string) => windows.reduce((a, w) => a + (w.posts.trim().toUpperCase().endsWith(suffix) ? Number(w.posts.trim()[0]) : 0), 0);
  t.eq(postsOf("T"), s.tPostTotal, `${c.id} T柱总数`);
  t.eq(postsOf("H"), s.hPostTotal, `${c.id} 挂柱总数`);
  const totalQty = cut.reduce((a, r) => a + r.qty, 0);
  t.eq(`订单：${header.orderNo}   窗：${windows.filter((w) => w.panels > 0).length}   下料总数量：${totalQty}`, s.cutHeader, `${c.id} 下料表头`);
}

t.report("Vinyl 原件对照");
