/**
 * FLOW-H1 项目页「下一步」——取数（只读，不写任何东西）
 *
 * 把判断要用的事实从既有的表里读出来，交给纯函数 decideWebNextStep。
 * 组织只取自调用方已经核对过的项目记录；每一条查询都按项目限定，分析与待批另按组织限定。
 * 不批准、不发送、不起草、不推进阶段。
 */
import { db } from "@/lib/db";
import { loadPendingMineWhere } from "@/lib/approval/pending-mine";
import { countUnknownCriticalFacts } from "@/lib/muse-bridge/next-step";
import { readUserPrefs } from "@/lib/muse-bridge/prefs-pure";
import { TERMINAL_TENDER_STATUSES } from "@/lib/projects/review";
import { isBidWorkspaceEnabledForOrg } from "@/lib/tender-bid-workspace/flags";
import { loadWorkspace, loadWorkspaceContext } from "@/lib/tender-bid-workspace/store";
import { buildWorkspaceView } from "@/lib/tender-bid-workspace/workspace-view";
import { parseChaseNotes, resolveChaseAfterDays } from "@/lib/tender-rfq/chase-pure";
import { loadFollowUpRoundState, roundPolicyInEffect } from "@/lib/tender-rfq/chase-service";
import { parseRfqThreadId } from "@/lib/tender-rfq/inbound-contract";
import { decideWebNextStep, type WebNextStepInput } from "./web-next-step";
import type { WebNextStepView } from "./targets";

export type NextStepProject = {
  id: string;
  name: string;
  orgId: string;
  ownerId: string;
  status: string | null;
  tenderStatus: string | null;
  closeDate: Date | null;
  dueDate: Date | null;
  submittedAt: Date | null;
};

const TERMINAL_LABEL_ZH: Record<string, string> = {
  won: "已中标", lost: "未中标", passed: "已放弃投标", no_bid: "不投标", archived: "已归档",
  cancelled: "已取消", completed: "已完成", terminated: "已终止",
};

/** 项目已放弃，或招投标状态已是终态 → 一句说法；否则 null */
export function closedLabelOf(project: Pick<NextStepProject, "status" | "tenderStatus">): string | null {
  if (project.status === "abandoned") return "已放弃";
  const s = (project.tenderStatus ?? "").toLowerCase();
  return TERMINAL_TENDER_STATUSES.has(s) ? (TERMINAL_LABEL_ZH[s] ?? "已结束") : null;
}

export async function loadWebNextStepInput(input: { project: NextStepProject; userId: string; canManage: boolean; now: Date }): Promise<WebNextStepInput> {
  const { project, now } = input;
  const projectId = project.id;
  const orgId = project.orgId;

  const [run, documentCount, parsingCount, round, quoteCount, pendingWhere, org] = await Promise.all([
    db.tenderAnalysisRun.findFirst({
      where: { projectId, orgId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        summaryJson: true,
        requirements: { where: { mandatory: true, complianceStatus: "NON_COMPLIANT" }, select: { id: true } },
      },
    }),
    db.projectDocument.count({ where: { projectId } }),
    db.projectDocument.count({ where: { projectId, parseStatus: { in: ["pending", "parsing"] } } }),
    // 最新一轮（已取消的不算）
    db.projectInquiry.findFirst({
      where: { projectId, project: { orgId }, status: { not: "canceled" } },
      orderBy: { roundNumber: "desc" },
      select: {
        id: true,
        dueDate: true,
        items: { select: { id: true, status: true, sentAt: true, isSelected: true, contactNotes: true, supplier: { select: { name: true } } } },
      },
    }),
    db.projectQuote.count({ where: { projectId } }),
    loadPendingMineWhere(input.userId, orgId),
    db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } }),
  ]);

  const [pendingRequirementCount, pendingActions, followUp, workspace] = await Promise.all([
    run ? db.tenderExtractedRequirement.count({ where: { analysisRunId: run.id, projectId, reviewStatus: "AI_EXTRACTED" } }) : Promise.resolve(0),
    // 这个人可见（与「待我确认」同一组条件）、属于这个项目、待批且未过期
    db.pendingAction.findMany({
      where: { AND: [pendingWhere, { projectId, status: "pending", expiresAt: { gt: now } }] },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: { id: true, title: true, createdAt: true, type: true, payload: true },
    }),
    round ? loadFollowUpRoundState(orgId, round.id) : Promise.resolve(null),
    isBidWorkspaceEnabledForOrg(orgId)
      ? Promise.all([loadWorkspace(projectId), loadWorkspaceContext(projectId, orgId, now)]).then(([stored, ctx]) => buildWorkspaceView(stored, ctx))
      : Promise.resolve(null),
  ]);

  // 等待天数：与定时催单扫描同一个取法（chase-service 的同两个函数）
  const roundPolicy = followUp ? roundPolicyInEffect(followUp) : null;
  const orgSettingsJson = org?.settingsJson ?? null;
  const chaseAfterDays = roundPolicy ? roundPolicy.chaseAfterDays : resolveChaseAfterDays(readUserPrefs(orgSettingsJson, project.ownerId).chaseAfterDays, orgSettingsJson);

  return {
    now,
    projectId,
    projectName: project.name,
    closedLabelZh: closedLabelOf(project),
    closeDate: project.closeDate ?? project.dueDate ?? null,
    submittedAt: project.submittedAt ?? null,
    documentCount,
    parsingActive: parsingCount > 0,
    analysisStatus: run?.status ?? null,
    unknownCriticalFacts: countUnknownCriticalFacts(run?.summaryJson ?? null),
    mandatoryNonCompliant: run?.requirements.length ?? 0,
    pendingRequirementCount,
    pendingApprovals: pendingActions.map((a) => {
      const inquiryId = (a.payload as { inquiryId?: unknown } | null)?.inquiryId;
      return { id: a.id, title: a.title, createdAt: a.createdAt, type: a.type, inquiryId: typeof inquiryId === "string" && inquiryId ? inquiryId : null };
    }),
    latestRound: round
      ? {
          inquiryId: round.id,
          replyBy: round.dueDate,
          items: round.items.map((i) => ({
            itemId: i.id,
            supplierName: i.supplier?.name ?? "供应商",
            status: i.status,
            sentAt: i.sentAt,
            isSelected: i.isSelected,
            hasThread: !!parseRfqThreadId(i.contactNotes),
            chasedAt: parseChaseNotes(i.contactNotes).filter((c) => c.kind === "no_reply").map((c) => c.at),
          })),
        }
      : null,
    hasProjectQuote: quoteCount > 0,
    chaseAfterDays,
    canManage: input.canManage,
    workspace: workspace
      ? { hasPriceSchedule: workspace.hasPriceSchedule, blockers: workspace.readiness.blockers.map((b) => ({ code: b.code, messageZh: b.messageZh })) }
      : null,
  };
}

export async function loadWebNextStep(input: { project: NextStepProject; userId: string; canManage: boolean; now?: Date }): Promise<WebNextStepView> {
  return decideWebNextStep(await loadWebNextStepInput({ ...input, now: input.now ?? new Date() }));
}
