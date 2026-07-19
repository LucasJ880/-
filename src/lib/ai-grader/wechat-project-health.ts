/**
 * 微信端「项目风险体检」编排（PROJECT_HEALTH / CHECK_PROJECT）
 *
 * 闭环：意图识别（GLOBAL / PROJECT）→ 项目解析（PROJECT 模式）→ 跑 ProjectHealthGrader
 * → 适配 suggestedActions 为 PendingAction → 格式化微信短文本（含编号动作）。
 *
 * 安全：全程只读 + 经 PendingAction 审批，不绕过 orgId / RBAC / data scope。
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import {
  runProjectHealthGrader,
  resolveProjectForHealth,
} from "./graders/project-health-grader";
import { graderActionsToPendingActions } from "./actions/to-pending-action";
import { formatGraderResultForWeChat } from "./format-grader-result-for-wechat";
import { writeGraderContext } from "./wechat-context";

export type ProjectHealthIntent =
  | { mode: "GLOBAL" }
  | { mode: "PROJECT"; projectId?: string; projectName?: string };

/** GLOBAL 模式触发语 */
const GLOBAL_TRIGGERS = [
  "哪些项目有风险",
  "今天有哪些项目要处理",
  "哪些项目快到 deadline",
  "哪些项目快到deadline",
  "哪些项目快截止",
  "哪些项目要处理",
  "项目体检",
];

/** 无名指代 → 请用户补充 */
const NAME_STOPWORDS = new Set([
  "这个", "那个", "该", "项目", "这个项目", "该项目", "他", "她", "它", "今天", "现在",
]);

const FALLBACK_ERROR = "项目风险体检暂时生成失败，我已经记录问题，请稍后再试。";
const NEED_NAME_REPLY = "请告诉我具体项目名称，例如：帮我检查 W0103 项目。";

/**
 * 识别是否为项目风险体检意图。返回 null 表示交回普通 AI chat。
 * 仅在出现「项目 / project」关键词时才可能命中（避免误抢普通聊天）。
 */
export function detectProjectHealthIntent(content: string): ProjectHealthIntent | null {
  const text = (content ?? "").trim();
  if (!text) return null;
  if (!/项目|project/i.test(text)) return null; // 关键词闸门

  if (GLOBAL_TRIGGERS.some((t) => text.includes(t))) {
    return { mode: "GLOBAL" };
  }

  // P1: 帮我看/检查 X 这个?项目
  const p1 = text.match(
    /帮我(?:看一?下|看看|看|检查一?下|检查)\s*([^\s，,。.？?！!]{1,30}?)\s*(?:这个)?项目/,
  );
  if (p1) return toProjectIntent(p1[1]);

  // P2: X 项目 (现在)?(健康吗 / 有没有风险 / 怎么样)
  const p2 = text.match(
    /([^\s，,。.？?！!]{1,30}?)\s*项目\s*(?:现在)?\s*(?:健康吗|健不健康|健康么|有没有风险|有风险吗|有风险么|怎么样)/,
  );
  if (p2) return toProjectIntent(p2[1]);

  // 无名指代："这个项目怎么样" / "帮我检查项目" → 澄清
  if (/这个项目|该项目|帮我检查项目|检查项目|帮我看项目/.test(text)) {
    return { mode: "PROJECT" };
  }

  return null;
}

function toProjectIntent(raw: string): ProjectHealthIntent {
  const name = (raw ?? "").trim().replace(/^[的了]/, "");
  if (!name || NAME_STOPWORDS.has(name)) return { mode: "PROJECT" };
  return { mode: "PROJECT", projectName: name };
}

/**
 * 运行项目风险体检并返回可直接发回微信的文本。失败不抛出。
 */
export async function runProjectHealthForWeChat(params: {
  userId: string;
  orgId: string | null;
  channel: string;
  externalUserId?: string;
  intent: ProjectHealthIntent;
  agentRunId?: string;
}): Promise<string> {
  const { userId, orgId, channel, externalUserId, intent, agentRunId } = params;

  if (!orgId) {
    return "无法解析所属组织，请先在『设置 / 微信』完成账号与组织绑定后重试。";
  }

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const role = user?.role ?? "user";

    let resolvedProjectId: string | undefined;
    let resolvedProjectName: string | undefined;
    let subject: string | undefined;

    if (intent.mode === "PROJECT") {
      const resolution = await resolveProjectForHealth({
        orgId,
        userId,
        role,
        mode: "PROJECT",
        projectId: intent.projectId,
        projectName: intent.projectName,
      });
      switch (resolution.status) {
        case "need_name":
          return NEED_NAME_REPLY;
        case "not_found":
          return `没有找到项目「${intent.projectName ?? ""}」，请确认名称是否正确。`;
        case "ambiguous":
          return (
            `找到多个匹配的项目：${resolution.candidates.map((c) => c.name).join("、")}。\n` +
            "请回复更完整的项目名称。"
          );
        case "ok":
          resolvedProjectId = resolution.projectId;
          resolvedProjectName = resolution.projectName;
          subject = `项目：${resolution.projectName}`;
          break;
      }
    }

    const result = await runProjectHealthGrader({
      orgId,
      userId,
      role,
      mode: intent.mode,
      projectId: resolvedProjectId,
    });

    // 写入短期上下文（解析成功才写真实 id/name）
    void writeGraderContext(
      { orgId, userId, channel, externalUserId },
      {
        lastGraderType: "PROJECT_HEALTH",
        lastIntent: intent.mode === "PROJECT" ? "CHECK_PROJECT" : "PROJECT_HEALTH",
        lastProjectId: resolvedProjectId,
        lastProjectName: resolvedProjectName,
      },
    );

    const adapted = await graderActionsToPendingActions(
      result.suggestedActions,
      { orgId, userId, channel, agentRunId },
      { limit: 3 },
    );

    const text = formatGraderResultForWeChat(result, adapted, {
      title: intent.mode === "PROJECT" ? "青砚项目体检" : "青砚项目风险体检",
      subject,
      issuesHeader: intent.mode === "PROJECT" ? "主要问题：" : "最需要处理：",
      emptyText: result.summary,
    });

    logAudit({
      userId,
      orgId,
      action: "ai_project_health_grader",
      targetType: "ai_grader",
      targetId: resolvedProjectId,
      afterData: {
        intent: intent.mode === "PROJECT" ? "CHECK_PROJECT" : "PROJECT_HEALTH",
        channel,
        score: result.score,
        riskLevel: result.riskLevel,
        issueCount: result.issues.length,
        actionCount: adapted.filter((a) => a.ok && a.actionId).length,
      },
    }).catch(() => {});

    return text;
  } catch (e) {
    console.error("[ProjectHealth] 生成失败:", e);
    return FALLBACK_ERROR;
  }
}
