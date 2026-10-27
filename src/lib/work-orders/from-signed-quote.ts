/**
 * 签名 → 工艺单：单一入口
 *
 * 由两条签名路径各调一次（线上公开页签字 / 线下 mark-signed）：
 *   - **不挂进 onQuoteSigned** —— 它在 opportunityId 为空时直接 return null，
 *     无商机的单会被静默漏掉。
 *   - fire-and-forget + 全程 catch：签名是钱，工艺单是活儿，
 *     工艺单生成失败绝不能让客户签不成。
 *   - 幂等键 VinylOrder.quoteId / BlindsOrder.quoteId @unique；并发重复签名靠捕获 P2002 兜底。
 *
 * 分流（按报价单品类）：
 *   Shutters + Vinyl  → VinylOrder
 *   Shutters + Wooden → 未接入（Wooden 工艺单待上传，见 WOODEN_PENDING）
 *   Shades（Zebra / Roller / SHANGRILA）→ BlindsOrder
 *                       （依赖迁移 20260829230000_add_blinds_order_org_and_quote）
 *   Drapery / Sheer   → 无工艺引擎
 */

import { db } from "@/lib/db";
import { parseQuoteFormSnapshot } from "./quote-form-snapshot";
import { isWorkOrderAutogenEnabled } from "./flags";
import {
  mapShutterLineToVinyl,
  resolveLouverSize,
  type WorkOrderNote,
} from "@/lib/vinyl/from-quote";
import { calculateVinylItem } from "@/lib/vinyl/calculation-engine";
import { mapShadeLineToBlinds } from "@/lib/blinds/from-quote";
import { calculateItem as calculateBlindsItem } from "@/lib/blinds/calculation-engine";
import { RULE_VERSION as BLINDS_RULE_VERSION } from "@/lib/blinds/deduction-rules";
import { loadPanelCodeOverrides } from "@/lib/vinyl/panel-code-store";
import { VINYL_RULE_VERSION } from "@/lib/vinyl/frame-rules";

export type SkipReason =
  | "FLAG_OFF"
  | "QUOTE_NOT_FOUND"
  | "NOT_SIGNED"
  | "ALREADY_GENERATED"
  | "NO_FORM_DATA"
  | "NO_SHUTTER_LINES"
  | "WOODEN_PENDING"
  | "LOUVER_UNSUPPORTED";

export interface WorkOrderOutcome {
  /** 生成的 Vinyl 工艺单 id；null = 未生成 */
  vinylOrderId: string | null;
  vinylOrderCode: string | null;
  /** 生成的 Blinds 工艺单 id；null = 未生成 */
  blindsOrderId: string | null;
  blindsOrderCode: string | null;
  /** 未生成时的原因 */
  skipped: SkipReason | null;
  skipMessage: string | null;
  /** 待补项数（kind=todo），供签约通知回写给销售 */
  todoCount: number;
  /** 用了默认值、需要确认的项数 */
  defaultCount: number;
  /** 其他品类的未接入提示 */
  pending: string[];
}

const EMPTY: WorkOrderOutcome = {
  vinylOrderId: null,
  vinylOrderCode: null,
  blindsOrderId: null,
  blindsOrderCode: null,
  skipped: null,
  skipMessage: null,
  todoCount: 0,
  defaultCount: 0,
  pending: [],
};

function skip(reason: SkipReason, message: string, pending: string[] = []): WorkOrderOutcome {
  return { ...EMPTY, skipped: reason, skipMessage: message, pending };
}

/** 工单号：优先用报价单的 Order#，缺失时退化为可追溯的派生号 */
function deriveCode(orderNumber: string | null, quoteId: string): string {
  const n = String(orderNumber ?? "").trim();
  return n ? `${n}-V` : `V-${quoteId.slice(-10).toUpperCase()}`;
}

export interface EnsureOptions {
  /**
   * auto   —— 签名时自动触发，受 SALES_WORKORDER_AUTOGEN_ENABLED 门控
   * manual —— 人在界面上明确点了「生成工艺单」，不受 flag 限制
   *
   * 这样拆的原因：flag 管的是"要不要在签约瞬间自动建单"这个自动化行为；
   * 手动生成是操作员的明确意图，是灰度期的正常用法
   *（先手动跑几单验证，确认无误再打开自动）。
   */
  trigger?: "auto" | "manual";
}

export async function ensureWorkOrdersFromSignedQuote(
  quoteId: string,
  opts: EnsureOptions = {},
): Promise<WorkOrderOutcome> {
  const trigger = opts.trigger ?? "auto";
  if (trigger === "auto" && !isWorkOrderAutogenEnabled()) {
    return skip("FLAG_OFF", "签名自动生成工艺单未启用（可在报价记录里手动生成）");
  }

  const quote = await db.salesQuote.findUnique({
    where: { id: quoteId },
    select: {
      id: true,
      orgId: true,
      status: true,
      signedAt: true,
      orderNumber: true,
      formDataJson: true,
      customerId: true,
      opportunityId: true,
      createdById: true,
      customer: { select: { name: true, phone: true, address: true } },
    },
  });
  if (!quote) return skip("QUOTE_NOT_FOUND", `报价单 ${quoteId} 不存在`);
  if (!quote.signedAt) return skip("NOT_SIGNED", "报价单尚未签署");

  // 幂等：一张报价至多一张 Vinyl 工艺单
  const existing = await db.vinylOrder.findUnique({
    where: { quoteId: quote.id },
    select: { id: true, code: true },
  });
  if (existing) {
    return {
      ...EMPTY,
      vinylOrderId: existing.id,
      vinylOrderCode: existing.code,
      skipped: "ALREADY_GENERATED",
      skipMessage: `已生成过工艺单 ${existing.code}`,
    };
  }

  const snap = parseQuoteFormSnapshot(quote.formDataJson);
  if (!snap.ok) return skip("NO_FORM_DATA", "报价单没有可解析的表单快照");

  const pending: string[] = [];
  if (snap.drapeOrderCount > 0) {
    pending.push(`本单含 ${snap.drapeOrderCount} 行 Drapery/Sheer —— 无对应工艺引擎`);
  }

  const notes: WorkOrderNote[] = [];

  // ── Shades → Blinds 工艺单 ──
  let blinds: { id: string; code: string } | null = null;
  if (snap.shadeOrders.length > 0) {
    blinds = await createBlindsOrder(quote, snap.shadeOrders, notes);
  }

  if (snap.shutterOrders.length === 0) {
    // 没有 Shutters 但有 Shades：仍算成功（Blinds 单已建），不是 skip
    if (blinds) {
      return {
        ...EMPTY,
        blindsOrderId: blinds.id,
        blindsOrderCode: blinds.code,
        todoCount: notes.filter((n) => n.kind === "todo").length,
        defaultCount: notes.filter((n) => n.kind === "default").length,
        pending,
      };
    }
    return skip("NO_SHUTTER_LINES", "本单没有可生成工艺单的产品行", pending);
  }

  // Wooden：工艺单待上传，先留扣子
  if (snap.shutterMaterial !== "Vinyl") {
    return {
      ...skip(
        "WOODEN_PENDING",
        `Shutters 材质为「${snap.shutterMaterial || "未选"}」，Wooden 工艺单尚未接入，未生成`,
        pending,
      ),
      blindsOrderId: blinds?.id ?? null,
      blindsOrderCode: blinds?.code ?? null,
      todoCount: notes.filter((n) => n.kind === "todo").length,
      defaultCount: notes.filter((n) => n.kind === "default").length,
    };
  }

  const louver = resolveLouverSize(snap.shutterLouverSize);
  if (!louver.ok) {
    // 百叶尺寸决定片数/间距/全部下料长度；算不出就不该生成一张全是 0 的工艺单
    return {
      ...skip("LOUVER_UNSUPPORTED", louver.reason, pending),
      blindsOrderId: blinds?.id ?? null,
      blindsOrderCode: blinds?.code ?? null,
      todoCount: notes.filter((n) => n.kind === "todo").length,
      defaultCount: notes.filter((n) => n.kind === "default").length,
    };
  }

  const overrides = await loadPanelCodeOverrides(quote.orgId);

  const itemRows = snap.shutterOrders.map((line, i) => {
    const mapped = mapShutterLineToVinyl(line, i + 1, {
      louverSize: louver.louverSize,
      panelCodeOverrides: overrides,
    });
    notes.push(...mapped.notes);

    const calc = calculateVinylItem(mapped.input, {
      louverSize: louver.louverSize,
      panelCodeOverrides: overrides,
    });

    // 映射待补 + 引擎告警合并落库，工厂端一处看全
    const rowNotes: WorkOrderNote[] = [
      ...mapped.notes,
      ...calc.warnings.map((w) => ({
        code: w.code,
        message: `#${i + 1} ${line.location || "(未命名)"}: ${w.message}`,
        kind: "todo" as const,
      })),
    ];

    return {
      itemNumber: i + 1,
      location: mapped.input.location ?? "",
      width: mapped.input.width,
      height: mapped.input.height,
      panelCount: mapped.input.panelCount,
      panelCode: mapped.input.panelCode,
      dividerSpec: mapped.input.dividerSpec ?? null,
      specialMidRail: mapped.input.specialMidRail ?? null,
      midRailRatio: mapped.input.midRailRatio ?? null,
      tiltRodPosition: mapped.input.tiltRodPosition ?? null,
      frameType: mapped.input.frameType,
      frameCount: mapped.input.frameCount,
      inOut: mapped.input.inOut,
      structure: mapped.input.structure,
      itemRemark: mapped.input.itemRemark ?? null,
      frameSignature: calc.frameSignature,
      cavityWidth: calc.cavityWidth,
      cavityHeight: calc.cavityHeight,
      panelWidth: calc.panelWidth,
      panelHeight: calc.panelHeight,
      midRail: calc.midRail,
      midRailFromBottom: calc.midRailFromBottom,
      topLouvers: calc.topLouvers,
      bottomLouvers: calc.bottomLouvers,
      louverPitch: calc.louverPitch,
      strips: calc.panelSpec?.strips ?? null,
      caps: calc.panelSpec?.caps ?? null,
      squareFeet: calc.squareFeet,
      warningsJson: rowNotes.length ? JSON.stringify(rowNotes) : null,
      sortOrder: i,
    };
  });

  const code = deriveCode(quote.orderNumber, quote.id);

  let created: { id: string; code: string };
  try {
    created = await db.vinylOrder.create({
      data: {
        orgId: quote.orgId,
        code,
        status: "draft",
        ruleVersion: VINYL_RULE_VERSION,
        customerName: quote.customer?.name ?? "(未知客户)",
        phone: quote.customer?.phone ?? null,
        address: quote.customer?.address ?? null,
        louverSize: louver.louverSize,
        creatorId: quote.createdById,
        customerId: quote.customerId,
        opportunityId: quote.opportunityId,
        quoteId: quote.id,
        items: { create: itemRows },
      },
      select: { id: true, code: true },
    });
  } catch (e) {
    // P2002：并发下另一次签名已经建好了 —— 幂等，不是错误
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      const race = await db.vinylOrder.findUnique({
        where: { quoteId: quote.id },
        select: { id: true, code: true },
      });
      if (race) {
        return {
          ...EMPTY,
          vinylOrderId: race.id,
          vinylOrderCode: race.code,
          skipped: "ALREADY_GENERATED",
          skipMessage: `并发生成，复用 ${race.code}`,
          pending,
        };
      }
    }
    throw e;
  }

  return {
    vinylOrderId: created.id,
    vinylOrderCode: created.code,
    blindsOrderId: blinds?.id ?? null,
    blindsOrderCode: blinds?.code ?? null,
    skipped: null,
    skipMessage: null,
    todoCount: notes.filter((n) => n.kind === "todo").length,
    defaultCount: notes.filter((n) => n.kind === "default").length,
    pending,
  };
}

/**
 * 供签名路由调用的安全包装：任何异常只记日志，绝不外抛。
 * 签名主流程已经把钱收了，工艺单生成失败只是"活儿还没排"，
 * 客户详情页有「重新生成工艺单」入口可以重试。
 */
export async function ensureWorkOrdersFromSignedQuoteSafe(
  quoteId: string,
  opts: EnsureOptions = {},
): Promise<WorkOrderOutcome | null> {
  try {
    return await ensureWorkOrdersFromSignedQuote(quoteId, opts);
  } catch (err) {
    console.error(`[work-orders] 自动生成工艺单失败 quote=${quoteId}:`, err);
    return null;
  }
}

/**
 * Shades → BlindsOrder。
 *
 * 与 Vinyl 侧同纪律：幂等键 BlindsOrder.quoteId @unique；
 * 落库存签名那一刻的计算快照，导出时仍按本单 ruleVersion 重算。
 */
async function createBlindsOrder(
  quote: {
    id: string;
    orgId: string;
    orderNumber: string | null;
    customerId: string;
    opportunityId: string | null;
    createdById: string;
    customer: { name: string; phone: string | null; address: string | null } | null;
  },
  lines: import("./quote-form-snapshot").QuoteShadeLine[],
  notes: WorkOrderNote[],
): Promise<{ id: string; code: string } | null> {
  const existing = await db.blindsOrder.findUnique({
    where: { quoteId: quote.id },
    select: { id: true, code: true },
  });
  if (existing) return existing;

  const itemRows = lines.map((line, i) => {
    const mapped = mapShadeLineToBlinds(line, i + 1);
    notes.push(...mapped.notes);

    const calc = calculateBlindsItem(mapped.input, BLINDS_RULE_VERSION);

    // 布纱比查不到不是错误，但工厂需要知道（斑马帘裁剪位会空着）
    if (mapped.input.productType === "斑马帘" && calc.ratioSource !== "manual" && calc.ratioSource !== "catalog") {
      notes.push({
        code: "MISSING_FABRIC_RATIO",
        message: `#${i + 1} ${line.location || "(未命名)"}: 面料「${line.sku || "(空)"}」${
          calc.ratioSource === "conflict" ? "在布纱比目录里有两个不同比例" : "不在布纱比目录里"
        }，斑马帘裁剪位将留空`,
        kind: "todo",
      });
    }

    return {
      itemNumber: i + 1,
      location: mapped.input.location,
      width: mapped.input.width,
      height: mapped.input.height,
      fabricSku: mapped.input.fabricSku,
      productType: mapped.input.productType,
      measureType: mapped.input.measureType,
      controlType: mapped.input.controlType,
      controlSide: mapped.input.controlSide,
      headrailType: mapped.input.headrailType,
      mountType: mapped.input.mountType,
      fabricRatio: calc.fabricRatioUsed,
      silkRatio: calc.silkRatioUsed,
      bottomBarWidth: null,
      itemRemark: line.note || null,
      cutHeadrail: calc.cutHeadrail,
      cutTube38: calc.cutTube38,
      cutRollerBar: calc.cutRollerBar,
      cutZebraBar: calc.cutZebraBar,
      cutCoreRod: calc.cutCoreRod,
      cutShangrilaBar: calc.cutShangrilaBar,
      cutFabricWidth: calc.cutFabricWidth,
      cutFabricLength: calc.cutFabricLength,
      insertSize: calc.insertSize,
      cordLength: calc.cordLength,
      cordSleeveLen: calc.cordSleeveLen,
      squareFeet: calc.squareFeet,
      sortOrder: calc.sortOrder,
    };
  });

  const n = String(quote.orderNumber ?? "").trim();
  const code = n ? `${n}-B` : `B-${quote.id.slice(-10).toUpperCase()}`;

  try {
    return await db.blindsOrder.create({
      data: {
        orgId: quote.orgId,
        code,
        status: "draft",
        ruleVersion: BLINDS_RULE_VERSION,
        customerName: quote.customer?.name ?? "(未知客户)",
        phone: quote.customer?.phone ?? null,
        address: quote.customer?.address ?? null,
        creatorId: quote.createdById,
        customerId: quote.customerId,
        opportunityId: quote.opportunityId,
        quoteId: quote.id,
        items: { create: itemRows },
      },
      select: { id: true, code: true },
    });
  } catch (e) {
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      // 并发下另一次签名已建好 —— 幂等，复用
      return db.blindsOrder.findUnique({
        where: { quoteId: quote.id },
        select: { id: true, code: true },
      });
    }
    throw e;
  }
}
