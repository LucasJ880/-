import type { TenderProject, TimelineEvent, TimelineEventKind } from "./types";

interface RawEvent {
  key: string;
  label: string;
  date: string | null;
  kind: TimelineEventKind;
}

/**
 * 从项目数据构建真实时间轴事件列表。
 * 返回按时间排序的事件，每个事件带有 [0,1] 范围的 position。
 */
export function buildProjectTimelineEvents(
  p: TenderProject
): TimelineEvent[] {
  const now = new Date();

  const candidates: RawEvent[] = [
    { key: "createdAt", label: "项目创建", date: p.createdAt, kind: "internal" },
    { key: "distributedAt", label: "项目分发", date: p.distributedAt, kind: "internal" },
    { key: "interpretedAt", label: "项目解读", date: p.interpretedAt, kind: "internal" },
    { key: "supplierQuotedAt", label: "供应商报价", date: p.supplierQuotedAt, kind: "internal" },
    { key: "publicDate", label: "发布时间", date: p.publicDate, kind: "external" },
    {
      key: "questionCloseDate",
      label: "提问截止",
      date: p.questionCloseDate,
      kind: "external",
    },
    {
      key: "closeDate",
      label: "截标时间",
      date: p.closeDate || p.dueDate,
      kind: "external",
    },
    { key: "submittedAt", label: "项目提交", date: p.submittedAt, kind: "internal" },
    { key: "awardDate", label: "结果公布", date: p.awardDate, kind: "external" },
  ];

  const withDates = candidates
    .filter((c) => c.date)
    .map((c) => ({ ...c, dateObj: new Date(c.date!) }))
    .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime());

  if (withDates.length === 0) return [];

  const startMs = withDates[0].dateObj.getTime();
  const endMs = withDates[withDates.length - 1].dateObj.getTime();

  const todayInRange =
    now.getTime() >= startMs - 86400_000 &&
    now.getTime() <= endMs + 86400_000 * 30;

  const effectiveEndMs = todayInRange
    ? Math.max(endMs, now.getTime())
    : endMs;
  const effectiveStartMs = Math.min(startMs, todayInRange ? now.getTime() : startMs);

  const span = effectiveEndMs - effectiveStartMs;

  function calcPosition(ms: number): number {
    if (span === 0) return 0.5;
    return (ms - effectiveStartMs) / span;
  }

  const events: TimelineEvent[] = withDates.map((e) => {
    const isPast = e.dateObj.getTime() <= now.getTime();
    const isExtFuture =
      e.kind === "external" && !isPast && e.dateObj.getTime() < now.getTime() + 48 * 3600_000;

    let status: TimelineEvent["status"];
    if (isPast) {
      status = "completed";
    } else if (isExtFuture) {
      status = "upcoming";
    } else {
      status = "upcoming";
    }

    if (
      e.kind === "external" &&
      isPast &&
      (e.key === "closeDate" || e.key === "questionCloseDate")
    ) {
      if (e.key === "closeDate" && !p.submittedAt) {
        status = "overdue";
      }
      if (
        e.key === "questionCloseDate" &&
        !isPast
      ) {
        status = "upcoming";
      }
    }

    return {
      key: e.key,
      label: e.label,
      date: e.dateObj,
      kind: e.kind,
      status,
      position: calcPosition(e.dateObj.getTime()),
    };
  });

  if (todayInRange) {
    events.push({
      key: "today",
      label: "今天",
      date: now,
      kind: "today",
      status: "active",
      position: calcPosition(now.getTime()),
    });
  }

  events.sort((a, b) => a.position - b.position);

  enforceMinSpacing(events, 0.06);

  return events;
}

/**
 * 确保事件之间有最小间距，尽量保持真实比例。
 */
function enforceMinSpacing(events: TimelineEvent[], minGap: number): void {
  for (let i = 1; i < events.length; i++) {
    const prev = events[i - 1];
    const curr = events[i];
    if (curr.position - prev.position < minGap) {
      curr.position = Math.min(prev.position + minGap, 1);
    }
  }

  if (events.length > 0 && events[events.length - 1].position > 1) {
    const overflow = events[events.length - 1].position - 1;
    const scale = 1 / (1 + overflow);
    for (const e of events) {
      e.position *= scale;
    }
  }
}
