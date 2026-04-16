"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, ShieldAlert, User as UserIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { apiJson } from "@/lib/api-fetch";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { canViewAdminPages } from "@/lib/permissions-client";

interface AuditUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}

interface DiscountDiffEntry {
  from: number | null;
  to: number | null;
}

interface AuditItem {
  id: string;
  createdAt: string;
  user: AuditUser | null;
  ip: string | null;
  userAgent: string | null;
  before: Record<string, number> | null;
  after: Record<string, number> | null;
  diff: Record<string, DiscountDiffEntry> | null;
}

interface AuditResponse {
  items: AuditItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const CATEGORY_LABELS: Record<string, string> = {
  Zebra: "Zebra（斑马帘）",
  Roller: "Roller（卷帘）",
  SHANGRILA: "SHANGRILA（香格里拉）",
  "Cordless Cellular": "Cordless Cellular（蜂巢帘）",
  SkylightHoneycomb: "Skylight Honeycomb（天窗蜂巢）",
  Drapery: "Drapery（窗帘）",
  Sheer: "Sheer（纱帘）",
  Shutters: "Shutters（百叶窗）",
};

function formatPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function QuoteSettingsAuditPage() {
  const { user, loading: userLoading } = useCurrentUser();
  const [data, setData] = useState<AuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const canView = !!user && canViewAdminPages(user.role);

  const load = useCallback(
    async (p: number) => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiJson<AuditResponse>(
          `/api/sales/quote-settings/log?page=${p}&pageSize=20`,
        );
        setData(res);
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (userLoading) return;
    if (!canView) {
      setLoading(false);
      return;
    }
    load(page);
  }, [userLoading, canView, page, load]);

  if (userLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-20 text-center">
        <ShieldAlert className="h-10 w-10 text-amber-500" />
        <h2 className="text-lg font-semibold">无权查看</h2>
        <p className="text-sm text-muted-foreground">
          折扣修改记录仅限管理员查看。
        </p>
        <Link
          href="/sales/quote-tool"
          className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-1.5 text-sm hover:bg-muted/50"
        >
          <ArrowLeft size={14} />
          返回报价工具
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="折扣率修改记录"
        description="所有通过 Pricing Settings 修改全局折扣率的操作都会在此留痕，用于事后审计。"
        actions={
          <Link
            href="/sales/quote-tool"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-white px-3 py-1.5 text-sm hover:bg-muted/50"
          >
            <ArrowLeft size={14} />
            返回报价工具
          </Link>
        }
      />

      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-accent" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          加载失败：{error}
        </div>
      ) : !data || data.items.length === 0 ? (
        <EmptyState
          title="暂无折扣修改记录"
          description="尚未有用户调整过全局折扣率。"
        />
      ) : (
        <div className="space-y-3">
          {data.items.map((item) => (
            <AuditCard key={item.id} item={item} />
          ))}
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            onPageChange={setPage}
          />
          <p className="text-center text-xs text-muted-foreground">
            共 {data.total} 条记录
          </p>
        </div>
      )}
    </div>
  );
}

function AuditCard({ item }: { item: AuditItem }) {
  const diffEntries = item.diff ? Object.entries(item.diff) : [];

  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {item.user?.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.user.avatar}
              alt={item.user.name}
              className="h-8 w-8 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
              <UserIcon size={14} />
            </div>
          )}
          <div>
            <div className="text-sm font-semibold text-foreground">
              {item.user?.name || item.user?.email || "未知用户"}
            </div>
            {item.user?.email && (
              <div className="text-xs text-muted-foreground">{item.user.email}</div>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>{formatTime(item.createdAt)}</div>
          {item.ip && <div className="mt-0.5">IP：{item.ip}</div>}
        </div>
      </div>

      {diffEntries.length > 0 ? (
        <div className="mt-3 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">品类</th>
                <th className="px-3 py-2 text-right font-medium">改前</th>
                <th className="px-3 py-2 text-right font-medium">改后</th>
                <th className="px-3 py-2 text-right font-medium">变动</th>
              </tr>
            </thead>
            <tbody>
              {diffEntries.map(([category, entry]) => {
                const from = entry.from;
                const to = entry.to;
                const delta =
                  from != null && to != null ? (to - from) * 100 : null;
                return (
                  <tr key={category} className="border-t border-border/60">
                    <td className="px-3 py-2 font-medium text-foreground">
                      {CATEGORY_LABELS[category] || category}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {formatPct(from)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-foreground">
                      {formatPct(to)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {delta == null ? (
                        "—"
                      ) : (
                        <span
                          className={
                            delta > 0
                              ? "text-emerald-600"
                              : delta < 0
                                ? "text-red-600"
                                : "text-muted-foreground"
                          }
                        >
                          {delta > 0 ? "+" : ""}
                          {Math.round(delta)}%
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground">
          （记录中没有明确的 diff）
        </div>
      )}

      {item.userAgent && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
            设备信息
          </summary>
          <div className="mt-1 break-all rounded bg-muted/30 p-2 text-xs text-muted-foreground">
            {item.userAgent}
          </div>
        </details>
      )}
    </div>
  );
}
