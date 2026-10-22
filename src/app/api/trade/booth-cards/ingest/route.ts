/**
 * POST /api/trade/booth-cards/ingest — 录入一张展会速记卡
 *
 * JSON：{ orgId?, event?, card }
 * 一张卡 = 一条询盘，走与网站询盘相同的链路（客户 / 商机 / RFQ / 评分 / 回复草稿进审批），
 * 事件身份 = card:<卡号>：同一张卡再次提交只补齐缺失步骤，不会多出线索。
 * 一张卡约 40–90 秒（含 AI），页面逐张调用并显示进度。
 */

import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { resolveTradeOrgId } from "@/lib/trade/access";
import { BOOTH_CARD_ROLES, boothCardFromInput, boothCardToInquiry, validateBoothCard } from "@/lib/trade/booth-cards";
import { ingestWebsiteInquiry } from "@/lib/trade/website-inquiry";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const auth = await requireRole(request, BOOTH_CARD_ROLES);
  if (auth instanceof NextResponse) return auth;

  const body = (await request.json().catch(() => null)) as
    | { orgId?: unknown; event?: unknown; card?: Record<string, unknown> }
    | null;
  if (!body || typeof body.card !== "object" || body.card === null) {
    return NextResponse.json({ error: "缺少卡片数据" }, { status: 400 });
  }

  const orgRes = await resolveTradeOrgId(request, auth.user, {
    bodyOrgId: typeof body.orgId === "string" ? body.orgId : null,
  });
  if (!orgRes.ok) return orgRes.response;

  const card = boothCardFromInput(body.card, typeof body.card.row === "number" ? body.card.row : 0);
  const errors = validateBoothCard(card);
  if (errors.length) {
    return NextResponse.json({ error: errors.join("；"), errors, cardNo: card.cardNo }, { status: 422 });
  }

  const event = typeof body.event === "string" ? body.event.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const normalized = boothCardToInquiry(card, event);
  if (!normalized.ok) {
    return NextResponse.json({ error: normalized.error, cardNo: card.cardNo }, { status: 422 });
  }

  try {
    const r = await ingestWebsiteInquiry(orgRes.orgId, normalized.value, {
      origin: { kind: "trade_show", event: event || null },
    });
    return NextResponse.json({
      ok: true,
      cardNo: card.cardNo,
      eventId: r.eventId,
      prospectId: r.prospectId || null,
      opportunityId: r.spine.ok ? r.spine.opportunityId : null,
      replay: r.replay,
      busy: r.busy,
      conflict: r.conflict,
      complete: r.complete,
      spineError: r.spine.ok ? null : r.spine.error,
      fde: r.fdeState
        ? {
            status: r.fdeState.status,
            terminal: r.fdeState.terminal,
            reason: r.fdeState.reason,
            pendingActionId: r.fdeState.pendingActionId,
          }
        : null,
    });
  } catch (err) {
    console.error(`[booth-cards] ${card.cardNo} ingest failed:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "录入失败", cardNo: card.cardNo },
      { status: 500 },
    );
  }
}
