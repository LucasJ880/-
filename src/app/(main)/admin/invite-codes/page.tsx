"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Copy,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Pencil,
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { canViewAdminPages } from "@/lib/permissions-client";
import { apiFetch } from "@/lib/api-fetch";
import { useOrganizations } from "@/lib/hooks/use-organizations";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { isPersonalWorkspaceCode } from "@/lib/organizations/onboarding-rules";

interface InviteCode {
  id: string;
  code: string;
  role: string;
  label: string | null;
  maxUses: number | null;
  usedCount: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  companyIdsJson: string | null;
  orgId: string | null;
  orgRole: string | null;
  /** USR-1：所属企业（未绑定为 null） */
  org: { id: string; name: string | null; status: string } | null;
}

/** 绑定企业的码只能给这两种平台角色（与注册时的校验同口径） */
const ORG_BOUND_ROLES = ["sales", "trade"] as const;
const ORG_ROLE_LABELS: Record<string, string> = {
  org_member: "成员",
  org_admin: "企业管理员",
};

interface Company {
  id: string;
  name: string;
  slug: string;
  logoUrl: string;
}

function parseCompanyIds(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  boss: "老板",
  manager: "总经理",
  operations: "运营",
  sales: "销售",
  trade: "外贸助手",
  user: "普通用户",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  sales: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  trade: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  user: "bg-gray-500/10 text-gray-400 border-gray-500/20",
};

export default function InviteCodesPage() {
  const router = useRouter();
  const { user, loading: userLoading } = useCurrentUser();
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const [newCode, setNewCode] = useState("");
  const [newRole, setNewRole] = useState("user");
  const [newLabel, setNewLabel] = useState("");
  const [newMaxUses, setNewMaxUses] = useState("");
  const [newCompanyIds, setNewCompanyIds] = useState<string[]>([]);
  const [newOrgId, setNewOrgId] = useState("");
  const [newOrgRole, setNewOrgRole] = useState("org_member");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // USR-1：可绑定的企业（启用中、不是个人工作区）；默认选中当前企业
  const { organizations } = useOrganizations();
  const { orgId: currentOrgId } = useCurrentOrgId();
  const orgOptions = useMemo(
    () =>
      organizations
        .filter((o) => o.status === "active" && !isPersonalWorkspaceCode(o.code))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN")),
    [organizations],
  );
  const orgCompanyId = (orgId: string): string | null => {
    const o = organizations.find((x) => x.id === orgId) as { companyId?: string | null } | undefined;
    return o?.companyId ?? null;
  };
  const orgName = (orgId: string) => orgOptions.find((o) => o.id === orgId)?.name ?? "";

  const [editingOrgFor, setEditingOrgFor] = useState<string | null>(null);
  const [editOrgId, setEditOrgId] = useState("");
  const [editOrgRole, setEditOrgRole] = useState("org_member");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const pickNewOrg = (orgId: string) => {
    setNewOrgId(orgId);
    if (!orgId) return;
    if (!(ORG_BOUND_ROLES as readonly string[]).includes(newRole)) setNewRole("sales");
    const companyId = orgCompanyId(orgId);
    if (companyId && companies.some((c) => c.id === companyId)) {
      setNewCompanyIds((prev) => (prev.includes(companyId) ? prev : [...prev, companyId]));
    }
  };

  const openCreate = () => {
    setShowCreate(true);
    setError("");
    const defaultOrg = currentOrgId && orgOptions.some((o) => o.id === currentOrgId) ? currentOrgId : "";
    setNewOrgRole("org_member");
    if (defaultOrg) {
      setNewRole("sales");
      setNewCompanyIds([]);
      setNewOrgId(defaultOrg);
      const companyId = orgCompanyId(defaultOrg);
      if (companyId && companies.some((c) => c.id === companyId)) setNewCompanyIds([companyId]);
    } else {
      setNewOrgId("");
    }
  };

  const loadCodes = useCallback(async () => {
    try {
      const [codesRes, companiesRes] = await Promise.all([
        apiFetch("/api/admin/invite-codes"),
        apiFetch("/api/admin/companies"),
      ]);
      if (codesRes.ok) {
        const data = await codesRes.json();
        setCodes(data.codes);
      }
      if (companiesRes.ok) {
        const data = await companiesRes.json();
        setCompanies(data.companies);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userLoading && user && !canViewAdminPages(user.role)) {
      router.replace("/");
      return;
    }
    loadCodes();
  }, [userLoading, user, router, loadCodes]);

  const handleCreate = async () => {
    if (!newCode.trim()) {
      setError("请输入邀请码");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const res = await apiFetch("/api/admin/invite-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: newCode.trim(),
          role: newRole,
          label: newLabel.trim() || undefined,
          maxUses: newMaxUses ? parseInt(newMaxUses) : null,
          companyIds: newCompanyIds.length > 0 ? newCompanyIds : undefined,
          orgId: newOrgId || null,
          orgRole: newOrgId ? newOrgRole : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "创建失败");
        return;
      }
      setShowCreate(false);
      setNewCode("");
      setNewRole("user");
      setNewLabel("");
      setNewMaxUses("");
      setNewCompanyIds([]);
      setNewOrgId("");
      setNewOrgRole("org_member");
      loadCodes();
    } catch {
      setError("网络错误");
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (id: string, currentActive: boolean) => {
    await apiFetch(`/api/admin/invite-codes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !currentActive }),
    });
    loadCodes();
  };

  const startEditOrg = (c: InviteCode) => {
    setEditingOrgFor(c.id);
    setEditOrgId(c.orgId ?? "");
    setEditOrgRole(c.orgRole ?? "org_member");
    setEditError("");
  };

  const saveEditOrg = async (id: string) => {
    setEditSaving(true);
    setEditError("");
    try {
      const res = await apiFetch(`/api/admin/invite-codes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editOrgId ? { orgId: editOrgId, orgRole: editOrgRole } : { orgId: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEditError(data.error || "保存失败");
        return;
      }
      setEditingOrgFor(null);
      loadCodes();
    } catch {
      setEditError("网络错误");
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此邀请码？")) return;
    await apiFetch(`/api/admin/invite-codes/${id}`, { method: "DELETE" });
    loadCodes();
  };

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
  };

  if (userLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="邀请码管理"
        description="管理注册邀请码：绑定角色，并可指定注册后直接加入的企业"
        actions={
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] hover:bg-accent-hover transition-colors"
          >
            <Plus size={16} />
            创建邀请码
          </button>
        }
      />

      {showCreate && (
        <div className="rounded-xl border border-border/60 bg-card-bg p-6 space-y-4">
          <h3 className="text-sm font-semibold text-foreground">新建邀请码</h3>

          {error && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2 text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">加入企业</label>
              <select
                value={newOrgId}
                onChange={(e) => pickNewOrg(e.target.value)}
                data-testid="invite-org-select"
                className="w-full rounded-lg border border-border/60 bg-input-bg px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
              >
                <option value="">不加入企业（注册后自建个人工作区）</option>
                {orgOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">企业内角色</label>
              <select
                value={newOrgRole}
                onChange={(e) => setNewOrgRole(e.target.value)}
                disabled={!newOrgId}
                className="w-full rounded-lg border border-border/60 bg-input-bg px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none disabled:opacity-50"
              >
                <option value="org_member">成员</option>
                <option value="org_admin">企业管理员</option>
              </select>
            </div>
            <p className="sm:col-span-2 -mt-2 text-xs text-muted" data-testid="invite-org-hint">
              {newOrgId
                ? `用这个码注册的人直接加入「${orgName(newOrgId)}」，当前企业就是它；按平台角色自动绑定默认岗位（销售 → 销售人员，外贸 → 外贸业务员），不会建个人工作区。绑定企业的码只能分配销售或外贸角色。`
                : "不加入企业：注册后会自建一个「××的工作区」，之后要由平台管理员在企业成员页把人加进企业并设岗位。"}
            </p>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">邀请码</label>
              <input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                placeholder="如 SALES2026"
                className="w-full rounded-lg border border-border/60 bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">绑定角色</label>
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="w-full rounded-lg border border-border/60 bg-input-bg px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none"
              >
                {!newOrgId && <option value="boss">老板</option>}
                {!newOrgId && <option value="manager">总经理</option>}
                {!newOrgId && <option value="operations">运营</option>}
                <option value="sales">销售</option>
                <option value="trade">外贸助手</option>
                {!newOrgId && <option value="user">普通用户</option>}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">备注标签（可选）</label>
              <input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="如：销售团队邀请码"
                className="w-full rounded-lg border border-border/60 bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted">使用上限（留空=无限）</label>
              <input
                type="number"
                value={newMaxUses}
                onChange={(e) => setNewMaxUses(e.target.value)}
                placeholder="不限"
                min={1}
                className="w-full rounded-lg border border-border/60 bg-input-bg px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-muted">
                公司归属（可多选，登录后左上角显示「青砚 × 公司logo」）
              </label>
              {companies.length === 0 ? (
                <p className="text-xs text-muted/60">暂无公司，可先运行公司初始化脚本或联系管理员创建</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {companies.map((co) => {
                    const selected = newCompanyIds.includes(co.id);
                    return (
                      <button
                        key={co.id}
                        type="button"
                        onClick={() =>
                          setNewCompanyIds((prev) =>
                            selected ? prev.filter((id) => id !== co.id) : [...prev, co.id]
                          )
                        }
                        className={cn(
                          "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors",
                          selected
                            ? "border-accent/60 bg-accent/10 text-foreground"
                            : "border-border/60 bg-input-bg text-muted hover:text-foreground"
                        )}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={co.logoUrl} alt={co.name} className="h-4 w-4 rounded-full object-cover" />
                        {co.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              创建
            </button>
            <button
              onClick={() => { setShowCreate(false); setError(""); }}
              className="rounded-lg px-4 py-2 text-sm text-muted hover:text-foreground transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      )}

      <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-border/60 bg-card-bg">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="whitespace-nowrap border-b border-border/40 text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">邀请码</th>
              <th className="px-4 py-3 font-medium">角色</th>
              <th className="px-4 py-3 font-medium">企业</th>
              <th className="px-4 py-3 font-medium">公司</th>
              <th className="px-4 py-3 font-medium">备注</th>
              <th className="px-4 py-3 font-medium text-center">已用/上限</th>
              <th className="px-4 py-3 font-medium text-center">状态</th>
              <th className="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center text-muted">
                  暂无邀请码，点击上方按钮创建
                </td>
              </tr>
            )}
            {codes.map((c) => (
              <tr key={c.id} className="border-b border-border/20 last:border-0 hover:bg-accent-soft transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-card-bg/5 px-2 py-0.5 font-mono text-xs text-foreground">
                      {c.code}
                    </code>
                    <button
                      onClick={() => copyCode(c.code)}
                      className="text-muted hover:text-foreground transition-colors"
                      title="复制"
                    >
                      <Copy size={12} />
                    </button>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={cn("inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-[10px] font-medium", ROLE_COLORS[c.role] || ROLE_COLORS.user)}>
                    {ROLE_LABELS[c.role] || c.role}
                  </span>
                </td>
                <td className="min-w-[220px] px-4 py-3 text-xs" data-testid="invite-org-cell">
                  {editingOrgFor === c.id ? (
                    <div className="space-y-1.5">
                      {(ORG_BOUND_ROLES as readonly string[]).includes(c.role) ? (
                        <>
                          <select
                            value={editOrgId}
                            onChange={(e) => setEditOrgId(e.target.value)}
                            className="w-full rounded-md border border-border/60 bg-input-bg px-2 py-1 text-xs"
                          >
                            <option value="">不加入企业</option>
                            {orgOptions.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </select>
                          {editOrgId && (
                            <select
                              value={editOrgRole}
                              onChange={(e) => setEditOrgRole(e.target.value)}
                              className="w-full rounded-md border border-border/60 bg-input-bg px-2 py-1 text-xs"
                            >
                              <option value="org_member">成员</option>
                              <option value="org_admin">企业管理员</option>
                            </select>
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveEditOrg(c.id)}
                              disabled={editSaving}
                              className="rounded-md bg-accent px-2 py-0.5 text-[color:var(--on-accent)] disabled:opacity-50"
                            >
                              {editSaving ? "保存中…" : "保存"}
                            </button>
                            <button onClick={() => setEditingOrgFor(null)} className="text-muted hover:text-foreground">
                              取消
                            </button>
                          </div>
                          <p className="text-[10px] text-muted">只影响以后用这个码注册的人</p>
                        </>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-muted">只有销售 / 外贸码可以绑定企业</p>
                          <button onClick={() => setEditingOrgFor(null)} className="text-muted hover:text-foreground">
                            关闭
                          </button>
                        </div>
                      )}
                      {editError && <p className="text-red-400">{editError}</p>}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      {c.org ? (
                        <span className="inline-flex items-center gap-1 text-foreground">
                          <Building2 size={12} className="text-muted" />
                          {c.org.name ?? "（企业已删除）"}
                          {c.org.status !== "active" && <span className="text-red-400">（{c.org.status === "missing" ? "不存在" : "已停用"}）</span>}
                          <span className="text-muted">· {ORG_ROLE_LABELS[c.orgRole ?? "org_member"] ?? c.orgRole}</span>
                        </span>
                      ) : (
                        <span className="text-muted">不加入企业</span>
                      )}
                      <button
                        onClick={() => startEditOrg(c)}
                        className="rounded p-0.5 text-muted hover:text-foreground"
                        title="修改企业"
                        data-testid="invite-org-edit"
                      >
                        <Pencil size={11} />
                      </button>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {(() => {
                    const ids = parseCompanyIds(c.companyIdsJson);
                    if (ids.length === 0) return <span className="text-muted">—</span>;
                    return (
                      <div className="flex items-center gap-1.5">
                        {ids.map((id) => {
                          const co = companies.find((x) => x.id === id);
                          if (!co) return null;
                          return (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={id}
                              src={co.logoUrl}
                              alt={co.name}
                              title={co.name}
                              className="h-5 w-5 rounded-full object-cover ring-1 ring-border/40"
                            />
                          );
                        })}
                      </div>
                    );
                  })()}
                </td>
                <td className="px-4 py-3 text-muted">{c.label || "—"}</td>
                <td className="whitespace-nowrap px-4 py-3 text-center">
                  <span className="text-foreground">{c.usedCount}</span>
                  <span className="text-muted">/{c.maxUses ?? "∞"}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-center">
                  {c.isActive ? (
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">启用</span>
                  ) : (
                    <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">停用</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => handleToggle(c.id, c.isActive)}
                      className="rounded-md p-1.5 text-muted hover:bg-accent-soft hover:text-foreground transition-colors"
                      title={c.isActive ? "停用" : "启用"}
                    >
                      {c.isActive ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="rounded-md p-1.5 text-muted hover:bg-red-500/10 hover:text-red-400 transition-colors"
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
