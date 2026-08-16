import { StatusPill } from "@/components/autopilot/status-pill";
import { formatDateTimeToronto } from "@/lib/time";
import type { ObserveEventCategory } from "@/lib/autopilot/observe-timeline";

export type TimelineEventView = {
  id: string;
  sequence: number;
  eventType: string;
  category: ObserveEventCategory;
  timestamp: string;
  durationMs: number | null;
  status: string | null;
  summary: Record<string, unknown> | null;
};

export function EventTimeline({
  events,
  extraTerminal,
}: {
  events: TimelineEventView[];
  extraTerminal?: boolean;
}) {
  if (events.length === 0) {
    return <p className="text-sm text-muted">No observed events for this run.</p>;
  }
  return (
    <ol className="space-y-2">
      {extraTerminal ? (
        <li className="rounded border border-warning-bg bg-warning-bg/40 p-2 text-xs">
          Terminal invariant issue: more than one logical terminal event was
          observed. This is a diagnostic, not a page error.
        </li>
      ) : null}
      {events.map((event) => (
        <li
          key={event.id}
          className="rounded-lg border border-border bg-background p-3"
        >
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-mono text-[11px] text-muted">
              {event.sequence}
            </span>
            <StatusPill label={event.category} tone="neutral" />
            <span className="font-medium">{event.eventType}</span>
            {event.status ? (
              <StatusPill label={event.status} tone="info" />
            ) : null}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {formatDateTimeToronto(event.timestamp)}
            {event.durationMs != null ? ` · ${event.durationMs}ms` : ""}
          </div>
          {event.summary ? (
            <dl className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
              {Object.entries(event.summary).map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <dt className="text-muted">{key}</dt>
                  <dd className="truncate font-mono">
                    {typeof value === "string" || typeof value === "number"
                      ? String(value)
                      : String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
