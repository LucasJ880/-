/**
 * P2-1 收尾：采购监控「扫描时间」的页面规则（纯函数）。
 *
 * 浏览器端（采购监控设置页）引用本文件：这里不得引用任何模块。
 */

export type ScheduleForm = { weekdays: number[]; time: string };
export type ScheduleValue = { weekdays: number[]; hour: number; minute: number };

export const SCHEDULE_PRESETS: ReadonlyArray<{ key: "daily" | "weekdays" | "default"; label: string; weekdays: number[] }> = [
  { key: "daily", label: "每天", weekdays: [0, 1, 2, 3, 4, 5, 6] },
  { key: "weekdays", label: "工作日", weekdays: [1, 2, 3, 4, 5] },
  { key: "default", label: "默认（周一、周四）", weekdays: [1, 4] },
];

export const SCHEDULE_DAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;
export const SCHEDULE_NEED_DAY_ZH = "扫描时间：至少选一天";
export const SCHEDULE_BAD_TIME_ZH = "扫描时间：时刻格式 HH:MM（00:00–23:59）";
export const SCHEDULE_HINT_ZH = "多伦多时间。由每小时 :25 的既有定时任务在这个时刻之后第一次执行；改成「每天」后，前一天发布的新标第二天这个时候就能看到（默认要等到周一或周四）。";

const norm = (days: number[]) => [...new Set(days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b);
const pad = (n: number) => String(n).padStart(2, "0");

export function scheduleFormOf(s: ScheduleValue): ScheduleForm {
  return { weekdays: norm(s.weekdays), time: `${pad(s.hour)}:${pad(s.minute)}` };
}

/** "HH:MM" → 时、分；不合法 → null */
export function parseTime(t: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const hour = Number(m[1]), minute = Number(m[2]);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

/** 点快捷按钮：只换星期几，时刻不动 */
export function applyPreset(f: ScheduleForm, key: (typeof SCHEDULE_PRESETS)[number]["key"]): ScheduleForm {
  const p = SCHEDULE_PRESETS.find((x) => x.key === key);
  return p ? { ...f, weekdays: [...p.weekdays] } : f;
}

export function toggleDay(f: ScheduleForm, day: number): ScheduleForm {
  return { ...f, weekdays: f.weekdays.includes(day) ? f.weekdays.filter((d) => d !== day) : norm([...f.weekdays, day]) };
}

/** 当前星期几对应哪个快捷按钮（用于高亮）；都不是 → null */
export function presetOf(weekdays: number[]): (typeof SCHEDULE_PRESETS)[number]["key"] | null {
  const k = norm(weekdays).join(",");
  return SCHEDULE_PRESETS.find((p) => p.weekdays.join(",") === k)?.key ?? null;
}

/**
 * 保存时排期放不放进请求（design D3）：与打开时相同 → 不放；改过 → 校验后放；不合规 → 错误、不发请求。
 */
export function scheduleBodyIfChanged(form: ScheduleForm, initial: ScheduleForm): { ok: true; schedule?: ScheduleValue } | { ok: false; error: string } {
  const days = norm(form.weekdays);
  const same = days.join(",") === norm(initial.weekdays).join(",") && form.time.trim() === initial.time.trim();
  if (same) return { ok: true };
  if (days.length === 0) return { ok: false, error: SCHEDULE_NEED_DAY_ZH };
  const t = parseTime(form.time);
  if (!t) return { ok: false, error: SCHEDULE_BAD_TIME_ZH };
  return { ok: true, schedule: { weekdays: days, hour: t.hour, minute: t.minute } };
}

/* ---------------------------------- 新标视图 ---------------------------------- */

export const NEW_VIEW_VALUE = "NEW";
export const NEW_VIEW_LABEL_ZH = "新标（未截标的招标公告）";
export const NEW_VIEW_HINT_ZH = "未截标的招标公告，按发布日期从新到旧（不是中标概率）。";
export const ALL_VIEW_HINT_ZH = "按优先级排序（不是中标概率）。";
export const NOTICE_LINK_ZH = "看公告";

/** 候选筛选下拉 → 接口查询串（新标走 view=new，其它走 triage） */
/** P2-2：新标视图的排序（默认按发布日期；fit = 按匹配度） */
export const FIT_SORT_VALUE = "fit";
export const DATE_SORT_VALUE = "date";
export const SORT_OPTIONS_ZH: Array<{ value: string; label: string }> = [
  { value: DATE_SORT_VALUE, label: "按发布日期" },
  { value: FIT_SORT_VALUE, label: "按匹配度" },
];
export const FIT_LABEL_ZH = "匹配度";
export const FIT_NOTE_ZH = "匹配度（不是中标概率）：按你能看到的项目计算";

export function candidatesQuery(filter: string, sort: string = DATE_SORT_VALUE): string {
  if (filter === NEW_VIEW_VALUE) return sort === FIT_SORT_VALUE ? "&view=new&sort=fit" : "&view=new";
  return filter !== "ALL" ? `&triage=${encodeURIComponent(filter)}` : "";
}

/** P2-3b：通知链接 ?view=new 打开时直接落在「新标」视图；其他取值保持默认「全部」 */
export function initialTriageFromSearch(search: string): string | null {
  const v = new URLSearchParams(search).get("view");
  return v === "new" ? NEW_VIEW_VALUE : null;
}
