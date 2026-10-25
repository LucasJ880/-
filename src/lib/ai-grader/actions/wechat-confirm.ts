/**
 * 微信端「数字回复确认」轻量逻辑
 *
 * 用户回复纯数字 1/2/3 → 找到该用户最近未过期的 pending actions → 执行对应动作。
 * 用户回复「取消 / cancel / 放弃」→ 拒绝最近一批 pending actions。
 *
 * 复用现有审批链路（A-P3 起统一走 ApprovalPort，不绕过、不另起一套）。
 * 执行时强制传入 orgId，触发 executor 的跨组织防护。
 *
 * 安全边界：
 * - 给买家发邮件的草稿（sales.send_inquiry_reply，含无回复跟进）不进数字确认 / 取消批次：
 *   只能在能看到完整预览（风险提醒 + 正文 + 中文对照）的青砚页面上批准。
 * - 只取当前绑定组织的动作（以及没有组织归属的个人旧动作），与网页审批的
 *   canConfirmPendingActionInActiveOrg 同一口径。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  approveApprovalItem,
  rejectApprovalItem,
} from "@/lib/approval/port";

const MAX_BATCH = 3;
const CANCEL_WORDS = ["取消", "放弃", "cancel", "算了", "不用了"];

export interface WeChatConfirmContext {
  userId: string;
  orgId: string | null;
}

export interface WeChatConfirmResult {
  /** 是否被本逻辑处理（false 表示应交给常规 AI 链路） */
  handled: boolean;
  reply?: string;
}

/** 不允许在微信里用数字 / 取消处理的动作类型（= INQUIRY_REPLY_ACTION_TYPE；此处不引入 FDE 模块，测试校验两者一致） */
export const WECHAT_EXCLUDED_ACTION_TYPES = ["sales.send_inquiry_reply"] as const;

/** 纯函数：微信数字确认的候选范围（本人创建、待处理、未过期、非买家邮件、当前组织或无组织） */
export function weChatPendingActionWhere(
  userId: string,
  orgId: string | null,
  now: Date = new Date(),
): Prisma.PendingActionWhereInput {
  return {
    createdById: userId,
    status: "pending",
    expiresAt: { gt: now },
    type: { notIn: [...WECHAT_EXCLUDED_ACTION_TYPES] },
    OR: orgId ? [{ orgId }, { orgId: null }] : [{ orgId: null }],
  };
}

/**
 * 取该用户最近未过期的 pending 草稿，按创建时间正序返回（旧→新），
 * 使编号 1..n 与适配/展示顺序一致。
 */
export async function getRecentPendingActionsForWeChat(
  userId: string,
  orgId: string | null,
  limit = MAX_BATCH,
) {
  const rows = await db.pendingAction.findMany({
    where: weChatPendingActionWhere(userId, orgId),
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      type: true,
      title: true,
      createdAt: true,
      agentRunId: true,
    },
  });
  return rows.reverse();
}

/** 有待审批的询盘回复时，提示去青砚看草稿（微信里不能批准给买家的邮件） */
async function inquiryReplyHint(ctx: WeChatConfirmContext): Promise<string> {
  if (!ctx.orgId) return "";
  const n = await db.pendingAction
    .count({
      where: {
        orgId: ctx.orgId,
        type: { in: [...WECHAT_EXCLUDED_ACTION_TYPES] },
        status: "pending",
        expiresAt: { gt: new Date() },
        OR: [{ createdById: ctx.userId }, { approverUserId: ctx.userId }],
      },
    })
    .catch(() => 0);
  return n > 0 ? `\n另有 ${n} 封询盘回复草稿待审批：给买家的邮件需在青砚「今日询盘」页看完草稿后批准。` : "";
}

function isPureNumber(text: string): number | null {
  const m = text.trim().match(/^(\d{1,2})$/);
  if (!m) return null;
  return parseInt(m[1], 10);
}

function isCancel(text: string): boolean {
  const t = text.trim().toLowerCase();
  return CANCEL_WORDS.some((w) => t === w);
}

/**
 * 尝试把入站消息当作「待确认动作」的回复处理。
 * 返回 handled=false 时，调用方应继续走常规 AI 链路。
 */
export async function handleWeChatPendingReply(
  content: string,
  ctx: WeChatConfirmContext,
): Promise<WeChatConfirmResult> {
  const text = (content ?? "").trim();
  if (!text) return { handled: false };

  // 取用户角色（executor 二次 RBAC 需要）
  const loadRole = async () => {
    const u = await db.user.findUnique({
      where: { id: ctx.userId },
      select: { role: true },
    });
    return u?.role ?? "user";
  };

  // ── 取消 ───────────────────────────────────────────────
  if (isCancel(text)) {
    const batch = await getRecentPendingActionsForWeChat(ctx.userId, ctx.orgId);
    if (batch.length === 0) {
      return { handled: true, reply: `当前没有待确认的动作。${await inquiryReplyHint(ctx)}` };
    }
    const role = await loadRole();
    let rejected = 0;
    const runIds = new Set<string>();
    for (const a of batch) {
      const r = await rejectApprovalItem("pending_action", a.id, {
        userId: ctx.userId,
        role,
        orgId: ctx.orgId,
      });
      if (r.ok) {
        rejected++;
        if (a.agentRunId) runIds.add(a.agentRunId);
      }
    }
    if (runIds.size > 0) {
      const { maybeCompleteAgentRunAfterApproval } = await import(
        "@/lib/agent-runtime/pending-link"
      );
      for (const agentRunId of runIds) {
        await maybeCompleteAgentRunAfterApproval({
          orgId: ctx.orgId,
          agentRunId,
        }).catch(() => {});
      }
    }
    return { handled: true, reply: `已取消 ${rejected} 个待确认动作。` };
  }

  // ── 数字确认 ───────────────────────────────────────────
  const n = isPureNumber(text);
  if (n === null) return { handled: false };

  const batch = await getRecentPendingActionsForWeChat(ctx.userId, ctx.orgId);
  if (batch.length === 0) {
    return { handled: true, reply: `没有找到对应的待确认动作，请重新发起。${await inquiryReplyHint(ctx)}` };
  }
  if (n < 1 || n > batch.length) {
    return { handled: true, reply: `没有找到编号 ${n} 对应的待确认动作，请回复 1-${batch.length}。` };
  }

  const target = batch[n - 1];
  const role = await loadRole();
  const result = await approveApprovalItem("pending_action", target.id, {
    userId: ctx.userId,
    role,
    orgId: ctx.orgId,
  });

  if (result.ok) {
    if (target.agentRunId) {
      const { maybeCompleteAgentRunAfterApproval } = await import(
        "@/lib/agent-runtime/pending-link"
      );
      await maybeCompleteAgentRunAfterApproval({
        orgId: ctx.orgId,
        agentRunId: target.agentRunId,
      }).catch(() => {});
    }
    // 内部备注用更贴合业务语义的文案；其余动作保持通用「已执行」
    if (target.type === "grader.internal_note") {
      return {
        handled: true,
        reply: target.title ? `✅ 已记录内部备注：${target.title}` : "✅ 已记录内部备注",
      };
    }
    // 项目任务：executor 返回的 message 已含「已创建/已存在类似项目任务：xxx」
    if (target.type === "grader.project_task") {
      return {
        handled: true,
        reply: result.message ? `✅ ${result.message}` : `✅ 已创建项目任务：${target.title}`,
      };
    }
    // 邮件草稿：只生成草稿，不发送；提示去 Gmail 草稿箱查看
    if (target.type === "grader.email_draft") {
      return {
        handled: true,
        reply: `✅ 已生成邮件草稿：${target.title}\n可到 Gmail 草稿箱查看。`,
      };
    }
    return { handled: true, reply: `✅ 已执行：${target.title}${result.message ? `（${result.message}）` : ""}` };
  }
  return { handled: true, reply: `❌ 执行失败：${result.error ?? "未知错误"}` };
}
