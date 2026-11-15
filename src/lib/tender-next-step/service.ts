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
import { OPEN_ITEM_WINDOW_DAYS, loadFollowUpRoundState, roundPolicyInEffect } from "@/lib/tender-rfq/chase-service";
import { isTerminalTenderStatus, recordedStageOf } from "@/lib/tender/stage";
import { parseRfqThreadId } from "@/lib/tender-rfq/inbound-contract";
import { isSubmissionRecordEnabledForOrg } from "@/lib/tender-submission/flags";
import { loadRfqWebEntry } from "@/lib/tender-rfq/web-entry";
import { chaseStillNeeded } from "@/lib/tender-rfq/web-entry-pure";
import { RFQ_ENTRY_RULES, decideWebNextStep, type WebNextStepInput } from "./web-next-step";
import type { WebNextStepView } from "./targets";

export type NextStepProject = {
  id: string;
  name: string;
  orgId: string;
  ownerId: string;
  status: string | null;
  tenderStatus: string | null;
  closeDate: Date | null;
  submittedAt: Date | null;
  /** FLOW-H1b：阶段记录的其余几项（库结构落后时可能没有：按没有处理） */
  intakeStatus?: string | null;
  distributedAt?: Date | null;
  dispatchedAt?: Date | null;
  interpretedAt?: Date | null;
  supplierInquiredAt?: Date | null;
  supplierQuotedAt?: Date | null;
};

const TERMINAL_LABEL_ZH: Record<string, string> = {
  lost: "未中标", passed: "已放弃投标", no_bid: "不投标", archived: "已归档",
  cancelled: "已取消", completed: "已完成", terminated: "已终止",
};

/** 招投标状态是已中标 */
export function isWon(project: Pick<NextStepProject, "tenderStatus">): boolean {
  return (project.tenderStatus ?? "").toLowerCase() === "won";
}

/** 项目已放弃 / 已归档，或招投标状态已是终态（已中标另算）→ 一句说法；否则 null */
export function closedLabelOf(project: Pick<NextStepProject, "status" | "tenderStatus">): string | null {
  if (project.status === "abandoned") return "已放弃";
  if (project.status === "archived") return "已归档";
  const s = (project.tenderStatus ?? "").toLowerCase();
  if (s === "won") return null;
  return TERMINAL_TENDER_STATUSES.has(s) ? (TERMINAL_LABEL_ZH[s] ?? "已结束") : null;
}

/** 等待审核或已批准的分析才是「可用的」——询价、投标草稿取的也是它 */
const USABLE_RUN = ["REVIEW_REQUIRED", "APPROVED"];
/** 不再作数的投标报价 */
const DEAD_QUOTE_STATUSES = ["cancelled", "superseded", "rejected", "archived"];
const DAY = 86_400_000;

export async function loadWebNextStepInput(input: { project: NextStepProject; userId: string; canManage: boolean; now: Date }): Promise<WebNextStepInput> {
  const { project, now } = input;
  const projectId = project.id;
  const orgId = project.orgId;
  const runSelect = { id: true, status: true, summaryJson: true } as const;

  const [latestRun, usableRun, documentCount, parsingCount, rounds, quoteCount, pendingWhere, org] = await Promise.all([
    db.tenderAnalysisRun.findFirst({ where: { projectId, orgId }, orderBy: { createdAt: "desc" }, select: runSelect }),
    db.tenderAnalysisRun.findFirst({ where: { projectId, orgId, status: { in: USABLE_RUN } }, orderBy: { createdAt: "desc" }, select: runSelect }),
    db.projectDocument.count({ where: { projectId } }),
    db.projectDocument.count({ where: { projectId, parseStatus: { in: ["pending", "parsing"] } } }),
    // 没取消的轮次，新的在前
    db.projectInquiry.findMany({
      where: { projectId, project: { orgId }, status: { not: "canceled" } },
      orderBy: { roundNumber: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        dueDate: true,
        items: { select: { id: true, status: true, sentAt: true, isSelected: true, contactNotes: true, supplier: { select: { name: true } } } },
      },
    }),
    db.projectQuote.count({ where: { projectId, status: { notIn: DEAD_QUOTE_STATUSES } } }),
    loadPendingMineWhere(input.userId, orgId),
    db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } }),
  ]);

  // 当前这份分析：最近一次是失败或被取代、而之前有可用的一份 → 用之前那份（询价入口用的也是它）；其余用最近一次
  const latestDead = !!latestRun && (latestRun.status === "FAILED" || latestRun.status === "SUPERSEDED");
  const run = latestDead && usableRun ? usableRun : latestRun;
  const latestAnalysisFailed = !!latestRun && latestRun.status === "FAILED" && !!usableRun;
  // 当前这一轮：最新一轮有已发出的供应商的；都没有发出过就是最新一轮（一个空的新轮次不该盖住上一轮的报价）
  const round = rounds.find((r) => r.items.some((i) => i.status !== "pending")) ?? rounds[0] ?? null;

  const [mandatoryNonCompliant, pendingRequirementCount, confirmedRequirementCount, pendingActions, followUp, workspace] = await Promise.all([
    run ? db.tenderExtractedRequirement.count({ where: { analysisRunId: run.id, projectId, mandatory: true, complianceStatus: "NON_COMPLIANT" } }) : Promise.resolve(0),
    run ? db.tenderExtractedRequirement.count({ where: { analysisRunId: run.id, projectId, reviewStatus: "AI_EXTRACTED" } }) : Promise.resolve(0),
    run ? db.tenderExtractedRequirement.count({ where: { analysisRunId: run.id, projectId, reviewStatus: "CONFIRMED" } }) : Promise.resolve(0),
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

  // 催单卡针对的那一家如果已经不需要催了，那一轮里不会列出这张卡（询价入口用的同一个判断）
  const itemStatus = new Map(rounds.flatMap((r) => r.items.map((i) => [i.id, i.status] as const)));
  const cards = pendingActions.map((a) => {
    const payload = (a.payload ?? null) as { inquiryId?: unknown; inquiryItemId?: unknown; kind?: unknown } | null;
    const inquiryId = typeof payload?.inquiryId === "string" && payload.inquiryId ? payload.inquiryId : null;
    const itemId = typeof payload?.inquiryItemId === "string" ? payload.inquiryItemId : null;
    const stale = a.type === "tender.send_chase" && !!itemId && itemStatus.has(itemId) && !chaseStillNeeded(payload?.kind === "missing_fields" ? "missing_fields" : "no_reply", itemStatus.get(itemId) ?? "");
    return { id: a.id, title: a.title, createdAt: a.createdAt, type: a.type, inquiryId, stale };
  });

  // 等待天数：与定时催单扫描同一个取法（chase-service 的同两个函数）
  const roundPolicy = followUp ? roundPolicyInEffect(followUp) : null;
  const orgSettingsJson = org?.settingsJson ?? null;
  const chaseAfterDays = roundPolicy ? roundPolicy.chaseAfterDays : resolveChaseAfterDays(readUserPrefs(orgSettingsJson, project.ownerId).chaseAfterDays, orgSettingsJson);
  // 定时催单不看的：轮次已结束的、发出超过它的时间窗的
  const scanFloor = now.getTime() - OPEN_ITEM_WINDOW_DAYS * DAY;

  return {
    now,
    projectId,
    projectName: project.name,
    closedLabelZh: closedLabelOf(project),
    won: isWon(project),
    closeDate: project.closeDate ?? null,
    submittedAt: project.submittedAt ?? null,
    documentCount,
    parsingActive: parsingCount > 0,
    analysisStatus: run?.status ?? null,
    latestAnalysisFailed,
    unknownCriticalFacts: countUnknownCriticalFacts(run?.summaryJson ?? null),
    mandatoryNonCompliant,
    pendingRequirementCount,
    confirmedRequirementCount,
    pendingApprovals: cards,
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
            outOfScan: round.status === "completed" || (!!i.sentAt && i.sentAt.getTime() < scanFloor),
          })),
        }
      : null,
    hasProjectQuote: quoteCount > 0,
    // FLOW-H1b：实际进度看所有没取消的轮次，不只是当前这一轮（开新一轮不该让进度条倒退）
    hasUsableAnalysis: !!usableRun,
    recordedStage: recordedStageOf(project),
    stageFrozen: closedLabelOf(project) !== null || isTerminalTenderStatus(project.tenderStatus),
    anySent: rounds.some((r) => r.items.some((i) => i.status !== "pending")),
    anyQuoted: rounds.some((r) => r.items.some((i) => i.status === "quoted")),
    chaseAfterDays,
    canManage: input.canManage,
    workspace: workspace
      ? { hasPriceSchedule: workspace.hasPriceSchedule, blockers: workspace.readiness.blockers.map((b) => ({ code: b.code, messageZh: b.messageZh })) }
      : null,
    rfqEntry: null,
    submissionRecordEnabled: isSubmissionRecordEnabledForOrg(orgId),
  };
}

export async function loadWebNextStep(input: { project: NextStepProject; userId: string; canManage: boolean; now?: Date }): Promise<WebNextStepView> {
  const now = input.now ?? new Date();
  const facts = await loadWebNextStepInput({ ...input, now });
  const view = decideWebNextStep(facts);
  if (!RFQ_ENTRY_RULES.has(view.rule)) return view;
  // 要指向「问供应商要价」时，先问页面上那个入口自己：现在能不能用、不能用是为什么（只读）
  const entry = await loadRfqWebEntry({ projectId: input.project.id, orgId: input.project.orgId, userId: input.userId, now });
  if (!entry.available) return view;
  return decideWebNextStep({ ...facts, rfqEntry: { enabled: entry.state.enabled, messageZh: entry.state.message } });
}
