/**
 * Muse Bridge — 业务挂钩入口（P0-7 / P0-8）
 *
 * 调用方只传 id，本文件负责取上下文并发事件；三条铁律：
 *   1. 绝不上抛（任何失败只 console.error）；
 *   2. 开关关闭时在第一行短路，不查库；
 *   3. 收件人与站内通知保持一致（analysis.ready 复用 alerts.ts 的 resolveFailureRecipients）。
 *
 * 挂钩点：
 *   - analysis.ready  : tender-auto-analysis/worker.ts FINALIZE（legacy）
 *                       tender-workforce/tools.ts 两个 finalize（workforce）
 *   - reply.received  : inquiry/service.ts markItemReplied
 *   - quote.parsed    : inquiry/service.ts recordQuote
 */

import { db } from "@/lib/db";
import { resolveFailureRecipients } from "@/lib/tender-auto-analysis/alerts";
import { emitAnalysisReady, emitMuseEvent } from "./events";
import { quoteRecordedEventInput } from "./events-pure";
import { isMuseBridgeEnabled } from "./flags";

/** 分析终态化（REVIEW_REQUIRED）→ analysis.ready。幂等键 = runId。 */
export async function museOnAnalysisFinalized(runId: string): Promise<void> {
  if (!isMuseBridgeEnabled()) return;
  try {
    const run = await db.tenderAnalysisRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        orgId: true,
        projectId: true,
        status: true,
        createdById: true,
        summaryJson: true,
        project: { select: { name: true, ownerId: true } },
      },
    });
    if (!run || run.status !== "REVIEW_REQUIRED" || !run.orgId) return;

    const recipients = resolveFailureRecipients({ ownerId: run.project?.ownerId, createdById: run.createdById });
    if (recipients.length === 0) return;

    const sj = (run.summaryJson ?? {}) as Record<string, unknown>;
    const syn = sj.analystSynthesis as
      | {
          coverage?: { analyzed?: number; uploaded?: number };
          keyRequirements?: unknown[];
          risksAndGaps?: unknown[];
          clarifications?: unknown[];
          qa?: { needsHumanReview?: boolean };
        }
      | undefined;
    const facts = {
      projectName: run.project?.name ?? "投标项目",
      analyzedFiles: syn?.coverage?.analyzed ?? null,
      uploadedFiles: syn?.coverage?.uploaded ?? null,
      keyRequirements: syn?.keyRequirements?.length ?? null,
      risks: syn?.risksAndGaps?.length ?? null,
      clarifications: syn?.clarifications?.length ?? null,
      needsHumanReview: syn?.qa?.needsHumanReview === true,
    };

    for (const userId of recipients) {
      await emitAnalysisReady({
        runId: `${run.id}:${userId}`,
        orgId: run.orgId,
        recipientUserId: userId,
        projectId: run.projectId,
        facts,
      });
    }
  } catch (err) {
    console.error("[muse-bridge] analysis.ready hook failed:", err);
  }
}

type InquiryItemContext = {
  orgId: string;
  projectId: string;
  projectName: string;
  ownerId: string;
  supplierName: string;
  inquiryTitle: string | null;
  roundNumber: number | null;
};

async function loadInquiryItemContext(itemId: string): Promise<InquiryItemContext | null> {
  const item = await db.inquiryItem.findUnique({
    where: { id: itemId },
    select: {
      supplier: { select: { name: true } },
      inquiry: {
        select: {
          title: true,
          roundNumber: true,
          project: { select: { id: true, name: true, orgId: true, ownerId: true } },
        },
      },
    },
  });
  const p = item?.inquiry?.project;
  if (!item || !p || !p.orgId) return null;
  return {
    orgId: p.orgId,
    projectId: p.id,
    projectName: p.name,
    ownerId: p.ownerId,
    supplierName: item.supplier?.name ?? "供应商",
    inquiryTitle: item.inquiry.title ?? null,
    roundNumber: item.inquiry.roundNumber ?? null,
  };
}

/** 供应商回复（尚无报价）→ reply.received。 */
export async function museOnInquiryReplied(itemId: string): Promise<void> {
  if (!isMuseBridgeEnabled()) return;
  try {
    const ctx = await loadInquiryItemContext(itemId);
    if (!ctx) return;
    await emitMuseEvent({
      eventId: `reply.received:${itemId}`,
      type: "reply.received",
      orgId: ctx.orgId,
      userId: ctx.ownerId,
      projectId: ctx.projectId,
      projectName: ctx.projectName,
      summary: `${ctx.supplierName} 回复了${ctx.roundNumber ? `第 ${ctx.roundNumber} 轮` : ""}询价，报价还没录入。`,
      action: { label: "看这个标的状态", command: { intent: "status", projectId: ctx.projectId } },
    });
  } catch (err) {
    console.error("[muse-bridge] reply.received hook failed:", err);
  }
}

const MISSING_FIELD_LABELS: Record<string, string> = {
  price: "价格",
  currency: "币种",
  deliveryDays: "交期",
  validUntil: "有效期",
  moq: "起订量",
  incoterm: "贸易条款",
};

/** 缺字段 key → 中文标签（未知 key 原样返回） */
export function museMissingLabel(field: string): string {
  return MISSING_FIELD_LABELS[field] ?? field;
}

function inferMissingLabels(quote: MuseQuoteSnapshot): string[] {
  const missing: string[] = [];
  if (quote.unitPrice == null && quote.totalPrice == null) missing.push("价格");
  if (!quote.currency) missing.push("币种");
  if (quote.deliveryDays == null) missing.push("交期");
  if (!quote.validUntil) missing.push("有效期");
  return missing;
}

export type MuseQuoteSnapshot = {
  unitPrice?: unknown;
  totalPrice?: unknown;
  currency?: string | null;
  deliveryDays?: number | null;
  validUntil?: Date | string | null;
};

/** museOnQuoteRecorded 的事件判定（纯函数）：有缺字段 → missing_fields，否则 quote.parsed */
export function museQuoteEvent(
  quote: MuseQuoteSnapshot,
  missingFieldsOverride?: readonly string[],
): { type: "quote.parsed" | "missing_fields"; missing: string[] } {
  const missing = missingFieldsOverride ? missingFieldsOverride.map(museMissingLabel) : inferMissingLabels(quote);
  return { type: missing.length ? "missing_fields" : "quote.parsed", missing };
}

/** 报价录入 → quote.parsed（缺字段如实列出，不猜）。幂等键含录入时间戳：同一供应商改价会再推一次。 */
export async function museOnQuoteRecorded(
  itemId: string,
  quote: MuseQuoteSnapshot,
  /**
   * 调用方已判定的缺字段（P1-4 入站：currency 列默认 CAD，只看字段值判不出"供应商没写币种"）。
   * 传了就以它为准，不再按字段值推断。
   */
  missingFieldsOverride?: readonly string[],
): Promise<void> {
  if (!isMuseBridgeEnabled()) return;
  try {
    const ctx = await loadInquiryItemContext(itemId);
    if (!ctx) return;
    const { type, missing } = museQuoteEvent(quote, missingFieldsOverride);
    // P1-8：结论 + 1 条理由；缺字段 → action = next_step，齐全 → action = compare
    await emitMuseEvent(
      quoteRecordedEventInput({
        itemId,
        orgId: ctx.orgId,
        ownerId: ctx.ownerId,
        projectId: ctx.projectId,
        projectName: ctx.projectName,
        supplierName: ctx.supplierName,
        type,
        missing,
        quote,
        now: new Date(),
      }),
    );
  } catch (err) {
    console.error("[muse-bridge] quote.parsed hook failed:", err);
  }
}
