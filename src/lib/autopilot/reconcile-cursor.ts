/**
 * Bounded, oldest-first cursor for Human Signal reconciliation.
 * Each invocation is one page. Callers loop until done.
 * Automatic runtime trigger is REQUIRED_BEFORE_PRODUCTION_ACTIVATION.
 */

export const AUTOMATIC_RECONCILER_TRIGGER =
  "REQUIRED_BEFORE_PRODUCTION_ACTIVATION" as const;

export const HUMAN_SIGNAL_RECONCILE_DEFAULT_PAGE_SIZE = 25;
export const HUMAN_SIGNAL_RECONCILE_MAX_PAGE_SIZE = 50;
export const HUMAN_SIGNAL_RECONCILE_MAX_PAGES = 80;

export type ReconcileStreamCursor =
  | { status: "start" }
  | { status: "page"; createdAt: string; id: string }
  | { status: "done" };

export type HumanSignalReconcileCursor = {
  feedback: ReconcileStreamCursor;
  retry: ReconcileStreamCursor;
  pending: ReconcileStreamCursor;
};

export function startHumanSignalReconcileCursor(): HumanSignalReconcileCursor {
  return {
    feedback: { status: "start" },
    retry: { status: "start" },
    pending: { status: "start" },
  };
}

export function cloneHumanSignalReconcileCursor(
  cursor: HumanSignalReconcileCursor,
): HumanSignalReconcileCursor {
  return {
    feedback: { ...cursor.feedback },
    retry: { ...cursor.retry },
    pending: { ...cursor.pending },
  };
}

export function isReconcileStreamDone(cursor: ReconcileStreamCursor): boolean {
  return cursor.status === "done";
}

export function isHumanSignalReconcileDone(
  cursor: HumanSignalReconcileCursor,
): boolean {
  return (
    isReconcileStreamDone(cursor.feedback) &&
    isReconcileStreamDone(cursor.retry) &&
    isReconcileStreamDone(cursor.pending)
  );
}

export function clampReconcilePageSize(limit?: number): number {
  const n = limit ?? HUMAN_SIGNAL_RECONCILE_DEFAULT_PAGE_SIZE;
  return Math.min(
    HUMAN_SIGNAL_RECONCILE_MAX_PAGE_SIZE,
    Math.max(1, n),
  );
}

export function nextStreamCursor(
  rows: Array<{ createdAt: Date; id: string }>,
  pageSize: number,
): ReconcileStreamCursor {
  if (rows.length < pageSize) return { status: "done" };
  const last = rows[rows.length - 1];
  if (!last) return { status: "done" };
  return {
    status: "page",
    createdAt: last.createdAt.toISOString(),
    id: last.id,
  };
}

/** Prisma where fragment: rows strictly after the cursor (timestamp, id). */
export function streamCursorWhere(
  cursor: ReconcileStreamCursor,
  timestampField: "createdAt" | "updatedAt" = "createdAt",
): Record<string, unknown> | null {
  if (cursor.status === "done") return null;
  if (cursor.status === "start") return {};
  const ts = new Date(cursor.createdAt);
  return {
    OR: [
      { [timestampField]: { gt: ts } },
      { AND: [{ [timestampField]: ts }, { id: { gt: cursor.id } }] },
    ],
  };
}
