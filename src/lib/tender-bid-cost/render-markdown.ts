/**
 * TI-2 核算表 Markdown 渲染（只排版，不计算：每个数字都取自视图）
 */
import type { CostSheetView } from "./sheet-view";

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const row = (cells: string[]) => `| ${cells.map(cell).join(" | ")} |`;

const LINE_HEADER = ["行", "说明", "数量", "供应商报价", "证据", "货值", "关税", "运费", "本地配送", "其它", "直接成本", "单位成本", "单位报价", "行合计", "利润", "毛利率", "备注"];

export function renderCostSheetMarkdown(view: CostSheetView): string {
  const out: string[] = [];
  out.push(`# ${view.title}：${view.scenarioLabel}`, "", "金额单位：加元。报价不含 HST。", "");

  out.push("## 行项", "");
  for (const g of view.groups) {
    out.push(`### ${g.labelZh}`, "", row(LINE_HEADER), row(LINE_HEADER.map(() => "---")));
    for (const r of g.rows) {
      out.push(row([
        String(r.lineNo), r.description, r.quantity, r.quote, r.evidence, r.goods, r.duty, r.freight, r.localDelivery, r.other,
        r.directCost, r.unitCost, r.unitBid, r.extended, r.profit, r.grossMarginPct, r.marks.join("；"),
      ]));
    }
    const s = g.subtotal;
    out.push(row([`${g.labelZh}小计`, "", "", "", "", s.goods, s.duty, s.freight, s.localDelivery, s.other, s.directCost, "", "", s.extended, s.profit, "", ""]), "");
  }

  const t = view.totals;
  out.push("## 合计", "", row(["项", "数值"]), row(["---", "---"]));
  out.push(row(["直接成本", t.directCost]));
  out.push(row([`报价（${t.taxNote}）`, t.bidExclHst]));
  out.push(row(["利润（扣按售价预备金后）", t.profit]));
  out.push(row(["毛利率（（价 − 成本）÷ 价）", t.grossMarginPct]));
  out.push(row(["加成率（（价 − 成本）÷ 成本）", t.markupPct]));
  out.push(row(["扣按售价预备金后的利润率", t.netMarginPct]));
  out.push(row(["预备金（按售价留）", t.reserveOnSale]));
  out.push(row(["预备金（计入成本）", t.reserveInCost]));
  out.push(row(["不可抵扣的进口环节税（已在成本内）", t.nonRecoverableTax]));
  out.push(row(["进口 GST 现金流（先垫付）", t.importGstCash]));
  out.push("", t.marks.length ? `标记：${t.marks.join("；")}` : "标记：无", "");

  out.push("## 假设与出处", "", row(["项", "取值", "依据", "来源", "日期"]), row(["---", "---", "---", "---", "---"]));
  for (const a of view.assumptions) out.push(row([a.item, a.value, a.basisKind, a.sourceRef ?? "未提供", a.asOf ?? "未提供"]));
  out.push("");

  out.push("## 阻断与提示", "");
  if (view.blockers.length === 0 && view.notices.length === 0) out.push("无。");
  for (const b of view.blockers) out.push(`- 第 ${b.lineNo} 行（${b.description}）：${b.reasons.join("、")}`);
  for (const n of view.notices) out.push(`- ${n}`);
  out.push("");
  return out.join("\n");
}
