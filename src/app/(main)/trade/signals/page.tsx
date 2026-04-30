"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Radio } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";

interface SignalListItem {
  id: string;
  title: string;
  description: string;
  signalType: string;
  strength: string;
  createdAt: string;
  prospectId: string | null;
  prospectCompanyName: string | null;
  watchTarget: { url: string; pageType: string } | null;
}

export default function TradeSignalsPage() {
  const router = useRouter();
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [items, setItems] = useState<SignalListItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!orgId || ambiguous) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await apiFetch(
        `/api/trade/signals?orgId=${encodeURIComponent(orgId)}&limit=100`,
      );
      if (res.ok) {
        const data = (await res.json()) as { items?: SignalListItem[] };
        setItems(data.items ?? []);
      } else {
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [orgId, ambiguous]);

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

  if (!orgId || ambiguous) {
    return (
      <div className="space-y-4 py-16 text-center">
        <p className="text-sm text-muted">请先选择当前组织后再查看监控信号。</p>
        <button type="button" onClick={() => router.push("/organizations")} className="text-sm text-accent underline-offset-2 hover:underline">
          前往组织
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="页面监控信号"
        description="按组织聚合的弱信号列表（需人工核对）；不含搜索与导出。"
      />

      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">
          最近最多 100 条 · 冷却期内同 URL 类型可能不重复落库
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-lg border border-border px-2 py-1 text-xs text-foreground hover:border-amber-500/40"
        >
          刷新
        </button>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-border/60 bg-card-bg px-8 py-16 text-center">
          <Radio className="mx-auto mb-3 h-8 w-8 text-muted" />
          <p className="text-sm text-muted">暂无监控信号</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60 bg-card-bg">
          <table className="w-full min-w-[640px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-border/60 text-muted">
                <th className="px-3 py-2 font-medium">时间</th>
                <th className="px-3 py-2 font-medium">标题</th>
                <th className="px-3 py-2 font-medium">线索</th>
                <th className="px-3 py-2 font-medium">类型</th>
                <th className="px-3 py-2 font-medium">监测 URL</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b border-border/40 last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {new Date(s.createdAt).toLocaleString("zh-CN")}
                  </td>
                  <td className="max-w-[200px] px-3 py-2">
                    <span className="font-medium text-foreground">{s.title}</span>
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted">
                      {s.description}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    {s.prospectId ? (
                      <Link
                        href={`/trade/prospects/${s.prospectId}`}
                        className="text-blue-400 hover:underline"
                      >
                        {s.prospectCompanyName ?? s.prospectId}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted">
                    {s.watchTarget?.pageType ?? "—"}
                  </td>
                  <td className="max-w-[280px] px-3 py-2">
                    {s.watchTarget?.url ? (
                      <a
                        href={s.watchTarget.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-blue-400 hover:underline"
                      >
                        {s.watchTarget.url}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
