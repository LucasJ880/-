/**
 * 内部成员加入项目时生成加入简报（幂等：同 user+project 复用）
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";

export async function ensureProjectJoinBrief(input: {
  orgId: string;
  projectId: string;
  userId: string;
  roleHint?: string;
  actorUserId: string;
}): Promise<{ id: string; created: boolean; briefMarkdown: string }> {
  const existing = await db.projectJoinBrief.findUnique({
    where: {
      projectId_userId: {
        projectId: input.projectId,
        userId: input.userId,
      },
    },
  });
  if (existing) {
    return {
      id: existing.id,
      created: false,
      briefMarkdown: existing.briefMarkdown,
    };
  }

  const project = await db.project.findFirst({
    where: { id: input.projectId, orgId: input.orgId },
    select: {
      name: true,
      bidPhaseStatus: true,
      tenderStatus: true,
      closeDate: true,
      clientOrganization: true,
      owner: { select: { name: true } },
      intelligenceRoom: {
        select: {
          summaryText: true,
          goDecision: true,
          modules: {
            where: { moduleKey: "commercial_judgment" },
            select: { dataJson: true },
          },
        },
      },
      documents: {
        take: 5,
        orderBy: { createdAt: "desc" },
        select: { title: true },
      },
      tasks: {
        where: {
          assigneeId: input.userId,
          status: { notIn: ["done", "cancelled"] },
        },
        take: 10,
        select: { title: true, dueDate: true },
      },
    },
  });

  if (!project) {
    throw new Error("项目不存在或不属于该组织");
  }

  const lines = [
    `# 加入项目简报 — ${project.name}`,
    ``,
    `## 项目是什么`,
    `- 名称：${project.name}`,
    `- 采购机构：${project.clientOrganization || "暂时未知"}`,
    `- 负责人：${project.owner?.name || "未指定"}`,
    `- 当前阶段：${project.bidPhaseStatus || project.tenderStatus || "DISCOVERED"}`,
    `- Go/Hold/No-Go：${project.intelligenceRoom?.goDecision || "未决定"}`,
    ``,
    `## 当前做到哪里`,
    project.intelligenceRoom?.summaryText || "调查尚未启动或摘要未生成。",
    ``,
    `## 你的角色`,
    input.roleHint || "项目贡献者（内部成员）",
    ``,
    `## 你负责的任务`,
  ];
  if (project.tasks.length === 0) {
    lines.push("- （暂无指派给你的未完成任务）");
  } else {
    for (const t of project.tasks) {
      lines.push(
        `- ${t.title}${t.dueDate ? `（截止 ${t.dueDate.toISOString().slice(0, 10)}）` : ""}`,
      );
    }
  }
  lines.push(``, `## 必须先阅读的文件`);
  if (project.documents.length === 0) {
    lines.push("- （暂无上传文件）");
  } else {
    for (const d of project.documents) {
      lines.push(`- ${d.title}`);
    }
  }
  lines.push(
    ``,
    `## 截止时间`,
    project.closeDate
      ? `- ${project.closeDate.toISOString().slice(0, 10)}`
      : "- 暂时未知",
    ``,
    `## 当前阻塞`,
    `- 请在调查室查看「重大阻塞」与商业判断模块`,
  );

  const briefMarkdown = lines.join("\n");

  try {
    const created = await db.projectJoinBrief.create({
      data: {
        orgId: input.orgId,
        projectId: input.projectId,
        userId: input.userId,
        roleHint: input.roleHint ?? null,
        briefMarkdown,
      },
    });
    await logAudit({
      userId: input.actorUserId,
      orgId: input.orgId,
      projectId: input.projectId,
      action: "project_join_brief_created",
      targetType: "project_join_brief",
      targetId: created.id,
      afterData: { forUserId: input.userId },
    });
    return { id: created.id, created: true, briefMarkdown };
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: string }).code)
        : "";
    if (code === "P2002") {
      const again = await db.projectJoinBrief.findUniqueOrThrow({
        where: {
          projectId_userId: {
            projectId: input.projectId,
            userId: input.userId,
          },
        },
      });
      return {
        id: again.id,
        created: false,
        briefMarkdown: again.briefMarkdown,
      };
    }
    throw err;
  }
}
