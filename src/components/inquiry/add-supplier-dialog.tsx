"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { Loader2, Plus, X } from "lucide-react";

interface SupplierOption {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
}

interface Props {
  projectId: string;
  inquiryId: string;
  orgId: string;
  onClose: () => void;
  onAdded: () => void;
}

export function AddSupplierDialog({
  projectId,
  inquiryId,
  orgId,
  onClose,
  onAdded,
}: Props) {
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState<string | null>(null);

  // Quick-create fields
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    apiFetch(`/api/suppliers?orgId=${orgId}&status=active&pageSize=200`)
      .then((r) => r.json())
      .then((res) => setSuppliers(res.data ?? []))
      .finally(() => setLoading(false));
  }, [orgId]);

  async function addExisting(supplierId: string) {
    setAdding(supplierId);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/inquiries/${inquiryId}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ supplierId }),
        }
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "添加失败");
      }
      onAdded();
    } catch (err) {
      alert(err instanceof Error ? err.message : "添加失败");
    } finally {
      setAdding(null);
    }
  }

  async function createAndAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const createRes = await apiFetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          name: newName.trim(),
          contactEmail: newEmail.trim() || undefined,
        }),
      });
      if (!createRes.ok) {
        const d = await createRes.json().catch(() => ({}));
        throw new Error(d.error || "创建供应商失败");
      }
      const supplier = await createRes.json();

      const addRes = await apiFetch(
        `/api/projects/${projectId}/inquiries/${inquiryId}/items`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ supplierId: supplier.id }),
        }
      );
      if (!addRes.ok) {
        const d = await addRes.json().catch(() => ({}));
        throw new Error(d.error || "添加到询价失败");
      }
      onAdded();
    } catch (err) {
      alert(err instanceof Error ? err.message : "操作失败");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-border bg-card-bg p-5 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">添加供应商到询价</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="flex h-20 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-accent" />
          </div>
        ) : (
          <>
            {suppliers.length > 0 && (
              <div className="max-h-48 space-y-1 overflow-y-auto mb-3">
                {suppliers.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2"
                  >
                    <div>
                      <div className="text-sm font-medium">{s.name}</div>
                      {s.contactEmail && (
                        <div className="text-[11px] text-muted">
                          {s.contactEmail}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => addExisting(s.id)}
                      disabled={adding === s.id}
                      className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                    >
                      {adding === s.id ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : (
                        "添加"
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-border pt-3">
              {!showCreate ? (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  <Plus size={12} />
                  新建供应商并添加
                </button>
              ) : (
                <form onSubmit={createAndAdd} className="space-y-2">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="供应商名称（必填）"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
                    autoFocus
                  />
                  <input
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="联系邮箱（可选）"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={creating || !newName.trim()}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                    >
                      {creating ? "创建中…" : "新建并添加"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreate(false)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-background/80"
                    >
                      取消
                    </button>
                  </div>
                </form>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
