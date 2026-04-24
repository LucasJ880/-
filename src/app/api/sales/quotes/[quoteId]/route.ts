import { NextResponse } from "next/server";
import { withAuth } from "@/lib/common/api-helpers";
import { db } from "@/lib/db";
import { isSuperAdmin } from "@/lib/rbac/roles";
import { calculateQuoteTotal } from "@/lib/blinds/pricing-engine";
import { getAddonDef } from "@/lib/blinds/pricing-addons";
import { parseAgreedPaymentFromFormDataJson } from "@/lib/sales/quote-agreed-payment";
import type {
  QuoteItemInput,
  QuoteAddonInput,
  InstallMode,
} from "@/lib/blinds/pricing-types";

/**
 * GET /api/sales/quotes/[quoteId]
 *
 * 返回单份报价单的完整数据（含 formDataJson、items、addons），
 * 供「编辑报价单」场景在前端恢复表单。
 *
 * 权限：销售仅可访问自己创建的 quote；admin/super_admin 可访问全部。
 */
export const GET = withAuth(async (_request, ctx, user) => {
  const { quoteId } = await ctx.params;

  const quote = await db.salesQuote.findUnique({
    where: { id: quoteId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      addons: true,
      customer: {
        select: { id: true, name: true, phone: true, email: true, address: true },
      },
    },
  });

  if (!quote) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }

  if (quote.createdById !== user.id && !isSuperAdmin(user.role)) {
    return NextResponse.json({ error: "无权查看此报价单" }, { status: 403 });
  }

  return NextResponse.json({ quote });
});

/**
 * PUT /api/sales/quotes/[quoteId]
 *
 * 更新已保存的报价单（保持 customerId / version / createdById / shareToken 不变）。
 * 行为与 POST /api/sales/quotes 一致：
 *   - pricing 失败不阻塞 → partial/shell 兜底
 *   - items / addons 全量替换（先 deleteMany 再 createMany）
 *   - status: full → 保持原 status（若原为 signed/accepted 等则不回退到 draft）
 *             partial/shell → 回到 draft
 *
 * 权限：
 *   - 销售仅可编辑自己创建的 quote
 *   - status === "signed" / "accepted" 的 quote，销售不可改（防误操作），
 *     admin 可强制修改
 */
export const PUT = withAuth(async (request, ctx, user) => {
  const { quoteId } = await ctx.params;
  const body = await request.json();
  const {
    items,
    addons,
    installMode,
    deliveryFee,
    taxRate,
    notes,
    orderNumber,
    formDataJson,
    totalMsrp,
    specialPromotion,
    finalDiscountPct,
    opportunityId,
  } = body as {
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

  const existing = await db.salesQuote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      customerId: true,
      createdById: true,
      status: true,
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "报价单不存在" }, { status: 404 });
  }

  const isAdmin = isSuperAdmin(user.role);
  if (existing.createdById !== user.id && !isAdmin) {
    return NextResponse.json({ error: "无权编辑此报价单" }, { status: 403 });
  }

  // 已签单 / 已接受的 quote 对销售锁定，admin 可强制改
  const lockedStatuses = new Set(["signed", "accepted"]);
  if (lockedStatuses.has(existing.status) && !isAdmin) {
    return NextResponse.json(
      {
        error:
          "该报价单已签单 / 已被客户接受，销售账号无法再修改；如需调整请联系管理员。",
      },
      { status: 403 },
    );
  }

  if ((!items || items.length === 0) && !formDataJson) {
    return NextResponse.json(
      { error: "需要 items 或 formDataJson 至少之一" },
      { status: 400 },
    );
  }

  // —— pricing 兜底，行为与 POST 完全一致 ——
  let calc: ReturnType<typeof calculateQuoteTotal>;
  try {
    calc = calculateQuoteTotal({
      items: items || [],
      addons,
      installMode,
      deliveryFee,
      taxRate,
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
      deliveryFee: deliveryFee ?? 50,
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

  // status 策略：partial/shell 回到 draft；full 则保留原 status（不降级也不升级）
  const nextStatus =
    saveMode === "full"
      ? existing.status
      : "draft";

  // pricing 警告 append 到 notes
  const pricingErrorNotes =
    calc.errors.length > 0
      ? `\n\n[Pricing Warnings @ ${new Date().toISOString()}]\n` +
        calc.errors
          .map(
            (e) =>
              `  #${e.index + 1} (${e.input.product} ${e.input.fabric}): ${e.error}`,
          )
          .join("\n")
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
        formDataJson: formDataJson ?? undefined,
        totalMsrp:
          typeof totalMsrp === "number" && Number.isFinite(totalMsrp)
            ? totalMsrp
            : null,
        specialPromotion:
          typeof specialPromotion === "number" && Number.isFinite(specialPromotion)
            ? Math.max(0, specialPromotion)
            : 0,
        finalDiscountPct:
          typeof finalDiscountPct === "number" && Number.isFinite(finalDiscountPct)
            ? Math.max(0, Math.min(1, finalDiscountPct))
            : null,
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
                  location: r.input.location || null,
                })),
              }
            : undefined,
        addons: addons?.length
          ? {
              create: addons.map((a) => {
                const def = getAddonDef(a.addonKey);
                return {
                  addonKey: a.addonKey,
                  displayName: def?.displayName || a.addonKey,
                  unitPrice: def?.unitPrice || 0,
                  qty: a.qty,
                  subtotal: (def?.unitPrice || 0) * a.qty,
                };
              }),
            }
          : undefined,
      },
      include: { items: true, addons: true },
    });

    return q;
  });

  return NextResponse.json({
    quote: updated,
    saveMode,
    pricing: {
      requestedItems,
      succeededItems,
      errors: calc.errors,
    },
    errors: calc.errors,
  });
});
