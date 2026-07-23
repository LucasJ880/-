/**
 * 场景：今日业务简报（只读，不自动创建 PendingAction）
 */

import { runDailyBusinessBriefGrader } from "@/lib/ai-grader/graders/daily-business-brief-grader";
import { resolveSalesScope } from "@/lib/sales/org-context";
import type { AuthUser } from "@/lib/auth";
import type { AssistantScenarioResult, ScenarioContext } from "./types";
import { friendlyScenarioError } from "./types";

function countByCategory(
  issues: Array<{ category: string; severity: string }>,
): Record<string, number> {
  const counts = {
    followups: 0,
    overdue: 0,
    quoteRisks: 0,
    projectRisks: 0,
    pendingApprovals: 0,
  };
  for (const i of issues) {
    if (
      ["followup_due", "stale_opportunity", "new_lead_stale"].includes(i.category)
    ) {
      counts.followups += 1;
    } else if (["order_overdue"].includes(i.category)) {
      counts.overdue += 1;
    } else if (["quote_pending", "viewed_not_signed"].includes(i.category)) {
      counts.quoteRisks += 1;
    } else if (i.category.startsWith("project")) {
      counts.projectRisks += 1;
    }
  }
  return counts;
}

export function formatDailyBriefContent(input: {
  summary: string;
  issues: Array<{ title: string; severity: string; category: string }>;
  score: number;
}): { text: string; workSuggestion: Record<string, unknown> } {
  const counts = countByCategory(input.issues);
  const lines: string[] = [];

  if (input.issues.length === 0) {
    lines.push("今日暂无明显风险事项，可以按计划推进。");
  } else {
    lines.push(`今日有 ${input.issues.length} 项需要关注：`);
    lines.push("");
    input.issues.slice(0, 5).forEach((item, idx) => {
      lines.push(`${idx + 1}. ${item.title}`);
    });
  }

  lines.push("");
  lines.push(input.summary);
  lines.push("");
  lines.push("以上为只读简报。如需创建提醒、更新跟进或邮件草稿，请明确告诉我具体动作。");

  return {
    text: lines.join("\n"),
    workSuggestion: {
      type: "daily_business_brief",
      score: input.score,
      counts,
      items: input.issues.slice(0, 8).map((i) => ({
        title: i.title,
        severity: i.severity,
        category: i.category,
      })),
    },
  };
}

export async function runDailyBriefScenario(
  ctx: ScenarioContext,
  user: Pick<AuthUser, "id" | "role">,
): Promise<AssistantScenarioResult> {
  try {
    const scope = await resolveSalesScope(
      { id: user.id, role: user.role } as AuthUser,
      ctx.orgId,
      "sales.customer.read",
    );

    if (!scope.allowed) {
      // 无权模块：不展示数量、不暗示敏感存在性
      return {
        kind: "completed",
        assistantContent:
          "今日业务简报已生成。\n\n当前账号没有可展示的销售业务模块数据。如需其他帮助，可以直接问我。",
        resultSummary: "brief_no_sales_access",
        workSuggestion: {
          type: "daily_business_brief",
          counts: {
            followups: 0,
            overdue: 0,
            quoteRisks: 0,
            projectRisks: 0,
            pendingApprovals: 0,
          },
          items: [],
        },
      };
    }

    const result = await runDailyBusinessBriefGrader({
      orgId: ctx.orgId,
      userId: ctx.userId,
      role: ctx.role,
    });

    const formatted = formatDailyBriefContent({
      summary: result.summary,
      score: result.score,
      issues: result.issues.map((i) => ({
        title: i.title,
        severity: i.severity,
        category: i.category,
      })),
    });

    // 明确：只读简报不自动创建写动作 PendingAction
    return {
      kind: "completed",
      assistantContent: formatted.text,
      resultSummary: `brief_score_${result.score}`,
      workSuggestion: formatted.workSuggestion,
    };
  } catch (e) {
    console.error("[scenario.daily-brief]", e);
    return {
      kind: "failed",
      assistantContent: friendlyScenarioError("GRADER_FAILED"),
      errorCode: "GRADER_FAILED",
    };
  }
}
