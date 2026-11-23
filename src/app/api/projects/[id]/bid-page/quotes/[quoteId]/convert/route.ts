/**
 * BIDPAGE-4 逐行 ↔ 总价的互转（openspec change quote-lump-sum-mode，spec tender/quote-lump-sum-mode「转换前后报价引擎算出的数不变」）
 *
 * POST /api/projects/{id}/bid-page/quotes/{quoteId}/convert —— 编辑权限 + 财务查看权：{ to: "LUMP_SUM" | "LINE", baseUpdatedAt }
 *   → 算出要写的行 → 用报价引擎核对前后结果、过目标做法的校验 → 事务写 → 快照 → 审计；成功 200 { id, entryMode }
 *
 * 不能转（不是逐行或总价报价、已是目标做法、币种不是加元、前后结果不同、同一项两条、货品是总数等）→ 409 并写明原因；冻结 / 别人改过 → 409。
 * 第一步就是报价权限守卫并紧接着检查（FIX-21）。
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireQuoteAccess } from "@/lib/quote-engine/access";
import { lineModeErrorResponse, lineModeGate } from "@/lib/bid-page-v2/quote-line/api-gate";
import { convertRequestSchema } from "@/lib/bid-page-v2/lump-sum/contract";
import { convertQuote } from "@/lib/bid-page-v2/lump-sum/service";

type Ctx = { params: Promise<{ id: string; quoteId: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id: projectId, quoteId } = await params;
  const access = await requireQuoteAccess(request, projectId, "edit");
  if (access instanceof NextResponse) return access;
  const gate = await lineModeGate(access);
  if (gate instanceof NextResponse) return gate;
  const parsed = convertRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "提交的内容格式不对，请刷新后再试", code: "VALIDATION" }, { status: 400 });
  try {
    return NextResponse.json(await convertQuote({ projectId, orgId: access.orgId, quoteId, userId: access.user.id, request: parsed.data }));
  } catch (e) {
    const res = lineModeErrorResponse(e);
    if (res) return res;
    throw e;
  }
}
