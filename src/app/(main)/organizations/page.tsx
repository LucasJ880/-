"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Loader2, Plus, FolderKanban, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";

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
    apiFetch("/api/organizations")
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
      const res = await apiFetch("/api/organizations", {
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
      <PageHeader
        title="组织"
        description="组织是一级数据隔离边界：成员在此协作，项目必须归属在某个组织下才能统一管理任务与环境。"
      />

      <div className="flex gap-3 rounded-xl border border-border bg-card-bg px-4 py-3 text-sm text-muted">
        <Info size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden />
        <p className="leading-relaxed">
          <strong className="text-foreground">与项目的关系：</strong>
          新建项目时需选择组织；任务、环境、Prompt 与知识库挂在项目下。
          若暂无项目，创建组织后可前往{" "}
          <Link href="/projects" className="font-medium text-accent hover:underline">
            项目
          </Link>{" "}
          新建。
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
          <p className="mt-2 text-sm text-[#a63d3d]">{error}</p>
        )}
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      ) : orgs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border py-16">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(110,125,118,0.08)]">
            <Building2 size={28} className="text-[#8a9590]" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">还没有组织</p>
            <p className="mt-1 max-w-sm text-sm text-muted">
              在上方填写名称和编码即可创建你的第一个组织。创建后可以邀请成员、新建项目和管理供应商。
            </p>
          </div>
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
                        <span className="ml-2 rounded bg-[rgba(110,125,118,0.08)] px-1.5 py-0.5 text-[10px]">
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
                      ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
                      : "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]"
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
