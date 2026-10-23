import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
} from "@/lib/projects/access";
import {
  buildScenarios,
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

/**
 * 报价表助手（tender-pricing/v1）
 * GET  → 评分模型（人工覆盖 > 已推导 > 即时启发式）+ 价格带（现任线索/联邦对标）
 *        + 人工输入 + 情景表/打平价。零模型花费（LLM 只在 POST derive）。
 * POST { action:"save", inputs?, model? }   → 存 room.summaryJson.pricingInputs / pricingModel(HUMAN)
 * POST { action:"derive" }                  → LLM 从事实重新推导模型（60s 频控，AI_INFERRED）
 * 纪律：计算结果是假设驱动的情景，不是报价决定；绝不 GO/NO-GO。
 */


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
  const result = model ? buildScenarios(model, inputs) : null;
  return NextResponse.json({
    runId: run?.id ?? null,
    model,
    modelOrigin,
    benchmark,
    inputs,
    result,
    note: !run
      ? "尚无已完成的分析"
      : !model
        ? "文件中未抓到价格权重——点「重新推导」或手工填写评分模型"
        : null,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = (await request.json().catch(() => ({}))) as {
    action?: "save" | "derive";
    inputs?: Partial<PricingInputs>;
    model?: Partial<ScoringModel>;
  };
  const room = await db.bidIntelligenceRoom.findUnique({
    where: { projectId },
    select: { id: true, summaryJson: true },
  });
  if (!room) {
    return NextResponse.json({ error: "项目尚未创建投标调查室（分析完成后自动创建）" }, { status: 409 });
  }
  const sj = ((room.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;

  if (body.action === "derive") {
    const lastAt = Date.parse(String(sj[PRICING_DERIVE_AT_KEY] ?? "")) || 0;
    if (Date.now() - lastAt < PRICING_DERIVE_RATE_WINDOW_MS) {
      return NextResponse.json({ error: "刚推导过，请稍候再试" }, { status: 429 });
    }
    const run = await latestPricingRun(projectId);
    if (!run) return NextResponse.json({ error: "尚无已完成的分析" }, { status: 404 });
    const texts = await pricingEvalTexts(run.id, run.summaryJson);
    const derived = await deriveScoringModel(texts);
    // 人工覆盖的模型不被自动推导覆盖
    const existing = isScoringModel(sj[PRICING_MODEL_KEY]) ? (sj[PRICING_MODEL_KEY] as ScoringModel) : null;
    const next: Record<string, unknown> = { ...sj, [PRICING_DERIVE_AT_KEY]: new Date().toISOString() };
    if (derived.model && existing?.source !== "HUMAN") next[PRICING_MODEL_KEY] = derived.model;
    await db.bidIntelligenceRoom.update({
      where: { id: room.id },
      data: { summaryJson: JSON.parse(JSON.stringify(next)) },
    });
    return NextResponse.json({
      ok: true,
      via: derived.via,
      model: (existing?.source === "HUMAN" ? existing : derived.model) ?? null,
      keptHumanOverride: existing?.source === "HUMAN",
    });
  }

  // save：输入与/或人工模型覆盖
  const prevInputs = (sj[PRICING_INPUTS_KEY] ?? {}) as Partial<PricingInputs>;
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
    return NextResponse.json({ error: "目标毛利须小于 100%" }, { status: 400 });
  }
  const next: Record<string, unknown> = { ...sj, [PRICING_INPUTS_KEY]: inputs };
  if (body.model) {
    const base = isScoringModel(sj[PRICING_MODEL_KEY]) ? (sj[PRICING_MODEL_KEY] as ScoringModel) : null;
    const pw = body.model.priceWeightPct ?? base?.priceWeightPct;
    if (typeof pw !== "number" || pw < 0 || pw > 100) {
      return NextResponse.json({ error: "价格权重须为 0-100 的数字" }, { status: 400 });
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
  await db.bidIntelligenceRoom.update({
    where: { id: room.id },
    data: { summaryJson: JSON.parse(JSON.stringify(next)) },
  });
  return NextResponse.json({ ok: true, inputs, model: next[PRICING_MODEL_KEY] ?? null });
}
