/** 运营首页任务归类纯函数（便于单测，无 DB） */

const CLOSED = new Set(["done", "cancelled"]);
const STALE_DAYS = 7;

export function isOpenTaskStatus(status: string): boolean {
  return !CLOSED.has(status);
}

export function isOverdueDueDate(
  dueDate: Date | null | undefined,
  todayStart: Date,
): boolean {
  if (!dueDate) return false;
  return dueDate.getTime() < todayStart.getTime();
}

export function isDueTodayDueDate(
  dueDate: Date | null | undefined,
  todayStart: Date,
  todayEnd: Date,
): boolean {
  if (!dueDate) return false;
  const t = dueDate.getTime();
  return t >= todayStart.getTime() && t <= todayEnd.getTime();
}

export function isStaleOpenTask(
  updatedAt: Date,
  now: Date,
  days = STALE_DAYS,
): boolean {
  const ageMs = now.getTime() - updatedAt.getTime();
  return ageMs >= days * 86_400_000;
}

export function taskStatusLabel(status: string): string {
  switch (status) {
    case "todo":
      return "待办";
    case "in_progress":
      return "进行中";
    case "done":
      return "已完成";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

export function truncatePreview(
  text: string | null | undefined,
  max = 120,
): string | null {
  if (!text) return null;
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}…`;
}

export { STALE_DAYS, CLOSED as CLOSED_TASK_STATUSES };
