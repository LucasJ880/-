/**
 * 「确认进入投标调查」— 幂等事务
 * 重复点击：复用唯一调查室，补齐缺失模块/任务，不重复创建。
 */

import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import {
  INTELLIGENCE_MODULES,
  TASK_TEMPLATE_KEYS,
  type BidPhaseStatus,
} from "./constants";
import { resolveBidPhaseOnIntelligenceStart } from "./phase-transition";
import { buildInitialSummary } from "./summary";

export type StartIntelligenceInput = {
  orgId: string;
  projectId: string;
  actorUserId: string;
};

export type StartIntelligenceResult = {
  ok: true;
  created: boolean;
  roomId: string;
  correlationId: string;
  bidPhaseStatus: BidPhaseStatus;
  modulesEnsured: number;
  tasksCreated: number;
  summaryText: string;
};

export class StartIntelligenceError extends Error {
  constructor(
    message: string,
    public code:
      | "PROJECT_NOT_FOUND"
      | "ORG_MISMATCH"
      | "NOT_TENDER_DOMAIN"
      | "FORBIDDEN",
  ) {
    super(message);
    this.name = "StartIntelligenceError";
  }
}

export async function startBidIntelligence(
  input: StartIntelligenceInput,
): Promise<StartIntelligenceResult> {
  const project = await db.project.findFirst({
    where: { id: input.projectId },
    select: {
      id: true,
      orgId: true,
      name: true,
      workDomain: true,
      tenderStatus: true,
      aiAdviceStatus: true,
      clientOrganization: true,
      solicitationNumber: true,
      closeDate: true,
      questionCloseDate: true,
      estimatedValue: true,
      currency: true,
      description: true,
      location: true,
      ownerId: true,
      bidPhaseStatus: true,
      intelligence: {
        select: {
          summary: true,
          structuredSummaryJson: true,
          recommendation: true,
          riskLevel: true,
        },
      },
      documents: {
        take: 15,
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, aiSummaryJson: true },
      },
      owner: { select: { id: true, name: true } },
    },
  });

  if (!project) {
    throw new StartIntelligenceError("项目不存在", "PROJECT_NOT_FOUND");
  }
  if (!project.orgId || project.orgId !== input.orgId) {
    throw new StartIntelligenceError("组织不匹配", "ORG_MISMATCH");
  }
  if (project.workDomain !== "tender" && project.workDomain !== "general") {
    // general 允许升级进入调查（保守：允许；delivery 禁止）
    if (project.workDomain === "delivery") {
      throw new StartIntelligenceError(
        "执行项目不可进入投标调查",
        "NOT_TENDER_DOMAIN",
      );
    }
  }

  const correlationId = randomUUID();
  const summary = buildInitialSummary(project);
  const phaseResolution = resolveBidPhaseOnIntelligenceStart(
    project.bidPhaseStatus,
  );

  const result = await db.$transaction(async (tx) => {
    let created = false;
    let room = await tx.bidIntelligenceRoom.findUnique({
      where: { projectId: project.id },
    });

    if (!room) {
      try {
        room = await tx.bidIntelligenceRoom.create({
          data: {
            orgId: input.orgId,
            projectId: project.id,
            status: "active",
            summaryText: summary.text,
            summaryJson: summary.json as object,
            summaryStatus: summary.status,
            startedById: input.actorUserId,
            correlationId,
          },
        });
        created = true;
      } catch (err) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: string }).code)
            : "";
        if (code !== "P2002") throw err;
        room = await tx.bidIntelligenceRoom.findUniqueOrThrow({
          where: { projectId: project.id },
        });
      }
    } else if (!room.summaryText) {
      room = await tx.bidIntelligenceRoom.update({
        where: { id: room.id },
        data: {
          summaryText: summary.text,
          summaryJson: summary.json as object,
          summaryStatus: summary.status,
        },
      });
    }

    let modulesEnsured = 0;
    for (const mod of INTELLIGENCE_MODULES) {
      const existing = await tx.bidIntelligenceModule.findUnique({
        where: {
          roomId_moduleKey: { roomId: room.id, moduleKey: mod.key },
        },
      });
      if (!existing) {
        await tx.bidIntelligenceModule.create({
          data: {
            roomId: room.id,
            moduleKey: mod.key,
            title: mod.title,
            status: "unknown",
            sortOrder: mod.sortOrder,
            dataJson: seedModuleData(mod.key, project, summary),
          },
        });
        modulesEnsured += 1;
      }
    }

    const projectUpdate: {
      bidPhaseStatus?: string;
      workDomain?: string;
    } = {};
    if (phaseResolution.shouldWrite) {
      projectUpdate.bidPhaseStatus = phaseResolution.bidPhaseStatus;
    }
    if (project.workDomain === "general") {
      projectUpdate.workDomain = "tender";
    }
    if (Object.keys(projectUpdate).length > 0) {
      await tx.project.update({
        where: { id: project.id },
        data: projectUpdate,
      });
    }

    let tasksCreated = 0;
    const taskSpecs: Array<{
      templateKey: string;
      title: string;
      description: string;
    }> = [
      {
        templateKey: TASK_TEMPLATE_KEYS.summary,
        title: "[投标调查] 生成初步项目摘要",
        description: "阅读招标文件与情报，完善调查室「项目理解」模块。",
      },
      {
        templateKey: TASK_TEMPLATE_KEYS.historical,
        title: "[投标调查] 历史采购调查",
        description: "查找同采购机构/同类产品历史中标与合同金额。",
      },
      {
        templateKey: TASK_TEMPLATE_KEYS.supplier_match,
        title: "[投标调查] 供应商匹配",
        description: "匹配国内候选厂家并建立项目供应商关联。",
      },
      {
        templateKey: TASK_TEMPLATE_KEYS.go_analysis,
        title: "[投标调查] Go / Hold / No-Go 初步分析",
        description: "完成商业判断模块草稿，供负责人人工决定。",
      },
    ];

    for (const spec of taskSpecs) {
      const exists = await tx.task.findFirst({
        where: {
          projectId: project.id,
          sourceType: "bid_intelligence",
          sourceTemplateKey: spec.templateKey,
        },
        select: { id: true },
      });
      if (exists) continue;
      await tx.task.create({
        data: {
          title: spec.title,
          description: spec.description,
          status: "todo",
          priority: "high",
          projectId: project.id,
          creatorId: input.actorUserId,
          assigneeId: project.ownerId,
          sourceType: "bid_intelligence",
          sourceId: room.id,
          sourceTemplateKey: spec.templateKey,
          sourceBatchKey: `bid_intel:${project.id}`,
        },
      });
      tasksCreated += 1;
    }

    return {
      created,
      roomId: room.id,
      modulesEnsured,
      tasksCreated,
    };
  });

  await logAudit({
    userId: input.actorUserId,
    orgId: input.orgId,
    projectId: project.id,
    action: "bid_intelligence_started",
    targetType: "bid_intelligence_room",
    targetId: result.roomId,
    afterData: {
      correlationId,
      created: result.created,
      modulesEnsured: result.modulesEnsured,
      tasksCreated: result.tasksCreated,
      bidPhaseStatus: phaseResolution.bidPhaseStatus,
      phaseAdvanced: phaseResolution.advancedToIntelligence,
      phaseWritten: phaseResolution.shouldWrite,
    },
  });

  return {
    ok: true,
    created: result.created,
    roomId: result.roomId,
    correlationId,
    bidPhaseStatus: phaseResolution.bidPhaseStatus as BidPhaseStatus,
    modulesEnsured: result.modulesEnsured,
    tasksCreated: result.tasksCreated,
    summaryText: summary.text,
  };
}

function seedModuleData(
  key: string,
  project: {
    name: string;
    solicitationNumber: string | null;
    clientOrganization: string | null;
    location: string | null;
    closeDate: Date | null;
    questionCloseDate: Date | null;
    estimatedValue: number | null;
    currency: string | null;
    description: string | null;
  },
  summary: { json: Record<string, unknown> },
): object {
  if (key === "project_understanding") {
    return {
      projectName: project.name,
      tenderNumber: project.solicitationNumber,
      procuringAgency: project.clientOrganization,
      endUser: null,
      product: summary.json.product ?? null,
      quantity: null,
      contractTerm: null,
      deliveryLocation: project.location,
      submissionPlatform: null,
      closeDate: project.closeDate?.toISOString() ?? null,
      questionCloseDate: project.questionCloseDate?.toISOString() ?? null,
      mandatoryHighlights: [],
    };
  }
  if (key === "contract_value") {
    return {
      initialAwardAmount: null,
      amendmentAmount: null,
      finalContractCeiling: project.estimatedValue,
      currency: project.currency,
      contractTerm: null,
      estimatedAnnualVolume: null,
      guaranteedPurchase: null,
      aiExplanation: null,
      officialSource: null,
    };
  }
  if (key === "historical_awards") {
    return { awards: [] };
  }
  if (key === "deliverables") {
    return {
      items: [
        { key: "china_supplier_brief", title: "国内供应商中文 PDF", ready: false },
        { key: "internal_analysis", title: "内部项目分析", ready: false },
        { key: "go_brief", title: "管理层 Go/No-Go 简报", ready: false },
        { key: "rfq_form", title: "厂家询价表", ready: false },
        { key: "tech_requirements", title: "技术要求清单", ready: false },
        { key: "certs_checklist", title: "证书收集清单", ready: false },
        { key: "historical_report", title: "历史采购报告", ready: false },
        { key: "competitor_report", title: "竞争对手报告", ready: false },
      ],
    };
  }
  return {};
}
