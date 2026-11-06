/**
 * POST /api/projects/[id]/tender-rfq/rounds（W-1）
 *
 * 项目页「生成并送审」：校验 → 与 Muse rfq 意图同一个 prepareRfqRound（source=web）→ 一张 tender.send_rfq 审批卡。
 * 本路由零出站；批准走审批中心既有接口 /api/capabilities/approvals/{id}/approve，批准后才由执行器发出。
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireProjectWriteAccess } from "@/lib/projects/access";
import { resolveOrgTimezone } from "@/lib/automation/registry";
import { db } from "@/lib/db";
import { prepareRfqRound } from "@/lib/tender-rfq/service";
import { rfqErrorToUserMessage, type PrepareRfqErrorCode } from "@/lib/tender-rfq/web-entry-pure";
import { loadRfqApprovalInfo, loadRfqSendEmails } from "@/lib/tender-rfq/web-entry-approval";

type Params = { params: Promise<{ id: string }> };

const BodySchema = z.object({
  supplierIds: z
    .array(z.string().trim().min(1))
    .min(1, "至少选一家供应商")
    .max(8, "一轮最多问 8 家"),
  incoterm: z.enum(["EXW", "FOB", "CIF", "DDP", "DAP"]).nullable().optional(),
  destination: z.string().trim().max(200, "目的地太长了（最多 200 字）").nullable().optional(),
  scopeNote: z.string().trim().max(2000, "补充说明太长了（最多 2000 字）").nullable().optional(),
  extraQuestions: z
    .array(z.string().trim().min(1).max(500, "单条附加问题最多 500 字"))
    .max(5, "附加问题最多 5 条")
    .optional(),
  quantityTiers: z.array(z.number().positive()).max(5, "数量阶梯最多 5 档").optional(),
});

const STATUS_OF: Record<PrepareRfqErrorCode, number> = {
  PROJECT_NOT_FOUND: 404,
  ROUND_LOCKED: 409,
  NO_SUPPLIERS: 400,
  SUPPLIERS_NOT_READY: 400,
  NO_CONFIRMED_REQUIREMENTS: 422,
  SENSITIVE_LEAK: 422,
  DRAFT_FAILED: 500,
};

export async function POST(request: NextRequest, { params }: Params) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const orgId = access.project.orgId;
  if (!orgId) {
    return NextResponse.json(
      { ok: false, errorCode: "PROJECT_NOT_FOUND", userMessage: { message: "这个项目不属于任何组织，不能发询价。", action: null } },
      { status: 404 },
    );
  }

  const raw = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "提交的内容不完整";
    return NextResponse.json({ ok: false, errorCode: "VALIDATION_FAILED", userMessage: { message, action: null } }, { status: 400 });
  }
  const body = parsed.data;

  const result = await prepareRfqRound({
    projectId,
    orgId,
    userId: access.user.id,
    source: "web",
    supplierIds: [...new Set(body.supplierIds)],
    incoterm: body.incoterm ?? null,
    destination: body.destination || null,
    scopeNote: body.scopeNote || null,
    extraQuestions: body.extraQuestions,
    quantityTiers: body.quantityTiers,
  });

  if (!result.ok) {
    const org = await db.organization.findUnique({ where: { id: orgId }, select: { settingsJson: true } });
    const userMessage = rfqErrorToUserMessage(result.errorCode, {
      projectId,
      now: new Date(),
      timeZone: resolveOrgTimezone(org?.settingsJson ?? null),
      blockedSuppliers: result.blockedSuppliers,
    });
    return NextResponse.json(
      { ok: false, errorCode: result.errorCode, userMessage, candidates: result.candidates ?? [] },
      { status: STATUS_OF[result.errorCode] ?? 400 },
    );
  }

  const [approvals, emails] = await Promise.all([
    loadRfqApprovalInfo(request, orgId, [result.actionId]),
    loadRfqSendEmails(orgId, [result.actionId]),
  ]);

  return NextResponse.json({
    ok: true,
    actionId: result.actionId,
    inquiryId: result.inquiryId,
    roundNumber: result.roundNumber,
    fromEmail: result.fromEmail,
    replyBy: result.replyBy,
    suppliers: result.suppliers,
    blockedSuppliers: result.blockedSuppliers,
    excludedRequirements: result.excludedRequirements,
    incoterm: result.incoterm,
    approval: approvals[result.actionId] ?? null,
    emails: emails[result.actionId] ?? [],
  });
}
