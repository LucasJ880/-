/**
 * 站点桥接的响应分类逻辑副本（测试夹具，不是生产代码）。
 *
 * 来源：官网侧站点仓库（向青砚转发询盘的那一端）src/lib/qingyan-inquiry.ts 的 classifyQingyanResponse / processingStateFrom
 * （连同它们依赖的 snapshotFromBody / str）。两个仓库不互相导入，所以复制过来：判定逻辑逐字一致，
 * 只把类型改成本地定义（ForwardOutcome / QingyanResultSnapshot 在站点的 inquiry-store.ts）；
 * 站点侧改了判定规则时，这里要同步更新，否则兼容性测试会给出错误的安全感。
 *
 * 用途：把青砚 webhook / 状态接口的真实响应喂给站点的判定逻辑，确认异步入站后：
 *   首个响应 → delivered + processing incomplete；FDE 终态后的重发 → processing complete。
 */

type ForwardStatus = "delivered" | "partial" | "unconfirmed" | "failed" | "rejected" | "disabled";

interface QingyanFdeSnapshot {
  status: string;
  terminal: boolean;
  reason: string;
  agentRunId: string | null;
  pendingActionId: string | null;
}

export interface QingyanResultSnapshot {
  receiptId: string | null;
  prospectId: string | null;
  messageId: string | null;
  opportunityId: string | null;
  spine: string | null;
  replay: boolean;
  duplicate: boolean;
  recovered: boolean;
  recoveredSteps: string[];
  busy: boolean;
  conflict: boolean;
  contentDuplicateOf: string | null;
  complete: boolean;
  fde: QingyanFdeSnapshot | null;
}

// ── 以下判定逻辑逐字复制自站点 src/lib/qingyan-inquiry.ts ──

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function snapshotFromBody(b: Record<string, unknown>): QingyanResultSnapshot {
  const fdeRaw = b.fde && typeof b.fde === "object" ? (b.fde as Record<string, unknown>) : null;
  return {
    receiptId: str(b.receiptId),
    prospectId: str(b.prospectId),
    messageId: str(b.messageId),
    opportunityId: str(b.opportunityId),
    spine: str(b.spine),
    replay: b.replay === true,
    duplicate: b.duplicate === true,
    recovered: b.recovered === true,
    recoveredSteps: Array.isArray(b.recoveredSteps) ? b.recoveredSteps.filter((x): x is string => typeof x === "string") : [],
    busy: b.busy === true,
    conflict: b.conflict === true,
    contentDuplicateOf: str(b.contentDuplicateOf),
    complete: b.complete === true,
    fde: fdeRaw
      ? {
          status: str(fdeRaw.status) ?? "unknown",
          terminal: fdeRaw.terminal === true,
          reason: str(fdeRaw.reason) ?? "",
          agentRunId: str(fdeRaw.agentRunId),
          pendingActionId: str(fdeRaw.pendingActionId),
        }
      : null,
  };
}

export function processingStateFrom(result: QingyanResultSnapshot | null): "unknown" | "incomplete" | "complete" {
  if (!result) return "unknown";
  if (result.complete && (result.fde?.terminal ?? false)) return "complete";
  if (result.opportunityId) return "incomplete";
  return "unknown";
}

export function classifyQingyanResponse(
  httpStatus: number,
  body: unknown,
): { status: ForwardStatus; result: QingyanResultSnapshot | null; error: string | null } {
  if (httpStatus >= 200 && httpStatus < 300) {
    const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
    if (!b) return { status: "unconfirmed", result: null, error: `HTTP ${httpStatus} without a JSON body` };
    const snap = snapshotFromBody(b);
    if (snap.busy) {
      return { status: "partial", result: snap, error: "receiver is already processing this event" };
    }
    if (b.ok !== true) {
      return { status: "partial", result: snap, error: str(b.error) ?? "Qingyan answered without ok=true" };
    }
    if (!snap.prospectId) {
      return { status: "partial", result: snap, error: "Qingyan did not return a prospectId (Trade inquiry not confirmed)" };
    }
    const spineOk = snap.spine === "ok" || snap.spine === "replay";
    if (!spineOk || !snap.opportunityId) {
      return { status: "partial", result: snap, error: `Revenue Spine not established (spine=${snap.spine ?? "unknown"})` };
    }
    return { status: "delivered", result: snap, error: null };
  }
  const detail =
    body && typeof body === "object" && typeof (body as Record<string, unknown>).error === "string"
      ? `: ${(body as Record<string, unknown>).error as string}`
      : "";
  if (httpStatus === 408 || httpStatus === 429 || httpStatus >= 500) {
    return { status: "failed", result: null, error: `HTTP ${httpStatus}${detail}` };
  }
  return { status: "rejected", result: null, error: `HTTP ${httpStatus}${detail}` };
}
