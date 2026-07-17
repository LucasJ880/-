import { SEVERITY_WEIGHT } from "./constants";

export interface PlanFinding {
  id: string;
  dimension: string;
  severity: string;
  title: string;
  description?: string | null;
}

export interface GeneratedPlanItem {
  dayOffset: number;
  dueDate: Date;
  category: "repair" | "content" | "growth" | "experiment";
  title: string;
  description: string | null;
  priority: "urgent" | "high" | "medium" | "low";
  findingId: string | null;
}

function categoryForDimension(dimension: string): GeneratedPlanItem["category"] {
  if (["WEBSITE", "LISTINGS", "SEO"].includes(dimension)) return "repair";
  if (["SOCIAL", "AI_VISIBILITY"].includes(dimension)) return "content";
  if (dimension === "REVIEWS") return "growth";
  return "experiment";
}

function priorityForSeverity(severity: string): GeneratedPlanItem["priority"] {
  if (severity === "critical") return "urgent";
  if (severity === "high") return "high";
  if (severity === "low") return "low";
  return "medium";
}

export function build30DayPlan(findings: PlanFinding[], startDate: Date): GeneratedPlanItem[] {
  const ranked = [...findings].sort(
    (a, b) => (SEVERITY_WEIGHT[b.severity] ?? 0) - (SEVERITY_WEIGHT[a.severity] ?? 0),
  );
  const items: GeneratedPlanItem[] = ranked.slice(0, 20).map((finding, index) => {
    const dayOffset = Math.min(27, Math.floor(index / 2) * 3);
    const dueDate = new Date(startDate);
    dueDate.setDate(dueDate.getDate() + dayOffset);
    return {
      dayOffset,
      dueDate,
      category: categoryForDimension(finding.dimension),
      title: finding.title,
      description: finding.description ?? null,
      priority: priorityForSeverity(finding.severity),
      findingId: finding.id,
    };
  });

  const experimentDate = new Date(startDate);
  experimentDate.setDate(experimentDate.getDate() + 21);
  items.push({
    dayOffset: 21,
    dueDate: experimentDate,
    category: "experiment",
    title: "复盘前三周结果并启动下一轮赛马",
    description: "以有效线索和成交贡献为主指标，播放量仅作为辅助指标。",
    priority: "medium",
    findingId: null,
  });
  return items;
}
