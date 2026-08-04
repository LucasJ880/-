"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import {
  SUPPLIER_LINK_ROLES,
  SUPPLIER_LINK_ROLE_LABELS,
  type SupplierLinkRole,
} from "@/lib/bid-workflow/supplier-link-roles";

type LinkRow = {
  id: string;
  role: string;
  inquiryStatus: string;
  sampleStatus: string;
  evidenceStatus: string;
  techMatch: string | null;
  rejectReason: string | null;
  notes: string | null;
  selected: boolean;
  supplier: {
    id: string;
    name: string;
    region: string | null;
    category: string | null;
    contactName: string | null;
    status: string;
  };
};

type SupplierOption = {
  id: string;
  name: string;
};

export function ProjectSupplierLinks({
  projectId,
  orgId,
}: {
  projectId: string;
  orgId: string | null;
}) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [options, setOptions] = useState<SupplierOption[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await apiJson<{ links?: LinkRow[]; unavailable?: boolean }>(
        `/api/projects/${projectId}/supplier-links`,
      );
      setLinks(Array.isArray(data.links) ? data.links : []);
      setUnavailable(!!data.unavailable);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载关联失败");
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!orgId) return;
    apiJson<{ data?: SupplierOption[] }>(
      `/api/suppliers?orgId=${encodeURIComponent(orgId)}&pageSize=100`,
    )
      .then((d) => setOptions(Array.isArray(d.data) ? d.data : []))
      .catch(() => setOptions([]));
  }, [orgId]);

  const linkSupplier = async () => {
    if (!supplierId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/supplier-links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplierId, role: "candidate" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "关联失败");
      setSupplierId("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const updateRole = async (linkId: string, role: SupplierLinkRole) => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/supplier-links/${linkId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            role,
            rejectReason:
              role === "rejected" ? "未入选（请补充原因）" : null,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "更新失败");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (linkId: string, name: string) => {
    if (!window.confirm(`解除与「${name}」的关联？不会删除供应商主数据。`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/supplier-links/${linkId}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "解除失败");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const linkedIds = new Set(links.map((l) => l.supplier.id));
  const available = options.filter((o) => !linkedIds.has(o.id));

  return (
    <div
      id="project-suppliers"
      className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">关联供应商</h3>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            公共供应商库多对多关联（候选 / 短名单 / 入选 / 未入选）
          </p>
        </div>
        <Link
          href="/suppliers"
          className="text-xs text-accent hover:underline"
        >
          打开供应商库
        </Link>
      </div>

      {unavailable && (
        <p className="text-xs text-[var(--muted)]">
          关联表暂不可用（可能尚未迁移），页面其余功能仍可使用。
        </p>
      )}

      {orgId && available.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-background px-2 py-1.5 text-xs"
          >
            <option value="">选择供应商…</option>
            {available.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy || !supplierId}
            onClick={() => void linkSupplier()}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            关联到本项目
          </button>
        </div>
      )}

      {links.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">尚未关联供应商</p>
      ) : (
        <ul className="space-y-2">
          {links.map((l) => (
            <li
              key={l.id}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs space-y-2"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    href={`/suppliers/${l.supplier.id}`}
                    className="font-medium hover:text-accent"
                  >
                    {l.supplier.name}
                  </Link>
                  <p className="text-[var(--muted)] mt-0.5">
                    {[
                      l.supplier.region,
                      l.supplier.category,
                      l.supplier.contactName,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void unlink(l.id, l.supplier.name)}
                  className="text-red-600 hover:underline disabled:opacity-50"
                >
                  解除关联
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1">
                  <span className="text-[var(--muted)]">状态</span>
                  <select
                    className="rounded border px-1.5 py-1 bg-background"
                    value={l.role}
                    disabled={busy}
                    onChange={(e) =>
                      void updateRole(l.id, e.target.value as SupplierLinkRole)
                    }
                  >
                    {SUPPLIER_LINK_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {SUPPLIER_LINK_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="text-[var(--muted)]">
                  询价：{l.inquiryStatus}
                </span>
                <span className="text-[var(--muted)]">
                  样品：{l.sampleStatus}
                </span>
                <span className="text-[var(--muted)]">
                  证据：{l.evidenceStatus}
                </span>
                {l.selected && (
                  <span className="text-[#2e7a56]">已入选</span>
                )}
              </div>
              {l.rejectReason && (
                <p className="text-[var(--muted)]">未入选原因：{l.rejectReason}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
