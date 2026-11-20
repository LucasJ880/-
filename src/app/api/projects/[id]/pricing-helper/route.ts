import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
  type ProjectAccessContext,
} from "@/lib/projects/access";
import { decideFinancePrivilege, resolveFinancePrivilege } from "@/lib/project-finance/access";
import { isPlatformSuperAdmin } from "@/lib/rbac/roles";
import {
  PRICING_MODEL_VERSION,
  type PricingInputs,
  type ScoringModel,
} from "@/lib/tender-pricing/calc";
import { deriveScoringModel, heuristicScoringModel } from "@/lib/tender-pricing/derive";
import {
  PRICING_DERIVE_AT_KEY,
  PRICING_DERIVE_RATE_WINDOW_MS,
  PRICING_INPUTS_KEY,
  PRICING_MODEL_KEY,
  isScoringModel,
  latestPricingRun,
  pricingEvalTexts,
  readPricingBenchmark,
} from "@/lib/tender-pricing/project-context";
import {
  isPricingCompareSourceEnabledForOrg,
  nextCostSource,
  readCostClaim,
  readCostSource,
  staleNoteZh,
  type CompareCostView,
} from "@/lib/tender-pricing/compare-cost-source";
import { loadCompareCostSuggestionSafe } from "@/lib/tender-pricing/compare-cost-source-load";
import { lockProject } from "@/lib/quote-engine/tender-bid";
import {
  COST_WRITE_FORBIDDEN_ZH,
  buildPricingHelperView,
  buildSavedInputsView,
  touchesCost,
} from "@/lib/tender-pricing/finance-view";

/**
 * 报价表助手（tender-pricing/v1）
 * GET  → 评分模型（人工覆盖 > 已推导 > 即时启发式）+ 价格带（现任线索/联邦对标）
 *        + 人工输入 + 情景表/打平价。零模型花费（LLM 只在 POST derive）。
 * POST { action:"save", inputs?, model? }   → 存 room.summaryJson.pricingInputs / pricingModel(HUMAN)
 * POST { action:"derive" }                  → LLM 从事实重新推导模型（60s 频控，AI_INFERRED）
 * 纪律：计算结果是假设驱动的情景，不是报价决定；绝不 GO/NO-GO。
 * FLOW-H2（开关 TENDER_PRICING_COMPARE_SOURCE_ENABLED）：GET 多返回 compareCost（比价矩阵里人工选定那一家的落地价建议、
 * 已保存成本的来源、矩阵变了的提示）；POST save 可带 ourCostSource 声明，服务端重新取数核对，到分相同才记来源。
 * CHAIN-2b：我方成本、落地价只给有财务查看权的人（与成本核算接口、寻源建议卡同一个判定）。没有的人读取时成本为 null、
 * 带 costHidden、不带成本建议（开关开着时只带 compareCostHidden），情景按没有成本算；保存时带了成本或成本来源 → 403。
 */

/**
 * 对本项目有财务查看权（resolveFinancePrivilege(...).canReadAll）。项目没有组织、或判定出错时，
 * 按「不持组织键」重算：只剩平台超级管理员与项目负责人（他们的判定不依赖授权查询）。
 */
async function canSeePricingCost(access: ProjectAccessContext): Promise<boolean> {
  const { user, project } = access;
  const withoutOrgKeys = () =>
    decideFinancePrivilege({
      isPlatformSuperAdmin: isPlatformSuperAdmin(user.role),
      isProjectOwner: !!project.ownerId && project.ownerId === user.id,
      holdsManage: false,
      holdsRead: false,
    }).canReadAll;
  if (!project.orgId) return withoutOrgKeys();
  try {
    return (await resolveFinancePrivilege(user, project.orgId, project.ownerId)).canReadAll;
  } catch (err) {
    console.warn("[pricing-helper] finance privilege", err instanceof Error ? err.message : err);
    return withoutOrgKeys();
  }
}


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const run = await latestPricingRun(projectId);
  const room = await db.bidIntelligenceRoom.findUnique({
    where: { projectId },
    select: { summaryJson: true },
  });
  const sj = ((room?.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;

  let model: ScoringModel | null = isScoringModel(sj[PRICING_MODEL_KEY]) ? (sj[PRICING_MODEL_KEY] as ScoringModel) : null;
  let modelOrigin: "HUMAN" | "AI_INFERRED" | "HEURISTIC" | "NONE" = model ? model.source : "NONE";
  if (!model && run) {
    const texts = await pricingEvalTexts(run.id, run.summaryJson);
    model = heuristicScoringModel(texts);
    modelOrigin = model ? "HEURISTIC" : "NONE";
  }
  const benchmark = readPricingBenchmark(sj);
  const saved = (sj[PRICING_INPUTS_KEY] ?? {}) as Partial<PricingInputs>;
  const inputs: PricingInputs = {
    competitorPriceCad: saved.competitorPriceCad ?? benchmark.median,
    ourCostCad: saved.ourCostCad ?? null,
    targetMarginPct: saved.targetMarginPct ?? null,
  };

  // FLOW-H2：组织只用服务端鉴权得到的项目组织
  const orgId = access.project.orgId;
  // CHAIN-2b：没有财务查看权时不取比价建议、情景按没有成本算
  const canSeeCost = await canSeePricingCost(access);
  const compareEnabled = !!orgId && isPricingCompareSourceEnabledForOrg(orgId);
  let compareCost: CompareCostView | null = null;
  if (orgId && canSeeCost && isPricingCompareSourceEnabledForOrg(orgId)) {
    const suggestion = await loadCompareCostSuggestionSafe({ projectId, orgId });
    const source = readCostSource((saved as Record<string, unknown>).ourCostSource);
    compareCost = { suggestion, source, staleNoteZh: staleNoteZh(source, inputs.ourCostCad, suggestion) };
  }
  const view = buildPricingHelperView({ model, inputs, canSeeCost, compareEnabled, compareCost });
  return NextResponse.json({
    ...(compareCost ? { compareCost } : {}),
    ...(view.compareCostHidden ? { compareCostHidden: true } : {}),
    runId: run?.id ?? null,
    model,
    modelOrigin,
    benchmark,
    inputs: view.inputs,
    result: view.result,
    ...(view.costHidden ? { costHidden: true } : {}),
    note: !run
      ? "尚无已完成的分析"
      : !model
        ? "文件中未抓到价格权重——点「重新推导」或手工填写评分模型"
        : null,
  });
}

type PricingPostBody = {
  action?: "save" | "derive";
  inputs?: Partial<PricingInputs>;
  model?: Partial<ScoringModel>;
  ourCostSource?: unknown;
};
type JsonRec = Record<string, unknown>;
type CostSource = ReturnType<typeof nextCostSource>;
type CompareCtx = {
  compareEnabled: boolean;
  claim: ReturnType<typeof readCostClaim>;
  /** 有来源声明时在锁外取好的比价建议；只在本次成本不为空时交给 nextCostSource（与 FLOW-H2 原条件相同） */
  suggestion: Awaited<ReturnType<typeof loadCompareCostSuggestionSafe>> | null;
};
const asRec = (v: unknown): JsonRec => (v && typeof v === "object" && !Array.isArray(v) ? (v as JsonRec) : {});
const NO_ROOM_ERROR = "项目尚未创建投标调查室（分析完成后自动创建）";

/**
 * save：在库里最新的 summaryJson 上算出要写的整块（纯函数，在加锁的事务里调用）。
 * pricingInputs 里还有报价引擎镜像的权威报价（ourPriceCad / ourPrice / ourPriceCurrency / ourPriceSource /
 * ourPriceStatus / ourPriceSupersededSource，见 quote-engine/tender-bid.ts），这里只改三项人工输入与成本来源，其余键原样保留。
 */
function buildSave(
  sj: JsonRec,
  body: PricingPostBody,
  ctx: CompareCtx,
): { error: string; status: number } | { next: JsonRec; inputs: PricingInputs; source: CostSource } {
  const prevPi = asRec(sj[PRICING_INPUTS_KEY]);
  const prevInputs = prevPi as Partial<PricingInputs>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : v === null ? null : undefined as never;
  const inputs: PricingInputs = {
    competitorPriceCad:
      body.inputs && "competitorPriceCad" in body.inputs
        ? num(body.inputs.competitorPriceCad) ?? null
        : prevInputs.competitorPriceCad ?? null,
    ourCostCad:
      body.inputs && "ourCostCad" in body.inputs
        ? num(body.inputs.ourCostCad) ?? null
        : prevInputs.ourCostCad ?? null,
    targetMarginPct:
      body.inputs && "targetMarginPct" in body.inputs
        ? num(body.inputs.targetMarginPct) ?? null
        : prevInputs.targetMarginPct ?? null,
  };
  if (inputs.targetMarginPct != null && inputs.targetMarginPct >= 100) {
    return { error: "目标毛利须小于 100%", status: 400 };
  }
  // FLOW-H2：成本来源。请求只能声明用的是哪一条报价；金额与轮次由服务端重新取数核对
  const prevSource = readCostSource((prevInputs as Record<string, unknown>).ourCostSource);
  const source = nextCostSource({
    enabled: ctx.compareEnabled,
    costInBody: !!body.inputs && "ourCostCad" in body.inputs,
    ourCostCad: inputs.ourCostCad,
    prevCostCad: prevInputs.ourCostCad ?? null,
    prevSource,
    claim: ctx.claim,
    suggestion: inputs.ourCostCad != null ? ctx.suggestion : null,
    now: new Date(),
  });
  // FIX-8：保留 pricingInputs 里的其它键（报价引擎镜像的我方报价）；来源这一键按本次结果设或去掉
  const stored: JsonRec = { ...prevPi, ...inputs };
  if (source) stored.ourCostSource = source;
  else delete stored.ourCostSource;
  const next: JsonRec = { ...sj, [PRICING_INPUTS_KEY]: stored };
  if (body.model) {
    const base = isScoringModel(sj[PRICING_MODEL_KEY]) ? (sj[PRICING_MODEL_KEY] as ScoringModel) : null;
    const pw = body.model.priceWeightPct ?? base?.priceWeightPct;
    if (typeof pw !== "number" || pw < 0 || pw > 100) {
      return { error: "价格权重须为 0-100 的数字", status: 400 };
    }
    const human: ScoringModel = {
      version: PRICING_MODEL_VERSION,
      priceWeightPct: pw,
      costFormula: body.model.costFormula ?? base?.costFormula ?? "unknown",
      otherCriteria: (body.model.otherCriteria ?? base?.otherCriteria ?? []).map((c) => ({
        key: String(c.key ?? "other").slice(0, 40),
        nameZh: String(c.nameZh ?? "").slice(0, 40) || "其它",
        weightPct: Math.max(0, Math.min(100, Number(c.weightPct) || 0)),
        ourPct: c.ourPct == null ? null : Math.max(0, Math.min(100, Number(c.ourPct))),
        competitorPct:
          c.competitorPct == null ? null : Math.max(0, Math.min(100, Number(c.competitorPct))),
        basisZh: c.basisZh ? String(c.basisZh).slice(0, 200) : undefined,
      })),
      source: "HUMAN",
      evidenceZh: base?.evidenceZh ?? [],
      derivedAt: new Date().toISOString(),
    };
    next[PRICING_MODEL_KEY] = human;
  }
  return { next, inputs, source };
}

/**
 * FIX-9：写 room.summaryJson 的读改写与报价引擎（selectQuoteAsTenderBid / syncTenderBidPointerTx）拿同一把项目行锁：
 * 锁住之后再读库里最新的 summaryJson，改完在同一事务里写回——报价同步不会被旧值盖掉，也不会盖掉这里的写入。
 * 锁里只有读与写，不调模型、不取别的数。
 */
async function writeRoomLocked<T>(
  projectId: string,
  roomId: string,
  apply: (sj: JsonRec) => { error: string; status: number } | { next: JsonRec; result: T },
): Promise<{ error: string; status: number } | { result: T }> {
  return db.$transaction(async (tx) => {
    await lockProject(tx, projectId);
    const fresh = await tx.bidIntelligenceRoom.findUnique({ where: { id: roomId }, select: { summaryJson: true } });
    if (!fresh) return { error: NO_ROOM_ERROR, status: 409 };
    const out = apply(asRec(fresh.summaryJson));
    if ("error" in out) return out;
    await tx.bidIntelligenceRoom.update({
      where: { id: roomId },
      data: { summaryJson: JSON.parse(JSON.stringify(out.next)) },
    });
    return { result: out.result };
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = (await request.json().catch(() => ({}))) as PricingPostBody;
  const room = await db.bidIntelligenceRoom.findUnique({
    where: { projectId },
    select: { id: true, summaryJson: true },
  });
  if (!room) {
    return NextResponse.json({ error: NO_ROOM_ERROR }, { status: 409 });
  }
  const sj = asRec(room.summaryJson);

  if (body.action === "derive") {
    const lastAt = Date.parse(String(sj[PRICING_DERIVE_AT_KEY] ?? "")) || 0;
    if (Date.now() - lastAt < PRICING_DERIVE_RATE_WINDOW_MS) {
      return NextResponse.json({ error: "刚推导过，请稍候再试" }, { status: 429 });
    }
    const run = await latestPricingRun(projectId);
    if (!run) return NextResponse.json({ error: "尚无已完成的分析" }, { status: 404 });
    const texts = await pricingEvalTexts(run.id, run.summaryJson);
    // 模型调用在锁外；写入时按库里最新的 summaryJson 只改推导时间与（非人工的）模型
    const derived = await deriveScoringModel(texts);
    const out = await writeRoomLocked(projectId, room.id, (latest) => {
      // 人工覆盖的模型不被自动推导覆盖
      const existing = isScoringModel(latest[PRICING_MODEL_KEY]) ? (latest[PRICING_MODEL_KEY] as ScoringModel) : null;
      const next: JsonRec = { ...latest, [PRICING_DERIVE_AT_KEY]: new Date().toISOString() };
      if (derived.model && existing?.source !== "HUMAN") next[PRICING_MODEL_KEY] = derived.model;
      return { next, result: existing };
    });
    if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
    const existing = out.result;
    return NextResponse.json({
      ok: true,
      via: derived.via,
      model: (existing?.source === "HUMAN" ? existing : derived.model) ?? null,
      keptHumanOverride: existing?.source === "HUMAN",
    });
  }

  // save：输入与/或人工模型覆盖
  // FLOW-H2：组织只用服务端鉴权得到的项目组织；比价建议是一次取数，在锁外取
  const orgId = access.project.orgId;
  // CHAIN-2b：没有财务查看权的人不能改我方成本与来源（锁外判定；顺序：没有调查室 409 → 这里 403 → 锁内 400）
  const canSeeCost = await canSeePricingCost(access);
  if (!canSeeCost && touchesCost(body)) {
    return NextResponse.json({ error: COST_WRITE_FORBIDDEN_ZH }, { status: 403 });
  }
  // compareEnabled 照旧按开关算：没有财务查看权的人不带成本保存时，已记的来源原样保留（不当成「开关关了」清掉）
  const compareEnabled = !!orgId && isPricingCompareSourceEnabledForOrg(orgId);
  const claim = compareEnabled ? readCostClaim(body.ourCostSource) : null;
  const suggestion =
    compareEnabled && orgId && claim ? await loadCompareCostSuggestionSafe({ projectId, orgId }) : null;
  const out = await writeRoomLocked(projectId, room.id, (latest) => {
    const built = buildSave(latest, body, { compareEnabled, claim, suggestion });
    return "error" in built ? built : { next: built.next, result: built };
  });
  if ("error" in out) return NextResponse.json({ error: out.error }, { status: out.status });
  const { next, inputs, source } = out.result;
  return NextResponse.json(
    buildSavedInputsView(
      {
        ok: true,
        inputs,
        model: next[PRICING_MODEL_KEY] ?? null,
        ...(compareEnabled ? { ourCostSource: source } : {}),
      },
      canSeeCost,
    ),
  );
}
