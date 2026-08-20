import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  requireProjectReadAccess,
  requireProjectWriteAccess,
} from "@/lib/projects/access";
import {
  isExternalIntelEnabled,
  searchAwardHistory,
} from "@/lib/tender-intel/canadabuys";
import {
  materializeWinnerConfirmation,
  normalizeVendorName,
  AwardIntelError,
  type AwardsDbClient,
  type AwardSourceType,
} from "@/lib/tender-intel/awards";
import { isT4AwardSchemaReady } from "@/lib/tender-intel/award-flags";
import { EXTERNAL_INTEL_STATUS_KEY } from "@/lib/tender-intel/orchestrate";

/**
 * M1/T4 — 历史授标外部检索 + 人工确认落 canonical
 * GET  ?q=keyword → findings（待确认，绝不自动写入结论）
 * POST { finding, applyTo } → 人工确认 → 同一事务内：
 *   ① canonical AwardRecord（组织级长期事实层，HUMAN_CONFIRMED + provenance）
 *   ② room.summaryJson.externalConfirmed（项目级调查投影，8 模块外部字段变 READY）
 *   任一失败 → 整体失败（绝不出现「UI 已确认但 canonical 写失败」的静默半成功）。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectReadAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  if (!isExternalIntelEnabled()) {
    return NextResponse.json({ enabled: false, findings: [], note: "外部情报未启用" });
  }

  // 无 q → 返回分析完成时自动检索的候选（多线交叉验证结果，待人工确认）
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!q) {
    const room = await db.bidIntelligenceRoom.findUnique({
      where: { projectId },
      select: { summaryJson: true },
    });
    const sj = (room?.summaryJson as Record<string, unknown>) ?? {};
    const auto = (sj.externalCandidates ?? null) as {
      queries?: string[];
      candidates?: unknown[];
      fetchedAt?: string;
    } | null;
    const webIntel = (sj.webIntel ?? null) as {
      queries?: string[];
      candidates?: unknown[];
      fetchedAt?: string;
    } | null;
    // 观察期包5：note 由显式状态驱动（不再许「分析完成后自动生成」这种
    // 在时序错过后永不兑现的承诺）；externalIntelStatus 一并返回供 UI 渲染。
    const intelStatus = (sj[EXTERNAL_INTEL_STATUS_KEY] ?? null) as {
      status?: string;
      ranAt?: string;
      reason?: string;
    } | null;
    const note =
      auto || webIntel
        ? null
        : intelStatus?.status === "ran" || intelStatus?.status === "skipped"
          ? "自动检索已执行但未获得可用候选，可点击「立即检索外部情报」重试"
          : intelStatus?.status === "error"
            ? "上次自动检索出错，可点击「立即检索外部情报」重试"
            : "尚未执行外部检索——点击「立即检索外部情报」立即获取，或等待下次分析完成后自动执行";
    return NextResponse.json({
      enabled: true,
      auto: auto ?? null,
      webIntel: webIntel ?? null,
      externalIntelStatus: intelStatus,
      // 情报自动流（包6）：AI 策略草案（AI_INFERRED，人审语义）
      bidStrategyAuto: sj.bidStrategyAuto ?? null,
      findings: [],
      note,
    });
  }

  const result = await searchAwardHistory({ query: q });
  return NextResponse.json({ enabled: true, auto: null, ...result });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: projectId } = await params;
  const access = await requireProjectWriteAccess(request, projectId);
  if (access instanceof NextResponse) return access;

  const body = (await request.json().catch(() => ({}))) as {
    kind?: "winner" | "competitor";
    vendorName?: string;
    contractValue?: number | null;
    contractDate?: string | null;
    sourceUrl?: string;
    possiblyRecurring?: boolean | null;
    /** T4：候选行携带的结构化上下文（可选，尽量传） */
    buyerName?: string | null;
    referenceNumber?: string | null;
    evidenceSnippet?: string | null;
  };

  const room = await db.bidIntelligenceRoom.findUnique({
    where: { projectId },
    select: { id: true, orgId: true, summaryJson: true },
  });
  if (!room) {
    return NextResponse.json(
      { error: "项目尚未创建投标调查室" },
      { status: 409 },
    );
  }
  const sj = ((room.summaryJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;

  // M2：确认竞争对手线索（web 情报 → 人工确认后进入调查结论 competitors 列表）
  // 注：竞争对手提及 ≠ 授标事实，不落 AwardRecord；canonical 竞争对手只能由
  // evidence-backed AwardRecord 推导（见 award-intelligence.ts）。
  if (body.kind === "competitor") {
    const name = (body.vendorName ?? "").trim();
    if (!name) return NextResponse.json({ error: "缺少名称" }, { status: 400 });
    const prevExt = (sj.externalConfirmed as Record<string, unknown>) ?? {};
    const prevList = Array.isArray(prevExt.competitors)
      ? (prevExt.competitors as Array<{ name: string; url: string | null }>)
      : [];
    if (!prevList.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      prevList.push({ name, url: body.sourceUrl ?? null });
    }
    const externalConfirmed = { ...prevExt, competitors: prevList };
    await db.bidIntelligenceRoom.update({
      where: { id: room.id },
      data: { summaryJson: { ...sj, externalConfirmed } },
    });
    return NextResponse.json({ ok: true, externalConfirmed });
  }

  const vendor = (body.vendorName ?? "").trim();
  if (!vendor) {
    return NextResponse.json({ error: "缺少中标方名称" }, { status: 400 });
  }
  const schemaReady = isT4AwardSchemaReady();
  if (schemaReady && !room.orgId) {
    // canonical 情报必须 org-scoped；无 org 的房间拒绝确认（fail closed，不做半成功）
    return NextResponse.json(
      { error: "该项目缺少组织归属，无法沉淀组织级授标情报" },
      { status: 409 },
    );
  }

  // 来源类型与幂等键（确定性：同一候选重复确认不产生第二条记录）
  const reference = (body.referenceNumber ?? "").trim() || null;
  const sourceUrl = (body.sourceUrl ?? "").trim() || null;
  const sourceType: AwardSourceType = reference
    ? "CANADABUYS_OPEN_DATA"
    : sourceUrl
      ? "WEB_SEARCH"
      : "USER_ENTRY";
  const sourceKey = reference
    ? `canadabuys:${reference}`
    : sourceUrl
      ? `web:${sourceUrl}`
      : `manual:${projectId}:winner:${normalizeVendorName(vendor)}`;

  const externalConfirmed = {
    ...((sj.externalConfirmed as Record<string, unknown>) ?? {}),
    previousWinner: vendor,
    historicalContractValue:
      body.contractValue != null
        ? `CAD ${Number(body.contractValue).toLocaleString()}${body.contractDate ? `（${body.contractDate}）` : ""}`
        : null,
    possiblyRecurring:
      body.possiblyRecurring == null ? null : body.possiblyRecurring ? "可能是（历史存在同类采购）" : "不确定",
    confirmedAt: new Date().toISOString(),
    sourceUrl,
  };

  // 生产激活闸（兼容策略 B）：T4 schema 未 ready → 保持 merge 前行为，
  // 仅写项目级调查结论（externalConfirmed），对 T4 表 0 次访问。
  // 一致性契约：externalConfirmed 保留全量结构化上下文（vendor/value/date/sourceUrl），
  // schema ready 后可按同一 sourceKey 推导规则幂等补偿 materialize（见 award-flags.ts）。
  if (!schemaReady) {
    await db.bidIntelligenceRoom.update({
      where: { id: room.id },
      data: { summaryJson: { ...sj, externalConfirmed } },
    });
    return NextResponse.json({
      ok: true,
      externalConfirmed,
      awardRecordId: null,
      canonical: "SCHEMA_NOT_READY",
    });
  }

  try {
    const { materialized } = await db.$transaction(async (tx) => {
      const materialized = await materializeWinnerConfirmation(
        {
          orgId: room.orgId,
          actor: { actorType: "user", userId: access.user.id },
          award: {
            winnerName: vendor,
            buyerNameRaw: body.buyerName ?? null,
            projectId,
            solicitationNumber: reference,
            awardDate: body.contractDate ? new Date(body.contractDate) : null,
            contractAmount: body.contractValue ?? null,
            currency: body.contractValue != null ? "CAD" : null,
            scopeSummary: body.evidenceSnippet ?? null,
          },
          source: {
            sourceType,
            sourceKey,
            sourceUrl,
            evidenceSnippet: body.evidenceSnippet ?? null,
            capturedAt: new Date(),
          },
          confidence: reference ? "HIGH" : "MEDIUM",
          verificationStatus: "HUMAN_CONFIRMED",
        },
        { client: tx as unknown as AwardsDbClient },
      );
      await tx.bidIntelligenceRoom.update({
        where: { id: room.id },
        data: { summaryJson: { ...sj, externalConfirmed } },
      });
      return { materialized };
    });

    return NextResponse.json({
      ok: true,
      externalConfirmed,
      awardRecordId: materialized.materialized ? materialized.record.id : null,
      awardOutcome: materialized.materialized ? materialized.outcome : null,
      canonical: materialized.materialized ? "MATERIALIZED" : materialized.reason,
    });
  } catch (e) {
    const msg =
      e instanceof AwardIntelError
        ? `组织级授标情报写入失败（${e.code}）`
        : "确认失败，请稍后重试";
    // 事务整体回滚：summaryJson 未更新，UI 不会显示「已确认」——无静默半成功
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
