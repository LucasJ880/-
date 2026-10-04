"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { cn } from "@/lib/utils";

interface CatalogRow {
  id: string;
  sku: string;
  name: string;
  nameEn: string | null;
  status: string;
  fobPrice: number | null;
  moq: string | null;
  leadTimeDays: number | null;
}

const emptyForm = {
  sku: "",
  name: "",
  nameEn: "",
  fobPrice: "",
  moq: "",
  leadTimeDays: "",
};

export default function TradeProductsPage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [items, setItems] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId || ambiguous) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const res = await apiFetch(`/api/trade/products?catalog=1&orgId=${encodeURIComponent(orgId)}`);
    if (res.ok) {
      const data = (await res.json()) as { items?: CatalogRow[] };
      setItems(data.items ?? []);
    } else {
      setItems([]);
    }
    setLoading(false);
  }, [orgId, ambiguous]);

  useEffect(() => {
    if (orgLoading) return;
    void load();
  }, [load, orgLoading]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setError(null);
  };

  const save = async () => {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    const editing = items.find((row) => row.id === editingId);
    const payload = {
      orgId,
      sku: form.sku,
      name: form.name,
      nameEn: form.nameEn,
      fobPrice: form.fobPrice,
      moq: form.moq,
      leadTimeDays: form.leadTimeDays,
      status: editing?.status === "archived" ? "archived" : "active",
    };
    const res = await apiFetch(editingId ? `/api/trade/products/${editingId}` : "/api/trade/products", {
      method: editingId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || "保存失败");
    else {
      resetForm();
      await load();
    }
    setBusy(false);
  };

  const toggle = async (row: CatalogRow) => {
    if (!orgId) return;
    setBusy(true);
    setError(null);
    const res = await apiFetch(`/api/trade/products/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId,
        status: row.status === "archived" ? "active" : "archived",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error || "更新失败");
    else await load();
    setBusy(false);
  };

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (!orgId || ambiguous) {
    return <p className="py-16 text-center text-sm text-muted">请先选择当前组织。</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="货号"
        description="在售货号、FOB、起订量和交期。报价和寄样用来对货号。不记库存。"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <form
        className="grid gap-2 rounded-xl border border-border/60 bg-card-bg p-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          value={form.sku}
          onChange={(e) => setForm({ ...form, sku: e.target.value })}
          placeholder="货号 *"
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs"
        />
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="中文名 *"
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs"
        />
        <input
          value={form.nameEn}
          onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
          placeholder="英文名"
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs"
        />
        <input
          value={form.fobPrice}
          onChange={(e) => setForm({ ...form, fobPrice: e.target.value })}
          placeholder="FOB 美元"
          inputMode="decimal"
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs"
        />
        <input
          value={form.moq}
          onChange={(e) => setForm({ ...form, moq: e.target.value })}
          placeholder="起订量，如 500"
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs"
        />
        <input
          value={form.leadTimeDays}
          onChange={(e) => setForm({ ...form, leadTimeDays: e.target.value })}
          placeholder="交期天数"
          inputMode="numeric"
          className="rounded-lg border border-border bg-background px-3 py-2 text-xs"
        />
        <div className="flex items-center gap-2 sm:col-span-3">
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {busy ? "…" : editingId ? "保存修改" : "添加货号"}
          </button>
          {editingId && (
            <button type="button" onClick={resetForm} className="text-xs text-muted">
              取消编辑
            </button>
          )}
        </div>
      </form>

      {items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">还没有货号。加上之后，报价和寄样才能对上。</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60">
          <table className="w-full text-left text-xs">
            <thead className="bg-background/80 text-[10px] uppercase text-muted">
              <tr>
                <th className="px-3 py-2">货号</th>
                <th className="px-3 py-2">名称</th>
                <th className="px-3 py-2">FOB</th>
                <th className="px-3 py-2">起订量</th>
                <th className="px-3 py-2">交期</th>
                <th className="px-3 py-2">状态</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-t border-border/40">
                  <td className="px-3 py-2 font-mono text-blue-400">{row.sku}</td>
                  <td className="px-3 py-2">
                    <div>{row.name}</div>
                    {row.nameEn && <div className="text-[10px] text-muted">{row.nameEn}</div>}
                  </td>
                  <td className="px-3 py-2 text-muted">{row.fobPrice != null ? `$${row.fobPrice}` : "—"}</td>
                  <td className="px-3 py-2 text-muted">{row.moq ?? "—"}</td>
                  <td className="px-3 py-2 text-muted">{row.leadTimeDays != null ? `${row.leadTimeDays} 天` : "—"}</td>
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px]",
                        row.status === "archived" ? "bg-zinc-500/15 text-zinc-300" : "bg-emerald-500/15 text-emerald-400",
                      )}
                    >
                      {row.status === "archived" ? "停用" : row.status === "draft" ? "草稿" : "在售"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      className="mr-2 text-blue-400"
                      onClick={() => {
                        setEditingId(row.id);
                        setForm({
                          sku: row.sku,
                          name: row.name,
                          nameEn: row.nameEn ?? "",
                          fobPrice: row.fobPrice != null ? String(row.fobPrice) : "",
                          moq: row.moq ?? "",
                          leadTimeDays: row.leadTimeDays != null ? String(row.leadTimeDays) : "",
                        });
                      }}
                    >
                      编辑
                    </button>
                    <button type="button" disabled={busy} className="text-muted" onClick={() => void toggle(row)}>
                      {row.status === "archived" ? "启用" : "停用"}
                    </button>
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
