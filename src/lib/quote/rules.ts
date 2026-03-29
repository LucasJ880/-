/**
 * 报价检查规则引擎 — 硬编码规则，不靠 AI，毫秒级
 */

import type {
  QuoteHeaderData,
  QuoteLineItemData,
  TemplateType,
  LineCategory,
} from "./types";
import { calculateTotals } from "./calculate";
import { TEMPLATE_CONFIGS } from "./templates";

export type CheckSeverity = "passed" | "info" | "warning" | "urgent";

export interface CheckItem {
  id: string;
  severity: CheckSeverity;
  field: string;
  message: string;
  suggestion?: string;
  actionType?:
    | "insert_line"
    | "set_field"
    | "adjust_price";
  actionPayload?: Record<string, unknown>;
}

export function runQuoteChecks(
  header: QuoteHeaderData,
  lines: QuoteLineItemData[]
): CheckItem[] {
  const items: CheckItem[] = [];
  const template = TEMPLATE_CONFIGS[header.templateType];
  const totals = calculateTotals(lines);
  const categories = new Set(lines.map((l) => l.category));

  // ── 1. 检查必需类别 ──
  for (const cat of template.suggestedCategories) {
    if (!categories.has(cat)) {
      const label = getCategoryLabel(cat);
      items.push({
        id: `missing_category_${cat}`,
        severity: "warning",
        field: "lineItems",
        message: `缺少${label}行项`,
        suggestion: `${template.label}通常需包含${label}`,
        actionType: "insert_line",
        actionPayload: { category: cat, itemName: label },
      });
    }
  }

  // ── 2. 利润率检查 ──
  if (totals.profitMargin != null) {
    if (totals.profitMargin < 5) {
      items.push({
        id: "low_margin",
        severity: "urgent",
        field: "profitMargin",
        message: `利润率 ${totals.profitMargin}%，低于 5% 安全线`,
        suggestion: "建议调整到 15%-25% 区间",
        actionType: "adjust_price",
      });
    } else if (totals.profitMargin < 10) {
      items.push({
        id: "margin_warning",
        severity: "warning",
        field: "profitMargin",
        message: `利润率 ${totals.profitMargin}%，偏低`,
        suggestion: "建议提升到 15% 以上",
      });
    } else if (totals.profitMargin > 60) {
      items.push({
        id: "high_margin",
        severity: "info",
        field: "profitMargin",
        message: `利润率 ${totals.profitMargin}%，较高`,
        suggestion: "请确认定价合理性",
      });
    }
  }

  // ── 3. 商务条款完整性 ──
  if (!header.paymentTerms) {
    items.push({
      id: "missing_payment",
      severity: "warning",
      field: "paymentTerms",
      message: "未设置付款条款",
      suggestion: "建议设为 T/T 30% 预付 70% 发货前",
      actionType: "set_field",
      actionPayload: { field: "paymentTerms", value: "T/T 30/70" },
    });
  }

  if (header.deliveryDays == null) {
    items.push({
      id: "missing_delivery",
      severity: "warning",
      field: "deliveryDays",
      message: "未设置交期",
      suggestion: "建议填写预计交货天数",
    });
  }

  if (!header.validUntil) {
    items.push({
      id: "missing_validity",
      severity: "warning",
      field: "validUntil",
      message: "报价有效期未设置",
      suggestion: "建议设为 30 天",
      actionType: "set_field",
      actionPayload: { field: "validUntil", value: getDate30DaysLater() },
    });
  }

  // ── 4. 外贸特有检查 ──
  if (header.templateType === "export_standard") {
    if (!header.tradeTerms) {
      items.push({
        id: "missing_trade_terms",
        severity: "warning",
        field: "tradeTerms",
        message: "未设置贸易方式",
        suggestion: "外贸报价需注明 FOB/CIF/EXW 等",
      });
    }
    if (!header.originCountry) {
      items.push({
        id: "missing_origin",
        severity: "info",
        field: "originCountry",
        message: "未设置原产地",
        suggestion: "海外客户通常要求注明原产地",
      });
    }
  }

  // ── 5. 政府采购格式检查 ──
  if (header.templateType === "gov_procurement") {
    for (const line of lines) {
      if (line.category === "product") {
        if (line.quantity == null || line.unitPrice == null) {
          items.push({
            id: `gov_format_${line.sortOrder}`,
            severity: "warning",
            field: "lineItems",
            message: `第 ${line.sortOrder + 1} 行「${line.itemName}」缺少数量或单价`,
            suggestion: "政府采购要求每行必须有数量×单价=合计",
          });
          break;
        }
      }
    }
  }

  // ── 6. 分项合计校验 ──
  const lineSum = lines.reduce((sum, l) => sum + (l.totalPrice ?? 0), 0);
  if (lineSum > 0 && totals.totalAmount > 0) {
    const diff = Math.abs(lineSum - totals.totalAmount);
    const pct = (diff / totals.totalAmount) * 100;
    if (pct > 1) {
      items.push({
        id: "total_mismatch",
        severity: "urgent",
        field: "totalAmount",
        message: `分项合计与总价差异 ${pct.toFixed(1)}%`,
        suggestion: "请检查行项目金额是否正确",
      });
    }
  }

  // ── 7. 空行项目检查 ──
  if (lines.length === 0) {
    items.push({
      id: "no_lines",
      severity: "warning",
      field: "lineItems",
      message: "报价单无行项目",
      suggestion: "添加产品或服务行项目",
    });
  }

  // ── 通过项 ──
  const passedIds = new Set(items.map((i) => i.id));

  if (header.paymentTerms && !passedIds.has("missing_payment")) {
    items.push({ id: "ok_payment", severity: "passed", field: "paymentTerms", message: `付款条款 — ${header.paymentTerms}` });
  }
  if (header.deliveryDays != null && !passedIds.has("missing_delivery")) {
    items.push({ id: "ok_delivery", severity: "passed", field: "deliveryDays", message: `交期 — ${header.deliveryDays} 天` });
  }
  if (header.validUntil && !passedIds.has("missing_validity")) {
    items.push({ id: "ok_validity", severity: "passed", field: "validUntil", message: `报价有效期已设置` });
  }
  if (header.tradeTerms) {
    items.push({ id: "ok_trade", severity: "passed", field: "tradeTerms", message: `贸易方式 — ${header.tradeTerms}` });
  }
  if (header.currency) {
    items.push({ id: "ok_currency", severity: "passed", field: "currency", message: `币种 — ${header.currency}` });
  }

  return items;
}

export function countByType(items: CheckItem[]): { passed: number; issues: number; urgent: number } {
  let passed = 0;
  let issues = 0;
  let urgent = 0;
  for (const i of items) {
    if (i.severity === "passed") passed++;
    else if (i.severity === "urgent") { issues++; urgent++; }
    else if (i.severity === "warning" || i.severity === "info") issues++;
  }
  return { passed, issues, urgent };
}

function getCategoryLabel(cat: LineCategory): string {
  const map: Record<string, string> = {
    product: "产品", shipping: "运费", customs: "关税",
    packaging: "包装", labor: "人工", overhead: "管理费",
    tax: "税费", other: "其他",
  };
  return map[cat] ?? cat;
}

function getDate30DaysLater(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}
