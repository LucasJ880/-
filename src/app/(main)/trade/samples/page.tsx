"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { cn } from "@/lib/utils";
import {
  TRADE_SAMPLE_STATUS_LABELS,
  type TradeSampleStatus,
} from "@/lib/trade/sample-constants";

interface SampleRow {
  id: string;
  productName: string;
  sku: string | null;
  quantity: number;
  unit: string;
  destination: string | null;
  status: string;
  trackingNo: string | null;
  createdAt: string;
  followUpDueAt: string | null;
  followedUpAt: string | null;
  waitingReply?: boolean;
  overdue?: boolean;
}

export default function TradeSamplesPage() {
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [items, setItems] = useState<SampleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    if (!orgId || ambiguous) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const sp = new URLSearchParams({ orgId });
    if (status === "waiting") sp.set("waiting", "1");
    else if (status) sp.set("status", status);
    const res = await apiFetch(`/api/trade/samples?${sp}`);
    if (res.ok) {
      const data = (await res.json()) as { items?: SampleRow[] };
      setItems(data.items ?? []);
    } else {
      setItems([]);
    }
    setLoading(false);
  }, [orgId, ambiguous, status]);

  useEffect(() => {
    if (orgLoading) return;
    void load();
  }, [load, orgLoading]);

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="寄样" description="人审创建，不自动发邮件。寄出后 5 个工作日盯买家回音。" />
        <button
          type="button"
          onClick={() => router.push("/trade/samples/new")}
          className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white"
        >
          <Plus size={12} /> 新建寄样
        </button>
      </div>

      <select
        value={status}
        onChange={(e) => setStatus(e.target.value)}
        className="rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
      >
        <option value="">全部状态</option>
        <option value="waiting">等买家回</option>
        {Object.entries(TRADE_SAMPLE_STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      {items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">
          {status === "waiting" ? "没有等买家回的寄样。" : "还没有寄样单。"}
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60">
          <table className="w-full text-left text-xs">
            <thead className="bg-background/80 text-[10px] uppercase text-muted">
              <tr>
                <th className="px-3 py-2">产品</th>
                <th className="px-3 py-2">数量</th>
                <th className="px-3 py-2">目的地</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2">盯回复</th>
                <th className="px-3 py-2">运单</th>
                <th className="px-3 py-2">创建</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer border-t border-border/40 hover:bg-border/10"
                  onClick={() => router.push(`/trade/samples/${row.id}`)}
                >
                  <td className="px-3 py-2">
                    <div className="text-foreground">{row.productName}</div>
                    {row.sku && <div className="font-mono text-[10px] text-blue-400">{row.sku}</div>}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {row.quantity} {row.unit}
                  </td>
                  <td className="px-3 py-2 text-muted">{row.destination ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span className={cn("rounded-full px-2 py-0.5 text-[10px]", row.status === "shipped" ? "bg-emerald-500/15 text-emerald-400" : "bg-zinc-500/15 text-zinc-300")}>
                      {TRADE_SAMPLE_STATUS_LABELS[row.status as TradeSampleStatus] ?? row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {row.waitingReply ? (
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px]", row.overdue ? "bg-amber-500/15 text-amber-500" : "bg-blue-500/15 text-blue-400")}>
                        {row.overdue ? "已逾期" : "等买家回"}
                      </span>
                    ) : row.followedUpAt ? (
                      <span className="text-muted">已跟进</span>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                    {row.followUpDueAt && row.waitingReply && (
                      <div className="mt-0.5 text-[10px] text-muted">
                        {new Date(row.followUpDueAt).toLocaleDateString("zh-CN")}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">{row.trackingNo ?? "—"}</td>
                  <td className="px-3 py-2 text-muted">{new Date(row.createdAt).toLocaleDateString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
