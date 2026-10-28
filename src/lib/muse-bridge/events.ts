/**
 * Muse Bridge — 事件出站（零 schema，复用 Notification 作为 outbox）
 *
 * 设计：
 *   - 每条 Muse 事件 = 一条 Notification（category="muse_bridge"，metadata.museEvent=信封）。
 *     用户在青砚站内也能看到同一条，Bridge 通过 GET /api/bridge/muse/events 按游标拉取。
 *   - 幂等：Notification.sourceKey = eventId（同一业务事实绝不推两次）。
 *   - 失败语义：emit 绝不上抛影响调用方（分析终态化 / 审批创建 / 路由）。
 *   - 出站脱敏在信封构造时完成（sanitizeOutbound）。
 */

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/create";
import { museEventEnvelopeSchema, type MuseEventEnvelope, type MuseEventType } from "./contract";
import { isMuseBridgeEnabled } from "./flags";
import { analysisReadyEventInput, buildMuseEvent, type AnalysisReadyFacts, type EmitMuseEventInput } from "./events-pure";

export const MUSE_EVENT_CATEGORY = "muse_bridge" as const;

/** 事件类型 → 复用的站内通知 type（保持用户通知偏好语义）。 */
function notificationTypeFor(type: MuseEventType): string {
  switch (type) {
    case "approval.requested":
    case "approval.resolved":
      return "agent_approval";
    case "brief.daily":
      return "sales_daily_briefing";
    default:
      return "project_update";
  }
}


/** 落库（幂等）。返回 { emitted: false } 表示被开关关闭 / 已存在 / 校验失败 / 落库失败。 */
export async function emitMuseEvent(
  input: EmitMuseEventInput,
): Promise<{ emitted: boolean; reason?: string }> {
  try {
    if (!isMuseBridgeEnabled()) return { emitted: false, reason: "bridge_disabled" };
    const envelope = buildMuseEvent(input);
    if (!envelope) return { emitted: false, reason: "invalid_envelope" };
    const sourceKey = `muse:${envelope.eventId}`;
    const existing = await db.notification.findUnique({ where: { sourceKey }, select: { id: true } });
    if (existing) return { emitted: false, reason: "duplicate" };
    await createNotification({
      userId: envelope.userId,
      orgId: envelope.orgId,
      projectId: envelope.projectId,
      type: notificationTypeFor(envelope.type),
      category: MUSE_EVENT_CATEGORY,
      title: titleFor(envelope),
      summary: envelope.summary,
      // S2：询问事件点开即到网页回复页（header.tsx 按 entityType=muse_inquiry 跳转）
      entityType: envelope.approval
        ? envelope.approval.kind
        : envelope.inquiryId
          ? "muse_inquiry"
          : envelope.projectId
            ? "project"
            : undefined,
      entityId: envelope.approval?.approvalId ?? envelope.inquiryId ?? envelope.projectId,
      priority: envelope.type === "approval.requested" || envelope.type === "deadline.approaching" ? "high" : "medium",
      sourceKey,
      metadata: { museEvent: envelope },
    });
    return { emitted: true };
  } catch (err) {
    console.error("[muse-bridge] emitMuseEvent failed:", err);
    return { emitted: false, reason: "persist_failed" };
  }
}

function titleFor(e: MuseEventEnvelope): string {
  const name = e.projectName ? `「${e.projectName.slice(0, 40)}」` : "";
  switch (e.type) {
    case "approval.requested":
      return `${name}有一条待你批准`;
    case "approval.resolved":
      return `${name}审批已处理`;
    case "analysis.ready":
      return `${name}分析完成`;
    case "reply.received":
      return `${name}供应商回复了`;
    case "quote.parsed":
      return `${name}新报价已入表`;
    case "missing_fields":
      return `${name}报价缺字段`;
    case "addendum.detected":
      return `${name}招标文件有更新`;
    case "deadline.approaching":
      return `${name}截标临近`;
    case "no_response":
      return `${name}有供应商未响应`;
    case "brief.daily":
      return "今日投标早报";
    case "inquiry.received":
      return "有一条商机询问等你回复";
    case "inquiry.replied":
      return "你的商机询问有回复了";
    case "inquiry.overdue":
      return "商机询问已逾期";
    case "followup.assigned":
      return "有一条跟进分配给你";
    case "followup.due":
      return "跟进即将到期";
    case "followup.overdue":
      return "跟进已逾期";
    case "followup.updated":
      return "你布置的跟进有更新";
  }
}

/** Bridge 拉取：按 createdAt 游标，只返回该用户 + 该 org 的 muse 事件。 */
/** S3：复合游标 `<ISO>|<通知 id>`；格式不对返回 null */
export function parseEventCursor(raw: string): { at: Date; id: string } | null {
  const sep = raw.lastIndexOf("|");
  if (sep <= 0) return null;
  const at = new Date(raw.slice(0, sep));
  const id = raw.slice(sep + 1);
  return Number.isNaN(at.getTime()) || !/^[A-Za-z0-9_-]{1,64}$/.test(id) ? null : { at, id };
}

export const formatEventCursor = (at: Date, id: string) => `${at.toISOString()}|${id}`;

export async function listMuseEvents(input: {
  userId: string;
  orgId: string;
  sinceIso?: string | null;
  /** S3：优先于 sinceIso；按 (createdAt, id) 翻页，同一毫秒的事件不会落在页缝里 */
  cursor?: { at: Date; id: string } | null;
  limit?: number;
}): Promise<{ events: MuseEventEnvelope[]; nextSince: string | null; nextCursor: string | null }> {
  const since = input.sinceIso ? new Date(input.sinceIso) : null;
  const take = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const after = input.cursor
    ? { OR: [{ createdAt: { gt: input.cursor.at } }, { createdAt: input.cursor.at, id: { gt: input.cursor.id } }] }
    : since && !Number.isNaN(since.getTime())
      ? { createdAt: { gt: since } }
      : {};
  const rows = await db.notification.findMany({
    where: {
      userId: input.userId,
      orgId: input.orgId,
      category: MUSE_EVENT_CATEGORY,
      ...after,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take,
    select: { id: true, metadata: true, createdAt: true },
  });
  const events: MuseEventEnvelope[] = [];
  for (const r of rows) {
    if (!r.metadata) continue;
    try {
      const parsed = museEventEnvelopeSchema.safeParse((JSON.parse(r.metadata) as { museEvent?: unknown }).museEvent);
      if (parsed.success) events.push(parsed.data);
    } catch {
      /* 坏行跳过，不影响其它事件 */
    }
  }
  const last = rows[rows.length - 1];
  const nextSince = last ? last.createdAt.toISOString() : input.sinceIso ?? null;
  const nextCursor = last
    ? formatEventCursor(last.createdAt, last.id)
    : input.cursor
      ? formatEventCursor(input.cursor.at, input.cursor.id)
      : null;
  return { events, nextSince, nextCursor };
}

// ── 挂钩点 helper（供 drafts.ts / 分析终态化 / inquiry 状态变更调用，均 best-effort）──

/** PendingAction 创建后：向有权审批的人推审批卡。 */
export async function emitApprovalRequested(input: {
  actionId: string;
  orgId: string | null | undefined;
  recipientUserId: string;
  projectId?: string | null;
  projectName?: string | null;
  title: string;
  expiresAt?: Date | null;
}): Promise<void> {
  if (!input.orgId) return;
  await emitMuseEvent({
    eventId: `approval.requested:${input.actionId}`,
    type: "approval.requested",
    orgId: input.orgId,
    userId: input.recipientUserId,
    projectId: input.projectId ?? undefined,
    projectName: input.projectName ?? undefined,
    summary: `待批：${input.title}。回复"批准"或"驳回"即可。`,
    approval: {
      approvalId: input.actionId,
      kind: "pending_action",
      expiresAt: input.expiresAt ? input.expiresAt.toISOString() : undefined,
    },
    action: { label: "批准", command: { intent: "approve", approvalId: input.actionId } },
  });
}

/** 分析终态化后：结论 + 1 条理由，action = next_step（P1-8）。 */
export async function emitAnalysisReady(input: {
  runId: string;
  orgId: string | null | undefined;
  recipientUserId: string;
  projectId: string;
  facts: AnalysisReadyFacts;
}): Promise<void> {
  if (!input.orgId) return;
  await emitMuseEvent(analysisReadyEventInput({ ...input, orgId: input.orgId }));
}
