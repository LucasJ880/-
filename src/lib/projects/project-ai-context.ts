/**
 * 组装项目 AI 聊天 / 分析用的最小上下文（强制 org / 可见性由调用方保证）
 */

import { db } from "@/lib/db";

export type ProjectAiContextOptions = {
  /** 轻量模式：少文档正文、少关联数据，优先首字速度（快速对话） */
  light?: boolean;
};

export async function buildProjectAiContextBlock(
  projectId: string,
  options: ProjectAiContextOptions = {}
): Promise<string> {
  const light = Boolean(options.light);
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      orgId: true,
      name: true,
      description: true,
      category: true,
      location: true,
      clientOrganization: true,
      estimatedValue: true,
      ourBidPrice: true,
      winningBidPrice: true,
      currency: true,
      tenderStatus: true,
      aiAdviceStatus: true,
      projectTypes: true,
      solicitationNumber: true,
      closeDate: true,
      intelligence: {
        select: {
          summary: true,
          recommendation: true,
          riskLevel: true,
          structuredSummaryJson: true,
        },
      },
      documents: {
        orderBy: { createdAt: "desc" },
        take: light ? 5 : 12,
        select: light
          ? {
              title: true,
              fileType: true,
              parseStatus: true,
              aiSummaryJson: true,
            }
          : {
              title: true,
              fileType: true,
              parseStatus: true,
              contentText: true,
              aiSummaryJson: true,
            },
      },
      tasks: {
        where: { status: { not: "done" } },
        take: light ? 6 : 15,
        orderBy: { updatedAt: "desc" },
        select: { title: true, status: true, priority: true, dueDate: true },
      },
      quotes: {
        take: light ? 2 : 5,
        orderBy: { createdAt: "desc" },
        select: { title: true, status: true, totalAmount: true, currency: true },
      },
      inquiries: {
        take: light ? 2 : 5,
        orderBy: { createdAt: "desc" },
        select: { title: true, status: true },
      },
      insights: {
        where: { status: "confirmed" },
        take: light ? 5 : 20,
        orderBy: { updatedAt: "desc" },
        select: { kind: true, title: true, content: true },
      },
      similaritiesAsSource: {
        orderBy: { score: "desc" },
        take: light ? 2 : 5,
        select: {
          score: true,
          reasonsJson: true,
          impactText: true,
          recommendationsJson: true,
          redacted: true,
          similarProject: { select: { name: true, tenderStatus: true } },
        },
      },
      reviews: {
        where: { status: "confirmed" },
        take: 1,
        orderBy: { confirmedAt: "desc" },
        select: { outcome: true, narrative: true, reasonTagsJson: true },
      },
    },
  });

  if (!project) return "";

  const lines: string[] = [
    `projectId=${project.id}`,
    `【当前项目】${project.name}`,
    `（调用任何 project_* 工具时，projectId 必须填：${project.id}）`,
    project.description
      ? `描述：${project.description.slice(0, light ? 220 : 500)}`
      : "",
    project.clientOrganization ? `客户：${project.clientOrganization}` : "",
    project.location ? `地区：${project.location}` : "",
    project.category ? `品类：${project.category}` : "",
    project.solicitationNumber ? `标号：${project.solicitationNumber}` : "",
    project.tenderStatus ? `正式状态 tenderStatus=${project.tenderStatus}` : "",
    project.aiAdviceStatus
      ? `AI建议态 aiAdviceStatus=${project.aiAdviceStatus}（勿直接覆盖正式状态）`
      : "",
    project.estimatedValue != null
      ? `预估金额：${project.estimatedValue} ${project.currency || ""}`
      : "",
    project.ourBidPrice != null
      ? `我方报价：${project.ourBidPrice} ${project.currency || ""}`
      : "",
    project.winningBidPrice != null
      ? `中标价：${project.winningBidPrice} ${project.currency || ""}`
      : "",
  ].filter(Boolean);

  if (project.intelligence?.summary) {
    lines.push(`AI摘要：${project.intelligence.summary}`);
  }
  if (project.intelligence?.structuredSummaryJson && !light) {
    lines.push(
      `结构化摘要：${project.intelligence.structuredSummaryJson.slice(0, 2500)}`,
    );
  }

  if (project.documents.length) {
    lines.push("【已上传文件】");
    for (const d of project.documents) {
      const contentText =
        "contentText" in d && typeof d.contentText === "string"
          ? d.contentText
          : "";
      const snippet = light
        ? d.aiSummaryJson?.slice(0, 80) || ""
        : d.aiSummaryJson?.slice(0, 200) ||
          contentText.slice(0, 200) ||
          "(无文本摘要)";
      lines.push(
        snippet
          ? `- ${d.title} [${d.fileType}/${d.parseStatus}] ${snippet}`
          : `- ${d.title} [${d.fileType}/${d.parseStatus}]`
      );
    }
  }

  if (project.tasks.length) {
    lines.push("【未完成任务】");
    for (const t of project.tasks) {
      lines.push(
        `- ${t.title} (${t.status}/${t.priority})${t.dueDate ? ` due=${t.dueDate.toISOString().slice(0, 10)}` : ""}`,
      );
    }
  }

  if (project.quotes.length) {
    lines.push("【项目报价】");
    for (const q of project.quotes) {
      lines.push(
        `- ${q.title || "报价"} status=${q.status} total=${q.totalAmount ?? "-"} ${q.currency || ""}`,
      );
    }
  }

  if (project.inquiries.length) {
    lines.push("【询价】");
    for (const i of project.inquiries) {
      lines.push(`- ${i.title || "询价"} status=${i.status}`);
    }
  }

  if (project.insights.length) {
    lines.push("【已确认经验/结论】");
    for (const i of project.insights) {
      lines.push(`- [${i.kind}] ${i.title}: ${i.content.slice(0, 300)}`);
    }
  }

  if (project.similaritiesAsSource.length) {
    lines.push("【相似历史项目】");
    for (const s of project.similaritiesAsSource) {
      const name = s.redacted
        ? "（脱敏同类项目）"
        : s.similarProject.name;
      lines.push(
        `- ${name} score=${s.score} status=${s.similarProject.tenderStatus || "-"}`,
      );
      if (s.impactText) lines.push(`  影响：${s.impactText.slice(0, 300)}`);
      if (s.recommendationsJson) {
        lines.push(`  建议：${s.recommendationsJson.slice(0, 400)}`);
      }
    }
  }

  if (project.reviews[0]) {
    lines.push(
      `【已确认复盘】outcome=${project.reviews[0].outcome} ${project.reviews[0].narrative?.slice(0, 500) || ""}`,
    );
  }

  try {
    const { buildActiveOrgRulesBlock } = await import("@/lib/projects/org-rules");
    const rulesBlock = await buildActiveOrgRulesBlock(project.orgId);
    if (rulesBlock) lines.push(rulesBlock);
  } catch {
    /* ignore */
  }

  lines.push(
    "规则：优先使用以上已有信息与企业已确认规则；不要让用户重复提供；不要自动改正式报价或对外发送文件；不得把 AI 推测直接当正式企业规则。",
  );

  return lines.join("\n");
}
