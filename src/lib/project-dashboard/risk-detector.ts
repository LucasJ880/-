import type { DashboardOverview, DashboardQuality, DashboardRuntime, RiskItem } from "./types";

let _id = 0;
function rid(): string {
  return `risk_${++_id}`;
}

export function detectRisks(
  overview: DashboardOverview,
  quality: DashboardQuality,
  runtime: DashboardRuntime
): RiskItem[] {
  _id = 0;
  const risks: RiskItem[] = [];

  if (overview.lowScoreCount.current > 0 && overview.lowScoreCount.deltaPercent > 20) {
    risks.push({
      id: rid(),
      level: overview.lowScoreCount.deltaPercent > 50 ? "high" : "medium",
      title: "低分评估上升",
      description: `近期低分评估 ${overview.lowScoreCount.current} 次，较上周期增长 ${overview.lowScoreCount.deltaPercent}%，建议排查 Prompt 或知识库变更`,
      metric: `${overview.lowScoreCount.current} 次 (+${overview.lowScoreCount.deltaPercent}%)`,
    });
  }

  if (overview.runtimeFailures.current > 0 && overview.runtimeFailures.deltaPercent > 20) {
    risks.push({
      id: rid(),
      level: overview.runtimeFailures.deltaPercent > 50 ? "high" : "medium",
      title: "Runtime 失败增加",
      description: `近期运行失败 ${overview.runtimeFailures.current} 次，较上周期增长 ${overview.runtimeFailures.deltaPercent}%，建议检查工具调用链路`,
      metric: `${overview.runtimeFailures.current} 次 (+${overview.runtimeFailures.deltaPercent}%)`,
    });
  }

  if (overview.openFeedbacks > 10) {
    risks.push({
      id: rid(),
      level: overview.openFeedbacks > 20 ? "high" : "medium",
      title: "未处理反馈积压",
      description: `当前有 ${overview.openFeedbacks} 条未处理反馈，建议尽快归类和处理`,
      metric: `${overview.openFeedbacks} 条待处理`,
    });
  }

  if (overview.highPriorityNotifications > 5) {
    risks.push({
      id: rid(),
      level: "medium",
      title: "高优通知积压",
      description: `当前有 ${overview.highPriorityNotifications} 条高优先级通知未读，建议关注`,
      metric: `${overview.highPriorityNotifications} 条未读`,
    });
  }

  if (
    overview.avgAutoScore.current > 0 &&
    overview.avgAutoScore.previous > 0 &&
    overview.avgAutoScore.delta < -0.5
  ) {
    risks.push({
      id: rid(),
      level: Math.abs(overview.avgAutoScore.delta) > 1 ? "high" : "medium",
      title: "自动评估平均分下降",
      description: `评估平均分从 ${overview.avgAutoScore.previous} 降至 ${overview.avgAutoScore.current}，质量可能出现波动`,
      metric: `${overview.avgAutoScore.current} (${overview.avgAutoScore.delta > 0 ? "+" : ""}${overview.avgAutoScore.delta})`,
    });
  }

  if (runtime.successRate < 90 && runtime.totalRuns > 5) {
    risks.push({
      id: rid(),
      level: runtime.successRate < 70 ? "high" : "medium",
      title: "Runtime 成功率偏低",
      description: `当前成功率 ${runtime.successRate}%，低于预期水平`,
      metric: `${runtime.successRate}%`,
    });
  }

  if (
    overview.recentConversations.current === 0 &&
    overview.recentConversations.previous > 5
  ) {
    risks.push({
      id: rid(),
      level: "low",
      title: "会话量异常下滑",
      description: `近期无新增会话，上周期为 ${overview.recentConversations.previous} 次，可能存在服务异常或使用中断`,
      metric: `0 次 (上周期 ${overview.recentConversations.previous})`,
    });
  }

  if (
    overview.recentConversations.deltaPercent > 200 &&
    overview.recentConversations.current > 20
  ) {
    risks.push({
      id: rid(),
      level: "low",
      title: "会话量异常激增",
      description: `近期会话 ${overview.recentConversations.current} 次，增长 ${overview.recentConversations.deltaPercent}%，建议关注是否为异常流量`,
      metric: `${overview.recentConversations.current} 次 (+${overview.recentConversations.deltaPercent}%)`,
    });
  }

  if (quality.issueDistribution.length > 0) {
    const top = quality.issueDistribution.sort((a, b) => b.count - a.count)[0];
    if (top.count > 5) {
      risks.push({
        id: rid(),
        level: "low",
        title: `高频问题类型：${top.type}`,
        description: `近期出现 ${top.count} 次「${top.type}」类反馈，占比突出`,
        metric: `${top.count} 次`,
      });
    }
  }

  risks.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.level] - order[b.level];
  });

  return risks;
}
