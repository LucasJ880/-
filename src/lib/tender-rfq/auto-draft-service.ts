/**
 * RFQ-AUTO-2 要求确认后自动起草第 1 轮询价 — 服务
 *
 * 只在人的审核动作（批准招标分析 / 确认 / 批量确认 / 驳回要求）成功之后被调用，在那次请求里同步执行。
 * 批准分析即视为审核完成（Lucas 2026-11-11 定）：询价单只带已确认的要求，没确认的不带，并在卡与结果里写明有几条没带上。
 * 只起草：调既有的 prepareRfqRound 产出一张待批的发询价审批卡；不批准、不发信。
 * 供应商（RFQ-AUTO-5）：操作者没有生效的分组 → 他的常用供应商；有分组 → 只用按项目名称恰好对上的那一组，对不上不起草。
 * 卡带不带跟进授权，只取决于触发起草的那个人自己的开关（RFQ-AUTO-3，默认关）；带了也仍要人批准这张卡才生效。
 * 任何异常都被接住——自动起草失败不影响触发它的审核动作。
 *
 * 返回 null = 开关关闭或项目不适用（调用方不在响应里带 rfqAutoDraft）。
 */

import { db } from "@/lib/db";
import { logAudit } from "@/lib/audit/logger";
import { readUserPrefs } from "@/lib/muse-bridge/prefs-pure";
import { isRfqAutoDraftEnabledForOrg } from "./auto-draft-flags";
import {
  AUTO_DRAFT_AUDIT_ACTION,
  autoDraftBlocked,
  autoDraftDone,
  decideAutoDraft,
  pickAutoDraftSuppliers,
  type AutoDraftSkipped,
  type AutoDraftTrigger,
  type RfqAutoDraftResult,
} from "./auto-draft-pure";
import { loadAutoDraftFollowUpOptIn } from "./auto-followup-optin-service";
import { prepareRfqRound } from "./service";
import { findGroup, matchSupplierGroup, type SupplierGroupMatch } from "./supplier-groups";
import { loadActiveSupplierGroups } from "./supplier-groups-service";
import { loadRfqWebEntry } from "./web-entry";

export type MaybeAutoDraftInput = {
  orgId: string;
  projectId: string;
  /** 这次审核动作所属的招标分析 */
  runId: string;
  /** 做这次审核动作的人：卡记在他名下，供应商取他的常用供应商 */
  userId: string;
  trigger: AutoDraftTrigger;
  now?: Date;
};

/** 可注入：让测试能模拟建轮次出错（默认就是真实的建轮次函数） */
export type AutoDraftDeps = { prepare: typeof prepareRfqRound };
const defaultDeps: AutoDraftDeps = { prepare: prepareRfqRound };

/** 审计对象类型：一轮询价（与 RFQ-AUTO-1 的跟进审计同一类型） */
const AUDIT_TARGET = "project_inquiry";

export async function maybeAutoDraftRfq(input: MaybeAutoDraftInput, deps: AutoDraftDeps = defaultDeps): Promise<RfqAutoDraftResult | null> {
  if (!isRfqAutoDraftEnabledForOrg(input.orgId)) return null;
  const ctx = { projectId: input.projectId, trigger: input.trigger };
  try {
    return await run(input, deps);
  } catch (err) {
    console.error("[rfq-auto-draft] failed", { projectId: input.projectId, error: err instanceof Error ? err.message : String(err) });
    return autoDraftBlocked("DRAFT_FAILED", ctx);
  }
}

async function run(input: MaybeAutoDraftInput, deps: AutoDraftDeps): Promise<RfqAutoDraftResult | null> {
  const ctx = { projectId: input.projectId, trigger: input.trigger };

  // ── 便宜的条件先查：分析、已有轮次（未确认的要求数只用来告诉人「有几条没带上」，不拦起草） ──
  // 「当前有效的一份」与询价单取要求时用的是同一条规则（最新一份等待审核或已批准的分析）
  const [current, unconfirmedCount, roundCount] = await Promise.all([
    db.tenderAnalysisRun.findFirst({
      where: { projectId: input.projectId, orgId: input.orgId, status: { in: ["REVIEW_REQUIRED", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    }),
    db.tenderExtractedRequirement.count({ where: { analysisRunId: input.runId, projectId: input.projectId, reviewStatus: "AI_EXTRACTED" } }),
    db.projectInquiry.count({ where: { projectId: input.projectId } }),
  ]);
  const runFacts = { isCurrent: current?.id === input.runId, status: current?.status ?? "" };
  const early = decideAutoDraft({ flagEnabled: true, run: runFacts, roundCount, entryBlock: null, pickedSupplierCount: 1 });
  if (!early.draft && early.reason !== "FLAG_OFF") return autoDraftBlocked(early.reason, ctx);

  // ── 既有入口对这个操作者的结论 + 他的常用供应商 ──
  const entry = await loadRfqWebEntry({ projectId: input.projectId, orgId: input.orgId, userId: input.userId, now: input.now });
  if (!entry.available) return null; // 不是投标项目：本功能不适用

  // ── 供应商名单：有生效的分组就只认分组（按项目名称比对，只看他本人的）；没有分组才是常用供应商 ──
  const [org, storedGroups, project] = await Promise.all([
    db.organization.findUnique({ where: { id: input.orgId }, select: { settingsJson: true } }),
    loadActiveSupplierGroups(input.orgId, input.userId),
    db.project.findFirst({ where: { id: input.projectId, orgId: input.orgId }, select: { name: true } }),
  ]);
  const hasGroups = storedGroups.doc.groups.length > 0;
  const groupMatch: SupplierGroupMatch | null = hasGroups ? matchSupplierGroup(storedGroups.doc, project?.name) : null;
  const matchedGroup = groupMatch?.kind === "one" ? findGroup(storedGroups.doc, groupMatch.group) : null;
  const group = groupMatch?.kind === "one" && matchedGroup ? { groupName: matchedGroup.name, keyword: groupMatch.keyword } : null;

  const prefs = readUserPrefs(org?.settingsJson ?? null, input.userId);
  const listIds = hasGroups ? (matchedGroup?.supplierIds ?? []) : prefs.defaultSupplierIds;
  const supplierRows = listIds.length
    ? await db.supplier.findMany({ where: { orgId: input.orgId, id: { in: listIds } }, select: { id: true, name: true, contactEmail: true, status: true } })
    : [];
  const { picked, skipped } = pickAutoDraftSuppliers(listIds, supplierRows);

  const decision = decideAutoDraft({
    flagEnabled: true,
    run: runFacts,
    roundCount,
    entryBlock: entry.state.enabled ? null : entry.state.reason,
    pickedSupplierCount: picked.length,
    groupMatch,
  });
  if (!decision.draft) return decision.reason === "FLAG_OFF" ? null : autoDraftBlocked(decision.reason, { ...ctx, groupMatch });

  // RFQ-AUTO-3：触发起草的这个人有没有事先开启「自动起草的轮次带跟进授权」（只看他本人的；功能开关任一关闭 → false）
  const followUpOptIn = await loadAutoDraftFollowUpOptIn(input.orgId, input.userId);

  // ── 起草：只在它恰好是项目的第 1 轮时才建。并发或重复触发时，后到的一次在建轮次那一步被拒
  //    （已有轮次，或撞上 (projectId, roundNumber) 唯一约束），什么都不会建出来。不持有任何长事务。 ──
  const prepared = await deps.prepare({
    projectId: input.projectId,
    orgId: input.orgId,
    userId: input.userId,
    source: "auto",
    supplierIds: picked.map((p) => p.id),
    onlyIfFirstRound: true,
    ...(followUpOptIn ? { autoFollowUp: true } : {}),
    ...(group ? { autoDraftGroup: group } : {}),
    now: input.now,
  });
  if (!prepared.ok) {
    return autoDraftBlocked(prepared.errorCode === "ROUND_LOCKED" ? "ROUND_EXISTS" : "DRAFT_FAILED", ctx);
  }

  await logAudit({
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    action: AUTO_DRAFT_AUDIT_ACTION,
    targetType: AUDIT_TARGET,
    targetId: prepared.inquiryId,
    afterData: auditData({ input, actionId: prepared.actionId, roundNumber: prepared.roundNumber, suppliers: prepared.suppliers, skipped, unconfirmedCount, withFollowUp: !!prepared.followUpPolicy, group, groupsVersion: group ? storedGroups.version : null }),
  });

  return autoDraftDone({
    projectId: input.projectId,
    inquiryId: prepared.inquiryId,
    roundNumber: prepared.roundNumber,
    supplierCount: prepared.suppliers.length,
    skippedCount: skipped.length,
    unconfirmedCount,
    // 以卡上实际写了什么为准（而不是开关的值）
    withFollowUp: !!prepared.followUpPolicy,
    group,
  });
}

function auditData(a: {
  input: MaybeAutoDraftInput;
  actionId: string;
  roundNumber: number;
  suppliers: Array<{ id: string; name: string }>;
  skipped: AutoDraftSkipped[];
  unconfirmedCount: number;
  withFollowUp: boolean;
  group: { groupName: string; keyword: string } | null;
  groupsVersion: string | null;
}) {
  return {
    // 这一轮不是人在抽屉里发起的：是人的审核动作触发、系统按他的常用供应商起草的
    source: "auto_draft",
    trigger: a.input.trigger,
    analysisRunId: a.input.runId,
    actionId: a.actionId,
    roundNumber: a.roundNumber,
    // 名单从哪来：操作者的常用供应商，或（RFQ-AUTO-5）他的供应商分组里按项目名称对上的那一组
    supplierSource: a.group ? "operator_supplier_group" : "operator_default_suppliers",
    ...(a.group ? { supplierGroup: { name: a.group.groupName, matchedKeyword: a.group.keyword, version: a.groupsVersion } } : {}),
    suppliers: a.suppliers.map((s) => ({ id: s.id, name: s.name })),
    skipped: a.skipped,
    // 批准时还没确认也没驳回的要求数：这些没有带进询价单
    unconfirmedRequirementCount: a.unconfirmedCount,
    // 这张卡带不带跟进授权（带 = 触发起草的人事先开启了个人开关）
    withFollowUpAuthorization: a.withFollowUp,
  };
}
