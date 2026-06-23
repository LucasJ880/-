/**
 * 微信端「今日体检」编排（DAILY_BRIEF）
 *
 * 串起最小闭环：意图识别 → 跑 DailyBusinessBriefGrader → 适配 suggestedActions 为 PendingAction
 * → 格式化微信短文本（含编号动作）。用户随后回复数字即可经现有 executor 执行。
 *
 * 安全：全程只读 + 经 PendingAction 审批，不绕过 orgId / RBAC / data scope。
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { runDailyBusinessBriefGrader } from "./graders/daily-business-brief-grader";
import { graderActionsToPendingActions } from "./actions/to-pending-action";
import { formatGraderResultForWeChat } from "./format-grader-result-for-wechat";

/** 命中即走今日体检（而非普通 chat） */
const DAILY_BRIEF_TRIGGERS = [
  "今天有什么要跟进",
  "今天有哪些风险",
  "今天我应该先做什么",
  "今日体检",
  "今日简报",
  "业务体检",
  "销售体检",
];

export function isDailyBriefIntent(content: string): boolean {
  const text = (content ?? "").trim();
  if (!text) return false;
  return DAILY_BRIEF_TRIGGERS.some((t) => text.includes(t));
}

const FALLBACK_ERROR = "今天的体检暂时生成失败，我已经记录问题，请稍后再试。";

/**
 * 运行今日体检并返回可直接发回微信的文本。
 * 失败不抛出，返回友好错误文案（同时写 error log）。
 */
export async function runDailyBriefForWeChat(params: {
  userId: string;
  orgId: string | null;
  channel: string;
}): Promise<string> {
  const { userId, orgId, channel } = params;

  if (!orgId) {
    return "无法解析所属组织，请先在『设置 / 微信』完成账号与组织绑定后重试。";
  }

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const role = user?.role ?? "user";

    const result = await runDailyBusinessBriefGrader({ orgId, userId, role });

    // suggestedActions → PendingAction 草稿（复用现有审批链路，最多 3 个）
    const adapted = await graderActionsToPendingActions(
      result.suggestedActions,
      { orgId, userId, channel },
      { limit: 3 },
    );

    const text = formatGraderResultForWeChat(result, adapted);

    // 留痕（复用 AuditLog，不新建 Grader 专用表）
    logAudit({
      userId,
      orgId,
      action: "ai_daily_brief",
      targetType: "ai_grader",
      afterData: {
        intent: "DAILY_BRIEF",
        channel,
        score: result.score,
        riskLevel: result.riskLevel,
        issueCount: result.issues.length,
        actionCount: adapted.filter((a) => a.ok && a.actionId).length,
      },
    }).catch(() => {});

    return text;
  } catch (e) {
    console.error("[DailyBrief] 生成失败:", e);
    return FALLBACK_ERROR;
  }
}
