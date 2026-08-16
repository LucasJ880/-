/**
 * Observe Dashboard windows. API buckets use deterministic UTC boundaries.
 * Display uses existing Qingyan Toronto formatters.
 */

export const OBSERVE_RANGES = ["24h", "7d", "30d"] as const;
export type ObserveRange = (typeof OBSERVE_RANGES)[number];

export class ObserveQueryError extends Error {
  readonly httpStatus = 400;
  readonly code = "INVALID_QUERY";
  constructor(message: string) {
    super(message);
    this.name = "ObserveQueryError";
  }
}

export function parseObserveRange(raw: string | null | undefined): ObserveRange {
  const value = (raw ?? "7d").trim();
  if (!(OBSERVE_RANGES as readonly string[]).includes(value)) {
    throw new ObserveQueryError("range must be 24h, 7d, or 30d");
  }
  return value as ObserveRange;
}

export function observeWindow(range: ObserveRange, now = new Date()): {
  since: Date;
  until: Date;
  bucket: "hour" | "day";
} {
  const until = now;
  if (range === "24h") {
    return {
      since: new Date(until.getTime() - 24 * 60 * 60 * 1000),
      until,
      bucket: "hour",
    };
  }
  const days = range === "7d" ? 7 : 30;
  return {
    since: new Date(until.getTime() - days * 24 * 60 * 60 * 1000),
    until,
    bucket: "day",
  };
}

export function utcBucketStart(at: Date, bucket: "hour" | "day"): string {
  const iso = at.toISOString();
  if (bucket === "hour") return `${iso.slice(0, 13)}:00:00.000Z`;
  return `${iso.slice(0, 10)}T00:00:00.000Z`;
}

export const DEFAULT_RUN_PAGE_SIZE = 25;
export const MAX_RUN_PAGE_SIZE = 100;

export function parseObserveLimit(raw: string | null | undefined): number {
  if (raw == null || raw === "") return DEFAULT_RUN_PAGE_SIZE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new ObserveQueryError("limit must be an integer >= 1");
  }
  if (n > MAX_RUN_PAGE_SIZE) {
    throw new ObserveQueryError(`limit must be <= ${MAX_RUN_PAGE_SIZE}`);
  }
  return n;
}

export type ObserveRunCursor = { startedAt: string; id: string };

export function parseObserveCursor(
  raw: string | null | undefined,
): ObserveRunCursor | null {
  if (raw == null || raw === "") return null;
  const idx = raw.indexOf("~");
  if (idx <= 0 || idx === raw.length - 1) {
    throw new ObserveQueryError("cursor must be startedAt~id");
  }
  const startedAt = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  if (Number.isNaN(Date.parse(startedAt)) || !id.trim()) {
    throw new ObserveQueryError("cursor startedAt is not a valid timestamp");
  }
  return { startedAt, id };
}

export function encodeObserveCursor(startedAt: Date, id: string): string {
  return `${startedAt.toISOString()}~${id}`;
}

export const OBSERVE_RUN_STATUSES = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "awaiting_approval",
] as const;

export type ObserveRunStatus = (typeof OBSERVE_RUN_STATUSES)[number];

export function parseObserveStatus(
  raw: string | null | undefined,
): ObserveRunStatus | undefined {
  if (raw == null || raw === "") return undefined;
  if (!(OBSERVE_RUN_STATUSES as readonly string[]).includes(raw)) {
    throw new ObserveQueryError("status is not a known runtime status");
  }
  return raw as ObserveRunStatus;
}

export function parseBoolFlag(raw: string | null | undefined): boolean | undefined {
  if (raw == null || raw === "") return undefined;
  if (raw === "1" || raw === "true") return true;
  if (raw === "0" || raw === "false") return false;
  throw new ObserveQueryError("boolean flags must be true/false");
}

export function parseOptionalToken(
  raw: string | null | undefined,
  field: string,
  max = 80,
): string | undefined {
  if (raw == null || raw === "") return undefined;
  const value = raw.trim();
  if (!value) {
    throw new ObserveQueryError(`${field} must not be empty`);
  }
  if (value.length > max) {
    throw new ObserveQueryError(`${field} is too long`);
  }
  return value;
}

export type ObserveRunsQueryInput = {
  range: ObserveRange;
  limit: number;
  cursor: ObserveRunCursor | null;
  status?: ObserveRunStatus;
  runType?: string;
  agent?: string;
  domain?: string;
  hasToolFailure?: boolean;
  hasModelFailure?: boolean;
  hasRetrievalFailure?: boolean;
  hasHumanSignal?: boolean;
  hasObservabilityGap?: boolean;
};

export function parseObserveRunsQuery(
  sp: Pick<URLSearchParams, "get">,
): ObserveRunsQueryInput {
  const runType = parseOptionalToken(sp.get("runType"), "runType");
  const domain = parseOptionalToken(sp.get("domain"), "domain");
  return {
    range: parseObserveRange(sp.get("range")),
    limit: parseObserveLimit(sp.get("limit")),
    cursor: parseObserveCursor(sp.get("cursor")),
    status: parseObserveStatus(sp.get("status")),
    runType,
    agent: parseOptionalToken(sp.get("agent"), "agent"),
    domain,
    hasToolFailure: parseBoolFlag(sp.get("hasToolFailure")),
    hasModelFailure: parseBoolFlag(sp.get("hasModelFailure")),
    hasRetrievalFailure: parseBoolFlag(sp.get("hasRetrievalFailure")),
    hasHumanSignal: parseBoolFlag(sp.get("hasHumanSignal")),
    hasObservabilityGap: parseBoolFlag(sp.get("hasObservabilityGap")),
  };
}
