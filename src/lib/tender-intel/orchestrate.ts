/**
 * 观察期包5 — 外部情报统一编排（M1 授标检索 / M2 Web 检索 / M2.5 AI 分析师）
 *
 * 从 legacy worker FINALIZE 的内联块抽出，三个触发面共用同一实现：
 *   legacy_finalize（legacy 管线分析完成）
 *   workforce_finalize（workforce t9 终态化完成）
 *   manual（情报 tab「立即检索外部情报」按钮）
 *
 * 修复的结构性缺陷（2026-08-17 诊断，生产实证）：
 * 1. 时序倒置：旧实现要求调查室**先于**分析存在（`&& roomBefore` 才写入），
 *    正常流程（上传→自动分析→事后才进调查）永远错过——检索真跑了、
 *    Tavily 钱真花了、结果直接丢弃。现在：flag 开启且项目有 org 时，
 *    写入前自动创建房间（upsert，最小字段，不伪造 investigating 状态）。
 * 2. 五种静默 no-op（flag 关 / 查询空 / 房间缺 / 检索败 / 分析败）全部无痕。
 *    现在：只要房间可用，一律落 `summaryJson.externalIntelStatus`
 *    （status/trigger/ranAt/reason/计数），UI 按真实状态渲染，不再许
 *    「分析完成后自动生成」这种可能永不兑现的承诺。
 *
 * 失败语义不变：任何异常绝不上抛影响调用方（分析结果 / 终态化 / 路由）。
 * 人工确认门不变：检索结果仅是候选，externalConfirmed 仍只能人工写入。
 */

import { db } from "@/lib/db";
import {
  isExternalIntelEnabled,
  deriveAwardQueries,
  autoSearchAwardHistory,
  type AutoAwardSearchResult,
} from "./canadabuys";
import {
  deriveWebQueries,
  autoWebIntel,
  type WebIntelResult,
} from "./websearch";
import { isT4AwardSchemaReady } from "./award-flags";
import { normalizeBuyerName } from "@/lib/corporate-memory/normalize";

export type ExternalIntelTrigger =
  | "legacy_finalize"
  | "workforce_finalize"
  | "manual";

export type ExternalIntelOutcome = {
  status: "ran" | "skipped" | "error";
  reason?: string;
  awardCandidates: number;
  webDomains: number;
  analyzed: boolean;
  /** 情报自动流（包6）：本次自动观察入 canonical 的权威公开数据条数 */
  autoObserved?: number;
  /** 情报自动流（包6）：本次是否生成 AI 策略草案 */
  strategyGenerated?: boolean;
};

/** room.summaryJson 里的显式状态键（UI/排障唯一事实源） */
export const EXTERNAL_INTEL_STATUS_KEY = "externalIntelStatus" as const;

export type ExternalIntelStatus = {
  status: ExternalIntelOutcome["status"];
  trigger: ExternalIntelTrigger;
  ranAt: string;
  runId?: string | null;
  reason?: string;
  awardCandidates: number;
  webDomains: number;
  analyzed: boolean;
  autoObserved?: number;
  strategyGenerated?: boolean;
};

/** manual 触发的简单频控：距上次记录不足窗口则拒绝（默认 60s） */
export function isExternalIntelRateLimited(
  status: { ranAt?: string } | null | undefined,
  nowMs: number,
  windowMs = 60_000,
): boolean {
  if (!status?.ranAt) return false;
  const last = Date.parse(status.ranAt);
  if (!Number.isFinite(last)) return false;
  return nowMs - last < windowMs;
}

/**
 * 相关性门（2026-08-19 生产复盘）：自动入库不再只看「权威真实」，还要看
 * 「与本项目相关」——买家归一匹配本项目采购方，或多检索线交叉命中（≥2）。
 * 其余候选留在调查室候选区走人工确认线。防止泛化检索词把无关政府授标
 * 灌进组织权威层（真实 ≠ 相关）。
 */
export function isAutoObserveRelevant(input: {
  candidateBuyer: string | null | undefined;
  projectBuyer: string | null | undefined;
  hitQueryCount: number;
}): boolean {
  if (input.hitQueryCount >= 2) return true;
  const cand = (input.candidateBuyer ?? "").trim();
  const proj = (input.projectBuyer ?? "").trim();
  if (!cand || !proj) return false;
  return normalizeBuyerName(cand) === normalizeBuyerName(proj);
}

const ZERO = { awardCandidates: 0, webDomains: 0, analyzed: false } as const;

/** 房间存在才落状态（不为记录一个 skipped 而建房间） */
async function persistStatusIfRoomExists(
  projectId: string,
  status: ExternalIntelStatus,
): Promise<void> {
  const room = await db.bidIntelligenceRoom.findUnique({
    where: { projectId },
    select: { id: true, summaryJson: true },
  });
  if (!room) return;
  const sj = ((room.summaryJson as Record<string, unknown>) ?? {}) as Record<
    string,
    unknown
  >;
  await db.bidIntelligenceRoom.update({
    where: { id: room.id },
    data: {
      summaryJson: JSON.parse(
        JSON.stringify({ ...sj, [EXTERNAL_INTEL_STATUS_KEY]: status }),
      ),
    },
  });
}

export async function runExternalIntelForProject(input: {
  projectId: string;
  runId?: string | null;
  trigger: ExternalIntelTrigger;
  env?: NodeJS.ProcessEnv;
}): Promise<ExternalIntelOutcome> {
  const env = input.env ?? process.env;
  const ranAt = new Date().toISOString();
  const base = { trigger: input.trigger, ranAt } as const;

  try {
    if (!isExternalIntelEnabled(env)) {
      // flag 关：零出站、不建房间；房间已存在则留下 skipped 痕迹
      await persistStatusIfRoomExists(input.projectId, {
        ...base,
        status: "skipped",
        reason: "flag_off",
        ...ZERO,
      }).catch(() => undefined);
      return { status: "skipped", reason: "flag_off", ...ZERO };
    }

    const project = await db.project.findUnique({
      where: { id: input.projectId },
      select: { id: true, name: true, orgId: true, solicitationNumber: true, clientOrganization: true },
    });
    if (!project) return { status: "skipped", reason: "project_not_found", ...ZERO };
    if (!project.orgId) {
      // 房间是 org-scoped（canonical 授标情报 fail-closed 依赖 orgId），无 org 不建
      return { status: "skipped", reason: "project_no_org", ...ZERO };
    }

    // 选 run：显式 runId 优先；否则该项目最新分析记录（两条管线的
    // tenderAnalysisRun 同表，analysisVersion 不同但 summaryJson 契约兼容）
    const run = input.runId
      ? await db.tenderAnalysisRun.findUnique({
          where: { id: input.runId },
          select: { id: true, summaryJson: true },
        })
      : await db.tenderAnalysisRun.findFirst({
          where: { projectId: project.id },
          orderBy: { createdAt: "desc" },
          select: { id: true, summaryJson: true },
        });
    if (!run) {
      await persistStatusIfRoomExists(input.projectId, {
        ...base,
        status: "skipped",
        reason: "no_analysis_run",
        ...ZERO,
      }).catch(() => undefined);
      return { status: "skipped", reason: "no_analysis_run", ...ZERO };
    }

    const sj = ((run.summaryJson as Record<string, unknown>) ?? {}) as Record<
      string,
      unknown
    >;
    const syn = sj.analystSynthesis as
      | {
          executiveBrief?: { whatIsBeingBoughtZh?: string };
          scope?: { deliverables?: string[] };
        }
      | undefined;
    const brief = sj.brief as
      | { buyer?: string | null; oneLiner?: string | null }
      | undefined;

    const queries = deriveAwardQueries({
      projectName: project.name,
      buyerText: brief?.buyer ?? null,
      productTexts: [
        syn?.executiveBrief?.whatIsBeingBoughtZh ?? "",
        ...(syn?.scope?.deliverables ?? []),
      ],
    });

    // 写入前确保房间存在（旧实现在这里因房间缺失而静默丢弃结果）
    const room = await db.bidIntelligenceRoom.upsert({
      where: { projectId: project.id },
      create: { orgId: project.orgId, projectId: project.id },
      update: {},
      select: { id: true, summaryJson: true },
    });
    const rsj = ((room.summaryJson as Record<string, unknown>) ?? {}) as Record<
      string,
      unknown
    >;
    const confirmed = rsj.externalConfirmed as
      | { previousWinner?: string | null }
      | undefined;

    const auto: AutoAwardSearchResult | null =
      queries.length > 0 ? await autoSearchAwardHistory({ queries, env }) : null;

    // 情报自动流（包6）：M1 权威公开数据（带 reference number）自动观察入
    // canonical。白名单铁律（awards.ts）明文允许 CANADABUYS_OPEN_DATA +
    // reference 落 SYSTEM_VERIFIED；actor=system（确定性代码观察公开数据，
    // ai/agent actor 仍被写门拒绝——T3 硬禁不被触碰）。幂等锚点与人工确认
    // 同键（canadabuys:{reference}）：此后人工确认同一候选只会挂源升级，
    // 绝不产生重复记录。Web 候选无权威 reference，不自动观察（仍走人工确认线）。
    let autoObserved = 0;
    if (auto?.ok && isT4AwardSchemaReady()) {
      try {
        const { createOrObserveAwardRecord } = await import("./awards");
        for (const c of auto.candidates.slice(0, 5)) {
          const ref = c.bestFinding.referenceNumber?.trim();
          if (!ref) continue;
          // 相关性门：买家匹配本项目采购方 或 交叉命中≥2 才自动入权威层
          if (
            !isAutoObserveRelevant({
              candidateBuyer: c.bestFinding.buyerName ?? c.bestFinding.ownerOrg,
              projectBuyer: project.clientOrganization,
              hitQueryCount: c.hitQueries.length,
            })
          ) {
            continue;
          }
          try {
            await createOrObserveAwardRecord({
              orgId: project.orgId,
              actor: { actorType: "system", userId: null },
              award: {
                winnerName: c.vendorName,
                buyerNameRaw:
                  c.bestFinding.buyerName ?? c.bestFinding.ownerOrg ?? null,
                solicitationNumber: ref,
                awardDate: c.bestFinding.contractDate
                  ? new Date(c.bestFinding.contractDate)
                  : null,
                contractAmount: c.bestFinding.contractValue ?? null,
                currency: c.bestFinding.contractValue != null ? "CAD" : null,
                scopeSummary: c.bestFinding.descriptionEn ?? null,
              },
              source: {
                sourceType: "CANADABUYS_OPEN_DATA",
                sourceKey: `canadabuys:${ref}`,
                sourceUrl: c.bestFinding.sourceUrl ?? null,
                evidenceSnippet: c.bestFinding.descriptionEn?.slice(0, 500) ?? null,
                capturedAt: new Date(),
              },
              confidence: c.hitQueries.length >= 2 ? "HIGH" : "MEDIUM",
              verificationStatus: "SYSTEM_VERIFIED",
            });
            autoObserved += 1;
          } catch {
            // 单条观察失败（如疑似重复语义）不阻塞其余候选
          }
        }
      } catch {
        // 观察层整体失败不影响候选展示与状态落库
      }
    }

    const webQueries = deriveWebQueries({
      confirmedWinner: confirmed?.previousWinner ?? null,
      productPhrase: queries[0] ?? null,
      buyerPhrase:
        queries.find((q) =>
          /general|ministry|department|city|university/i.test(q),
        ) ?? null,
      solicitationNumber: project.solicitationNumber ?? null,
    });
    const web: WebIntelResult | null =
      webQueries.length > 0 ? await autoWebIntel({ queries: webQueries, env }) : null;

    // M2.5：AI 分析师读检索结果 → 中文结论（八模块直接可读；仍属 AI 初步调查）
    let externalAnalysis: unknown = null;
    if (auto?.ok || web?.ok) {
      try {
        const { analyzeExternalIntel } = await import("./analyze");
        const { analysis } = await analyzeExternalIntel({
          projectOneLiner: brief?.oneLiner ?? null,
          awardCandidates: auto?.candidates ?? [],
          webCandidates: web?.candidates ?? [],
        });
        externalAnalysis = analysis;
      } catch {
        externalAnalysis = null;
      }
    }

    // 情报自动流（包6）：AI 投标策略草案（第 7 槽位）——基于组织级七域投影
    // + 本项目分析摘要合成，AI_INFERRED 标签人审语义。失败不影响其余结果。
    // 批次一：投标策略备忘录 v2（文档接地深读，替换浅层组织投影草案）。
    // 输入 = 本单 canonical 事实/强制要求 + 综合层 + 组织投影 + 现任供应商
    // 线索（incumbentLead，人工记录）。AI_INFERRED 人审语义，禁整体 GO/NO-GO。
    let strategyGenerated = false;
    let bidStrategyMemo: unknown = null;
    try {
      const { listAwardsForOrg } = await import("./awards");
      const { deriveAwardIntelligence } = await import("./award-intelligence");
      const { synthesizeBidStrategyMemo } = await import("./strategy");
      const orgRows = isT4AwardSchemaReady()
        ? await listAwardsForOrg({ orgId: project.orgId })
        : [];
      const [factRows, mandatoryRows, projMeta] = await Promise.all([
        db.tenderAnalysisFact.findMany({
          where: { runId: run.id },
          take: 80,
          select: { statementKind: true, contentZh: true },
        }),
        db.tenderExtractedRequirement.findMany({
          where: { analysisRunId: run.id, mandatory: true },
          take: 40,
          select: { chineseTranslation: true },
        }),
        db.project.findUnique({
          where: { id: project.id },
          select: {
            clientOrganization: true,
            closeDate: true,
            estimatedValue: true,
            currency: true,
          },
        }),
      ]);
      const clarsZh = ((syn as { clarifications?: Array<{ questionZh?: string }> })
        ?.clarifications ?? [])
        .map((c) => c.questionZh ?? "")
        .filter(Boolean);
      const { memo } = await synthesizeBidStrategyMemo({
        project: {
          nameZh: project.name,
          buyer: projMeta?.clientOrganization ?? null,
          closeDate: projMeta?.closeDate
            ? projMeta.closeDate.toISOString().slice(0, 10)
            : null,
          estimatedValue: projMeta?.estimatedValue ?? null,
          currency: projMeta?.currency ?? null,
        },
        facts: factRows.map((f) => ({
          kind: f.statementKind,
          contentZh: (f.contentZh ?? "").slice(0, 220),
        })),
        mandatoryRequirements: mandatoryRows.map((r) =>
          r.chineseTranslation.slice(0, 160),
        ),
        analystBrief: syn ?? null,
        intelligence: deriveAwardIntelligence(orgRows),
        incumbentLead: (rsj as { incumbentLead?: unknown }).incumbentLead ?? null,
        existingClarifications: clarsZh,
      });
      if (memo) {
        bidStrategyMemo = memo;
        strategyGenerated = true;
      }
    } catch {
      bidStrategyMemo = null;
    }

    const ran = Boolean(auto?.ok || web?.ok);
    const outcome: ExternalIntelOutcome = {
      status: ran ? "ran" : "skipped",
      reason: ran
        ? undefined
        : queries.length === 0 && webQueries.length === 0
          ? "no_queries"
          : "search_no_result",
      awardCandidates: auto?.candidates.length ?? 0,
      webDomains: web?.candidates.length ?? 0,
      analyzed: Boolean(externalAnalysis),
      autoObserved,
      strategyGenerated,
    };

    await db.bidIntelligenceRoom.update({
      where: { id: room.id },
      data: {
        summaryJson: JSON.parse(
          JSON.stringify({
            ...rsj,
            ...(auto?.ok ? { externalCandidates: auto } : {}),
            ...(web?.ok ? { webIntel: web } : {}),
            ...(externalAnalysis ? { externalAnalysis } : {}),
            ...(bidStrategyMemo ? { bidStrategyMemo } : {}),
            [EXTERNAL_INTEL_STATUS_KEY]: {
              ...base,
              status: outcome.status,
              runId: run.id,
              ...(outcome.reason ? { reason: outcome.reason } : {}),
              awardCandidates: outcome.awardCandidates,
              webDomains: outcome.webDomains,
              analyzed: outcome.analyzed,
              autoObserved,
              strategyGenerated,
            } satisfies ExternalIntelStatus,
          }),
        ),
      },
    });
    console.log(
      `[tender-external-intel] project=${project.id} trigger=${input.trigger} status=${outcome.status} award_candidates=${outcome.awardCandidates} web_domains=${outcome.webDomains} analyzed=${outcome.analyzed ? 1 : 0} auto_observed=${autoObserved} strategy=${strategyGenerated ? 1 : 0}`,
    );
    return outcome;
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message.replace(/[\r\n\t]+/g, " ").slice(0, 200)
        : String(error).slice(0, 200);
    await persistStatusIfRoomExists(input.projectId, {
      ...base,
      status: "error",
      reason,
      ...ZERO,
    }).catch(() => undefined);
    return { status: "error", reason, ...ZERO };
  }
}
