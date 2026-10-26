/**
 * 组织驾驶舱 — 自动化调度表与健康度（A-2，openspec change org-cockpit-read-model）
 *
 * registry 的 cadence 是给人看的中文文本，这里按线上真实调度维护一张类型化的表：
 *   - cron：vercel.json 每次触发都会记录一次 AutomationRun（UTC）
 *   - local_hours：cron 每小时唤醒，但只在本地某些小时才记录运行（组织时区或固定时区）
 *   - on_demand：没有 cron
 * __tests__/schedule.test.ts 逐项对照 vercel.json 与路由源码，漂移即失败。
 *
 * 全部纯函数：时间、环境变量、组织时区都由调用方传入。
 */

import { AUTOMATION_REGISTRY, type AutomationKey } from "@/lib/automation/registry";
import { getLocalTimeParts } from "@/lib/automation/local-time";

// ── 调度表 ────────────────────────────────────────────────────

export type AutomationSchedule =
  | { kind: "cron"; route: string; cron: string; enabledEnv?: { name: string; equals: string } }
  | {
      kind: "local_hours";
      route: string;
      /** 唤醒 cron（UTC） */
      cron: string;
      /** 本地小时（0..23）落在其中时才记录运行 */
      hours: readonly number[];
      /** "org" = 组织时区（settingsJson.timezone，缺省 America/Toronto）；否则为固定 IANA 时区 */
      timezone: "org" | string;
      /** 本地星期（0 = 周日 … 6 = 周六） */
      weekday?: number;
    }
  | { kind: "on_demand" };

const MARKETING_TZ = "America/Toronto";

export const AUTOMATION_SCHEDULES: Record<AutomationKey, AutomationSchedule> = {
  "project-inspection": { kind: "cron", route: "/api/cron/inspect", cron: "0 8 * * *" },
  "daily-brief": { kind: "local_hours", route: "/api/cron/daily-brief", cron: "0 * * * *", hours: [7], timezone: "org" },
  "approval-timeout": { kind: "cron", route: "/api/cron/approval-timeout", cron: "0 */2 * * *" },
  "trade-followup": { kind: "local_hours", route: "/api/cron/followup", cron: "0 * * * *", hours: [9, 14], timezone: "org" },
  "sales-action-sync": { kind: "cron", route: "/api/cron/sales-actions", cron: "*/15 * * * *" },
  "revenue-spine-sync": { kind: "cron", route: "/api/cron/revenue-spine", cron: "*/15 * * * *" },
  "wechat-push": { kind: "local_hours", route: "/api/cron/wechat-push", cron: "30 * * * *", hours: [7], timezone: "org" },
  "progress-summary": { kind: "cron", route: "/api/cron/progress-summary", cron: "0 10 * * *" },
  "service-inbox-sla": { kind: "cron", route: "/api/cron/service-inbox-sla", cron: "*/10 * * * *" },
  "inquiry-sla": { kind: "cron", route: "/api/cron/inquiry-sla", cron: "*/5 * * * *" },
  "market-intelligence": { kind: "cron", route: "/api/cron/market-intelligence", cron: "*/15 * * * *" },
  "marketing-channel-sync": {
    kind: "local_hours",
    route: "/api/cron/marketing-automation",
    cron: "5 * * * *",
    hours: [1, 7, 13, 19],
    timezone: MARKETING_TZ,
  },
  "marketing-crm-attribution": {
    kind: "local_hours",
    route: "/api/cron/marketing-automation",
    cron: "5 * * * *",
    hours: [7],
    timezone: MARKETING_TZ,
  },
  "marketing-health": {
    kind: "local_hours",
    route: "/api/cron/marketing-automation",
    cron: "5 * * * *",
    hours: [7],
    timezone: MARKETING_TZ,
  },
  "marketing-daily-brief": {
    kind: "local_hours",
    route: "/api/cron/marketing-automation",
    cron: "5 * * * *",
    hours: [8],
    timezone: MARKETING_TZ,
  },
  "marketing-experiment-review": {
    kind: "local_hours",
    route: "/api/cron/marketing-automation",
    cron: "5 * * * *",
    hours: [9],
    timezone: MARKETING_TZ,
    weekday: 1,
  },
  "marketing-mmm": { kind: "on_demand" },
  "aivora-sync": { kind: "cron", route: "/api/cron/aivora-sync", cron: "*/15 * * * *" },
  "postiz-sync": { kind: "cron", route: "/api/cron/postiz-sync", cron: "*/10 * * * *" },
  "trade-daily": { kind: "local_hours", route: "/api/trade/cron", cron: "0 * * * *", hours: [8], timezone: "org" },
  "proactive-scan": { kind: "cron", route: "/api/cron/proactive-scan", cron: "15 * * * *" },
  "agent-runs": { kind: "cron", route: "/api/cron/agent-runs", cron: "*/2 * * * *" },
  "release-drift": { kind: "cron", route: "/api/cron/release-drift", cron: "0 9 * * *" },
  "autopilot-telemetry": { kind: "cron", route: "/api/cron/autopilot-telemetry", cron: "*/2 * * * *" },
  "tender-auto-analysis": { kind: "cron", route: "/api/cron/tender-auto-analysis", cron: "*/2 * * * *" },
  "employee-ai-practice-miner": {
    kind: "cron",
    route: "/api/cron/employee-ai-practice-miner",
    cron: "0 6 * * 1",
    // 开关未开时路由直接返回，不写运行记录
    enabledEnv: { name: "EMPLOYEE_AI_LEARNING_ENABLED", equals: "1" },
  },
  "tender-watch": { kind: "cron", route: "/api/cron/tender-watch", cron: "25 * * * *" },
  "tender-rfq-inbound": { kind: "cron", route: "/api/cron/tender-rfq-inbound", cron: "*/10 * * * *" },
};

// ── cron 子集解析 ─────────────────────────────────────────────

export interface ParsedCron {
  minutes: readonly number[];
  hours: readonly number[];
  /** null = 任意星期 */
  weekday: number | null;
}

function parseField(field: string, max: number): number[] | null {
  if (field === "*") return Array.from({ length: max + 1 }, (_, i) => i);
  const step = field.match(/^\*\/(\d+)$/);
  if (step) {
    const n = Number(step[1]);
    if (!Number.isInteger(n) || n <= 0 || n > max) return null;
    return Array.from({ length: Math.floor(max / n) + 1 }, (_, i) => i * n).filter((v) => v <= max);
  }
  if (/^\d+(,\d+)*$/.test(field)) {
    const values = field.split(",").map(Number);
    if (values.some((v) => v < 0 || v > max)) return null;
    return [...new Set(values)].sort((a, b) => a - b);
  }
  return null;
}

/** 支持：分 / 时为 `*`、`*\/N`、数字或逗号列表；日、月必须为 `*`；星期为 `*` 或单个数字。其余写法返回 null。 */
export function parseCron(expr: string): ParsedCron | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*") return null;
  const minutes = parseField(m, 59);
  const hours = parseField(h, 23);
  if (!minutes || !hours) return null;
  let weekday: number | null = null;
  if (dow !== "*") {
    if (!/^[0-6]$/.test(dow)) return null;
    weekday = Number(dow);
  }
  return { minutes, hours, weekday };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** 推算下次触发与最长间隔时的枚举窗口 */
const SEARCH_DAYS = 15;

/** after 之后（不含）第一个满足 cron 的 UTC 时刻；窗口内找不到返回 null */
export function nextCronTick(cron: ParsedCron, after: Date, horizonDays = SEARCH_DAYS): Date | null {
  const afterMs = after.getTime();
  const base = Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate());
  for (let day = 0; day <= horizonDays; day++) {
    const dayStart = base + day * DAY_MS;
    if (cron.weekday !== null && new Date(dayStart).getUTCDay() !== cron.weekday) continue;
    for (const hour of cron.hours) {
      const hourStart = dayStart + hour * HOUR_MS;
      if (hourStart + HOUR_MS <= afterMs) continue;
      for (const minute of cron.minutes) {
        const t = hourStart + minute * MINUTE_MS;
        if (t > afterMs) return new Date(t);
      }
    }
  }
  return null;
}

/** 本地星期（0 = 周日） */
function localWeekday(at: Date, timeZone: string): number {
  const { date } = getLocalTimeParts(at, timeZone);
  const [y, mo, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

function resolveTimezone(schedule: Extract<AutomationSchedule, { kind: "local_hours" }>, orgTimezone: string): string {
  return schedule.timezone === "org" ? orgTimezone : schedule.timezone;
}

/** 下次应跑时刻：cron 型取下一个 UTC 触发；门控型取下一个落在本地门控小时（及星期）的唤醒；按需为 null */
export function nextDueAt(schedule: AutomationSchedule, now: Date, orgTimezone: string): Date | null {
  if (schedule.kind === "on_demand") return null;
  const cron = parseCron(schedule.cron);
  if (!cron) return null;
  if (schedule.kind === "cron") return nextCronTick(cron, now);

  const tz = resolveTimezone(schedule, orgTimezone);
  let cursor = now;
  for (let i = 0; i < SEARCH_DAYS * 24 * cron.minutes.length; i++) {
    const tick = nextCronTick(cron, cursor);
    if (!tick) return null;
    const local = getLocalTimeParts(tick, tz);
    if (schedule.hours.includes(local.hour) && (schedule.weekday === undefined || localWeekday(tick, tz) === schedule.weekday)) {
      return tick;
    }
    cursor = tick;
  }
  return null;
}

const maxGapCache = new Map<string, number>();

/** cron 相邻两次触发的最大间隔（分钟），在固定参考周内枚举，按表达式缓存 */
function cronMaxGapMinutes(expr: string): number | null {
  const cached = maxGapCache.get(expr);
  if (cached !== undefined) return cached;
  const cron = parseCron(expr);
  if (!cron) return null;
  // 2026-01-05 是周一；枚举 15 天足以覆盖每周任务的两次触发
  let prev = nextCronTick(cron, new Date(Date.UTC(2026, 0, 4, 23, 59)));
  const end = Date.UTC(2026, 0, 20);
  let maxGap = 0;
  while (prev && prev.getTime() < end) {
    const next = nextCronTick(cron, prev);
    if (!next) break;
    maxGap = Math.max(maxGap, (next.getTime() - prev.getTime()) / MINUTE_MS);
    prev = next;
  }
  if (maxGap === 0) return null;
  maxGapCache.set(expr, maxGap);
  return maxGap;
}

/** 正常情况下相邻两次运行记录之间的最长间隔（分钟）；按需为 null */
export function maxGapMinutes(schedule: AutomationSchedule): number | null {
  if (schedule.kind === "on_demand") return null;
  if (schedule.kind === "cron") return cronMaxGapMinutes(schedule.cron);
  if (schedule.weekday !== undefined) return 7 * 24 * 60;
  const hours = [...schedule.hours].sort((a, b) => a - b);
  if (hours.length === 0) return null;
  let gap = 24 - hours[hours.length - 1] + hours[0];
  for (let i = 1; i < hours.length; i++) gap = Math.max(gap, hours[i] - hours[i - 1]);
  return gap * 60;
}

// ── 健康度 ────────────────────────────────────────────────────

export type AutomationHealth = "on_time" | "late" | "failed" | "never_ran" | "not_configured" | "n/a";
export type PostHealth = AutomationHealth | "quota_hit";

/** 严重度从高到低 */
export const POST_HEALTH_ORDER: readonly PostHealth[] = [
  "failed",
  "quota_hit",
  "late",
  "never_ran",
  "not_configured",
  "on_time",
  "n/a",
];

/** 与 automation/runner.ts 的 STALE_RUN_MS 一致：超过 30 分钟仍在运行即视为卡住 */
export const STALLED_RUN_MINUTES = 30;
export const LATE_FACTOR = 1.5;

export interface LastRunSnapshot {
  status: string;
  startedAt: Date;
  completedAt: Date | null;
}

/** 必需环境变量齐全且开关已开 */
export function isAutomationConfigured(key: AutomationKey, env: Readonly<Record<string, string | undefined>>): boolean {
  const definition = AUTOMATION_REGISTRY.find((d) => d.key === key);
  const required = definition && "requiredEnv" in definition ? definition.requiredEnv : [];
  if (required.some((name) => !env[name]?.trim())) return false;
  const schedule = AUTOMATION_SCHEDULES[key];
  if (schedule.kind === "cron" && schedule.enabledEnv) {
    return env[schedule.enabledEnv.name] === schedule.enabledEnv.equals;
  }
  return true;
}

export function automationHealth(input: {
  schedule: AutomationSchedule;
  configured: boolean;
  lastRun: LastRunSnapshot | null;
  now: Date;
}): AutomationHealth {
  if (input.schedule.kind === "on_demand") return "n/a";
  if (!input.configured) return "not_configured";
  if (!input.lastRun) return "never_ran";
  const sinceStartMinutes = (input.now.getTime() - input.lastRun.startedAt.getTime()) / MINUTE_MS;
  if (input.lastRun.status === "failed") return "failed";
  if (input.lastRun.status === "running" && sinceStartMinutes > STALLED_RUN_MINUTES) return "failed";
  const gap = maxGapMinutes(input.schedule);
  if (gap !== null && sinceStartMinutes > gap * LATE_FACTOR) return "late";
  return "on_time";
}

/** 岗位健康度：取最严重者；quotaHit 只在岗位有 AgentRun 工作时由调用方传 true */
export function postHealth(healths: readonly AutomationHealth[], quotaHit: boolean): PostHealth {
  const candidates: PostHealth[] = [...healths];
  if (quotaHit) candidates.push("quota_hit");
  if (candidates.length === 0) return "n/a";
  return POST_HEALTH_ORDER.find((h) => candidates.includes(h)) ?? "n/a";
}
