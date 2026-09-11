/**
 * S3-A：采购视角的**纯展示映射**（无 DB、无 server-only 依赖，客户端组件可直接 import）。
 *
 * 为什么单独成文件：`procurement-view.ts` 依赖 `./access` → `tenancy/context` → `node:crypto`，
 * 是 server-only 模块；客户端面板若从那里取分组与文案，会把整条服务端链路拖进浏览器包，
 * 构建直接失败（本轮 `next build` 实测捕获）。展示口径本身是纯函数，抽到这里让两侧共用同一份。
 */

import type { MandatorySnapshotValue } from "./requirement-snapshot";

/* ───────────────── 纯函数：采购视角分组与文案（可 CI 单测，无 DB） ───────────────── */

export const PROCUREMENT_GROUPS = [
  { key: "product", label: "产品与规格" },
  { key: "compliance", label: "认证与合规" },
  { key: "samples", label: "样品与图纸" },
  { key: "delivery", label: "交付与安装" },
  { key: "warranty", label: "质保与售后" },
  { key: "commercial", label: "商务与提交" },
  { key: "other", label: "其他" },
] as const;

export type ProcurementGroupKey = (typeof PROCUREMENT_GROUPS)[number]["key"];

/** DB 里的 category 是小写（v2-map 落库时 toLowerCase） */
const GROUP_BY_CATEGORY: Record<string, ProcurementGroupKey> = {
  product: "product",
  technical: "product",
  performance: "product",
  safety: "compliance",
  mandatory: "compliance",
  administrative: "compliance",
  bonding: "compliance",
  insurance: "compliance",
  samples: "samples",
  shop_drawings: "samples",
  delivery: "delivery",
  installation: "delivery",
  schedule: "delivery",
  site_visit: "delivery",
  warranty: "warranty",
  training: "warranty",
  reporting: "warranty",
  pricing: "commercial",
  commercial: "commercial",
  submission: "commercial",
  other: "other",
};

/** 未知/空 category 一律落「其他」——不猜品类 */
export function procurementGroupOf(category: string | null | undefined): ProcurementGroupKey {
  const key = category?.trim().toLowerCase();
  if (!key) return "other";
  return GROUP_BY_CATEGORY[key] ?? "other";
}

export type MandatoryTone = "mandatory" | "uncertain" | "optional";

/**
 * 三值 → 采购人员看得懂的中文。
 * false **不是**「可选」：它只表示「不是硬性强制」，商业影响仍需自行判断。
 */
export function mandatoryDisplay(value: MandatorySnapshotValue): {
  label: string;
  tone: MandatoryTone;
  hint: string;
} {
  if (value === true) {
    return { label: "强制要求", tone: "mandatory", hint: "不满足通常直接失去投标资格" };
  }
  if (value === "uncertain") {
    return {
      label: "强制性待确认",
      tone: "uncertain",
      hint: "原文未能确定是否强制，按强制对待并向业主澄清；不得当作可选",
    };
  }
  return { label: "非强制要求", tone: "optional", hint: "非硬性条款，但仍可能影响评分与成本" };
}

/** 关键事实槽位 → 中文标签（只列采购关心的，其余不展示） */
export const PROCUREMENT_FACT_SLOTS = [
  { key: "scope", label: "采购范围" },
  { key: "quantity", label: "数量" },
  { key: "delivery", label: "交付要求" },
  { key: "location", label: "交付地点" },
  { key: "installation", label: "安装责任" },
  { key: "warranty", label: "质保" },
  { key: "closing_datetime", label: "投标截止" },
  { key: "question_deadline", label: "答疑截止" },
] as const;
