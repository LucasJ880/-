/**
 * 主动触发扫描器
 *
 * 扫描用户可见的活跃项目，检测：
 * 1. 截止日逼近（7/3/1 天）
 * 2. 项目阶段卡顿（超过 N 天未推进）
 * 3. 供应商未回复（询价后超过 3 天无报价）
 * 4. 任务逾期
 * 5. 综合风险预警
 */

import { db } from "@/lib/db";
import { getVisibleProjectIds } from "@/lib/projects/visibility";
import { getProjectStage } from "@/lib/tender/stage";
import type {
  ProactiveSuggestion,
  ScanResult,
  TriggerSeverity,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeId(): string {
  return `ps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── 截止日逼近 ─────────────────────────────────────────────────

function checkDeadlineApproaching(
  project: ProjectRow,
  now: Date
): ProactiveSuggestion | null {
  const closeDate = project.closeDate;
  if (!closeDate) return null;

  const msLeft = closeDate.getTime() - now.getTime();
  if (msLeft < 0) return null; // 已过期的由 tasks_overdue 或 stage 检测处理

  const daysLeft = Math.ceil(msLeft / DAY_MS);

  if (daysLeft > 7) return null;

  let severity: TriggerSeverity;
  let title: string;

  if (daysLeft <= 1) {
    severity = "urgent";
    title = `⚠️ 截标倒计时：${project.name} 明天截标`;
  } else if (daysLeft <= 3) {
    severity = "urgent";
    title = `截标倒计时：${project.name} 还剩 ${daysLeft} 天`;
  } else {
    severity = "warning";
    title = `截标提醒：${project.name} 还剩 ${daysLeft} 天`;
  }

  return {
    id: makeId(),
    projectId: project.id,
    projectName: project.name,
    kind: "deadline_approaching",
    severity,
    title,
    description: `截标日期 ${closeDate.toISOString().slice(0, 10)}，建议检查投标准备进度。`,
    suggestedAction: {
      type: "view_project",
      label: "查看项目",
      params: { projectId: project.id },
    },
    dedupeKey: `deadline:${project.id}:${daysLeft <= 1 ? "1d" : daysLeft <= 3 ? "3d" : "7d"}`,
    createdAt: now.toISOString(),
  };
}

// ── 阶段卡顿 ───────────────────────────────────────────────────

const STAGE_STALL_DAYS: Record<string, number> = {
  initiation: 5,
  distribution: 3,
  interpretation: 5,
  supplier_inquiry: 5,
  supplier_quote: 7,
  submission: 3,
};

function checkStageStalled(
  project: ProjectRow,
  now: Date
): ProactiveSuggestion | null {
  const stage = getProjectStage({
    createdAt: project.createdAt?.toISOString() ?? null,
    tenderStatus: project.tenderStatus,
    publicDate: project.publicDate?.toISOString() ?? null,
    questionCloseDate: project.questionCloseDate?.toISOString() ?? null,
    closeDate: project.closeDate?.toISOString() ?? null,
    dueDate: project.dueDate?.toISOString() ?? null,
    distributedAt: project.distributedAt?.toISOString() ?? null,
    dispatchedAt: project.dispatchedAt?.toISOString() ?? null,
    interpretedAt: project.interpretedAt?.toISOString() ?? null,
    supplierInquiredAt: project.supplierInquiredAt?.toISOString() ?? null,
    supplierQuotedAt: project.supplierQuotedAt?.toISOString() ?? null,
    submittedAt: project.submittedAt?.toISOString() ?? null,
    awardDate: project.awardDate?.toISOString() ?? null,
    intakeStatus: project.intakeStatus,
  });

  const threshold = STAGE_STALL_DAYS[stage] ?? 5;
  const lastUpdate = project.updatedAt;
  const daysSinceUpdate = Math.floor(
    (now.getTime() - lastUpdate.getTime()) / DAY_MS
  );

  if (daysSinceUpdate < threshold) return null;

  const STAGE_LABELS: Record<string, string> = {
    initiation: "立项",
    distribution: "项目分发",
    interpretation: "项目解读",
    supplier_inquiry: "供应商询价",
    supplier_quote: "供应商报价",
    submission: "项目提交",
  };

  const stageLabel = STAGE_LABELS[stage] ?? stage;

  return {
    id: makeId(),
    projectId: project.id,
    projectName: project.name,
    kind: "stage_stalled",
    severity: daysSinceUpdate >= threshold * 2 ? "urgent" : "warning",
    title: `项目停滞：${project.name}「${stageLabel}」阶段已 ${daysSinceUpdate} 天未推进`,
    description: `当前处于「${stageLabel}」阶段，建议检查是否有阻塞问题。`,
    suggestedAction: {
      type: "advance_stage",
      label: "查看并推进",
      params: { projectId: project.id, currentStage: stage },
    },
    dedupeKey: `stalled:${project.id}:${stage}`,
    createdAt: now.toISOString(),
  };
}

// ── 供应商未回复 ────────────────────────────────────────────────

async function checkSupplierNoResponse(
  project: ProjectRow,
  now: Date
): Promise<ProactiveSuggestion[]> {
  const results: ProactiveSuggestion[] = [];

  const pendingItems = await db.inquiryItem.findMany({
    where: {
      inquiry: { projectId: project.id },
      status: { in: ["pending", "contacted"] },
      createdAt: { lt: new Date(now.getTime() - 3 * DAY_MS) },
    },
    include: {
      supplier: { select: { name: true } },
      inquiry: { select: { roundNumber: true } },
    },
    take: 5,
  });

  if (pendingItems.length === 0) return results;

  const names = pendingItems.map((i) => i.supplier.name);
  const nameList = names.length <= 3
    ? names.join("、")
    : `${names.slice(0, 3).join("、")}等 ${names.length} 家`;

  results.push({
    id: makeId(),
    projectId: project.id,
    projectName: project.name,
    kind: "supplier_no_response",
    severity: pendingItems.length >= 3 ? "urgent" : "warning",
    title: `供应商未回复：${project.name} 有 ${pendingItems.length} 家供应商超过 3 天未回复`,
    description: `${nameList}尚未回复报价，建议发送催促邮件。`,
    suggestedAction: {
      type: "send_followup_email",
      label: "批量催促",
      params: { projectId: project.id },
    },
    dedupeKey: `supplier_nr:${project.id}:${pendingItems.length}`,
    createdAt: now.toISOString(),
  });

  return results;
}

// ── 任务逾期 ────────────────────────────────────────────────────

async function checkTasksOverdue(
  project: ProjectRow,
  now: Date
): Promise<ProactiveSuggestion | null> {
  const overdueCount = await db.task.count({
    where: {
      projectId: project.id,
      status: { notIn: ["done", "cancelled"] },
      dueDate: { lt: now },
    },
  });

  if (overdueCount === 0) return null;

  return {
    id: makeId(),
    projectId: project.id,
    projectName: project.name,
    kind: "tasks_overdue",
    severity: overdueCount >= 3 ? "urgent" : "warning",
    title: `任务逾期：${project.name} 有 ${overdueCount} 个任务已逾期`,
    description: `建议尽快处理逾期任务，避免影响项目整体进度。`,
    suggestedAction: {
      type: "view_project",
      label: "查看逾期任务",
      params: { projectId: project.id },
    },
    dedupeKey: `overdue:${project.id}:${overdueCount}`,
    createdAt: now.toISOString(),
  };
}

// ── 主扫描入口 ──────────────────────────────────────────────────

interface ProjectRow {
  id: string;
  name: string;
  status: string;
  closeDate: Date | null;
  questionCloseDate: Date | null;
  publicDate: Date | null;
  dueDate: Date | null;
  tenderStatus: string | null;
  intakeStatus: string | null;
  createdAt: Date;
  updatedAt: Date;
  distributedAt: Date | null;
  dispatchedAt: Date | null;
  interpretedAt: Date | null;
  supplierInquiredAt: Date | null;
  supplierQuotedAt: Date | null;
  submittedAt: Date | null;
  awardDate: Date | null;
  orgId: string | null;
}

const PROJECT_SCAN_SELECT = {
  id: true,
  name: true,
  status: true,
  closeDate: true,
  questionCloseDate: true,
  publicDate: true,
  dueDate: true,
  tenderStatus: true,
  intakeStatus: true,
  createdAt: true,
  updatedAt: true,
  distributedAt: true,
  dispatchedAt: true,
  interpretedAt: true,
  supplierInquiredAt: true,
  supplierQuotedAt: true,
  submittedAt: true,
  awardDate: true,
  orgId: true,
} as const;

export async function scanProjectsForUser(
  userId: string,
  userRole: string
): Promise<ScanResult> {
  const now = new Date();
  const projectIds = await getVisibleProjectIds(userId, userRole);

  const where = projectIds !== null
    ? { id: { in: projectIds }, status: "active" }
    : { status: "active" };

  const projects = await db.project.findMany({
    where,
    select: PROJECT_SCAN_SELECT,
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  const suggestions: ProactiveSuggestion[] = [];
  const seenKeys = new Set<string>();

  for (const project of projects) {
    const checks = [
      checkDeadlineApproaching(project, now),
      checkStageStalled(project, now),
    ];

    for (const result of checks) {
      if (result && !seenKeys.has(result.dedupeKey)) {
        seenKeys.add(result.dedupeKey);
        suggestions.push(result);
      }
    }

    const asyncChecks = await Promise.all([
      checkSupplierNoResponse(project, now),
      checkTasksOverdue(project, now),
    ]);

    for (const result of asyncChecks.flat()) {
      if (result && !seenKeys.has(result.dedupeKey)) {
        seenKeys.add(result.dedupeKey);
        suggestions.push(result);
      }
    }
  }

  const severityOrder: Record<string, number> = { urgent: 0, warning: 1, info: 2 };
  suggestions.sort(
    (a, b) => (severityOrder[a.severity] ?? 2) - (severityOrder[b.severity] ?? 2)
  );

  return {
    scannedAt: now.toISOString(),
    projectCount: projects.length,
    suggestions,
  };
}
