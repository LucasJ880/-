/**
 * 组织驾驶舱 — 首页展示规则（A-3，openspec change org-cockpit-home）
 *
 * 健康度色调、KPI 数值格式化、口径文案、相对时间、时间线操作者等纯函数；
 * 组件只负责排版，规则在这里查表，便于无浏览器测试。
 */

import { POST_REGISTRY, type PostKey, type PostKpiFormat, type PostKpiWindow } from "./posts";
import type { AutomationHealth, PostHealth } from "./schedule";

/** 与 StatusBadge 的 tone 子集一致 */
export type CockpitTone = "neutral" | "success" | "warning" | "danger";

export const HEALTH_PRESENTATION: Record<PostHealth, { label: string; tone: CockpitTone }> = {
  failed: { label: "失败", tone: "danger" },
  quota_hit: { label: "配额已满", tone: "danger" },
  late: { label: "迟到", tone: "warning" },
  never_ran: { label: "未运行过", tone: "warning" },
  not_configured: { label: "未配置", tone: "neutral" },
  on_time: { label: "正常", tone: "success" },
  "n/a": { label: "按需", tone: "neutral" },
};

export function healthPresentation(health: string): { label: string; tone: CockpitTone } {
  return HEALTH_PRESENTATION[health as PostHealth] ?? { label: health, tone: "neutral" };
}

const EMPTY = "—";
const count = new Intl.NumberFormat("en-US");

function finite(value: number | string | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** count 千分位；rate 0..1 → 百分比；percentage_string 原值加 %；minutes → 分钟 / 小时；score 取整 */
export function formatKpiValue(value: number | string | null, format: PostKpiFormat): string {
  const n = finite(value);
  if (n === null) return EMPTY;
  switch (format) {
    case "count":
      return count.format(Math.round(n));
    case "rate":
      return `${Math.round(n * 100)}%`;
    case "percentage_string":
      return `${typeof value === "string" ? value.trim() : n}%`;
    case "minutes": {
      const minutes = Math.round(n);
      if (minutes < 60) return `${minutes} 分钟`;
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
    }
    case "score":
      return String(Math.round(n));
  }
}

export function kpiWindowLabel(window: PostKpiWindow): string {
  switch (window.kind) {
    case "rolling_days":
      return `近 ${window.days} 天`;
    case "month_to_date":
      return "本月至今";
    case "point_in_time":
      return "当前";
    case "all_time":
      return "累计";
  }
}

export const KPI_STATUS_LABELS = {
  unavailable: "未接入",
  disabled: "未开启",
  error: "暂不可用",
} as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** 过去："刚刚 / x 分钟前 / x 小时前 / x 天前"；将来："x 分钟后 / x 小时后 / x 天后" */
export function formatRelativeTime(iso: string | null | undefined, now: Date): string {
  if (!iso) return EMPTY;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return EMPTY;
  const diff = at - now.getTime();
  const abs = Math.abs(diff);
  const suffix = diff > 0 ? "后" : "前";
  if (abs < MINUTE) return diff > 0 ? "1 分钟内" : "刚刚";
  if (abs < HOUR) return `${Math.floor(abs / MINUTE)} 分钟${suffix}`;
  if (abs < DAY) return `${Math.floor(abs / HOUR)} 小时${suffix}`;
  return `${Math.floor(abs / DAY)} 天${suffix}`;
}

export function actorLabel(actor: string, actorName: string | null): string {
  if (actor === "system") return "系统";
  if (actor === "ai") return "AI";
  return actorName?.trim() || "成员";
}

/** 来源被截断时显示"N+" */
export function waitingCountLabel(total: number, truncated: boolean): string {
  return truncated ? `${total}+` : String(total);
}

export function postName(key: string | null): string {
  if (!key) return "未归属";
  return POST_REGISTRY.find((p) => p.key === key)?.name ?? key;
}

export function isPostKey(key: string): key is PostKey {
  return POST_REGISTRY.some((p) => p.key === key);
}

const ABNORMAL_ORDER: readonly AutomationHealth[] = ["failed", "late", "never_ran"];

/** 健康度不为正常的自动化名（失败 → 迟到 → 未运行过），最多 limit 个；未配置 / 按需不算异常 */
export function abnormalAutomations(
  automations: ReadonlyArray<{ name: string; health: string }>,
  limit = 3,
): Array<{ name: string; health: AutomationHealth }> {
  return ABNORMAL_ORDER.flatMap((health) =>
    automations.filter((a) => a.health === health).map((a) => ({ name: a.name, health })),
  ).slice(0, limit);
}
