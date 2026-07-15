export interface LocalTimeParts {
  date: string;
  hour: number;
  minute: number;
}

export function getLocalTimeParts(
  now: Date,
  timeZone: string,
): LocalTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
    minute: Number(value("minute")),
  };
}

export function isLocalScheduleHour(
  now: Date,
  timeZone: string,
  hours: readonly number[],
): boolean {
  return hours.includes(getLocalTimeParts(now, timeZone).hour);
}
