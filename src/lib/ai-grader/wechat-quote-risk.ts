/**
 * 微信端「报价风险体检」编排（QUOTE_RISK / CHECK_QUOTE）
 *
 * 闭环：意图识别（GLOBAL / QUOTE）→ 报价解析（QUOTE 模式）→ 跑 QuoteRiskGrader
 * → 适配 suggestedActions 为 PendingAction → 格式化微信短文本（含编号动作）。
 *
 * 安全：全程只读 + 经 PendingAction 审批，不绕过 orgId / RBAC / data scope。
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import {
  runQuoteRiskGrader,
  resolveQuoteForRisk,
} from "./graders/quote-risk-grader";
import { graderActionsToPendingActions } from "./actions/to-pending-action";
import { formatGraderResultForWeChat } from "./format-grader-result-for-wechat";
import { writeGraderContext } from "./wechat-context";

export type QuoteRiskIntent =
  | { mode: "GLOBAL" }
  | { mode: "QUOTE"; quoteId?: string; customerName?: string };

/** GLOBAL 模式触发语 */
const GLOBAL_TRIGGERS = [
  "哪些报价有风险",
  "哪些报价要跟进",
  "哪些报价发出去没回复",
  "哪些报价客户看了没签",
  "哪些报价没人跟",
  "报价发出去后有没有人跟",
  "报价发出去有没有人跟",
];

/** 无名指代 → 请用户补充 */
const NAME_STOPWORDS = new Set([
  "这个", "那个", "这份", "那份", "客户", "报价", "他", "她", "它", "今天", "现在",
]);

const FALLBACK_ERROR = "报价风险体检暂时生成失败，我已经记录问题，请稍后再试。";
const NEED_TARGET_REPLY = "请告诉我具体客户或报价名称，例如：帮我检查 Lucas 的报价。";

/**
 * 识别是否为报价风险体检意图。返回 null 表示交回普通 AI chat。
 * 仅在出现「报价 / quote」关键词时才可能命中（避免误抢普通聊天）。
 */
export function detectQuoteRiskIntent(content: string): QuoteRiskIntent | null {
  const text = (content ?? "").trim();
  if (!text) return null;
  if (!/报价|quote/i.test(text)) return null; // 关键词闸门

  if (GLOBAL_TRIGGERS.some((t) => text.includes(t))) {
    return { mode: "GLOBAL" };
  }

  // P1: 帮我看/检查 X 的报价
  const p1 = text.match(
    /帮我(?:看一?下|看看|看|检查一?下|检查)\s*([^\s，,。.？?！!]{1,20}?)\s*(?:的)?报价/,
  );
  if (p1) return toQuoteIntent(p1[1]);

  // P2: X 的报价(有没有风险 / 怎么样 / 要不要跟 / 有没有人跟)
  const p2 = text.match(
    /([^\s，,。.？?！!]{1,20}?)\s*(?:的)?报价\s*(?:有没有风险|有风险吗|有风险么|怎么样|要不要跟|该不该跟|有没有人跟)/,
  );
  if (p2) return toQuoteIntent(p2[1]);

  // 无名指代："这个报价有没有风险" / "帮我检查报价" / "检查报价" → 澄清
  if (/这个报价|这份报价|该报价|帮我检查报价|检查报价|帮我看报价/.test(text)) {
    return { mode: "QUOTE" };
  }

  return null;
}

function toQuoteIntent(raw: string): QuoteRiskIntent {
  const name = (raw ?? "").trim().replace(/^[的了]/, "");
  if (!name || NAME_STOPWORDS.has(name)) return { mode: "QUOTE" };
  return { mode: "QUOTE", customerName: name };
}

/**
 * 运行报价风险体检并返回可直接发回微信的文本。失败不抛出。
 */
export async function runQuoteRiskForWeChat(params: {
  userId: string;
  orgId: string | null;
  channel: string;
  externalUserId?: string;
  intent: QuoteRiskIntent;
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

    let resolvedQuoteId: string | undefined;
    let resolvedCustomerName: string | undefined;
    let subject: string | undefined;

    if (intent.mode === "QUOTE") {
      const resolution = await resolveQuoteForRisk({
        orgId,
        userId,
        role,
        mode: "QUOTE",
        quoteId: intent.quoteId,
        customerName: intent.customerName,
      });
      switch (resolution.status) {
        case "need_target":
          return NEED_TARGET_REPLY;
        case "not_found":
          return intent.customerName
            ? `没有找到「${intent.customerName}」可检查的报价。`
            : "没有找到可检查的报价。";
        case "ambiguous":
          return (
            `找到多个匹配的客户：${resolution.candidates.map((c) => c.name).join("、")}。\n` +
            "请回复更完整的客户名称。"
          );
        case "ok":
          resolvedQuoteId = resolution.quoteId;
          resolvedCustomerName = resolution.customerName;
          subject = `客户：${resolution.customerName}`;
          break;
      }
    }

    const result = await runQuoteRiskGrader({
      orgId,
      userId,
      role,
      mode: intent.mode,
      quoteId: resolvedQuoteId,
    });

    // 写入短期上下文（解析成功才写真实 id/name）
    void writeGraderContext(
      { orgId, userId, channel, externalUserId },
      {
        lastGraderType: "QUOTE_RISK",
        lastIntent: intent.mode === "QUOTE" ? "CHECK_QUOTE" : "QUOTE_RISK",
        lastQuoteId: resolvedQuoteId,
        lastCustomerName: resolvedCustomerName,
      },
    );

    const adapted = await graderActionsToPendingActions(
      result.suggestedActions,
      { orgId, userId, channel },
      { limit: 3 },
    );

    const text = formatGraderResultForWeChat(result, adapted, {
      title: intent.mode === "QUOTE" ? "青砚报价体检" : "青砚报价风险体检",
      subject,
      issuesHeader: intent.mode === "QUOTE" ? "主要问题：" : "最需要处理：",
      emptyText: result.summary,
    });

    logAudit({
      userId,
      orgId,
      action: "ai_quote_risk_grader",
      targetType: "ai_grader",
      targetId: resolvedQuoteId,
      afterData: {
        intent: intent.mode === "QUOTE" ? "CHECK_QUOTE" : "QUOTE_RISK",
        channel,
        score: result.score,
        riskLevel: result.riskLevel,
        issueCount: result.issues.length,
        actionCount: adapted.filter((a) => a.ok && a.actionId).length,
      },
    }).catch(() => {});

    return text;
  } catch (e) {
    console.error("[QuoteRisk] 生成失败:", e);
    return FALLBACK_ERROR;
  }
}
