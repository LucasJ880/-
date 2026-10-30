/**
 * 微信「回数字确认 / 回取消」可处理哪些 PendingAction 类型 — 纯函数，无 DB
 *
 * 白名单而不是黑名单：只有下面明确标成 wechat_number_ok 的类型（内部、低风险）可以在微信里
 * 回一个数字就批准（或回「取消」批量拒绝）。其余类型——对外发送、改外部可见状态、高风险审批——
 * 必须在能看到完整内容的青砚网页上批准。
 *
 * - WECHAT_CONFIRM_POLICY 是 Record<PendingActionType, …>：新增动作类型时 tsc 会强制在这里给出分类；
 * - 数据库里出现任何不在白名单里的 type 字符串（旧数据 / 新类型 / 拼写不同），查询条件是 `type in 白名单`，
 *   一律不进微信批次（默认排除）。
 * - 少数类型是否对外取决于 payload：grader.internal_note 只有写进内部可见位置的目标（见
 *   WECHAT_CONFIRMABLE_INTERNAL_NOTE_TARGETS）可回数字确认。判断具体一条动作用 isWeChatConfirmableAction，
 *   isWeChatConfirmableActionType 只是类型层面的上限。
 */

import type { InternalNoteTargetType, PendingActionType } from "@/lib/pending-actions/types";

export type WeChatConfirmPolicy =
  /** 内部、低风险：可在微信里回数字确认 */
  | "wechat_number_ok"
  /** 会发给外部方（买家 / 供应商）或改外部可见状态（活动上线等）：只能网页审批 */
  | "web_only_external"
  /** 内部但高风险 / 需要看完内容或由他人审批：只能网页审批 */
  | "web_only_review";

/** 询盘回复（= INQUIRY_REPLY_ACTION_TYPE；此处不引入 FDE 模块，测试校验两者一致） */
export const INQUIRY_REPLY_TYPE = "sales.send_inquiry_reply" as const;

export const WECHAT_CONFIRM_POLICY: Readonly<Record<PendingActionType, WeChatConfirmPolicy>> = {
  // ── 内部、低风险 ──
  /** 改商机下次跟进时间（本库字段） */
  "sales.update_followup": "wechat_number_ok",
  /** 改商机阶段（本库字段，可再改回） */
  "sales.update_stage": "wechat_number_ok",
  /**
   * 内部备注：只有写进客户时间线 / 商机时间线 / 项目讨论流的才可回数字确认（按 payload.targetType 再筛，
   * 见 WECHAT_CONFIRMABLE_INTERNAL_NOTE_TARGETS）；写报价的（QUOTE）不行。
   */
  "grader.internal_note": "wechat_number_ok",
  /** 建项目任务 */
  "grader.project_task": "wechat_number_ok",
  /**
   * 个人日程：写本库 CalendarEvent，并同步到**用户本人**已连接的 Google 日历（无参会人，不发邀请）。
   * 不会发给任何外部方。
   */
  "calendar.create_event": "wechat_number_ok",
  /**
   * Gmail 草稿：只在**用户本人**邮箱里 drafts.create，绝不发送；真正发出前用户必须在 Gmail 里看完草稿再点发送。
   * 不会发给任何外部方。
   */
  "grader.email_draft": "wechat_number_ok",
  /** 营销活动草稿（status=draft，不投放） */
  "marketing.create_campaign_draft": "wechat_number_ok",

  // ── 对外发送 / 改外部可见状态 ──
  /** 给买家发询盘回复邮件（含无回复跟进）：只能在「今日询盘」/ 商机页看完草稿（风险提醒 + 正文 + 中文对照）后批准 */
  "sales.send_inquiry_reply": "web_only_external",
  /** 给供应商发投标询价邮件 */
  "tender.send_rfq": "web_only_external",
  /** INSTALL-2c：完工 + 质保邮件，发给客户（须在网页看完预览后批准） */
  "install.send_warranty_email": "web_only_external",
  /** INSTALL-2j：返修时间确认邮件，发给客户（须在维修单详情看完预览后批准） */
  "install.send_repair_visit_email": "web_only_external",
  /** 给供应商发催单 / 缺字段追问邮件 */
  "tender.send_chase": "web_only_external",
  /** 营销活动上线（awaiting_approval → active，开始对外投放 / 发布） */
  "marketing.activate_campaign": "web_only_external",

  // ── 内部但高风险 / 需看完内容 ──
  /** 报价让利审批（HIGH 风险，审批人通常不是发起人） */
  "sales.approve_quote_promotion": "web_only_review",
  /** Leader 批准研究运营计划（批量建任务、通知他人） */
  "marketing.approve_research_plan": "web_only_review",
  /** 覆盖已确认的产品营销上下文（影响此后所有营销内容，须看完差异） */
  "marketing.propose_context_update": "web_only_review",
  // PERM-2：销售设置修改只在 Web 审批中心审（含解锁码变更，不走微信确认）
  "sales.update_quote_settings": "web_only_review",
  // PERM-3：作废工艺单只在 Web 审批中心审
  "orders.cancel_blinds_order": "web_only_review",
  // PERM-4a：签约单改总价只在 Web 审批中心审
  "sales.update_signed_quote": "web_only_review",
  /** 改写企业商务事实（MOQ / 周期 / 港口 / 落款 / 目录；影响此后所有 FDE 草稿，且只有 admin / boss 能批） */
  "revenue_spine.propose_commercial_fact": "web_only_review",
};

/** 可在微信里回数字确认 / 回取消的类型（白名单；部分类型还要按 payload 再筛，见 isWeChatConfirmableAction） */
export const WECHAT_CONFIRMABLE_ACTION_TYPES: readonly PendingActionType[] = (
  Object.keys(WECHAT_CONFIRM_POLICY) as PendingActionType[]
).filter((t) => WECHAT_CONFIRM_POLICY[t] === "wechat_number_ok");

/** 任意 type 字符串：只有白名单里的才返回 true（未知类型默认排除）。类型层面的上限，不看 payload。 */
export function isWeChatConfirmableActionType(type: string | null | undefined): boolean {
  return !!type && (WECHAT_CONFIRMABLE_ACTION_TYPES as readonly string[]).includes(type);
}

export const INTERNAL_NOTE_TYPE = "grader.internal_note" as const satisfies PendingActionType;

/**
 * grader.internal_note 可在微信回数字确认的目标（白名单，新增目标默认排除）：
 * - OPPORTUNITY / CUSTOMER → CustomerInteraction(type=note)，只在青砚内部时间线可见；
 * - PROJECT → 项目讨论流的系统消息，只有项目成员可见。
 * QUOTE 不在内：执行器把备注追加到 SalesQuote.notes，而免登录的报价分享页（/quote/[token]，没有 PDF 存档时）
 * 会把这个字段展示给买家——等于把内部风险判断发给了买家，只能在网页上看完内容后批准。
 */
export const WECHAT_CONFIRMABLE_INTERNAL_NOTE_TARGETS: readonly InternalNoteTargetType[] = [
  "OPPORTUNITY",
  "CUSTOMER",
  "PROJECT",
];

function payloadTargetType(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const v = (payload as Record<string, unknown>).targetType;
  return typeof v === "string" ? v : undefined;
}

/**
 * 具体一条动作能否在微信里回数字确认 / 回取消：类型在白名单内，且按 payload 再筛
 * （内部备注只认 WECHAT_CONFIRMABLE_INTERNAL_NOTE_TARGETS，缺 targetType 也排除）。
 * payload 可传 PendingAction.payload 原值，或只含 { targetType } 的子集。
 */
export function isWeChatConfirmableAction(type: string | null | undefined, payload?: unknown): boolean {
  if (!isWeChatConfirmableActionType(type)) return false;
  if (type === INTERNAL_NOTE_TYPE) {
    const target = payloadTargetType(payload);
    return !!target && (WECHAT_CONFIRMABLE_INTERNAL_NOTE_TARGETS as readonly string[]).includes(target);
  }
  return true;
}

/**
 * 纯函数：微信里不能处理、但用户有待审批的动作时，附在回复后面的提示。
 * 询盘回复单独指向「今日询盘」（那里有草稿全文与中文对照）；其余指向「审批中心」。
 */
export function weChatWebOnlyHint(counts: { inquiryReplies: number; others: number }): string {
  const parts: string[] = [];
  if (counts.inquiryReplies > 0) {
    parts.push(`另有 ${counts.inquiryReplies} 封询盘回复草稿待审批：给买家的邮件需在青砚「今日询盘」页看完草稿后批准。`);
  }
  if (counts.others > 0) {
    parts.push(`另有 ${counts.others} 个待审批动作会对外发送、改动买家可见的内容或属于高风险操作，微信里不能直接批准，请在青砚「审批中心」看完内容后处理。`);
  }
  return parts.length ? `\n${parts.join("\n")}` : "";
}
