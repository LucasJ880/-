/**
 * POST /api/organizations/[orgId]/tender-awards/[awardId]/review（仅组织管理员）
 *   { action: "confirm" }                → 线索 / 疑似重复 → 人工确认（ACTIVE + HUMAN_CONFIRMED）
 *   { action: "retract", reason: "…" }   → 撤回（RETRACTED；不删行、不删来源；原因必填 ≤200 字）
 *
 * P2-0d：授标记录的人工处理入口。写入只经 awards.ts（confirmAwardRecord / retractAwardRecord），
 * 状态变化与审计在同一事务。授标情报开关关闭 → 409，不访问授标表。
 * 已是人工确认的再确认、已撤回的再撤回 → 200 + unchanged（幂等，不写审计）。
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireOrgRole } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/audit/logger";
import { isT4AwardSchemaReady } from "@/lib/tender-intel/award-flags";
import {
  AwardIntelError,
  confirmAwardRecord,
  retractAwardRecord,
  type AwardRecordRow,
  type AwardsDbClient,
} from "@/lib/tender-intel/awards";

type Params = { params: Promise<{ orgId: string; awardId: string }> };

function summary(r: AwardRecordRow) {
  return {
    id: r.id,
    winnerName: r.winnerName,
    buyerName: r.buyerNameRaw,
    solicitationNumber: r.solicitationNumber,
    status: r.status,
    verificationStatus: r.verificationStatus,
  };
}

export async function POST(request: NextRequest, { params }: Params) {
  const { orgId, awardId } = await params;
  const auth = await requireOrgRole(request, orgId, "org_admin");
  if (auth instanceof NextResponse) return auth;

  if (!isT4AwardSchemaReady()) {
    return NextResponse.json({ error: "组织授标情报尚未启用" }, { status: 409 });
  }

  const body = (await request.json().catch(() => null)) as { action?: unknown; reason?: unknown } | null;
  const action = body?.action;
  if (action !== "confirm" && action !== "retract") {
    return NextResponse.json({ error: "action 只能是 confirm 或 retract" }, { status: 400 });
  }
  if (action === "retract" && typeof body?.reason !== "string") {
    return NextResponse.json({ error: "请填写撤回原因" }, { status: 400 });
  }

  const actor = { actorType: "user" as const, userId: auth.user.id };
  try {
    const result = await db.$transaction(async (tx) => {
      const client = tx as unknown as AwardsDbClient;
      const before = await client.awardRecord.findFirst({ where: { id: awardId, orgId } });
      if (!before) throw new AwardIntelError("NOT_FOUND", "授标记录不存在或不属于该组织");

      if (action === "confirm") {
        if (before.status === "ACTIVE" && before.verificationStatus === "HUMAN_CONFIRMED") {
          return { record: before, changed: false };
        }
        const record = await confirmAwardRecord({ orgId, actor, awardRecordId: awardId }, { client });
        await writeAuditLog(tx, {
          userId: auth.user.id,
          orgId,
          projectId: before.projectId ?? undefined,
          action: "award_record_confirmed",
          targetType: "award_record",
          targetId: awardId,
          beforeData: { status: before.status, verificationStatus: before.verificationStatus, possibleDuplicateOfId: before.possibleDuplicateOfId },
          afterData: { status: record.status, verificationStatus: record.verificationStatus },
          request,
        });
        return { record, changed: true };
      }

      const { record, changed } = await retractAwardRecord(
        { orgId, actor, awardRecordId: awardId, reason: String(body?.reason ?? "") },
        { client },
      );
      if (changed) {
        await writeAuditLog(tx, {
          userId: auth.user.id,
          orgId,
          projectId: before.projectId ?? undefined,
          action: "award_record_retracted",
          targetType: "award_record",
          targetId: awardId,
          beforeData: { status: before.status, verificationStatus: before.verificationStatus },
          afterData: {
            status: record.status,
            reason: (record.metadata as { retraction?: { reason?: string } } | null)?.retraction?.reason ?? null,
          },
          request,
        });
      }
      return { record, changed };
    });

    return NextResponse.json({ record: summary(result.record), unchanged: !result.changed });
  } catch (e) {
    if (e instanceof AwardIntelError) {
      const status = e.code === "NOT_FOUND" ? 404 : e.code === "RETRACTED_IMMUTABLE" ? 409 : 400;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    throw e;
  }
}
