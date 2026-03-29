/**
 * 报价模板定义 — 每种模板的默认列配置和必需字段
 */

import type { TemplateType, LineCategory } from "./types";

export interface TemplateColumnDef {
  key: string;
  label: string;
  width?: string;
  editable?: boolean;
}

export interface TemplateConfig {
  type: TemplateType;
  label: string;
  columns: TemplateColumnDef[];
  requiredCategories: LineCategory[];
  defaultHeaderFields: string[];
  suggestedCategories: LineCategory[];
}

const BASE_COLUMNS: TemplateColumnDef[] = [
  { key: "sortOrder", label: "#", width: "w-10" },
  { key: "category", label: "类型", width: "w-20" },
  { key: "itemName", label: "品名", editable: true },
  { key: "specification", label: "规格", editable: true },
  { key: "unit", label: "单位", width: "w-16", editable: true },
  { key: "quantity", label: "数量", width: "w-20", editable: true },
  { key: "unitPrice", label: "单价", width: "w-24", editable: true },
  { key: "totalPrice", label: "总价", width: "w-24", editable: true },
  { key: "remarks", label: "备注", editable: true },
];

export const TEMPLATE_CONFIGS: Record<TemplateType, TemplateConfig> = {
  export_standard: {
    type: "export_standard",
    label: "外贸标准报价",
    columns: BASE_COLUMNS,
    requiredCategories: ["product"],
    defaultHeaderFields: [
      "currency",
      "tradeTerms",
      "paymentTerms",
      "deliveryDays",
      "validUntil",
      "moq",
      "originCountry",
    ],
    suggestedCategories: ["product", "packaging", "shipping"],
  },
  gov_procurement: {
    type: "gov_procurement",
    label: "政府采购投标",
    columns: [
      { key: "sortOrder", label: "编号", width: "w-14" },
      { key: "itemName", label: "项目/内容", editable: true },
      { key: "specification", label: "技术规格", editable: true },
      { key: "unit", label: "单位", width: "w-16", editable: true },
      { key: "quantity", label: "数量", width: "w-20", editable: true },
      { key: "unitPrice", label: "单价", width: "w-24", editable: true },
      { key: "totalPrice", label: "合计", width: "w-24", editable: true },
      { key: "remarks", label: "备注", editable: true },
    ],
    requiredCategories: ["product"],
    defaultHeaderFields: ["currency", "paymentTerms", "deliveryDays", "validUntil"],
    suggestedCategories: ["product", "tax"],
  },
  project_install: {
    type: "project_install",
    label: "项目制安装报价",
    columns: [
      ...BASE_COLUMNS.slice(0, 2),
      { key: "itemName", label: "项目", editable: true },
      { key: "specification", label: "规格/说明", editable: true },
      { key: "unit", label: "单位", width: "w-16", editable: true },
      { key: "quantity", label: "数量", width: "w-20", editable: true },
      { key: "unitPrice", label: "单价", width: "w-24", editable: true },
      { key: "totalPrice", label: "金额", width: "w-24", editable: true },
      { key: "remarks", label: "备注", editable: true },
    ],
    requiredCategories: ["product", "labor"],
    defaultHeaderFields: [
      "currency",
      "paymentTerms",
      "deliveryDays",
      "validUntil",
    ],
    suggestedCategories: ["product", "labor", "shipping", "overhead"],
  },
  service_labor: {
    type: "service_labor",
    label: "服务/人工单价报价",
    columns: [
      { key: "sortOrder", label: "#", width: "w-10" },
      { key: "itemName", label: "服务项目", editable: true },
      { key: "specification", label: "说明", editable: true },
      { key: "unit", label: "单位", width: "w-16", editable: true },
      { key: "quantity", label: "工时/人数", width: "w-24", editable: true },
      { key: "unitPrice", label: "单价/时", width: "w-24", editable: true },
      { key: "totalPrice", label: "金额", width: "w-24", editable: true },
      { key: "remarks", label: "备注", editable: true },
    ],
    requiredCategories: ["labor"],
    defaultHeaderFields: ["currency", "paymentTerms", "validUntil"],
    suggestedCategories: ["labor", "overhead"],
  },
};
