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
 * - lost 不写对手事实：结果表单不采集中标方名称；对手 award 事实只能走
 *   外部情报人工确认线（award-history POST）。表单补选填中标方 = 后续 P1。
 * - Buyer 写门是 admin-only（corporate-memory access.ts）：无权限 → 跳过并
 *   记录原因，绝不阻塞结果标记。
 * - T4 schema 未 ready → 跳过 award 写入（与 award-history 路由同一兼容策略）。
 * - 任何失败绝不上抛（结果标记必须成功）；返回值显式描述每一步结局。
 */

import { db } from "@/lib/db";
import { isT4AwardSchemaReady } from "./award-flags";
import {
  materializeWinnerConfirmation,
  type AwardsDbClient,
} from "./awards";

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
      materializeWinnerConfirmation(
        {
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
            sourceKey: `own-result:${project.id}`,
            sourceUrl: null,
            evidenceSnippet: null,
            capturedAt: new Date(),
          },
          confidence: "HIGH",
          verificationStatus: "HUMAN_CONFIRMED",
        },
        { client: tx as unknown as AwardsDbClient },
      ),
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
