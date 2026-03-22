/**
 * 青砚统一时间工具层
 *
 * 所有时间判断、格式化、范围计算均使用 America/Toronto 时区。
 * 数据库继续存储 UTC；展示与业务逻辑在此统一转换。
 */

export { TIMEZONE, LOCALE } from "./constants";

export {
  toToronto,
  nowToronto,
  torontoDateStr,
  torontoTimeParts,
  startOfDayToronto,
  endOfDayToronto,
  startOfWeekToronto,
  endOfWeekToronto,
  isTodayToronto,
  isYesterdayToronto,
  isTomorrowToronto,
  isOverdueToronto,
  daysRemainingToronto,
} from "./core";

export {
  formatDateTimeToronto,
  formatDateToronto,
  formatDateLongToronto,
  formatTimeToronto,
  formatDateDisplayToronto,
  formatHHmmToronto,
  formatRelativeToronto,
  formatDateLabelToronto,
  formatISODateToronto,
  formatTimeRangeToronto,
  formatSmartDateTimeToronto,
} from "./format";

export {
  getTodayRangeToronto,
  getWeekRangeToronto,
  getLastNDaysRangeToronto,
  getLast7DaysRangeToronto,
  getLast30DaysRangeToronto,
  getTomorrowRangeToronto,
  buildDashboardRangeToronto,
} from "./range";
export type { DateRange, WeekRange } from "./range";

export { isInQuietHoursToronto } from "./quiet-hours";
