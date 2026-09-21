"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import {
  TRADE_SAMPLE_STATUS_LABELS,
  canTransitionSample,
  isTradeSampleStatus,
  type TradeSampleStatus,
} from "@/lib/trade/sample-constants";

interface SampleDetail {
  id: string;
  productName: string;
  sku: string | null;
  quantity: number;
  unit: string;
  destination: string | null;
  recipientName: string | null;
  recipientEmail: string | null;
  address: string | null;
  status: string;
  trackingNo: string | null;
  notes: string | null;
  createdAt: string;
  shippedAt: string | null;
  followUpDueAt: string | null;
  followedUpAt: string | null;
  waitingReply?: boolean;
  overdue?: boolean;
  prospectId: string | null;
  quoteId: string | null;
}

export default function TradeSampleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [row, setRow] = useState<SampleDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [trackingNo, setTrackingNo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId || ambiguous) {
      setRow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await apiFetch(`/api/trade/samples/${id}?orgId=${encodeURIComponent(orgId)}`);
    if (res.ok) {
      const data = (await res.json()) as SampleDetail;
      setRow(data);
      setTrackingNo(data.trackingNo ?? "");
    } else {
      setRow(null);
    }
    setLoading(false);
  }, [id, orgId, ambiguous]);

  useEffect(() => {
    if (orgLoading) return;
    void load();
  }, [load, orgLoading]);

  const markFollowedUp = async () => {
    if (!orgId) return;
    setBusy("followed_up");
    setError(null);
    const res = await apiFetch(`/api/trade/samples/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, followedUp: true }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error || "标记失败");
    else await load();
    setBusy(null);
  };

  const changeStatus = async (status: TradeSampleStatus) => {
    if (!orgId) return;
    setBusy(status);
    setError(null);
    const res = await apiFetch(`/api/trade/samples/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId, status, trackingNo }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error || "更新失败");
    else await load();
    setBusy(null);
  };

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }
  if (!row) {
    return <p className="py-16 text-center text-sm text-muted">寄样单不存在。</p>;
  }

  const current = isTradeSampleStatus(row.status) ? row.status : "requested";

  return (
    <div className="space-y-6">
      <button type="button" onClick={() => router.push("/trade/samples")} className="inline-flex items-center gap-1 text-xs text-muted">
        <ArrowLeft size={14} /> 寄样列表
      </button>
      <PageHeader
        title={row.productName}
        description={`${TRADE_SAMPLE_STATUS_LABELS[current]} · ${row.quantity} ${row.unit}`}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      {row.waitingReply && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-xs">
          <div>
            <p className="font-medium text-foreground">
              {row.overdue ? "已寄出、跟进日已过，等买家回" : "已寄出、等买家回"}
            </p>
            <p className="mt-0.5 text-muted">
              {row.followUpDueAt
                ? `跟进日 ${new Date(row.followUpDueAt).toLocaleDateString("zh-CN")} · 不自动发信`
                : "不自动发信，人点已跟进后出队"}
            </p>
          </div>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void markFollowedUp()}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-[color:var(--on-accent)] disabled:opacity-50"
          >
            {busy === "followed_up" ? "…" : "已跟进"}
          </button>
        </div>
      )}
      {row.followedUpAt && !row.waitingReply && (
        <p className="text-xs text-emerald-500">
          已跟进 · {new Date(row.followedUpAt).toLocaleString("zh-CN")}
        </p>
      )}
      <section className="rounded-xl border border-border/60 bg-card-bg p-4 text-sm">
        <dl className="grid gap-2 sm:grid-cols-2">
          <div>货号：{row.sku || "—"}</div>
          <div>目的地：{row.destination || "—"}</div>
          <div>收件人：{row.recipientName || "—"}</div>
          <div>邮箱：{row.recipientEmail || "—"}</div>
          <div>寄出：{row.shippedAt ? new Date(row.shippedAt).toLocaleString("zh-CN") : "—"}</div>
          <div>跟进日：{row.followUpDueAt ? new Date(row.followUpDueAt).toLocaleDateString("zh-CN") : "—"}</div>
        </dl>
        {row.address && <p className="mt-3 text-xs text-muted">地址：{row.address}</p>}
        {row.notes && <p className="mt-2 text-xs text-muted">备注：{row.notes}</p>}
      </section>
      <div className="flex flex-wrap items-end gap-2">
        <input
          value={trackingNo}
          onChange={(e) => setTrackingNo(e.target.value)}
          placeholder="运单号"
          className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs"
        />
        {(["preparing", "shipped", "cancelled"] as const).map((next) =>
          canTransitionSample(current, next) && current !== next ? (
            <button
              key={next}
              type="button"
              disabled={busy !== null}
              onClick={() => void changeStatus(next)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-50"
            >
              {busy === next ? "…" : TRADE_SAMPLE_STATUS_LABELS[next]}
            </button>
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {row.prospectId && (
          <button type="button" className="text-blue-400" onClick={() => router.push(`/trade/prospects/${row.prospectId}`)}>
            打开线索
          </button>
        )}
        {row.quoteId && (
          <button type="button" className="text-blue-400" onClick={() => router.push(`/trade/quotes/${row.quoteId}`)}>
            打开报价
          </button>
        )}
      </div>
    </div>
  );
}
