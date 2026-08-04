/**
 * GET /api/cron/qm-project-daily-brief
 *
 * QM Phase1 PoC：项目每日简报（默认 Feature Flag 关闭）。
 * - requireCronSecret
 * - 仅 allowlist org/project
 * - service principal + 原子 claim
 * - Shadow：可提 PendingAction，不自动执行、不发外部消息
 */

import { NextRequest, NextResponse } from "next/server";
import { requireCronSecret } from "@/lib/cron/auth";
import { db } from "@/lib/db";
import { createPrismaScopeDeps } from "@/lib/scope/deps";
import {
  isQmScopePhase1Enabled,
  getQmPhase1OrgAllowlist,
  getQmPhase1ProjectAllowlist,
} from "@/lib/scope";
import {
  PROJECT_DAILY_BRIEF_TYPE,
  SERVICE_PRINCIPAL,
  runProjectDailyBrief,
  localDateInTz,
  PROJECT_BRIEF_DEFAULT_TZ,
} from "@/lib/qm-phase1";
import { createProductionBriefDeps } from "@/lib/qm-phase1/adapters";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const denied = requireCronSecret(request);
  if (denied) return denied;

  const env = process.env;
  if (!isQmScopePhase1Enabled(env)) {
    return NextResponse.json({
      skipped: true,
      reason: "QINGYAN_QM_SCOPE_PHASE1_ENABLED=false",
      servicePrincipal: SERVICE_PRINCIPAL,
    });
  }

  const orgAllow = getQmPhase1OrgAllowlist(env);
  const projectAllow = getQmPhase1ProjectAllowlist(env);
  if (orgAllow.length === 0 || projectAllow.length === 0) {
    return NextResponse.json({
      skipped: true,
      reason: "empty allowlist",
      servicePrincipal: SERVICE_PRINCIPAL,
    });
  }

  const projects = await db.project.findMany({
    where: {
      id: { in: projectAllow },
      orgId: { in: orgAllow },
      status: "active",
    },
    select: {
      id: true,
      name: true,
      orgId: true,
      ownerId: true,
      org: { select: { id: true, modulesJson: true } },
    },
    take: 50,
  });

  const scopeDeps = createPrismaScopeDeps();
  const deps = createProductionBriefDeps({ scopeDeps });
  const now = new Date();
  const localDate = localDateInTz(now, PROJECT_BRIEF_DEFAULT_TZ);

  const results: Array<{
    projectId: string;
    orgId: string | null;
    status: string;
    reason?: string;
    correlationId?: string;
  }> = [];

  for (const project of projects) {
    if (!project.orgId) {
      results.push({
        projectId: project.id,
        orgId: null,
        status: "failed",
        reason: "project.orgId missing",
      });
      continue;
    }
    try {
      const out = await runProjectDailyBrief(
        {
          orgId: project.orgId,
          projectId: project.id,
          principalUserId: project.ownerId,
          localDate,
          modulesJson: project.org?.modulesJson,
          triggerSource: "cron",
          env,
          now,
        },
        deps,
      );
      results.push({
        projectId: project.id,
        orgId: project.orgId,
        status: out.status,
        reason: out.reason,
        correlationId: out.correlationId,
      });
    } catch (err) {
      results.push({
        projectId: project.id,
        orgId: project.orgId,
        status: "failed",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    briefType: PROJECT_DAILY_BRIEF_TYPE,
    servicePrincipal: SERVICE_PRINCIPAL,
    localDate,
    scanned: projects.length,
    results,
  });
}
