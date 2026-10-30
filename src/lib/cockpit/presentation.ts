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

/** 计数千分位（非有限数显示 —） */
export function formatCount(value: number): string {
  return Number.isFinite(value) ? count.format(Math.round(value)) : EMPTY;
}

function finite(value: number | string | null): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** count 千分位；rate 0..1 → 百分比（一位小数、向下取）；percentage_string 原值加 %；minutes → 分钟 / 小时；score 取整 */
export function formatKpiValue(value: number | string | null, format: PostKpiFormat): string {
  const n = finite(value);
  if (n === null) return EMPTY;
  switch (format) {
    case "count":
      return count.format(Math.round(n));
    case "rate": {
      // 最多一位小数且向下取，避免 0.9996 被四舍五入成 100%；1e-9 抵消 0.57 * 1000 这类浮点误差
      const pct = Math.floor(n * 1000 + 1e-9) / 10;
      return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
    }
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

/**
 * 页面上的"现在"：以服务端生成时间为基准，加上收到响应之后流逝的时间，
 * 避免客户端时钟偏差把过去的事显示成"x 分钟后"，也能让"更新于"随时间变旧。
 */
export function serverNow(generatedAt: string, receivedAtMs: number, nowMs: number): Date {
  const base = Date.parse(generatedAt);
  if (Number.isNaN(base)) return new Date(nowMs);
  return new Date(base + Math.max(0, nowMs - receivedAtMs));
}

export type CockpitLoadError = "org_selection" | "no_org" | "forbidden" | "account_disabled" | "session_expired" | "server";

/**
 * 403 响应体里的错误文案（来源：workforce 组织解析 `workforceOrgFailureHttp("NO_ORG")`、
 * `withAuth` 的停用账号分支 `src/lib/auth/guards.ts`）；测试里对照原函数 / 源码核对，防止两边漂移。
 */
export const NO_ORG_ERROR = "无组织";
export const ACCOUNT_DISABLED_ERROR = "账号已停用";

/** 接口失败 → 页面错误类型：401 登录过期；403 按响应体区分需选择组织 / 无组织 / 账号停用 / 无权限；其余为服务端错误 */
export function errorKindFrom(status: number, body: unknown): CockpitLoadError {
  if (status === 401) return "session_expired";
  if (status !== 403) return "server";
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (b.needsSelection === true) return "org_selection";
  if (b.error === NO_ORG_ERROR) return "no_org";
  if (b.error === ACCOUNT_DISABLED_ERROR) return "account_disabled";
  return "forbidden";
}

export function actorLabel(actor: string, actorName: string | null): string {
  if (actor === "system") return "系统";
  if (actor === "ai") return "AI";
  return actorName?.trim() || "成员";
}

/** 千分位；来源被截断时显示"N+" */
export function waitingCountLabel(total: number, truncated: boolean): string {
  return truncated ? `${formatCount(total)}+` : formatCount(total);
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
