/**
 * 成本类别启发式分类（确定性，中英双语关键词）。
 * AI 只在低置信度行上补充（见 classify-ai.ts），且只能改建议类别/描述，绝不改数字。
 */

import type { CostCategory } from "../contract";

type Rule = { category: CostCategory; weight: number; patterns: RegExp[] };

/** 顺序 = 优先级（同分时靠前者胜）；权重区分强弱信号 */
const RULES: Rule[] = [
  { category: "FREIGHT", weight: 3, patterns: [/ocean\s*freight/i, /sea\s*freight/i, /\bfreight\b/i, /\bshipping\b/i, /\btrucking\b/i, /inland/i, /海运/, /运费/, /陆运/, /运输费?/] },
  { category: "LOGISTICS", weight: 2, patterns: [/packag/i, /packing/i, /crat(e|ing)/i, /palleti[sz]/i, /domestic\s*(freight|transport)/i, /包装/, /国内运/, /打托/] },
  { category: "CUSTOMS", weight: 3, patterns: [/customs/i, /brokerage/i, /clearance/i, /清关/, /报关/] },
  { category: "DUTY", weight: 3, patterns: [/\bduty\b/i, /\bduties\b/i, /tariff/i, /关税/] },
  { category: "WAREHOUSING", weight: 3, patterns: [/warehous/i, /\bstorage\b/i, /仓储/, /仓库/] },
  { category: "LABOUR", weight: 3, patterns: [/install/i, /\blabou?r\b/i, /removal/i, /caulk/i, /paint/i, /measure/i, /foreman/i, /overtime/i, /\bcrew\b/i, /安装/, /人工/, /拆除/, /打胶/, /测量/, /油漆/, /工时/] },
  { category: "EQUIPMENT", weight: 3, patterns: [/\blift\b/i, /scaffold/i, /\bcrane\b/i, /boom/i, /equipment/i, /rental/i, /升降/, /脚手架/, /吊车/, /设备租/] },
  { category: "SITE_GENERAL", weight: 2, patterns: [/fenc/i, /protection/i, /hoarding/i, /garbage/i, /\bbin\b/i, /parking/i, /travel/i, /site\s*(general|setup|clean)/i, /围挡/, /防护/, /垃圾/, /停车/, /差旅/, /现场/] },
  { category: "ENGINEERING", weight: 3, patterns: [/engineer/i, /shop\s*drawing/i, /\bdrawings?\b/i, /\bdesign\b/i, /stamp/i, /图纸/, /工程师/, /设计费?/] },
  { category: "PERMIT", weight: 3, patterns: [/permit/i, /许可/, /报建/] },
  { category: "COMPLIANCE", weight: 3, patterns: [/testing/i, /inspection/i, /\bESA\b/, /certif/i, /compliance/i, /检测/, /检验/, /认证/] },
  { category: "PROJECT_MANAGEMENT", weight: 3, patterns: [/project\s*manag/i, /\bPM\b/, /supervis/i, /management/i, /项目经理/, /项目管理/, /管理人员/] },
  { category: "INSURANCE", weight: 3, patterns: [/insurance/i, /保险/] },
  { category: "BOND", weight: 3, patterns: [/\bbond/i, /surety/i, /保函/, /保证金/] },
  { category: "FINANCING", weight: 3, patterns: [/financ/i, /interest/i, /融资/, /利息/, /资金成本/, /资金使用/, /资金占用/] },
  { category: "ADMIN", weight: 2, patterns: [/\badmin/i, /overhead/i, /office/i, /行政/, /管理费/, /办公/] },
  { category: "COMMISSION", weight: 3, patterns: [/commission/i, /佣金/, /提成/] },
  { category: "CONTINGENCY", weight: 3, patterns: [/contingenc/i, /不可预见/, /预备费/, /风险金/] },
  { category: "PROFIT", weight: 3, patterns: [/\bprofit\b/i, /\bmargin\b/i, /利润/, /毛利/] },
  { category: "OTHER", weight: 2, patterns: [/warranty/i, /after[-\s]*sales/i, /质保/, /售后/] },
  { category: "PROCUREMENT", weight: 2, patterns: [/window/i, /\bdoor/i, /glass/i, /glazing/i, /\bunits?\b/i, /product/i, /goods/i, /\bsupply\b/i, /material/i, /\bframe/i, /hardware/i, /shutter/i, /blind/i, /\bsku\b/i, /采购/, /货值/, /产品/, /材料/, /窗/, /门/, /玻璃/, /五金/, /百叶/, /窗帘/] },
];

export type ClassifyResult = { category: CostCategory | null; confidence: number; ambiguous: boolean; matched: CostCategory[] };

/**
 * 对描述（+ 可选的 section 提示 / 用户类别列文本）打分。
 * 置信度：单一强命中 0.85；多命中同分 → 0.45（AMBIGUOUS）；无命中 → null / 0.2。
 */
export function classifyDescription(description: string, hints?: { section?: string | null; categoryText?: string | null }): ClassifyResult {
  const text = [description, hints?.categoryText ?? ""].join(" ");
  const scores = new Map<CostCategory, number>();
  for (const rule of RULES) {
    for (const re of rule.patterns) {
      if (re.test(text)) {
        scores.set(rule.category, (scores.get(rule.category) ?? 0) + rule.weight);
        break;
      }
    }
  }
  // section 提示权重减半（如 Sheet 分组 "Installation" 下的 "Type A"）
  if (hints?.section) {
    for (const rule of RULES) {
      if (rule.patterns.some((re) => re.test(hints.section!))) {
        scores.set(rule.category, (scores.get(rule.category) ?? 0) + rule.weight / 2);
        break;
      }
    }
  }
  if (scores.size === 0) return { category: null, confidence: 0.2, ambiguous: true, matched: [] };
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1] || RULES.findIndex((r) => r.category === a[0]) - RULES.findIndex((r) => r.category === b[0]));
  const [top, topScore] = ranked[0]!;
  const second = ranked[1];
  const ambiguous = !!second && second[1] === topScore;
  const confidence = ambiguous ? 0.45 : topScore >= 3 ? 0.85 : 0.65;
  return { category: top, confidence, ambiguous, matched: ranked.map((r) => r[0]) };
}

/** 把源描述整理成成本行描述：去掉多余空白/行首编号/尾部冒号；保留原文语义 */
export function normalizeDescription(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/^\s*(\d+[.)]|[-•*])\s*/, "")
    .replace(/[:：]\s*$/, "")
    .trim()
    .slice(0, 300);
}

/** 合计/小计/税行 —— 绝不导入为成本。关键词后只允许限定词（括号/百分比/冒号/cost|price|amount|due），"Total station rental" 不误判 */
export const TOTAL_LINE_PATTERN = /^(sub\s*-?\s*total|grand\s*total|total|amount\s*due|balance(\s*due)?|deposit|hst|gst|pst|qst|taxes?|vat|合计|小计|总计|总额|税额?|税费|含税合计|应付(金额)?|定金)(\s+(cost|price|amount|due|payable|incl\.?\s*tax(es)?|excl\.?\s*tax(es)?))?(\s*\([^)]*\))?(\s*\d+(\.\d+)?\s*%)?\s*[:：]?\s*$/i;
export function looksLikeTotalLine(description: string): boolean {
  const d = description.trim();
  if (!d) return false;
  return TOTAL_LINE_PATTERN.test(d);
}

/** 描述里出现的百分比（Bond 1.5% / 佣金 6%）——仅作提示 */
export function extractRatePct(text: string): number | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}
