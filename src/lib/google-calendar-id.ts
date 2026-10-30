/**
 * CalendarProvider.calendarId 存的是逗号分隔的已选日历 ID 列表
 * （primary,xxx@group.calendar.google.com,...），读路径会逐个拉取；
 * 写路径（新建 / 修改 / 删除 / 取单个事件）只能落在一个日历上：取列表第一项。
 * 空值、空串或只有逗号空格时回落到 "primary"。
 */
export function primaryWriteCalendarId(raw: string | null | undefined): string {
  const first = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .find(Boolean);
  return first || "primary";
}
