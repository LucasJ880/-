/**
 * 微信端「客户跟进体检」编排（CUSTOMER_FOLLOWUP / CHECK_CUSTOMER）
 *
 * 闭环：意图识别（GLOBAL / CUSTOMER）→ 客户解析（CUSTOMER 模式）→ 跑 CustomerFollowupGrader
 * → 适配 suggestedActions 为 PendingAction → 格式化微信短文本（含编号动作）。
 *
 * 安全：全程只读 + 经 PendingAction 审批，不绕过 orgId / RBAC / data scope。
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import {
  runCustomerFollowupGrader,
  resolveCustomerForFollowup,
} from "./graders/customer-followup-grader";
import { graderActionsToPendingActions } from "./actions/to-pending-action";
import { formatGraderResultForWeChat } from "./format-grader-result-for-wechat";
import { writeGraderContext } from "./wechat-context";

export type CustomerFollowupIntent =
  | { mode: "GLOBAL" }
  | { mode: "CUSTOMER"; customerId?: string; customerName?: string };

/** GLOBAL 模式触发语 */
const GLOBAL_TRIGGERS = [
  "哪些客户该联系",
  "哪些客户要跟进",
  "哪些客户需要跟进",
  "哪些客户该跟进",
  "今天要跟哪些客户",
  "今天跟哪些客户",
  "哪些客户要联系",
];

/** 指代型词，命中时视为"未给客户名"，请用户补充 */
const NAME_STOPWORDS = new Set([
  "这个客户",
  "该客户",
  "这位客户",
  "那个客户",
  "那位客户",
  "客户",
  "这个",
  "那个",
  "他",
  "她",
  "它",
  "今天",
  "现在",
]);

const FALLBACK_ERROR = "客户跟进体检暂时生成失败，我已经记录问题，请稍后再试。";

/**
 * 识别是否为客户跟进体检意图。返回 null 表示交回普通 AI chat。
 */
export function detectCustomerFollowupIntent(
  content: string,
): CustomerFollowupIntent | null {
  const text = (content ?? "").trim();
  if (!text) return null;

  if (GLOBAL_TRIGGERS.some((t) => text.includes(t))) {
    return { mode: "GLOBAL" };
  }

  // P1: 帮我看 / 帮我检查 X（需"帮我"前缀，避免误抢普通聊天）
  const p1 = text.match(
    /帮我(?:看一?下|看看|看|检查一?下|检查)\s*([^\s，,。.？?！!]{1,20})/,
  );
  if (p1) return toCustomerIntent(p1[1]);

  // P2: X 现在要不要跟 / 该不该跟（显式"跟"意图）
  const p2 = text.match(
    /([^\s，,。.？?！!]{1,20})\s*(?:现在)?\s*(?:要不要跟|该不该跟|需不需要跟|要跟吗|跟不跟)/,
  );
  if (p2) return toCustomerIntent(p2[1]);

  // P3: X (现在)?(怎么样|什么情况|有风险吗)——仅当出现"客户"关键词时才触发
  if (text.includes("客户")) {
    const p3 = text.match(
      /([^\s，,。.？?！!]{1,20})\s*(?:现在)?\s*(?:是什么情况|什么情况|怎么样|有没有风险|有风险吗|有风险么)/,
    );
    if (p3) return toCustomerIntent(p3[1]);
  }

  return null;
}

function toCustomerIntent(raw: string): CustomerFollowupIntent {
  const name = (raw ?? "").trim().replace(/^[的了]/, "");
  if (!name || NAME_STOPWORDS.has(name)) {
    return { mode: "CUSTOMER" }; // 无有效名 → 走 need_name 澄清
  }
  return { mode: "CUSTOMER", customerName: name };
}

/**
 * 运行客户跟进体检并返回可直接发回微信的文本。失败不抛出。
 */
export async function runCustomerFollowupForWeChat(params: {
  userId: string;
  orgId: string | null;
  channel: string;
  externalUserId?: string;
  intent: CustomerFollowupIntent;
}): Promise<string> {
  const { userId, orgId, channel, externalUserId, intent } = params;

  if (!orgId) {
    return "无法解析所属组织，请先在『设置 / 微信』完成账号与组织绑定后重试。";
  }

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const role = user?.role ?? "user";

    let resolvedCustomerId: string | undefined;
    let resolvedCustomerName: string | undefined;
    let subject: string | undefined;

    if (intent.mode === "CUSTOMER") {
      const resolution = await resolveCustomerForFollowup({
        orgId,
        userId,
        role,
        mode: "CUSTOMER",
        customerId: intent.customerId,
        customerName: intent.customerName,
      });
      switch (resolution.status) {
        case "need_name":
          return "请告诉我具体的客户名称，例如：帮我看 Lucas。";
        case "not_found":
          return `没有找到客户「${intent.customerName ?? ""}」，请确认名称是否正确。`;
        case "ambiguous":
          return (
            `找到多个匹配的客户：${resolution.candidates.map((c) => c.name).join("、")}。\n` +
            "请回复更完整的客户名称。"
          );
        case "ok":
          resolvedCustomerId = resolution.customerId;
          resolvedCustomerName = resolution.customerName;
          subject = `客户：${resolution.customerName}`;
          break;
      }
    }

    const result = await runCustomerFollowupGrader({
      orgId,
      userId,
      role,
      mode: intent.mode,
      customerId: resolvedCustomerId,
    });

    // 写入短期上下文（解析成功才写真实 id/name）
    void writeGraderContext(
      { orgId, userId, channel, externalUserId },
      {
        lastGraderType: "CUSTOMER_FOLLOWUP",
        lastIntent: intent.mode === "CUSTOMER" ? "CHECK_CUSTOMER" : "CUSTOMER_FOLLOWUP",
        lastCustomerId: resolvedCustomerId,
        lastCustomerName: resolvedCustomerName,
      },
    );

    const adapted = await graderActionsToPendingActions(
      result.suggestedActions,
      { orgId, userId, channel },
      { limit: 3 },
    );

    const text = formatGraderResultForWeChat(result, adapted, {
      title: intent.mode === "CUSTOMER" ? "青砚客户体检" : "青砚客户跟进体检",
      subject,
      issuesHeader: intent.mode === "CUSTOMER" ? "主要问题：" : "最需要跟进：",
      emptyText: result.summary,
    });

    logAudit({
      userId,
      orgId,
      action: "ai_customer_followup_grader",
      targetType: "ai_grader",
      targetId: resolvedCustomerId,
      afterData: {
        intent: intent.mode === "CUSTOMER" ? "CHECK_CUSTOMER" : "CUSTOMER_FOLLOWUP",
        channel,
        score: result.score,
        riskLevel: result.riskLevel,
        issueCount: result.issues.length,
        actionCount: adapted.filter((a) => a.ok && a.actionId).length,
      },
    }).catch(() => {});

    return text;
  } catch (e) {
    console.error("[CustomerFollowup] 生成失败:", e);
    return FALLBACK_ERROR;
  }
}
