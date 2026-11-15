/**
 * 投标文件起草——装配 → 合成 → HTML → 元信息落库（从 generate-docs 的 bid_draft 分支原样移来）
 *
 * 装配（只读）→ LLM 合成（AI_DRAFT，能力/价格不编造）→ HTML；结果元信息落 room.summaryJson.bidDraft 供工作台卡片展示
 * （失败温和，不写半成品）。FLOW-H5：两道闸的开关开着时记下起草所用的分析与是否已批准，没批准的在草稿里加横幅
 * （不改输入与提示词）。deps.synthesize 只给测试注入假的合成用。
 */
import { db } from "@/lib/db";
import { UNCONFIRMED_BASIS_BANNER_EN, isDecisionGatesEnabledForOrg } from "@/lib/tender-decision-gates/gates";
import { gatherBidDraftInputsWithBasis } from "./gather";
import { bidDraftMetaOf } from "./meta";
import { renderBidDraftHtml } from "./render";
import { synthesizeBidDraft } from "./synthesize";

export async function buildBidDraftDocument(
  input: { projectId: string; orgId: string | null; userId: string },
  deps: { synthesize?: typeof synthesizeBidDraft } = {},
): Promise<string> {
  const synthesize = deps.synthesize ?? synthesizeBidDraft;
  const gathered = await gatherBidDraftInputsWithBasis({ projectId: input.projectId, orgId: input.orgId, userId: input.userId });
  if (!gathered) throw new Error("尚无已完成的分析，无法起草");
  const { inputs, basis } = gathered;
  const gates = isDecisionGatesEnabledForOrg(input.orgId);
  const { result, errorCode } = await synthesize(inputs);
  if (!result) throw new Error(`起草失败（${errorCode ?? "unknown"}）`);
  const html = renderBidDraftHtml(inputs, result, { unconfirmedBasisBanner: gates && !basis.approved ? UNCONFIRMED_BASIS_BANNER_EN : null });
  try {
    const room = await db.bidIntelligenceRoom.findUnique({ where: { projectId: input.projectId }, select: { id: true, summaryJson: true } });
    if (room) {
      const rsj = ((room.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;
      await db.bidIntelligenceRoom.update({
        where: { id: room.id },
        data: { summaryJson: JSON.parse(JSON.stringify({ ...rsj, bidDraft: bidDraftMetaOf(result, gates ? basis : null) })) },
      });
    }
  } catch {
    // 元信息落库失败不影响文档产出
  }
  return html;
}
