/**
 * 渠道指标灌数：批量周数据、解析账号、付费渠道/GA4 映射。
 * 供 HTTP API、Activepieces 回调、数字员工工具共用。
 */

import { db } from "@/lib/db";
import {
  isSyncableMetricProvider,
  normalizeProviderHint,
} from "./channel-providers";
import { writeMarketingMetricSnapshot } from "./metrics";
import {
  buildGa4IngestionKey,
  mapGa4RowToMetricValues,
  type Ga4RawMetricRow,
} from "./providers/ga4-mapper";
import {
  buildPaidMediaIngestionKey,
  detectPaidMediaProvider,
  isPaidMediaProvider,
  mapPaidMediaRowToMetricValues,
  type PaidMediaProvider,
  type PaidMediaRawRow,
} from "./providers/paid-media-mapper";

export type IngestMetricRowResult =
  | { ok: true; snapshotId: string; ingestionKey: string | null; source: string }
  | { ok: false; index: number; error: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function resolveChannelAccountId(input: {
  orgId: string;
  channelAccountId?: string | null;
  externalAccountId?: string | null;
  provider?: string | null;
}): Promise<string | null> {
  if (input.channelAccountId) {
    const account = await db.marketingChannelAccount.findFirst({
      where: { id: input.channelAccountId, orgId: input.orgId },
      select: { id: true },
    });
    if (!account) throw new Error("渠道账号不存在或跨组织");
    return account.id;
  }

  const externalId = text(input.externalAccountId);
  const provider = normalizeProviderHint(input.provider);
  if (externalId && provider) {
    const account = await db.marketingChannelAccount.findFirst({
      where: {
        orgId: input.orgId,
        provider,
        externalAccountId: externalId,
      },
      select: { id: true },
    });
    if (account) return account.id;
  }

  if (provider && isSyncableMetricProvider(provider)) {
    const matches = await db.marketingChannelAccount.findMany({
      where: { orgId: input.orgId, provider },
      select: { id: true },
      take: 2,
    });
    if (matches.length === 1) return matches[0]!.id;
  }

  return null;
}

export function normalizeInboundMetricRow(input: {
  raw: Record<string, unknown>;
  providerHint?: string | null;
  channelAccountId?: string | null;
  eventId?: string | null;
  index?: number;
}): {
  source: string;
  values: Record<string, unknown>;
  ingestionKey: string;
} {
  const raw = { ...input.raw };
  const hint =
    normalizeProviderHint(input.providerHint || raw.provider || raw.source) ||
    null;

  const isGa4 =
    hint === "ga4" ||
    Boolean(raw.propertyId || raw.screenPageViews || raw.sessions);

  if (isGa4) {
    const values = mapGa4RowToMetricValues(raw as Ga4RawMetricRow);
    if (input.channelAccountId) values.channelAccountId = input.channelAccountId;
    const ingestionKey =
      text(raw.ingestionKey) ||
      buildGa4IngestionKey(raw as Ga4RawMetricRow);
    return { source: "ga4", values, ingestionKey };
  }

  const paid = detectPaidMediaProvider(hint, raw);
  if (paid || isPaidMediaProvider(hint)) {
    const provider = (paid || hint) as PaidMediaProvider;
    const values = mapPaidMediaRowToMetricValues(
      raw as PaidMediaRawRow,
      provider,
    );
    if (input.channelAccountId) values.channelAccountId = input.channelAccountId;
    const weekStart = String(values.periodStart || values.capturedAt).slice(0, 10);
    const ingestionKey =
      text(raw.ingestionKey) ||
      buildPaidMediaIngestionKey({
        provider,
        weekStart,
        channelAccountId: text(values.channelAccountId) || null,
        externalAccountId:
          text(raw.externalAccountId) ||
          text(raw.external_account_id) ||
          text(raw.accountId) ||
          null,
      });
    return { source: provider, values, ingestionKey };
  }

  const source = hint || "manual";
  const values = { ...raw };
  if (input.channelAccountId) values.channelAccountId = input.channelAccountId;
  if (!values.granularity && (values.weekStart || values.week_start)) {
    values.granularity = "weekly";
  }
  const ingestionKey =
    text(raw.ingestionKey) ||
    `${source}:${input.eventId || "row"}:${input.index ?? 0}`;
  return { source, values, ingestionKey };
}

export async function ingestChannelMetricRows(input: {
  orgId: string;
  userId: string;
  provider?: string | null;
  channelAccountId?: string | null;
  externalAccountId?: string | null;
  rows: unknown[];
  externalEventId?: string | null;
  maxRows?: number;
}): Promise<{
  written: number;
  results: IngestMetricRowResult[];
  channelAccountId: string | null;
}> {
  const maxRows = input.maxRows ?? 1000;
  const rows = input.rows.slice(0, maxRows);
  const provider = normalizeProviderHint(input.provider);

  const channelAccountId = await resolveChannelAccountId({
    orgId: input.orgId,
    channelAccountId: input.channelAccountId,
    externalAccountId: input.externalAccountId,
    provider,
  });

  const results: IngestMetricRowResult[] = [];
  let written = 0;

  for (let index = 0; index < rows.length; index++) {
    const raw = asRecord(rows[index]);
    if (Object.keys(raw).length === 0) {
      results.push({ ok: false, index, error: "空行" });
      continue;
    }
    try {
      const normalized = normalizeInboundMetricRow({
        raw,
        providerHint: provider,
        channelAccountId,
        eventId: input.externalEventId,
        index,
      });
      // 行级可覆盖账号
      if (!normalized.values.channelAccountId && channelAccountId) {
        normalized.values.channelAccountId = channelAccountId;
      }
      if (
        !normalized.values.channelAccountId &&
        (text(raw.externalAccountId) || text(raw.external_account_id))
      ) {
        const resolved = await resolveChannelAccountId({
          orgId: input.orgId,
          externalAccountId:
            text(raw.externalAccountId) || text(raw.external_account_id),
          provider: normalized.source,
        });
        if (resolved) normalized.values.channelAccountId = resolved;
      }

      const snapshot = await writeMarketingMetricSnapshot({
        orgId: input.orgId,
        userId: input.userId,
        source: normalized.source,
        ingestionKey: normalized.ingestionKey,
        externalEventId: input.externalEventId,
        values: normalized.values,
      });
      written += 1;
      results.push({
        ok: true,
        snapshotId: snapshot.id,
        ingestionKey: snapshot.ingestionKey,
        source: snapshot.source,
      });
    } catch (error) {
      results.push({
        ok: false,
        index,
        error: error instanceof Error ? error.message : "写入失败",
      });
    }
  }

  const touchedAccountIds = [
    ...new Set(
      results
        .filter((row): row is Extract<IngestMetricRowResult, { ok: true }> => row.ok)
        .map(() => channelAccountId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  // 也收集成功行里可能不同的账号：再查一次最近写入
  if (written > 0) {
    const successIds = results
      .filter((row): row is Extract<IngestMetricRowResult, { ok: true }> => row.ok)
      .map((row) => row.snapshotId);
    if (successIds.length) {
      const snaps = await db.marketingMetricSnapshot.findMany({
        where: { id: { in: successIds } },
        select: { channelAccountId: true },
      });
      for (const snap of snaps) {
        if (snap.channelAccountId) touchedAccountIds.push(snap.channelAccountId);
      }
    }
    const unique = [...new Set(touchedAccountIds)];
    if (unique.length) {
      await db.marketingChannelAccount.updateMany({
        where: { orgId: input.orgId, id: { in: unique } },
        data: {
          status: "connected",
          lastSyncedAt: new Date(),
          lastError: null,
        },
      });
    }
  }

  return { written, results, channelAccountId };
}
