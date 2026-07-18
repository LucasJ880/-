import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { createNotification } from "@/lib/notifications/create";
import { pushMessage } from "@/lib/messaging/gateway";
import { createDraft } from "@/lib/pending-actions/drafts";
import { ensureGrowthCenterProject, resolveMarketingLeader } from "./team";

export interface ResearchPlanDraftItem {
  dayOffset: number;
  category: "growth" | "experiment";
  title: string;
  description: string;
  priority: "high" | "medium";
  successMetric: string;
  targetValue: string;
  stopCondition: string;
  evidenceSummary: string;
  confidence: number;
}

function section(markdown: string, title: string) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^##\\s+${escaped}\\s*\\r?\\n`, "mi");
  const match = heading.exec(markdown);
  if (!match) return "";
  const tail = markdown.slice(match.index + match[0].length);
  const nextHeading = tail.search(/^##\s+/m);
  return tail.slice(0, nextHeading < 0 ? undefined : nextHeading).trim();
}

function cleanLine(value: string) {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)、]\s*/, "")
    .replace(/^\*\*(.*?)\**:?\s*/, "$1：")
    .replace(/\*\*/g, "")
    .trim();
}

function candidateLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^(###\s+|[-*+]\s+|\d+[.)、]\s*)/.test(line))
    .map(cleanLine)
    .filter((line) => line.length >= 4 && line.length <= 240);
}

function short(value: string, max: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

/** 纯函数：把报告中的机会与首个实验变成可审批的执行草案。 */
export function buildResearchPlanDraft(markdown: string, objective: string): ResearchPlanDraftItem[] {
  const opportunities = section(markdown, "优先机会（最多3个）") || section(markdown, "优先机会");
  const experiment = section(markdown, "第一个增长实验");
  const evidence = section(markdown, "证据与判断");
  const evidenceSummary = short(evidence || "来自本次市场研究报告，批准前需由 Leader 复核证据。", 500);
  const titles = [...new Set(candidateLines(opportunities))].slice(0, 3);
  const items: ResearchPlanDraftItem[] = titles.map((title, index) => ({
    dayOffset: [3, 7, 14][index] ?? 14,
    category: "growth",
    title: short(title, 180),
    description: short(opportunities || objective, 1200),
    priority: index === 0 ? "high" : "medium",
    successMetric: "有效线索或下一漏斗阶段转化",
    targetValue: "由负责人基于当前基线确认",
    stopCondition: "连续两个检查周期无改善，或出现品牌/预算风险时暂停并复盘。",
    evidenceSummary,
    confidence: evidence ? 80 : 60,
  }));

  const experimentTitle = candidateLines(experiment)[0] || (experiment ? short(experiment, 180) : "验证本次研究的首个增长实验");
  items.push({
    dayOffset: 21,
    category: "experiment",
    title: short(experimentTitle, 180),
    description: short(experiment || `围绕“${objective}”设计最小可行实验，先确认基线、变量和数据口径。`, 1200),
    priority: "high",
    successMetric: "有效线索率 / 预约率 / 成交贡献",
    targetValue: "实验启动前由 Leader 与执行人共同确认",
    stopCondition: "样本达到预设下限后仍未优于基线，或成本超过审批阈值时停止。",
    evidenceSummary,
    confidence: experiment ? 80 : 55,
  });
  return items.slice(0, 4);
}

function inputRecord(value: Prisma.JsonValue): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, typeof item === "string" ? item : String(item ?? "")]));
}

export async function createResearchPlanDraft(runId: string) {
  const run = await db.marketResearchRun.findUnique({ where: { id: runId } });
  if (!run || run.status !== "completed" || !run.outputMarkdown) return null;
  if (run.planId) return db.marketingPlan.findUnique({ where: { id: run.planId } });

  const variables = inputRecord(run.inputJson);
  const objective = variables.objective?.trim() || "执行本次市场研究建议";
  const project = await ensureGrowthCenterProject(run.orgId, run.createdById);
  const leaderId = await resolveMarketingLeader({
    orgId: run.orgId,
    projectId: project.id,
    requesterId: run.createdById,
  });
  const requester = await db.user.findUnique({
    where: { id: run.createdById },
    select: { name: true, email: true },
  });
  const requesterName = requester?.name || requester?.email || "团队成员";
  const startDate = new Date();
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 30);
  const draftItems = buildResearchPlanDraft(run.outputMarkdown, objective);

  let plan;
  try {
    plan = await db.marketingPlan.create({
      data: {
        orgId: run.orgId,
        projectId: project.id,
        sourceResearchRunId: run.id,
        name: `市场研究执行计划 · ${startDate.toISOString().slice(0, 10)}`,
        objective: objective.slice(0, 1000),
        startDate,
        endDate,
        status: "awaiting_approval",
        createdById: run.createdById,
        items: {
          create: draftItems.map((item) => {
            const dueDate = new Date(startDate);
            dueDate.setDate(dueDate.getDate() + item.dayOffset);
            return { ...item, orgId: run.orgId, ownerId: run.createdById, dueDate };
          }),
        },
      },
      include: { items: true },
    });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    plan = await db.marketingPlan.findUnique({
      where: { sourceResearchRunId: run.id },
      include: { items: true },
    });
    if (!plan) throw error;
  }

  if (plan.pendingActionId) return plan;
  const draft = await createDraft({
    type: "marketing.approve_research_plan",
    title: `审批研究运营计划：${short(objective, 80)}`,
    preview: [
      `提交人：${requesterName}`,
      `目标：${objective}`,
      `计划周期：30 天`,
      `执行项：${plan.items.map((item) => item.title).join("；")}`,
      "批准后才会创建并指派 Project Task。",
    ].join("\n"),
    payload: {
      planId: plan.id,
      researchRunId: run.id,
      projectId: project.id,
      requestedById: run.createdById,
      metadata: { orgId: run.orgId, targetType: "marketing_plan", targetId: plan.id },
    },
    userId: run.createdById,
    orgId: run.orgId,
    projectId: project.id,
    approverUserId: leaderId,
    requiredRole: "project_admin",
    ttlHours: 168,
  });
  const actionId = (draft.data as { actionId?: string } | undefined)?.actionId;
  if (!actionId) throw new Error("运营计划审批草稿创建失败");

  await db.$transaction([
    db.marketingPlan.update({ where: { id: plan.id }, data: { pendingActionId: actionId } }),
    db.marketResearchRun.update({
      where: { id: run.id },
      data: {
        projectId: project.id,
        planId: plan.id,
        pendingActionId: actionId,
        planStatus: "awaiting_approval",
        actionDraftJson: draft.data as object,
      },
    }),
  ]);
  await logAudit({
    userId: run.createdById,
    orgId: run.orgId,
    projectId: project.id,
    action: "market_research_plan_created",
    targetType: "marketing_plan",
    targetId: plan.id,
    afterData: { researchRunId: run.id, approverUserId: leaderId, itemCount: plan.items.length },
  });

  const leaderText = `【青砚运营审批】\n组员完成了市场研究并生成 30 天计划。\n目标：${short(objective, 120)}\n执行项：${plan.items.length}\n请前往增长中心审核；批准后才会创建任务。`;
  const requesterText = leaderId === run.createdById
    ? leaderText
    : `【青砚市场研究】\n报告已自动转成 30 天运营计划，正在等待 Leader 审批。\n目标：${short(objective, 120)}`;
  await Promise.allSettled([
    createNotification({
      userId: leaderId,
      type: "marketing_plan_approval_required",
      category: "marketing",
      title: "新的研究运营计划待审批",
      summary: short(objective, 200),
      entityType: "marketing_plan",
      entityId: plan.id,
      projectId: project.id,
      priority: "high",
      sourceKey: `marketing-plan:${plan.id}:leader`,
      metadata: { route: "/operations/growth", pendingActionId: actionId, researchRunId: run.id },
    }),
    pushMessage(leaderId, leaderText, { channels: ["personal_wechat", "wecom"] }),
    ...(leaderId === run.createdById ? [] : [
      createNotification({
        userId: run.createdById,
        type: "marketing_plan_awaiting_approval",
        category: "marketing",
        title: "研究报告已生成运营计划",
        summary: "计划已提交给 Leader 审批。",
        entityType: "marketing_plan",
        entityId: plan.id,
        projectId: project.id,
        priority: "medium",
        sourceKey: `marketing-plan:${plan.id}:requester`,
        metadata: { route: "/operations/growth", pendingActionId: actionId, researchRunId: run.id },
      }),
      pushMessage(run.createdById, requesterText, { channels: ["personal_wechat", "wecom"] }),
    ]),
  ]);
  return plan;
}
