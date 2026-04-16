"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch, apiJson } from "@/lib/api-fetch";

interface OrgDetail {
  id: string;
  name: string;
  code: string;
  status: string;
  planType: string;
  memberCount: number;
  projectCount: number;
  myRole: string | null;
}

interface MemberRow {
  id: string;
  userId: string;
  role: string;
  status: string;
  user: { id: string; email: string; name: string };
}

const ORG_ROLES = ["org_admin", "org_member", "org_viewer"] as const;

export default function OrganizationDetailPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editName, setEditName] = useState("");
  const [savingOrg, setSavingOrg] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<string>("org_member");
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [platformRole, setPlatformRole] = useState<string | null>(null);

  useEffect(() => {
    apiJson<{ user?: { role: string } }>("/api/auth/me")
      .then((d) => setPlatformRole(d.user?.role ?? null))
      .catch(() => {});
  }, []);

  const isAdmin =
    org?.myRole === "org_admin" || platformRole === "super_admin";

  const load = useCallback(() => {
    if (!orgId) return;
    setLoading(true);
    Promise.all([
      apiJson<{ organization: OrgDetail; error?: string }>(`/api/organizations/${orgId}`),
      apiJson<{ members?: MemberRow[] }>(`/api/organizations/${orgId}/members`),
    ])
      .then(([o, m]) => {
        setOrg(o.organization);
        setEditName(o.organization.name);
        setError("");
        setMembers(m.members ?? []);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "加载失败");
        setOrg(null);
      })
      .finally(() => setLoading(false));
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveOrgName() {
    if (!org || !editName.trim()) return;
    setSavingOrg(true);
    try {
      const res = await apiFetch(`/api/organizations/${orgId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "保存失败");
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingOrg(false);
    }
  }

  async function archiveOrg() {
    if (!confirm("确定归档该组织？归档后不可再在其下新建项目。")) return;
    const res = await apiFetch(`/api/organizations/${orgId}`, {
      method: "DELETE",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || "操作失败");
      return;
    }
    router.push("/organizations");
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault();
    const uid = addUserId.trim();
    if (!uid) return;
    setBusyMemberId("__add__");
    try {
      const res = await apiFetch(`/api/organizations/${orgId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: uid, role: addRole }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "添加失败");
      setAddUserId("");
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "添加失败");
    } finally {
      setBusyMemberId(null);
    }
  }

  async function updateMember(memberId: string, role: string) {
    setBusyMemberId(memberId);
    try {
      const res = await apiFetch(
        `/api/organizations/${orgId}/members/${memberId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "更新失败");
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "更新失败");
    } finally {
      setBusyMemberId(null);
    }
  }

  async function removeMember(memberId: string) {
    if (!confirm("确定从组织中移除此成员？")) return;
    setBusyMemberId(memberId);
    try {
      const res = await apiFetch(
        `/api/organizations/${orgId}/members/${memberId}`,
        { method: "DELETE" }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "移除失败");
      load();
    } catch (e) {
      alert(e instanceof Error ? e.message : "移除失败");
    } finally {
      setBusyMemberId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Link
          href="/organizations"
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft size={14} /> 返回
        </Link>
        <p className="text-[#a63d3d]">{error || "组织不存在"}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href="/organizations"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft size={14} /> 组织列表
      </Link>

      <div className="rounded-xl border border-border bg-card-bg p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">{org.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {org.code} · {org.planType} · {org.memberCount} 人 ·{" "}
              {org.projectCount} 个项目
            </p>
          </div>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-medium",
              org.status === "active"
                ? "bg-[rgba(46,122,86,0.08)] text-[#2e7a56]"
                : "bg-[rgba(110,125,118,0.08)] text-[#6e7d76]"
            )}
          >
            {org.status}
          </span>
        </div>

        {isAdmin && org.status === "active" && (
          <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1 block text-xs text-muted">组织名称</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
              />
            </div>
            <button
              type="button"
              onClick={saveOrgName}
              disabled={savingOrg}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              {savingOrg ? "保存中…" : "保存名称"}
            </button>
            <button
              type="button"
              onClick={archiveOrg}
              className="rounded-lg border border-[rgba(166,61,61,0.15)] px-4 py-2 text-sm text-[#a63d3d] hover:bg-[rgba(166,61,61,0.04)]"
            >
              归档组织
            </button>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-border bg-card-bg p-5">
        <h2 className="text-sm font-semibold">成员</h2>
        <p className="mt-1 text-xs text-muted">
          通过用户 ID 添加成员（无邮件邀请）；可从设置或其它途径获取用户 id。
        </p>

        {isAdmin && org.status === "active" && (
          <form onSubmit={addMember} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <input
              value={addUserId}
              onChange={(e) => setAddUserId(e.target.value)}
              placeholder="用户 ID (cuid)"
              className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
            />
            <select
              value={addRole}
              onChange={(e) => setAddRole(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
            >
              {ORG_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={busyMemberId === "__add__"}
              className="rounded-[var(--radius-sm)] bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50"
            >
              添加
            </button>
          </form>
        )}

        <table className="mt-4 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="pb-2 pr-2">用户</th>
              <th className="pb-2 pr-2">邮箱</th>
              <th className="pb-2 pr-2">角色</th>
              <th className="pb-2">状态</th>
              {isAdmin && <th className="pb-2 w-28">操作</th>}
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-border/60">
                <td className="py-2 pr-2">{m.user.name}</td>
                <td className="py-2 pr-2 text-muted">{m.user.email}</td>
                <td className="py-2 pr-2">
                  {isAdmin && org.status === "active" && m.status === "active" ? (
                    <select
                      value={m.role}
                      disabled={busyMemberId === m.id}
                      onChange={(e) => updateMember(m.id, e.target.value)}
                      className="rounded border border-border bg-background px-2 py-1 text-xs"
                    >
                      {ORG_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  ) : (
                    m.role
                  )}
                </td>
                <td className="py-2">{m.status}</td>
                {isAdmin && (
                  <td className="py-2">
                    {org.status === "active" && m.status === "active" && (
                      <button
                        type="button"
                        onClick={() => removeMember(m.id)}
                        disabled={busyMemberId === m.id}
                        className="text-[#a63d3d] hover:text-[#a63d3d] disabled:opacity-50"
                        title="移除"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
