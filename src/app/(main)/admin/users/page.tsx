"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Loader2,
  Search,
  Users,
  X,
  ChevronRight,
  Shield,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Pagination } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { RoleBadge } from "@/components/ui/role-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { canViewAdminPages } from "@/lib/permissions-client";

interface UserRow {
  id: string;
  email: string;
  name: string;
  nickname: string | null;
  avatar: string | null;
  role: string;
  status: string;
  authProvider: string;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UsersResponse {
  users: UserRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

const STATUS_OPTIONS = [
  { value: "", label: "全部状态" },
  { value: "active", label: "正常" },
  { value: "inactive", label: "已停用" },
  { value: "suspended", label: "已封禁" },
];

export default function AdminUsersPage() {
  return (
    <Suspense fallback={<div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>}>
      <UsersContent />
    </Suspense>
  );
}

function UsersContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user: currentUser, loading: userLoading } = useCurrentUser();

  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [keyword, setKeyword] = useState(searchParams.get("keyword") ?? "");
  const [status, setStatus] = useState(searchParams.get("status") ?? "");
  const [page, setPage] = useState(
    parseInt(searchParams.get("page") ?? "1", 10) || 1
  );

  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [userDetail, setUserDetail] = useState<Record<string, unknown> | null>(null);
  const [editingRole, setEditingRole] = useState(false);
  const [newRole, setNewRole] = useState("");
  const [roleUpdating, setRoleUpdating] = useState(false);

  const loadUsers = useCallback(() => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    if (keyword.trim()) params.set("keyword", keyword.trim());
    if (status) params.set("status", status);
    params.set("page", String(page));
    params.set("pageSize", "20");

    apiFetch(`/api/users?${params}`)
      .then(async (r) => {
        if (!r.ok) {
          const d = await r.json().catch(() => ({}));
          throw new Error(d.error || `请求失败 (${r.status})`);
        }
        return r.json();
      })
      .then((d: UsersResponse) => setData(d))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [keyword, status, page]);

  useEffect(() => {
    if (userLoading) return;
    if (!canViewAdminPages(currentUser?.role)) return;
    loadUsers();
  }, [loadUsers, userLoading, currentUser?.role]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set("keyword", keyword.trim());
    if (status) params.set("status", status);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    router.replace(`/admin/users${qs ? `?${qs}` : ""}`, { scroll: false });
  }, [keyword, status, page, router]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    loadUsers();
  }

  async function openDetail(user: UserRow) {
    setSelectedUser(user);
    setDetailLoading(true);
    try {
      const d = await apiJson<Record<string, unknown>>(`/api/users/${user.id}`);
      const detail = (d.user as Record<string, unknown> | undefined) ?? d;
      setUserDetail(detail);
    } catch {
      setUserDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleRoleUpdate() {
    if (!selectedUser || !newRole) return;
    setRoleUpdating(true);
    try {
      const res = await apiFetch(`/api/users/${selectedUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        setEditingRole(false);
        if (userDetail) {
          setUserDetail({ ...userDetail, role: newRole });
        }
        loadUsers();
      }
    } finally {
      setRoleUpdating(false);
    }
  }

  if (userLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  if (!canViewAdminPages(currentUser?.role)) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="flex flex-col items-center gap-3 rounded-xl border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] py-12">
          <Shield className="h-10 w-10 text-[#a63d3d]" />
          <p className="text-sm font-medium text-[#a63d3d]">无权限访问</p>
          <p className="text-sm text-[#a63d3d]">此页面仅超级管理员可查看</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="用户管理"
        description="查看和管理平台所有用户账号"
      />

      <div className="rounded-xl border border-border bg-card-bg p-4">
        <form onSubmit={handleSearch} className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索邮箱、姓名..."
              className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none focus:border-accent"
            />
            {keyword && (
              <button
                type="button"
                onClick={() => { setKeyword(""); setPage(1); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted hover:text-foreground"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="rounded-lg border border-border bg-background px-3 py-2 text-sm"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            搜索
          </button>
        </form>
      </div>

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-[#a63d3d]">
          {error}
          <button onClick={loadUsers} className="ml-2 font-medium text-accent hover:underline">
            重试
          </button>
        </div>
      ) : !data || data.users.length === 0 ? (
        <EmptyState icon={Users} title="暂无用户" description="没有符合筛选条件的用户" />
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-border bg-card-bg">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border bg-background/50 text-xs text-muted">
                  <th className="px-4 py-3">用户</th>
                  <th className="px-4 py-3">邮箱</th>
                  <th className="px-4 py-3">角色</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">认证方式</th>
                  <th className="px-4 py-3">最近登录</th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr
                    key={u.id}
                    onClick={() => openDetail(u)}
                    className="cursor-pointer border-b border-border/60 transition-colors hover:bg-background/50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-medium text-accent">
                          {u.avatar ? (
                            <img src={u.avatar} className="h-full w-full rounded-full object-cover" alt="" />
                          ) : (
                            u.name[0]?.toUpperCase()
                          )}
                        </div>
                        <div>
                          <p className="font-medium">{u.name}</p>
                          {u.nickname && (
                            <p className="text-[10px] text-muted">{u.nickname}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted">{u.email}</td>
                    <td className="px-4 py-3">
                      <RoleBadge role={u.role} type="platform" />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={u.status} />
                    </td>
                    <td className="px-4 py-3 text-muted">{u.authProvider}</td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {u.lastLoginAt
                        ? new Date(u.lastLoginAt).toLocaleString("zh-CN", {
                            timeZone: "America/Toronto",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight size={14} className="text-muted" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted">共 {data.total} 条</p>
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              onPageChange={setPage}
            />
          </div>
        </>
      )}

      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/50">
          <div className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-card-bg p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">用户详情</h3>
              <button
                onClick={() => { setSelectedUser(null); setUserDetail(null); }}
                className="rounded p-1 text-muted hover:bg-background"
              >
                <X size={18} />
              </button>
            </div>

            {detailLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-accent" />
              </div>
            ) : userDetail ? (
              <div className="mt-4 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-lg font-bold text-accent">
                    {String(userDetail.name ?? "")[0]?.toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold">{String(userDetail.name)}</p>
                    <p className="text-sm text-muted">{String(userDetail.email)}</p>
                  </div>
                </div>

                <div className="space-y-2 rounded-lg border border-border p-3">
                  {([
                    ["ID", userDetail.id],
                    ["昵称", userDetail.nickname || "—"],
                    ["手机", userDetail.phone || "—"],
                    ["状态", userDetail.status],
                    ["认证方式", userDetail.authProvider || "email"],
                    ["所属组织", (userDetail._count as { orgMemberships?: number })?.orgMemberships ?? "—"],
                    ["参与项目", (userDetail._count as { projectMemberships?: number })?.projectMemberships ?? "—"],
                    ["注册时间", userDetail.createdAt ? new Date(String(userDetail.createdAt)).toLocaleString("zh-CN", { timeZone: "America/Toronto" }) : "—"],
                    ["最近登录", userDetail.lastLoginAt ? new Date(String(userDetail.lastLoginAt)).toLocaleString("zh-CN", { timeZone: "America/Toronto" }) : "—"],
                  ] as [string, unknown][]).map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between text-sm">
                      <span className="text-muted">{label}</span>
                      <span className="font-medium">{String(value)}</span>
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">平台角色</span>
                    <div className="flex items-center gap-2">
                      <RoleBadge role={String(userDetail.role)} type="platform" />
                      {!editingRole && (
                        <button
                          onClick={() => { setEditingRole(true); setNewRole(String(userDetail.role)); }}
                          className="text-xs text-accent hover:underline"
                        >
                          修改
                        </button>
                      )}
                    </div>
                  </div>
                  {editingRole && (
                    <div className="mt-3 flex items-center gap-2">
                      <select
                        value={newRole}
                        onChange={(e) => setNewRole(e.target.value)}
                        className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
                      >
                        <option value="admin">管理员</option>
                        <option value="sales">销售</option>
                        <option value="trade">外贸助手</option>
                        <option value="user">普通用户</option>
                      </select>
                      <button
                        onClick={handleRoleUpdate}
                        disabled={roleUpdating || newRole === String(userDetail.role)}
                        className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                      >
                        {roleUpdating ? "保存中..." : "保存"}
                      </button>
                      <button
                        onClick={() => setEditingRole(false)}
                        className="text-xs text-muted hover:text-foreground"
                      >
                        取消
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-[#a63d3d]">加载失败</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
