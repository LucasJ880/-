import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { withAuth } from '@/lib/common/api-helpers';
import { db } from '@/lib/db';
import { calculateQuoteTotal } from '@/lib/blinds/pricing-engine';
import type { QuoteItemInput, QuoteAddonInput, InstallMode } from '@/lib/blinds/pricing-types';
import { onQuoteCreated } from '@/lib/sales/opportunity-lifecycle';
import { getAddonDef } from '@/lib/blinds/pricing-addons';
import { parseAgreedPaymentFromFormDataJson } from '@/lib/sales/quote-agreed-payment';

/**
 * POST /api/sales/quotes
 *
 * 数据不丢兜底策略（saveMode 三档）：
 *
 *   full    —— pricing 成功且至少一条 item 算出 → 走正常 lifecycle，status 由生命周期推进
 *   partial —— 部分 item 算出、部分失败       → 只存成功的 items，status="draft"，不推进生命周期
 *   shell   —— pricing 全失败 / 未提供 items  → 只存主表 + formDataJson，status="draft"
 *
 * 核心原则：
 *   只要 customerId + formDataJson 存在，请求永远返回 2xx 且有 quoteId。
 *   这样前端可以安全地 clearDraft()，不会再出现"保存失败但草稿也被擦掉"。
 *
 *   pricing 失败不再阻塞落库 —— 错误信息会 append 到 quote.notes 里，
 *   便于 admin / 销售回查和手工修正。
 */
export const POST = withAuth(async (request, _ctx, user) => {
  const body = await request.json();
  const {
    customerId,
    opportunityId,
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
  } = body as {
    customerId: string;
    opportunityId?: string;
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
  };

  // —— 兜底最低要求：customerId 必须有；没 items 也要有 formDataJson 才能救回来 ——
  if (!customerId) {
    return NextResponse.json({ error: '缺少 customerId' }, { status: 400 });
  }
  if ((!items || items.length === 0) && !formDataJson) {
    return NextResponse.json(
      { error: '需要 items 或 formDataJson 至少之一' },
      { status: 400 },
    );
  }

  // —— 尝试 pricing 计算；失败也不抛错 ——
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
    // 极端情况：pricing 引擎自己 throw 了（理论上不会，但保险起见）
    console.error('[quotes.POST] pricing engine threw:', err);
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

  // —— 决定保存模式 ——
  let saveMode: 'full' | 'partial' | 'shell';
  let quoteStatus: string;
  if (requestedItems === 0) {
    saveMode = 'shell';
    quoteStatus = 'draft';
  } else if (succeededItems === requestedItems && calc.errors.length === 0) {
    saveMode = 'full';
    quoteStatus = 'draft'; // 默认 draft，lifecycle 里再按业务推进
  } else if (succeededItems > 0) {
    saveMode = 'partial';
    quoteStatus = 'draft';
  } else {
    saveMode = 'shell';
    quoteStatus = 'draft';
  }

  // —— pricing 错误写进 notes，方便销售/管理员肉眼回查 ——
  const pricingErrorNotes =
    calc.errors.length > 0
      ? `\n\n[Pricing Warnings @ ${new Date().toISOString()}]\n` +
        calc.errors
          .map((e) => `  #${e.index + 1} (${e.input.product} ${e.input.fabric}): ${e.error}`)
          .join('\n')
      : '';
  const mergedNotes = [notes || '', pricingErrorNotes].filter(Boolean).join('').trim() || null;

  const existingCount = await db.salesQuote.count({ where: { customerId } });
  const shareToken = randomBytes(16).toString('hex');
  const agreed = parseAgreedPaymentFromFormDataJson(formDataJson, calc.grandTotal);

  const quote = await db.salesQuote.create({
    data: {
      customerId,
      opportunityId: opportunityId || null,
      version: existingCount + 1,
      shareToken,
      status: quoteStatus,
      orderNumber: orderNumber || null,
      installMode: installMode || 'default',
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
      formDataJson: formDataJson || null,
      totalMsrp: typeof totalMsrp === 'number' && Number.isFinite(totalMsrp) ? totalMsrp : null,
      specialPromotion:
        typeof specialPromotion === 'number' && Number.isFinite(specialPromotion)
          ? Math.max(0, specialPromotion)
          : 0,
      finalDiscountPct:
        typeof finalDiscountPct === 'number' && Number.isFinite(finalDiscountPct)
          ? Math.max(0, Math.min(1, finalDiscountPct))
          : null,
      agreedDepositAmount: agreed.agreedDepositAmount,
      agreedBalanceAmount: agreed.agreedBalanceAmount,
      createdById: user.id,
      // 只有算成功的 item 才入表；shell / 全失败情况下不建 item
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

  // —— 只有 full 模式才推进商机 lifecycle，避免"半成品"误升到 quoted ——
  let lifecycleResult = { opportunityId: null as string | null, advanced: false };
  if (saveMode === 'full') {
    lifecycleResult = await onQuoteCreated(
      quote.id,
      customerId,
      calc.grandTotal,
      opportunityId || null,
    ).catch((err) => {
      console.error('Lifecycle automation error:', err);
      return { opportunityId: null, advanced: false };
    });
  }

  return NextResponse.json(
    {
      quote,
      saveMode,
      pricing: {
        requestedItems,
        succeededItems,
        errors: calc.errors,
      },
      errors: calc.errors, // 兼容旧前端
      lifecycle: {
        opportunityId: lifecycleResult.opportunityId,
        autoAdvanced: lifecycleResult.advanced,
      },
    },
    { status: 201 },
  );
});
