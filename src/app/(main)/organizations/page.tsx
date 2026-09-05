"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Loader2, Plus, Info, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { isSuperAdmin } from "@/lib/permissions-client";
import {
  SELECTED_ORG_STORAGE_KEY,
  readStoredOrgId,
  selectActiveOrganization,
} from "@/lib/org-selection";

interface OrgRow {
  id: string;
  name: string;
  code: string;
  status: string;
  planType: string;
  memberCount: number;
  projectCount: number;
  myRole: string | null;
  company: { name: string; logoUrl: string } | null;
}

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [activeOrgId, setActiveOrgId] = useState("");
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [platformRole, setPlatformRole] = useState<string | null>(null);

  useEffect(() => {
    setActiveOrgId(readStoredOrgId());
    const onStorage = () => setActiveOrgId(readStoredOrgId());
    window.addEventListener("qingyan-org-storage", onStorage);
    return () => window.removeEventListener("qingyan-org-storage", onStorage);
  }, []);

  useEffect(() => {
    apiJson<{ user?: { role: string } }>("/api/auth/me")
      .then((d) => setPlatformRole(d.user?.role ?? null))
      .catch(() => {});
  }, []);

  const isPlatformAdmin = isSuperAdmin(platformRole);

  const load = useCallback(() => {
    setLoading(true);
    const q =
      isPlatformAdmin && showArchived
        ? "/api/organizations?includeArchived=1"
        : "/api/organizations";
    apiJson<{ organizations?: OrgRow[] }>(q)
      .then((d) => setOrgs(d.organizations ?? []))
      .finally(() => setLoading(false));
  }, [isPlatformAdmin, showArchived]);

  useEffect(() => {
    load();
  }, [load]);

  async function archiveOrg(org: OrgRow) {
    if (
      !confirm(
        `确定归档（删除）「${org.name}」？\n归档后会从默认列表隐藏，且不可再在其下新建项目。`,
      )
    ) {
      return;
    }
    setArchivingId(org.id);
    try {
      const res = await apiFetch(`/api/organizations/${org.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "归档失败");
      if (readStoredOrgId() === org.id) {
        try {
          window.localStorage.removeItem(SELECTED_ORG_STORAGE_KEY);
          window.dispatchEvent(new Event("qingyan-org-storage"));
        } catch {
          /* ignore */
        }
        setActiveOrgId("");
      }
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "归档失败");
    } finally {
      setArchivingId(null);
    }
  }

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
            className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] hover:bg-accent-hover disabled:opacity-50"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            创建
          </button>
        </form>
        {error && (
          <p className="mt-2 text-sm text-[#a63d3d]">{error}</p>
        )}
      </div>

      {isPlatformAdmin && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted">
            删除组织 = 归档（软删除）。需要时可勾选「显示已归档」后进入详情恢复。
          </p>
          <label className="inline-flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="rounded border-border"
            />
            显示已归档
          </label>
        </div>
      )}

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
        <div className="space-y-6">
          {(() => {
            // 公司 → 组织层级：先按公司分组，独立组织（个人工作区等）殿后
            const groups = new Map<string, { company: OrgRow["company"]; rows: OrgRow[] }>();
            for (const o of orgs) {
              const key = o.company?.name ?? "";
              if (!groups.has(key)) groups.set(key, { company: o.company, rows: [] });
              groups.get(key)!.rows.push(o);
            }
            const sections = [...groups.entries()].sort(([a], [b]) => {
              if (a === "") return 1;
              if (b === "") return -1;
              return a.localeCompare(b, "zh");
            });
            return sections.map(([key, g]) => (
              <section key={key || "__standalone"}>
                <div className="mb-2 flex items-center gap-2">
                  {g.company ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={g.company.logoUrl}
                        alt={g.company.name}
                        className="h-5 max-w-[96px] rounded object-contain"
                      />
                      <span className="text-xs font-semibold tracking-wide text-muted">
                        {g.company.name} · {g.rows.length} 个组织
                      </span>
                    </>
                  ) : (
                    <span className="text-xs font-semibold tracking-wide text-muted">
                      独立组织（未归属公司）· {g.rows.length} 个
                    </span>
                  )}
                </div>
                <ul className="space-y-2">
                  {g.rows.map((o) => {
            const isCurrent = o.id === activeOrgId;
            return (
              <li key={o.id}>
                <div
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-xl border bg-card-bg px-4 py-3",
                    isCurrent ? "border-accent/40" : "border-border"
                  )}
                >
                  <Link
                    href={`/organizations/${o.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 transition-colors hover:opacity-90"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <Building2 size={20} />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium">
                        {o.name}
                        {isCurrent && (
                          <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                            当前
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted">
                        {o.code} · {o.memberCount} 人 · {o.projectCount} 个项目
                        {o.myRole && (
                          <span className="ml-2 rounded bg-[rgba(110,125,118,0.08)] px-1.5 py-0.5 text-[10px]">
                            {o.myRole}
                          </span>
                        )}
                      </p>
                    </div>
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    {!isCurrent && o.status === "active" && (
                      <button
                        type="button"
                        disabled={switchingId === o.id}
                        onClick={async () => {
                          setSwitchingId(o.id);
                          const r = await selectActiveOrganization(o.id);
                          setSwitchingId(null);
                          if (!r.ok) {
                            alert(r.error || "切换失败");
                            return;
                          }
                          window.location.reload();
                        }}
                        className="rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-accent/40 hover:text-accent disabled:opacity-50"
                      >
                        {switchingId === o.id ? "切换中…" : "设为当前"}
                      </button>
                    )}
                    {(isPlatformAdmin || o.myRole === "org_admin") &&
                      o.status === "active" && (
                        <button
                          type="button"
                          disabled={archivingId === o.id}
                          onClick={() => void archiveOrg(o)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[rgba(166,61,61,0.15)] px-2.5 py-1.5 text-xs font-medium text-[#a63d3d] hover:bg-[rgba(166,61,61,0.04)] disabled:opacity-50"
                          title="归档组织"
                        >
                          <Trash2 size={12} />
                          {archivingId === o.id ? "…" : "归档"}
                        </button>
                      )}
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
                  </div>
                </div>
              </li>
            );
                  })}
                </ul>
              </section>
            ));
          })()}
        </div>
      )}
    </div>
  );
}
