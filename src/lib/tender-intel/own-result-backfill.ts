/**
 * 情报阶段2 — 我方招标结果回灌 canonical（T0 §9.1 认可路径）
 *
 * 「我方参与的每个标都是一条 award 事实」：人工标记 won 时，把我方中标写成
 * AwardRecord（HUMAN_CONFIRMED / USER_ENTRY / 幂等 sourceKey=own-result:{projectId}，
 * 重复标记不产生第二条）；同时把买家（clientOrganization）经同一 human 动作
 * 沉淀为 T3 Buyer canonical（createBuyer 自带幂等身份匹配）。
 *
 * 硬边界：
 * - 仅从人工结果标记路径调用（markProjectTenderResult 唯一调用方 = tender-result
 *   路由，human 动作）——不触碰「AI 自动写 canonical 硬禁」。
 * - lost + 用户在结果表单选填了中标方（P2-0）→ 同一人工动作把对手中标写成
 *   AwardRecord（HUMAN_CONFIRMED / USER_ENTRY / 幂等 sourceKey=tender-result-winner:{projectId}）；
 *   每个项目只记一次：再次标记换了名字不覆盖（返回 winner_already_recorded，避免静默改写事实）。
 *   更正（P2-0d）：组织管理员先在「历史中标」撤回原记录，再重新标记——来源键对应记录已撤回时
 *   改用后继键 `{key}:after:{撤回记录 id}` 写新记录（我方中标 own-result 同理）。
 *   没填中标方的 lost 仍不写对手事实。
 * - Buyer 写门是 admin-only（corporate-memory access.ts）：无权限 → 跳过并
 *   记录原因，绝不阻塞结果标记。
 * - T4 schema 未 ready → 跳过 award 写入（与 award-history 路由同一兼容策略）。
 * - 任何失败绝不上抛（结果标记必须成功）；返回值显式描述每一步结局。
 */

import { db } from "@/lib/db";
import { isT4AwardSchemaReady } from "./award-flags";
import {
  materializeWinnerConfirmation,
  normalizeVendorName,
  type AwardsDbClient,
  type MaterializeWinnerResult,
  type ObserveAwardInput,
} from "./awards";

/** 同一项目同一来源键最多跟随几次「已撤回 → 新键」（P2-0d；超过视为数据异常） */
const MAX_RETRACTED_HOPS = 10;

/**
 * 写入结果标记的授标事实；若该来源键对应的记录已被组织管理员撤回（P2-0d），
 * 改用确定性的后继键 `{baseKey}:after:{撤回记录 id}` 再写——撤回后重新标记（更正）能落新记录，
 * 重放同一更正仍幂等。撤回记录本身不复活。
 */
async function materializeSkippingRetracted(
  tx: AwardsDbClient,
  baseKey: string,
  build: (sourceKey: string) => ObserveAwardInput,
): Promise<MaterializeWinnerResult> {
  let key = baseKey;
  for (let i = 0; i < MAX_RETRACTED_HOPS; i++) {
    const res = await materializeWinnerConfirmation(build(key), { client: tx });
    if (!res.materialized || res.record.status !== "RETRACTED") return res;
    key = `${baseKey}:after:${res.record.id}`;
  }
  throw new Error(`retracted_chain_too_long:${baseKey}`);
}

export type OwnResultBackfillOutcome = {
  award: "written" | "skipped";
  awardReason?: string;
  awardRecordId?: string | null;
  buyer: "created" | "matched" | "skipped";
  buyerReason?: string;
};

export async function backfillOwnResultCanonical(input: {
  projectId: string;
  result: string;
  actorUserId: string;
  /** P2-0：未中标时用户选填的中标方（已校验、不是我方） */
  winnerName?: string | null;
}): Promise<OwnResultBackfillOutcome> {
  const out: OwnResultBackfillOutcome = { award: "skipped", buyer: "skipped" };
  try {
    const project = await db.project.findUnique({
      where: { id: input.projectId },
      select: {
        id: true,
        name: true,
        orgId: true,
        clientOrganization: true,
        solicitationNumber: true,
        awardDate: true,
        winningBidPrice: true,
        ourBidPrice: true,
        currency: true,
        org: { select: { name: true } },
      },
    });
    if (!project?.orgId) {
      return { ...out, awardReason: "project_no_org", buyerReason: "project_no_org" };
    }

    // Buyer 起灌：won/lost 都做（买家是谁与结果无关）；幂等匹配内置
    const buyerName = project.clientOrganization?.trim();
    if (buyerName) {
      try {
        const { createBuyer } = await import(
          "@/lib/corporate-memory/buyer-service"
        );
        const created = await createBuyer({
          orgId: project.orgId,
          actor: { userId: input.actorUserId },
          canonicalName: buyerName,
          metadata: { seededFrom: "tender_result", projectId: project.id },
        });
        out.buyer = created.created ? "created" : "matched";
      } catch (e) {
        out.buyerReason =
          e instanceof Error ? e.message.slice(0, 120) : String(e).slice(0, 120);
      }
    } else {
      out.buyerReason = "no_client_organization";
    }

    if (input.result === "lost") {
      const competitor = input.winnerName?.trim();
      if (!competitor) {
        out.awardReason = "lost_without_winner";
        return out;
      }
      if (!isT4AwardSchemaReady()) {
        out.awardReason = "t4_schema_not_ready";
        return out;
      }
      const amount = project.winningBidPrice ?? null;
      const res = await db.$transaction(async (tx) =>
        materializeSkippingRetracted(tx as unknown as AwardsDbClient, `tender-result-winner:${project.id}`, (sourceKey) => ({
            orgId: project.orgId!,
            actor: { actorType: "user", userId: input.actorUserId },
            award: {
              winnerName: competitor,
              buyerNameRaw: buyerName ?? null,
              projectId: project.id,
              solicitationNumber: project.solicitationNumber ?? null,
              awardDate: project.awardDate ?? null,
              contractAmount: amount,
              currency: amount != null ? project.currency?.trim() || "CAD" : null,
              scopeSummary: project.name ?? null,
            },
            source: {
              sourceType: "USER_ENTRY",
              sourceKey,
              sourceUrl: null,
              evidenceSnippet: null,
              capturedAt: new Date(),
            },
            confidence: "MEDIUM",
            verificationStatus: "HUMAN_CONFIRMED",
          })),
      );
      if (!res.materialized) {
        out.awardReason = res.reason;
        return out;
      }
      out.awardRecordId = res.record.id;
      if (res.outcome === "ALREADY_OBSERVED" && res.record.winnerNameNormalized !== normalizeVendorName(competitor)) {
        // 每个项目只记一次中标方：换了名字不覆盖既有事实
        out.awardReason = "winner_already_recorded";
        return out;
      }
      out.award = "written";
      if (res.outcome === "NEEDS_REVIEW") out.awardReason = "needs_review";
      console.log(`[tender-own-result-backfill] project=${project.id} lost-winner award=${out.award} buyer=${out.buyer}`);
      return out;
    }
    if (input.result !== "won") {
      out.awardReason = "result_not_won";
      return out;
    }
    if (!isT4AwardSchemaReady()) {
      out.awardReason = "t4_schema_not_ready";
      return out;
    }
    const winnerName = project.org?.name?.trim();
    if (!winnerName) {
      out.awardReason = "org_name_missing";
      return out;
    }
    const amount = project.winningBidPrice ?? project.ourBidPrice ?? null;

    const res = await db.$transaction(async (tx) =>
      materializeSkippingRetracted(tx as unknown as AwardsDbClient, `own-result:${project.id}`, (sourceKey) => ({
          orgId: project.orgId!,
          actor: { actorType: "user", userId: input.actorUserId },
          award: {
            winnerName,
            buyerNameRaw: buyerName ?? null,
            projectId: project.id,
            solicitationNumber: project.solicitationNumber ?? null,
            awardDate: project.awardDate ?? null,
            contractAmount: amount,
            // 财务冻结口径：币种不猜测——项目有 currency 用之；无金额则不填币种
            currency: amount != null ? project.currency?.trim() || "CAD" : null,
            scopeSummary: project.name ?? null,
          },
          source: {
            sourceType: "USER_ENTRY",
            sourceKey,
            sourceUrl: null,
            evidenceSnippet: null,
            capturedAt: new Date(),
          },
          confidence: "HIGH",
          verificationStatus: "HUMAN_CONFIRMED",
        })),
    );
    out.award = res.materialized ? "written" : "skipped";
    out.awardRecordId = res.materialized ? res.record.id : null;
    if (!res.materialized) out.awardReason = res.reason;
    console.log(
      `[tender-own-result-backfill] project=${project.id} award=${out.award} buyer=${out.buyer}`,
    );
    return out;
  } catch (e) {
    return {
      ...out,
      awardReason:
        e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160),
    };
  }
}
