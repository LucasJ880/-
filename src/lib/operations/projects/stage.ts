/**
 * 执行项目交付阶段
 */

export const DELIVERY_STAGES = [
  "handoff",
  "contract_review",
  "site_measurement",
  "shop_drawing",
  "client_approval",
  "procurement",
  "production",
  "shipping",
  "installation",
  "deficiency",
  "completed",
  "on_hold",
  "cancelled",
] as const;

export type DeliveryStage = (typeof DELIVERY_STAGES)[number];

export const DELIVERY_STAGE = {
  HANDOFF: "handoff",
  CONTRACT_REVIEW: "contract_review",
  SITE_MEASUREMENT: "site_measurement",
  SHOP_DRAWING: "shop_drawing",
  CLIENT_APPROVAL: "client_approval",
  PROCUREMENT: "procurement",
  PRODUCTION: "production",
  SHIPPING: "shipping",
  INSTALLATION: "installation",
  DEFICIENCY: "deficiency",
  COMPLETED: "completed",
  ON_HOLD: "on_hold",
  CANCELLED: "cancelled",
} as const satisfies Record<string, DeliveryStage>;

/** 主流程顺序（不含特殊态） */
export const DELIVERY_MAIN_FLOW: readonly DeliveryStage[] = [
  "handoff",
  "contract_review",
  "site_measurement",
  "shop_drawing",
  "client_approval",
  "procurement",
  "production",
  "shipping",
  "installation",
  "deficiency",
  "completed",
];

const STAGE_SET = new Set<string>(DELIVERY_STAGES);

export const DELIVERY_STAGE_LABELS: Record<DeliveryStage, string> = {
  handoff: "交接",
  contract_review: "合同复核",
  site_measurement: "现场测量",
  shop_drawing: "Shop Drawing",
  client_approval: "客户审批",
  procurement: "采购",
  production: "生产",
  shipping: "运输",
  installation: "安装",
  deficiency: "Deficiency",
  completed: "已完成",
  on_hold: "暂停",
  cancelled: "已取消",
};

export function normalizeDeliveryStage(
  raw: string | null | undefined,
): DeliveryStage | null {
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  if (!v) return null;
  if (STAGE_SET.has(v)) return v as DeliveryStage;
  return null;
}

export function assertDeliveryStage(
  raw: string | null | undefined,
): DeliveryStage {
  const v = normalizeDeliveryStage(raw);
  if (!v) throw new Error(`非法 deliveryStage: ${String(raw)}`);
  return v;
}

export function isDeliveryStageComplete(
  raw: string | null | undefined,
): boolean {
  return normalizeDeliveryStage(raw) === "completed";
}

/** 活跃 = 非 completed / cancelled（on_hold 仍算活跃但非完成） */
export function isDeliveryStageActive(raw: string | null | undefined): boolean {
  const s = normalizeDeliveryStage(raw);
  if (!s) return false;
  return s !== "completed" && s !== "cancelled";
}

export function isDeliveryStageCancelled(
  raw: string | null | undefined,
): boolean {
  return normalizeDeliveryStage(raw) === "cancelled";
}

export function isDeliveryStageOnHold(raw: string | null | undefined): boolean {
  return normalizeDeliveryStage(raw) === "on_hold";
}

/**
 * Phase 4：允许管理跳过不适用阶段，但拒绝非法值与非 delivery 写入由上层保证。
 * completed → 其他阶段需高级权限（上层检查）。
 */
export function canTransitionDeliveryStage(input: {
  from: string | null | undefined;
  to: string | null | undefined;
  allowReopenCompleted?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  const next = normalizeDeliveryStage(input.to);
  if (!next) return { ok: false, reason: "非法目标阶段" };

  const from = normalizeDeliveryStage(input.from);
  if (from === next) return { ok: false, reason: "阶段未变化" };

  if (from === "completed" && next !== "completed") {
    if (!input.allowReopenCompleted) {
      return { ok: false, reason: "从已完成恢复需要更高权限" };
    }
  }

  return { ok: true };
}

export function deliveryStageLabel(raw: string | null | undefined): string {
  const s = normalizeDeliveryStage(raw);
  return s ? DELIVERY_STAGE_LABELS[s] : "未设置";
}
