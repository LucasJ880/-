"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface OrgRow {
  id: string;
  name: string;
  code: string;
  status: string;
  planType: string;
  memberCount: number;
  projectCount: number;
  myRole: string | null;
}

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/organizations")
      .then((r) => r.json())
      .then((d) => setOrgs(d.organizations ?? []))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    try {
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: n,
          ...(code.trim() ? { code: code.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "创建失败");
      setName("");
      setCode("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">组织</h1>
        <p className="mt-1 text-sm text-muted">
          组织是一级数据隔离边界，项目与后续资源将归属在组织下
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card-bg p-5">
        <h2 className="mb-3 text-sm font-semibold">创建组织</h2>
        <form onSubmit={handleCreate} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs text-muted">名称 *</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：某某工作室"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <div className="w-full sm:w-40">
            <label className="mb-1 block text-xs text-muted">Code（可选）</label>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="自动从名称生成"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            创建
          </button>
        </form>
        {error && (
          <p className="mt-2 text-sm text-red-600">{error}</p>
        )}
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      ) : orgs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-16">
          <Building2 className="h-10 w-10 text-muted" />
          <p className="mt-2 text-sm text-muted">暂无组织，请先创建</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {orgs.map((o) => (
            <li key={o.id}>
              <Link
                href={`/organizations/${o.id}`}
                className="flex items-center justify-between rounded-xl border border-border bg-card-bg px-4 py-3 transition-colors hover:bg-background"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                    <Building2 size={20} />
                  </div>
                  <div>
                    <p className="font-medium">{o.name}</p>
                    <p className="text-xs text-muted">
                      {o.code} · {o.memberCount} 人 · {o.projectCount} 个项目
                      {o.myRole && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">
                          {o.myRole}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-medium",
                    o.status === "active"
                      ? "bg-green-100 text-green-700"
                      : "bg-slate-100 text-slate-600"
                  )}
                >
                  {o.status === "active" ? "正常" : o.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
