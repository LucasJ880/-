/**
 * AI 主动秘书 — 类型定义
 */

export interface BriefingItem {
  id: string;
  domain: "trade" | "sales" | "project" | "general";
  severity: "urgent" | "warning" | "info";
  category: string;
  title: string;
  description: string;
  /** 可执行动作 */
  action?: BriefingAction;
  /** 关联实体，用于跳转 */
  entityType?: string;
  entityId?: string;
  /** 去重键 */
  dedupeKey: string;
}

export interface BriefingAction {
  type: string;
  label: string;
  /** AI 预生成的内容（邮件草稿等） */
  payload?: Record<string, unknown>;
}

export interface DomainScanResult {
  domain: string;
  items: BriefingItem[];
  stats: Record<string, number>;
}

export interface DailyBriefing {
  generatedAt: string;
  userId: string;
  domains: DomainScanResult[];
  summary: string;
  totalUrgent: number;
  totalWarning: number;
  totalItems: number;
}
