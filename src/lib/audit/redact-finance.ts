/**
 * FIX-26（FIX-25 安全审查 S1）：审计日志详情里的成本、毛利、落地价类的值只给有财务查看权的人（纯模块，不读库）。
 *
 * 键名判定 = 写死的清单 + 兜底规则（键名不分大小写含 cost / margin / markup / profit / landed）。递归扫对象与数组，
 * 命中的键整值置 null（含它下面的整棵子树），返回被置空的键路径（如 beforeData.sourceCost、afterData.lines[0].costPrice）；
 * 本来就是 null / 没有值的不算。不改输入。
 * 不藏：卖价类（sellingPrice、sourceSellingPrice、ourBidPrice、total；我方报价对项目读者可见，FIX-25 D6）；
 * 供应商原价 unitPrice / totalPrice 跟 FIX-26b（现在维持可见）。
 * 守卫测试 src/lib/audit/__tests__/audit-detail-redaction.test.ts 扫全仓审计写入，像钱的键都要分到「藏」或写明理由的「可见」。
 */
import { financeHiddenHintZh } from "@/lib/project-finance/view-hint";

/** 2026-11-23 全仓扫 logAudit / writeAuditLog 调用与它们可能带进去的对象得到的清单（兜底规则之外再写一遍，读的人一眼看到） */
export const AUDIT_FINANCE_HIDDEN_KEYS: readonly string[] = [
  "sourceCost", "sourceMargin", "estimatedCost", "grossProfit", "grossMarginPct", "markupPct", "pricingRate",
  "calculatedCost", "calculatedMargin", "unitCost", "internalCost", "profitMargin", "costPrice", "costLines",
  "breakdown", "scenarios", "ourCostCad", "ourCostSource", "targetMarginPct", "marginPct",
  "landedCad", "landedCadTotal", "landedCadUnit", "landedCost", "expectedRemainingCostCad",
];

/** 兜底：以后新加的 xxxCost 一类键不登记也藏住（键名碰巧含这些词的非金额值也会被藏，无害） */
export const AUDIT_FINANCE_KEY_PATTERN = /cost|margin|markup|profit|landed/i;

const HIDDEN = new Set(AUDIT_FINANCE_HIDDEN_KEYS);

export function isAuditFinanceKey(key: string): boolean {
  return HIDDEN.has(key) || AUDIT_FINANCE_KEY_PATTERN.test(key);
}

export function redactAuditFinance(value: unknown, rootPath: string): { value: unknown; paths: string[] } {
  const paths: string[] = [];
  const walk = (v: unknown, path: string): unknown => {
    if (Array.isArray(v)) return v.map((item, i) => walk(item, `${path}[${i}]`));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (isAuditFinanceKey(k)) {
          out[k] = null;
          if (child !== null && child !== undefined) paths.push(`${path}.${k}`);
        } else {
          out[k] = walk(child, `${path}.${k}`);
        }
      }
      return out;
    }
    return v;
  };
  return { value: walk(value, rootPath), paths };
}

/** 审计日志页：详情被裁剪时写的那句 */
export const AUDIT_COST_HIDDEN_HINT_ZH = financeHiddenHintZh("这条记录里的成本和毛利");
