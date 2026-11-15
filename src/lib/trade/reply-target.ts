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
export function inboxReplyHref(target: { prospectId: string } | { opportunityId: string }): string {
  return "prospectId" in target
    ? `/trade/inbox?prospect=${encodeURIComponent(target.prospectId)}`
    : `/trade/inbox?opportunity=${encodeURIComponent(target.opportunityId)}`;
}
