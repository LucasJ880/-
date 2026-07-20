/**
 * GET /api/cron/employee-ai-practice-miner
 * 每周挖掘 CandidatePractice（Bearer CRON_SECRET）
 * 不足条件不生成；不自动发布 Playbook
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runTrackedAutomation } from "@/lib/automation/runner";
import { mineCandidatePractices } from "@/lib/employee-ai";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization") || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (process.env.EMPLOYEE_AI_LEARNING_ENABLED !== "1") {
    return NextResponse.json({ ok: true, skipped: true, reason: "flag_off" });
  }

  const data = await runTrackedAutomation("employee-ai-practice-miner", async () => {
    const orgs = await db.organization.findMany({
      where: { status: "active" },
      select: { id: true, code: true },
      take: 50,
    });
    const allow = (process.env.EMPLOYEE_AI_ORG_ALLOWLIST || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    const results: Array<{ orgId: string; created: number; skippedReason?: string }> = [];
    for (const org of orgs) {
      if (allow.length > 0 && !allow.includes(org.id) && !allow.includes(org.code)) {
        continue;
      }
      const r = await mineCandidatePractices({
        orgId: org.id,
        department: "sales",
        roleScope: "sales",
        generatedByRunId: `cron-${Date.now()}`,
      });
      results.push({
        orgId: org.id,
        created: r.created,
        skippedReason: r.skippedReason,
      });
    }

    return {
      data: { results },
      processedCount: results.length,
      succeededCount: results.filter((r) => !r.skippedReason || r.created > 0).length,
      failedCount: 0,
      metadata: { results },
    };
  });

  return NextResponse.json({ ok: true, ...data });
}
