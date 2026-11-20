/**
 * POST /api/organizations/[orgId]/tender-awards/manual（CHAIN-1b）
 *   { buyerName, winnerName, apcUrl, solicitationNumber?, awardDate?, contractAmount?, currency?, scopeSummary? }
 *
 * Alberta 授标的人工录入：来源人工录入（USER_ENTRY）、带 APC 公告链接、信任级待人工复核（NEEDS_REVIEW）；
 * 组织管理员在「历史中标」页确认属实后才进入统计。写入只经 awards.ts（createOrObserveAwardRecord），
 * 记录与审计在同一事务。系统不打开、不请求这个链接（不访问 APC）。
 *
 * 判定顺序：未登录 401 → 不是本组织 org_member 以上的有效成员 403（平台超级管理员按既有规则，组织不存在 404）
 *   → 授标情报开关关 409（不访问授标表）→ 校验 400。
 */

import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireOrgRole } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/audit/logger";
import { isT4AwardSchemaReady } from "@/lib/tender-intel/award-flags";
import { createOrObserveAwardRecord, normalizeVendorName, type AwardRecordRow, type AwardsDbClient, type ObserveAwardInput } from "@/lib/tender-intel/awards";
import {
  AWARD_MANUAL_ENTRY_AUDIT_ACTION,
  MANUAL_ENTRY_TEXT,
  attachCause,
  manualEntryMessageZh,
  parseManualEntry,
  type ManualEntryInput,
  type ManualEntryOutcome,
} from "@/lib/tender-intel/award-manual-entry";
import { manualApcSourceKey } from "@/lib/tender-intel/award-manual-entry-key";

type Params = { params: Promise<{ orgId: string }> };

/** 同一来源键最多跟随几次「已撤回 → 后继键」（与项目结果回灌同一做法） */
const MAX_RETRACTED_HOPS = 10;
const MAX_BODY_BYTES = 16 * 1024;

function summary(r: AwardRecordRow) {
  return {
    id: r.id,
    verificationStatus: r.verificationStatus,
    status: r.status,
    buyerName: r.buyerNameRaw,
    solicitationNumber: r.solicitationNumber,
    awardDate: r.awardDate ? r.awardDate.toISOString().slice(0, 10) : null,
  };
}

async function readBody(request: NextRequest): Promise<unknown | "TOO_LARGE"> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return "TOO_LARGE";
  const text = await request.text().catch(() => "");
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) return "TOO_LARGE";
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildInput(orgId: string, userId: string, v: ManualEntryInput, sourceKey: string, now: Date): ObserveAwardInput {
  return {
    orgId,
    actor: { actorType: "user", userId },
    award: {
      winnerName: v.winnerName,
      buyerNameRaw: v.buyerName,
      projectId: null,
      solicitationNumber: v.solicitationNumber,
      awardDate: v.awardDate,
      contractAmount: v.contractAmount,
      currency: v.contractAmount !== null ? v.currency : null,
      scopeSummary: v.scopeSummary,
    },
    source: { sourceType: "USER_ENTRY", sourceKey, sourceUrl: v.apcUrl, evidenceSnippet: null, archiveItemId: null, capturedAt: now },
    confidence: "MEDIUM",
    verificationStatus: "NEEDS_REVIEW",
  };
}

export async function POST(request: NextRequest, { params }: Params) {
  const { orgId } = await params;
  const auth = await requireOrgRole(request, orgId, "org_member");
  if (auth instanceof NextResponse) return auth;
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { id: true } });
  if (!org) return NextResponse.json({ error: "组织不存在" }, { status: 404 });
  if (!isT4AwardSchemaReady()) return NextResponse.json({ error: MANUAL_ENTRY_TEXT.flagOff }, { status: 409 });

  const body = await readBody(request);
  if (body === "TOO_LARGE") return NextResponse.json({ error: "请求太大", code: "TOO_LARGE" }, { status: 400 });
  const now = new Date();
  const parsed = parseManualEntry(body, now);
  if (!parsed.ok) return NextResponse.json({ error: parsed.messageZh, code: parsed.code }, { status: 400 });
  const v = parsed.value;
  const baseKey = manualApcSourceKey(v.apcUrl, normalizeVendorName(v.winnerName));
  const userId = auth.user.id;

  const run = () =>
    db.$transaction(async (tx) => {
      const client = tx as unknown as AwardsDbClient;
      let key = baseKey;
      for (let i = 0; i < MAX_RETRACTED_HOPS; i++) {
        const res = await createOrObserveAwardRecord(buildInput(orgId, userId, v, key, now), { client });
        // 撤回过的记录不参与去重：同一来源键命中已撤回的 → 换确定性的后继键再写，撤回的那条保持撤回
        if (res.outcome === "ALREADY_OBSERVED" && res.record.status === "RETRACTED") {
          key = `${baseKey}:after:${res.record.id}`;
          continue;
        }
        const outcome: ManualEntryOutcome =
          res.outcome === "CREATED" ? "CREATED" : res.outcome === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : res.outcome === "ATTACHED_EXISTING" ? attachCause(v.solicitationNumber, res.record.solicitationNumber) : "ALREADY_ENTERED";
        if (outcome !== "ALREADY_ENTERED") {
          await writeAuditLog(tx, {
            userId,
            orgId,
            action: AWARD_MANUAL_ENTRY_AUDIT_ACTION,
            targetType: "award_record",
            targetId: res.record.id,
            afterData: {
              outcome,
              buyerName: v.buyerName,
              winnerName: v.winnerName,
              solicitationNumber: v.solicitationNumber,
              awardDate: v.awardDate ? v.awardDate.toISOString().slice(0, 10) : null,
              contractAmount: v.contractAmount,
              currency: v.contractAmount !== null ? v.currency : null,
              scopeSummary: v.scopeSummary,
              apcUrl: v.apcUrl,
              verificationStatus: "NEEDS_REVIEW",
              ...(outcome === "ATTACHED_BY_SOLICITATION" || outcome === "ATTACHED_BY_DATE_AMOUNT" ? { targetVerificationStatus: res.record.verificationStatus } : {}),
            },
            request,
          });
        }
        return { outcome, record: res.record };
      }
      throw new Error(`retracted_chain_too_long:${baseKey}`);
    });

  let result: { outcome: ManualEntryOutcome; record: AwardRecordRow };
  try {
    result = await run();
  } catch (err) {
    // 两次同时提交撞上来源唯一约束：另一个已经写好，重读一次就是「已经录过」
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") result = await run();
    else throw err;
  }
  return NextResponse.json({ outcome: result.outcome, record: summary(result.record), messageZh: manualEntryMessageZh(result.outcome) });
}
