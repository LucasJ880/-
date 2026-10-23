/**
 * Tender RFQ（P1-6）— 比价矩阵取数（DB 侧；计算全在 landed-cost.ts / compare.ts 纯函数里）
 *
 * 取：轮次（未指定 → 最新一轮）的 quoted items + 项目截标日 + 组织落地价设置（含项目级关税率 / 交付截止）
 *   + 询价第一档数量与强制编号（从已发出的 tender.send_rfq 正文读，零 schema）
 *   + quoteNotes 的 [auto …] 段（起订量 / 贸易条款 / 强制项答复）
 */

import { db } from "@/lib/db";
import { ITEM_STATUS } from "@/lib/inquiry/types";
import { buildCompareMatrix, type CompareInput, type CompareMatrix } from "./compare";
import { rfqContextFromBody } from "./inbound-contract";
import { normalizeQuote, projectOverrides, readLandedCostSettings } from "./landed-cost";
import { parseAutoNotes } from "./notes-parse";
import { TENDER_SEND_RFQ_TYPE } from "./types";

export type LoadCompareMatrixResult =
  | { ok: true; matrix: CompareMatrix; projectId: string; projectName: string; inquiryId: string; roundNumber: number; closeDate: string | null }
  | { ok: false; errorCode: "PROJECT_NOT_FOUND" | "NO_INQUIRY" | "NO_QUOTES"; message: string; inquiryId?: string; roundNumber?: number };

const toNum = (v: unknown): number | null => {
  if (v == null) return null;
  const n = Number(typeof v === "object" ? String(v) : v);
  return Number.isFinite(n) ? n : null;
};

/** orgId 传了就强制租户匹配（Muse 通道）；不传则由调用方先做项目读权限校验（API 路由） */
export async function loadCompareMatrix(input: {
  projectId: string;
  orgId?: string;
  inquiryId?: string | null;
  now?: Date;
}): Promise<LoadCompareMatrixResult> {
  const now = input.now ?? new Date();
  const project = await db.project.findFirst({
    where: { id: input.projectId, ...(input.orgId ? { orgId: input.orgId } : {}) },
    select: { id: true, name: true, orgId: true, closeDate: true },
  });
  if (!project) return { ok: false, errorCode: "PROJECT_NOT_FOUND", message: "找不到这个项目。" };

  const inquiry = input.inquiryId
    ? await db.projectInquiry.findFirst({ where: { id: input.inquiryId, projectId: project.id }, select: { id: true, roundNumber: true } })
    : await db.projectInquiry.findFirst({ where: { projectId: project.id }, orderBy: { roundNumber: "desc" }, select: { id: true, roundNumber: true } });
  if (!inquiry) return { ok: false, errorCode: "NO_INQUIRY", message: "这个项目还没有询价轮次。" };

  const items = await db.inquiryItem.findMany({
    where: { inquiryId: inquiry.id, status: ITEM_STATUS.QUOTED },
    select: {
      id: true,
      supplierId: true,
      unitPrice: true,
      totalPrice: true,
      currency: true,
      deliveryDays: true,
      validUntil: true,
      repliedAt: true,
      quoteNotes: true,
      supplier: { select: { name: true } },
    },
  });
  if (items.length === 0) {
    return { ok: false, errorCode: "NO_QUOTES", message: `第 ${inquiry.roundNumber} 轮询价还没有报价入表。`, inquiryId: inquiry.id, roundNumber: inquiry.roundNumber };
  }

  const org = project.orgId
    ? await db.organization.findUnique({ where: { id: project.orgId }, select: { settingsJson: true } })
    : null;
  const settings = readLandedCostSettings(org?.settingsJson ?? null);
  const overrides = projectOverrides(settings, project.id);

  // 询价第一档数量 / 强制编号：各家正文只差抬头，取任一封
  const sent = await db.pendingAction.findFirst({
    where: { type: TENDER_SEND_RFQ_TYPE, payload: { path: ["inquiryId"], equals: inquiry.id } },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });
  const body = (sent?.payload as { items?: Array<{ body?: string }> } | null)?.items?.[0]?.body ?? null;
  const rfq = rfqContextFromBody(body);

  const inputs: CompareInput[] = items.map((it) => {
    const notes = parseAutoNotes(it.quoteNotes);
    const quoted = {
      unitPrice: toNum(it.unitPrice),
      totalPrice: toNum(it.totalPrice),
      currency: it.currency,
      incoterm: notes.incoterm,
      moq: notes.moq,
      deliveryDays: it.deliveryDays,
      validUntil: it.validUntil ? it.validUntil.toISOString().slice(0, 10) : null,
    };
    return {
      itemId: it.id,
      supplierId: it.supplierId,
      supplierName: it.supplier?.name ?? "供应商",
      quoted,
      emailDate: it.repliedAt,
      mandatoryAnswers: notes.mandatoryAnswers,
      normalized: normalizeQuote(
        { unitPrice: quoted.unitPrice, totalPrice: quoted.totalPrice, currency: quoted.currency, incoterm: quoted.incoterm },
        { settings, dutyRatePct: overrides.dutyRatePct, quantity: rfq.firstTierQty, now },
      ),
    };
  });

  const matrix = buildCompareMatrix(inputs, {
    closeDate: project.closeDate,
    deliveryDeadline: overrides.deliveryDeadline,
    firstTierQty: rfq.firstTierQty,
    mandatoryCodes: rfq.mandatoryCodes,
    now,
  });
  return {
    ok: true,
    matrix,
    projectId: project.id,
    projectName: project.name,
    inquiryId: inquiry.id,
    roundNumber: inquiry.roundNumber,
    closeDate: project.closeDate ? project.closeDate.toISOString().slice(0, 10) : null,
  };
}
