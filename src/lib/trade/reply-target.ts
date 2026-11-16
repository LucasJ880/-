/**
 * NAV-1c：看到来信就能回（spec trade/inquiry-reply-entry）——纯函数部分。
 *
 *   - resolveReplyTargets：客户互动 → 回复目标（外贸线索 id 或空）
 *   - interactionMetaLine：时间线条目下方的「方向 · 经手人」文字
 *   - replySubjectFor：没有 AI 草稿时回复窗口预填的主题
 *   - replyButtonFor：询盘收件箱会话卡片上的回复按钮
 *   - inboxReplyHref：进入询盘收件箱并打开回复窗口的地址
 *
 * 不依赖数据库与 React：客户端组件、接口与测试都直接引用。读库的部分在 reply-target-server.ts。
 */

export type ReplyTarget = { prospectId: string } | null;

export type ReplyTargetInteraction = { id: string; direction: string | null; opportunityId: string | null };

/**
 * @param prospectByOpportunity 商机 id → 外贸线索 id（本企业内 convertedToSalesOpportunityId 指向该商机、最早建立的那条；
 *   与审批发送写回收件箱时间线用的是同一条，见 exec-sales-inquiry-reply.ts mirrorApprovedReplyToTradeTimeline）
 * @param allowed 外贸模块已开 ∧ 当前用户持 trade.manage ∧ 询盘收件箱对其放行
 */
export function resolveReplyTargets(
  interactions: readonly ReplyTargetInteraction[],
  prospectByOpportunity: ReadonlyMap<string, string>,
  allowed: boolean,
): Map<string, ReplyTarget> {
  const out = new Map<string, ReplyTarget>();
  for (const i of interactions) {
    const prospectId = allowed && i.direction === "inbound" && i.opportunityId ? prospectByOpportunity.get(i.opportunityId) : undefined;
    out.set(i.id, prospectId ? { prospectId } : null);
  }
  return out;
}

/** 需要去查线索的商机 id：来信且挂着商机的互动，去重 */
export function opportunityIdsNeedingTarget(interactions: readonly ReplyTargetInteraction[]): string[] {
  return [...new Set(interactions.filter((i) => i.direction === "inbound" && i.opportunityId).map((i) => i.opportunityId as string))];
}

/** 时间线条目下方的文字：来信「客户来信 · 经手人：X」，发出「我方发出 · 经手人：X」，没有方向「经手人：X」 */
export function interactionMetaLine(direction: string | null | undefined, handlerName: string): string {
  const handler = `经手人：${handlerName}`;
  if (direction === "inbound") return `客户来信 · ${handler}`;
  if (direction === "outbound") return `我方发出 · ${handler}`;
  return handler;
}

/** 没有 AI 草稿时预填的主题：来信没有主题 → 空；已以 Re: 开头 → 原样；否则加 Re:  */
export function replySubjectFor(lastInboundSubject: string | null | undefined): string {
  const subject = (lastInboundSubject ?? "").trim();
  if (!subject) return "";
  return /^re\s*[:：]/i.test(subject) ? subject : `Re: ${subject}`;
}

export type ReplyButton = {
  /** draft = 查看回复草稿（带 AI 草稿打开）；write = 写回复；again = 再写一封（后两者空白打开） */
  kind: "draft" | "write" | "again";
  label: string;
  /** 打开回复窗口时是否预填 AI 草稿 */
  useDraft: boolean;
};

/** 每张会话卡片都有回复按钮，不以 AI 草稿存在为前提 */
export function replyButtonFor(thread: { replied: boolean; hasDraft: boolean }): ReplyButton {
  if (thread.replied) return { kind: "again", label: "再写一封", useDraft: false };
  if (thread.hasDraft) return { kind: "draft", label: "查看回复草稿", useDraft: true };
  return { kind: "write", label: "写回复", useDraft: false };
}

/** 进入询盘收件箱并直接打开该买家回复窗口的地址；审批面只有商机 id，时间线有线索 id */
export function inboxReplyHref(target: { prospectId: string } | { opportunityId: string; approvalId?: string | null }): string {
  if ("prospectId" in target) return `/trade/inbox?prospect=${encodeURIComponent(target.prospectId)}`;
  const base = `/trade/inbox?opportunity=${encodeURIComponent(target.opportunityId)}`;
  // NAV-3：从待批草稿卡进入时带上这份草稿的 id，收件箱据此预填草稿原文
  return target.approvalId ? `${base}&approval=${encodeURIComponent(target.approvalId)}` : base;
}

/** NAV-3：带进回复窗口的待批草稿原文（只有这四个字段） */
export type ApprovalDraft = { pendingActionId: string; subject: string; body: string; to: string };

/** 判定用到的审批记录字段（接口按 id 取出后原样传入） */
export type ApprovalDraftRow = {
  id: string;
  orgId: string | null;
  type: string;
  status: string;
  expiresAt: Date | null;
  payload: unknown;
};

/**
 * 待批草稿能不能带进回复窗口（spec trade/inquiry-reply-entry「单会话接口按待批草稿 id 返回草稿原文」）。
 * 七个条件全满足才给原文，否则一律为空、不区分原因：
 *   属于本企业；类型是询盘回复；状态为待批；未过期；载荷里的商机就是这位买家的商机；
 *   买家不是入驻测试询盘的测试买家（与审批执行「测试询盘不发给买家」同一口径）；主题与正文都非空。
 */
export function usableApprovalDraft(
  row: ApprovalDraftRow | null | undefined,
  ctx: { orgId: string; opportunityId: string | null; actionType: string; buyerIsOnboardingTest: boolean; now: Date },
): ApprovalDraft | null {
  if (!row || !ctx.opportunityId) return null;
  if (row.orgId !== ctx.orgId) return null;
  if (row.type !== ctx.actionType) return null;
  if (row.status !== "pending") return null;
  if (row.expiresAt && row.expiresAt.getTime() <= ctx.now.getTime()) return null;
  if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload)) return null;
  const payload = row.payload as Record<string, unknown>;
  if (payload.opportunityId !== ctx.opportunityId) return null;
  if (ctx.buyerIsOnboardingTest) return null;
  const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!subject || !body) return null;
  return { pendingActionId: row.id, subject, body, to: typeof payload.to === "string" ? payload.to.trim() : "" };
}

/** 草稿原定的收件邮箱与线索邮箱是否不同（忽略大小写与首尾空格；任一为空不算不同） */
export function approvalRecipientDiffers(draftTo: string | null | undefined, prospectEmail: string | null | undefined): boolean {
  const a = (draftTo ?? "").trim().toLowerCase();
  const b = (prospectEmail ?? "").trim().toLowerCase();
  return Boolean(a) && Boolean(b) && a !== b;
}
