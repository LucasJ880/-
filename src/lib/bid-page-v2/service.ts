/**
 * BIDPAGE-1「标书与报价」页汇总——取数（只读，不写任何东西）
 *
 * 「当前这份分析」复用项目页「下一步」（FLOW-H1）的取数 loadWebNextStepInput，保证两处说的是同一份分析；
 * 其余事实（供应商、询价明细、待批询价卡张数、引擎报价、我方报价、生成文件种类）在这里另查。
 * 每一条查询都按项目限定，能按组织限定的另按组织限定；组织只取自调用方已经核对过的项目记录。
 * 询价按供应商算：每家取它最近一次发出的那一轮（没取消的轮次里，按轮次号最大）的状态；任何一轮报过价就算已报价；
 * 「在等」= 最近一次是已发出、那一轮没结束、发出不到 90 天（与定时催单扫描、FLOW-H1 同一个时间窗）。
 * 金额只在 canViewAmounts 为真且报价功能开通时读出（resolveTenderBid 的 internal 与之相同）；
 * resolveTenderBid 的结果不透传：只取状态、版本、售价（看得到金额时）、币种（同上）与可选报价的份数。
 */
import { db } from "@/lib/db";
import { isLegacyGarbledGeneratedDoc } from "@/lib/projects/generate/legacy-doc-filter";
import { isLineModeQuote } from "./quote-line/contract";
import { resolveTenderBid } from "@/lib/quote-engine/tender-bid";
import { loadWebNextStepInput, type NextStepProject } from "@/lib/tender-next-step/service";
import { countInquiry } from "./inquiry-count";
import { decideBidPageNextStep, type BidPageFacts, type BidPageView, type BidTenderStatus } from "./next-step";

export type BidPageAccess = {
  /** 有项目编辑权限（与写接口同一组条件）：生成文件要它 */
  canManage: boolean;
  /** 报价功能是否开通（报价引擎开关） */
  quoteAvailable: boolean;
  /** 同时有报价内部成本权限与财务查看权 */
  canViewAmounts: boolean;
};

export async function loadBidPageFacts(input: { project: NextStepProject; userId: string; access: BidPageAccess; now: Date }): Promise<BidPageFacts> {
  const { project, now, access } = input;
  const projectId = project.id;
  const orgId = project.orgId;

  const [base, items, links, pendingRfqApprovals] = await Promise.all([
    loadWebNextStepInput({ project, userId: input.userId, canManage: access.canManage, now }),
    // 没取消的轮次里的全部明细（只取状态、发出时间、供应商与所在轮次）
    db.inquiryItem.findMany({
      where: { inquiry: { projectId, project: { orgId }, status: { not: "canceled" } } },
      select: { supplierId: true, status: true, sentAt: true, inquiry: { select: { roundNumber: true, status: true } } },
    }),
    // 关联卡里没标「未入选」的供应商
    db.projectSupplierLink.findMany({ where: { projectId, orgId, role: { not: "rejected" } }, select: { supplierId: true } }),
    // 待批、未过期的发询价卡（只要张数，不按看的人过滤、不出标题）
    db.pendingAction.count({ where: { projectId, orgId, type: "tender.send_rfq", status: "pending", expiresAt: { gt: now } } }),
  ]);

  const suppliers = new Set<string>([...links.map((l) => l.supplierId), ...items.map((i) => i.supplierId)]);
  const inquiry = countInquiry(
    items.map((i) => ({ supplierId: i.supplierId, status: i.status, sentAt: i.sentAt, roundNumber: i.inquiry.roundNumber, roundStatus: i.inquiry.status })),
    now,
  );

  let bid: BidPageFacts["quote"]["bid"] = { status: "NONE", version: null, amount: null };
  let openDraft: BidPageFacts["quote"]["openDraft"] = null;
  let approvedUnselected = 0;
  if (access.quoteAvailable) {
    const [resolution, draft] = await Promise.all([
      resolveTenderBid({ projectId, orgId, internal: access.canViewAmounts }),
      db.projectQuote.findFirst({
        where: { projectId, orgId, quoteType: { not: "CUSTOM" }, status: { in: ["draft", "review"] } },
        orderBy: [{ updatedAt: "desc" }],
        select: { status: true, version: true },
      }),
    ]);
    const status: BidTenderStatus = resolution.status;
    const q = resolution.quote;
    const price = q?.sellingPrice;
    // 我方报价是不是逐行报价（BIDPAGE-3）：只读做法字段，决定「已定」的按钮去 ② 还是 ③
    // 只给看得到金额的人读（② 对其余人锁着，去处不随做法变）
    const bidQuote = access.canViewAmounts && status === "AUTHORITATIVE" && q ? await db.projectQuote.findFirst({ where: { id: q.id, projectId, orgId }, select: { engineJson: true, quoteType: true } }) : null;
    const lineMode = !!bidQuote && isLineModeQuote(bidQuote);
    bid = {
      status,
      version: q?.version ?? null,
      // 与「我方报价」卡同一个数（resolveTenderBid → summarize：实时计算，计算无效时沿用快照）
      amount: access.canViewAmounts && status === "AUTHORITATIVE" && q && typeof price === "number" && Number.isFinite(price) ? { value: price, currency: q.currency } : null,
      lineMode,
    };
    openDraft = draft ? { status: draft.status === "review" ? "review" : "draft", version: draft.version } : null;
    // 还没有我方报价、但有已批准（或已中标）的报价可选（自动选中只在恰好一份时发生）
    approvedUnselected = status === "NONE" ? resolution.candidates.length : 0;
  }

  let generatedKinds = 0;
  if (access.canManage) {
    const docs = await db.projectGeneratedDocument.findMany({ where: { projectId }, select: { docType: true, metaJson: true, blobUrl: true } });
    generatedKinds = new Set(docs.filter((d) => !isLegacyGarbledGeneratedDoc(d)).map((d) => d.docType)).size;
  }

  return {
    now,
    analysisStatus: base.analysisStatus,
    supplierCount: suppliers.size,
    pendingRfqApprovals,
    inquiry,
    quote: { available: access.quoteAvailable, bid, openDraft, approvedUnselected },
    documents: { canGenerate: access.canManage, generatedKinds },
    canViewAmounts: access.canViewAmounts,
  };
}

export async function loadBidPageView(input: { project: NextStepProject; userId: string; access: BidPageAccess; now?: Date }): Promise<BidPageView> {
  const now = input.now ?? new Date();
  return decideBidPageNextStep(await loadBidPageFacts({ ...input, now }));
}
