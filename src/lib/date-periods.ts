/**
 * 时段切片工具 —— 给定起止日期 + 粒度，返回 periods 列表。
 *
 * 所有计算按"本地时区"进行（对于北美业务默认跟系统时区走），
 * 不引入第三方日期库，保持零依赖。
 */

export type Granularity = "week" | "month" | "quarter";

export interface Period {
  /** 唯一 key，如 "2026-03"、"2026-W12"、"2026-Q1" */
  key: string;
  /** 显示标签，如 "3月"、"2026 W12"、"2026 Q1" */
  label: string;
  /** 起点（包含），本地 00:00:00 */
  start: Date;
  /** 终点（不含下一周期的 00:00:00） */
  end: Date;
}

function startOfDay(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

/** ISO 周一为一周开始；返回本周一 00:00 */
function startOfISOWeek(d: Date): Date {
  const x = startOfDay(d);
  // getDay: 0=周日, 1=周一 ... 6=周六
  const day = x.getDay();
  const diff = (day + 6) % 7; // 距离本周一的天数
  return addDays(x, -diff);
}

/** ISO 周编号（简化版，大多数场景够用） */
function isoWeekNumber(d: Date): { year: number; week: number } {
  // 算法参考 ISO 8601
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = target.getUTCDay() || 7; // 周日=7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return { year: target.getUTCFullYear(), week: weekNum };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 根据 start/end（本地时间语义）+ 粒度，生成覆盖整个区间的 periods。
 * - 两端对齐到所在周/月/季的起点
 * - end 使用"开区间"（< end），方便数据库 createdAt >= start AND createdAt < end
 */
export function buildPeriods(
  start: Date,
  end: Date,
  granularity: Granularity,
): Period[] {
  if (end < start) return [];
  const periods: Period[] = [];

  if (granularity === "month") {
    // 对齐到本月 1 号
    let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    const limit = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cursor <= limit) {
      const next = addMonths(cursor, 1);
      const year = cursor.getFullYear();
      const month = cursor.getMonth() + 1;
      const key = `${year}-${pad2(month)}`;
      const label = `${year}/${month}`;
      periods.push({ key, label, start: cursor, end: next });
      cursor = next;
    }
    return periods;
  }

  if (granularity === "quarter") {
    // 对齐到季度首月 1 号（1/4/7/10）
    const q = Math.floor(start.getMonth() / 3);
    let cursor = new Date(start.getFullYear(), q * 3, 1);
    const endQ = Math.floor(end.getMonth() / 3);
    const limit = new Date(end.getFullYear(), endQ * 3, 1);
    while (cursor <= limit) {
      const next = addMonths(cursor, 3);
      const year = cursor.getFullYear();
      const quarter = Math.floor(cursor.getMonth() / 3) + 1;
      const key = `${year}-Q${quarter}`;
      const label = `${year} Q${quarter}`;
      periods.push({ key, label, start: cursor, end: next });
      cursor = next;
    }
    return periods;
  }

  // week：对齐到本周一
  let cursor = startOfISOWeek(start);
  const limit = startOfISOWeek(end);
  while (cursor <= limit) {
    const next = addDays(cursor, 7);
    const { year, week } = isoWeekNumber(cursor);
    const key = `${year}-W${pad2(week)}`;
    const label = `${pad2(cursor.getMonth() + 1)}/${pad2(cursor.getDate())} 起`;
    periods.push({ key, label, start: cursor, end: next });
    cursor = next;
  }
  return periods;
}

/** 在 periods 里根据日期找到对应 period 的 key；找不到返回 null */
export function findPeriodKey(periods: Period[], d: Date): string | null {
  for (const p of periods) {
    if (d >= p.start && d < p.end) return p.key;
  }
  return null;
}
