/**
 * 报价修改的计算与落库（PUT /api/sales/quotes/[quoteId] 与签约改价审批执行器共用，PERM-4a design D5）
 *
 * - prepareQuoteUpdate：定价兜底（与 POST 一致）+ 折扣三档判定，只读，不写库
 * - commitQuoteUpdate：事务内全量替换 items / addons 并更新主表；签名作废时清理旧签署 PDF；直批时写审计
 *
 * 行为与 PERM-4a 之前的 PUT 完全一致，只是搬出路由。
 */

import { db } from "@/lib/db";
import { calculateQuoteTotal } from "@/lib/blinds/pricing-engine";
import { normalizeAddonInputs, resolveAddonLines } from "@/lib/blinds/pricing-addons";
import { loadDiscountsDto, applyOrgDiscountDefaults, dtoToProductDiscounts, dtoToCordlessPolicy } from "@/lib/blinds/discount-settings";
import { stampPricelistVersion } from "@/lib/blinds/pricelist-version";
import { costRateForProduct, snapshotCostPrice } from "@/lib/blinds/cost-rates";
import type { QuoteItemInput, QuoteAddonInput, InstallMode } from "@/lib/blinds/pricing-types";
import { loadPricingPolicy } from "@/lib/sales/pricing-policy";
import { decideDiscountTier } from "@/lib/sales/discount-tier";
import { parseAgreedPaymentFromFormDataJson } from "@/lib/sales/quote-agreed-payment";
import { logAudit } from "@/lib/audit/logger";
import { settleQuotePromotionApprovalAction } from "@/lib/pending-actions/quote-promotion-settle";

export type QuoteUpdateBody = {
  items?: QuoteItemInput[];
  addons?: QuoteAddonInput[];
  installMode?: InstallMode;
  deliveryFee?: number;
  taxRate?: number;
  notes?: string;
  orderNumber?: string;
  formDataJson?: string;
  totalMsrp?: number;
  specialPromotion?: number;
  finalDiscountPct?: number;
  opportunityId?: string;
};

export const QUOTE_UPDATE_EXISTING_SELECT = {
  id: true,
  customerId: true,
  createdById: true,
  status: true,
  grandTotal: true,
  updatedAt: true,
  orderNumber: true,
  signedAt: true,
  signedPdfPath: true,
  promotionApprovalStatus: true,
  promotionApprovalActionId: true,
  promotionApprovalAmount: true,
  promotionApprovalRatio: true,
  promotionApprovalMaxPct: true,
} as const;

export type QuoteUpdateExisting = {
  id: string;
  customerId: string;
  createdById: string;
  status: string;
  grandTotal: number;
  updatedAt: Date;
  orderNumber: string | null;
  signedAt: Date | null;
  signedPdfPath: string | null;
  promotionApprovalStatus: string;
  promotionApprovalActionId: string | null;
  promotionApprovalAmount: number | null;
  promotionApprovalRatio: number | null;
  promotionApprovalMaxPct: number | null;
};

/** 折扣三档按"谁的修改"判定：PUT 是当前用户，签约改价执行器是提交人 */
export type QuoteUpdateActor = {
  userId: string;
  isPlatformSuperAdmin: boolean;
  canSubmitOverLimit: boolean;
};

export async function prepareQuoteUpdate(input: {
  orgId: string;
  existing: QuoteUpdateExisting;
  body: QuoteUpdateBody;
  actor: QuoteUpdateActor;
}) {
  const { orgId, existing, body, actor } = input;
  const { items, addons, installMode, deliveryFee, taxRate, specialPromotion, finalDiscountPct } = body;

  // —— pricing 兜底，行为与 POST 完全一致 ——
  const quoteSettings = await loadDiscountsDto(orgId);
  // PRICE-3：Part B / 快速报价的附加项目——落库行与 addonsSubtotal 同一函数（design D4）
  const addonInputs = normalizeAddonInputs(addons);
  const addonResolved = resolveAddonLines(addonInputs, quoteSettings.addonPrices);
  const nextPromotionAmount = typeof specialPromotion === "number" && Number.isFinite(specialPromotion)
    ? Math.max(0, specialPromotion)
    : 0;
  const nextPromotionRatio = typeof finalDiscountPct === "number" && Number.isFinite(finalDiscountPct)
    ? Math.max(0, Math.min(1, finalDiscountPct))
    : 0;
  const approvalSnapshotMatches = ["pending", "approved"].includes(existing.promotionApprovalStatus)
    && existing.promotionApprovalAmount != null
    && existing.promotionApprovalRatio != null
    && Math.abs(existing.promotionApprovalAmount - nextPromotionAmount) <= 0.0001
    && Math.abs(existing.promotionApprovalRatio - nextPromotionRatio) <= 0.0001;
  // PERM-2：折扣三档；直批只来自 lead_direct / platform_self_approved
  const pricingPolicy = await loadPricingPolicy(orgId, quoteSettings.promoMaxPct);
  const tierDecision = decideDiscountTier({
    ratio: nextPromotionRatio,
    promoMaxPct: pricingPolicy.promoMaxPct,
    leadMaxPct: pricingPolicy.leadMaxPct,
    actor: { isPlatformSuperAdmin: actor.isPlatformSuperAdmin, canSubmitOverLimit: actor.canSubmitOverLimit },
  });
  const adminPromotionApproval = tierDecision.auditVia !== null;
  let calc: ReturnType<typeof calculateQuoteTotal>;
  try {
    calc = calculateQuoteTotal({
      // 2026-10-28：与 POST 一致，没有行级覆盖的行套企业折扣
      items: applyOrgDiscountDefaults(items || [], dtoToProductDiscounts(quoteSettings)),
      addons: addonInputs,
      addonPrices: quoteSettings.addonPrices,
      installMode,
      deliveryFee: deliveryFee ?? quoteSettings.deliveryFee,
      taxRate,
      sunnyMotorPrice: quoteSettings.sunnyMotorPrice,
      minInstallTotal: quoteSettings.minInstallFee,
      cordlessPolicy: dtoToCordlessPolicy(quoteSettings),
    });
  } catch (err) {
    console.error("[quotes.PUT] pricing engine threw:", err);
    calc = {
      itemResults: [],
      errors: (items || []).map((input, idx) => ({
        index: idx,
        input,
        error: `pricing 引擎异常：${err instanceof Error ? err.message : String(err)}`,
      })),
      merchSubtotal: 0,
      addonsSubtotal: 0,
      installSubtotal: 0,
      installApplied: 0,
      deliveryFee: deliveryFee ?? 0,
      preTaxTotal: 0,
      taxRate: taxRate ?? 0.13,
      taxAmount: 0,
      grandTotal: 0,
    };
  }

  const requestedItems = items?.length ?? 0;
  const succeededItems = calc.itemResults.length;

  let saveMode: "full" | "partial" | "shell";
  if (requestedItems === 0) {
    saveMode = "shell";
  } else if (succeededItems === requestedItems && calc.errors.length === 0) {
    saveMode = "full";
  } else if (succeededItems > 0) {
    saveMode = "partial";
  } else {
    saveMode = "shell";
  }

  return {
    quoteSettings,
    addonLines: addonResolved.lines,
    addonWarnings: addonResolved.warnings,
    pricingPolicy,
    tierDecision,
    adminPromotionApproval,
    approvalSnapshotMatches,
    nextPromotionAmount,
    nextPromotionRatio,
    calc,
    requestedItems,
    succeededItems,
    saveMode,
  };
}

export type PreparedQuoteUpdate = Awaited<ReturnType<typeof prepareQuoteUpdate>>;

export async function commitQuoteUpdate(input: {
  orgId: string;
  quoteId: string;
  existing: QuoteUpdateExisting;
  body: QuoteUpdateBody;
  prepared: PreparedQuoteUpdate;
  actor: QuoteUpdateActor;
}) {
  const { orgId, quoteId, existing, body, prepared, actor } = input;
  const { installMode, notes, orderNumber, formDataJson, totalMsrp, opportunityId } = body;
  const {
    quoteSettings,
    addonLines,
    addonWarnings,
    pricingPolicy,
    tierDecision,
    adminPromotionApproval,
    approvalSnapshotMatches,
    nextPromotionAmount,
    nextPromotionRatio,
    calc,
    requestedItems,
    succeededItems,
    saveMode,
  } = prepared;

  // 已签署的 quote 被（管理员）编辑 = 内容变更，旧签名作废，进入新一轮发送/签署。
  // 否则客户重开分享链接会看到"已签署"，且签的是修改前的旧内容。
  const invalidateSignature = Boolean(existing.signedAt);

  // status 策略：partial/shell 回到 draft；full 则保留原 status（不降级也不升级）；
  // 签名作废时统一回到 draft，由发送流程重新推进到 sent
  const nextStatus = invalidateSignature
    ? "draft"
    : saveMode === "full"
      ? existing.status
      : "draft";

  // pricing 警告 append 到 notes
  const pricingErrorNotes =
    calc.errors.length > 0 || addonWarnings.length > 0
      ? `\n\n[Pricing Warnings @ ${new Date().toISOString()}]\n` +
        [
          ...calc.errors.map(
            (e) =>
              `  #${e.index + 1} (${e.input.product} ${e.input.fabric}): ${e.error}`,
          ),
          ...addonWarnings.map((w) => `  ${w}`),
        ].join("\n")
      : "";
  const mergedNotes =
    [notes || "", pricingErrorNotes].filter(Boolean).join("").trim() || null;

  /** 未传 formDataJson 时不要清空历史约定（兼容非报价编辑端调用） */
  const agreedPatch =
    formDataJson !== undefined
      ? parseAgreedPaymentFromFormDataJson(formDataJson, calc.grandTotal)
      : null;

  // 事务：清空旧 items/addons，写入新数据，更新主表
  const updated = await db.$transaction(async (tx) => {
    await tx.salesQuoteItem.deleteMany({ where: { quoteId } });
    await tx.salesQuoteAddon.deleteMany({ where: { quoteId } });
    if (existing.promotionApprovalActionId) {
      if (adminPromotionApproval) {
        await settleQuotePromotionApprovalAction(tx, { actionId: existing.promotionApprovalActionId, orgId, mode: "approve", userId: actor.userId, quoteId });
      } else if (!approvalSnapshotMatches) {
        await settleQuotePromotionApprovalAction(tx, { actionId: existing.promotionApprovalActionId, orgId, mode: "invalidate", userId: actor.userId, quoteId });
      }
    }

    const q = await tx.salesQuote.update({
      where: { id: quoteId },
      data: {
        opportunityId: opportunityId ?? undefined,
        status: nextStatus,
        orderNumber: orderNumber ?? undefined,
        installMode: (installMode as string | undefined) ?? undefined,
        merchSubtotal: calc.merchSubtotal,
        addonsSubtotal: calc.addonsSubtotal,
        installSubtotal: calc.installSubtotal,
        installApplied: calc.installApplied,
        deliveryFee: calc.deliveryFee,
        preTaxTotal: calc.preTaxTotal,
        taxRate: calc.taxRate,
        taxAmount: calc.taxAmount,
        grandTotal: calc.grandTotal,
        notes: mergedNotes,
        // 2026-10-28：重算时同样记录当时的价表版本
        formDataJson: formDataJson !== undefined ? (stampPricelistVersion(formDataJson) ?? undefined) : undefined,
        totalMsrp:
          typeof totalMsrp === "number" && Number.isFinite(totalMsrp)
            ? totalMsrp
            : null,
        specialPromotion: nextPromotionAmount,
        finalDiscountPct: nextPromotionRatio,
        ...(adminPromotionApproval
          ? {
              promotionApprovalStatus: "approved",
              promotionApprovalActionId: existing.promotionApprovalActionId,
              promotionApprovalAmount: nextPromotionAmount,
              promotionApprovalRatio: nextPromotionRatio,
              promotionApprovalMaxPct: quoteSettings.promoMaxPct,
              promotionApprovalRequestedAt: null,
              promotionApprovalExpiresAt: null,
              promotionApprovalRequestedById: null,
              promotionApprovedAt: new Date(),
              promotionApprovedById: actor.userId,
              promotionRejectedAt: null,
              promotionRejectedById: null,
              promotionRejectionReason: null,
            }
          : !approvalSnapshotMatches
          ? {
              promotionApprovalStatus:
                nextPromotionRatio > quoteSettings.promoMaxPct ? "required" : "not_required",
              promotionApprovalActionId: null,
              promotionApprovalAmount: null,
              promotionApprovalRatio: null,
              promotionApprovalMaxPct: null,
              promotionApprovalRequestedAt: null,
              promotionApprovalExpiresAt: null,
              promotionApprovalRequestedById: null,
              promotionApprovedAt: null,
              promotionApprovedById: null,
              promotionRejectedAt: null,
              promotionRejectedById: null,
              promotionRejectionReason: null,
            }
          : {}),
        ...(invalidateSignature
          ? {
              signatureUrl: null,
              signedAt: null,
              signedPdfPath: null,
            }
          : {}),
        ...(agreedPatch
          ? {
              agreedDepositAmount: agreedPatch.agreedDepositAmount,
              agreedBalanceAmount: agreedPatch.agreedBalanceAmount,
            }
          : {}),
        items:
          succeededItems > 0
            ? {
                create: calc.itemResults.map((r, idx) => ({
                  sortOrder: idx,
                  product: r.input.product,
                  fabric: r.input.fabric,
                  sku: r.input.sku || null,
                  widthIn: r.input.widthIn,
                  heightIn: r.input.heightIn,
                  bracketWidth: r.bracketWidth,
                  bracketHeight: r.bracketHeight,
                  cordless: r.cordless,
                  msrp: r.msrp,
                  discountPct: r.discountPct,
                  discountValue: r.discountValue,
                  price: r.price,
                  installFee: r.install,
                  costPrice: snapshotCostPrice(r.price, costRateForProduct(quoteSettings.costRates, r.input.product)),
                  location: r.input.location || null,
                })),
              }
            : undefined,
        addons: addonLines.length
          ? { create: addonLines }
          : undefined,
      },
      include: { items: true, addons: true },
    });

    return q;
  });

  // 签名作废时清理旧的已签署 PDF 存档（失败不阻断）
  if (invalidateSignature && existing.signedPdfPath) {
    const { deleteBlob } = await import("@/lib/files/blob-access");
    await deleteBlob(existing.signedPdfPath).catch(() => undefined);
  }

  if (adminPromotionApproval) {
    await logAudit({
      userId: actor.userId,
      orgId,
      action: "quote_promotion_approved",
      targetType: "sales_quote",
      targetId: quoteId,
      afterData: {
        via: tierDecision.auditVia,
        tier: tierDecision.tier,
        selfApproved: tierDecision.selfApproved,
        promotionAmount: nextPromotionAmount,
        promotionRatio: nextPromotionRatio,
        maxPct: quoteSettings.promoMaxPct,
        leadMaxPct: pricingPolicy.leadMaxPct,
      },
    });
  }

  return {
    quote: updated,
    saveMode,
    pricing: {
      requestedItems,
      succeededItems,
      errors: calc.errors,
    },
    errors: calc.errors,
  };
}
