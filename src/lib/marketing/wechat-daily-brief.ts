import { getMarketingDashboard } from "./query-dashboard";

export function formatMarketingDailyBrief(data: Awaited<ReturnType<typeof getMarketingDashboard>>): string {
  const money = new Intl.NumberFormat("en-CA", { style: "currency", currency: data.summary.currency, maximumFractionDigits: 0 }).format(data.summary.revenue);
  const lines = [
    "【青砚推广日报】",
    "",
    `市场存在度：${data.summary.marketPresence ?? "待体检"}${data.summary.marketPresence == null ? "" : "/100"}`,
    `增长执行力：${data.summary.growthExecution}/100`,
    `本月有效线索：${data.summary.effectiveLeads}`,
    `本月成交贡献：${money}`,
    `运行中实验：${data.summary.runningExperiments}`,
    `待审批内容：${data.summary.pendingContent}`,
    `待 Leader 审批计划：${data.summary.pendingTeamApprovals}`,
    "",
  ];
  if (data.pendingTeamApprovals.length > 0) {
    lines.push("待审批计划：");
    data.pendingTeamApprovals.slice(0, 3).forEach((approval, index) => {
      lines.push(`${index + 1}. ${approval.requester.name} 提交 · ${approval.title.replace(/^审批研究运营计划：/, "")}`);
    });
    lines.push("");
  }
  if (data.highPriorityFindings.length > 0) {
    lines.push("今日优先：");
    data.highPriorityFindings.slice(0, 3).forEach((finding, index) => lines.push(`${index + 1}. ${finding.title}`));
  } else {
    lines.push("今日优先：暂无高优先级营销问题");
  }
  lines.push("", "回复“推广日报”查看详情，所有发布与预算动作仍需人工审批。 ");
  return lines.join("\n").trim();
}

export async function buildMarketingDailyBrief(orgId: string): Promise<string> {
  return formatMarketingDailyBrief(await getMarketingDashboard(orgId));
}
