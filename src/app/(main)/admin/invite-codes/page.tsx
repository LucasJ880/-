"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Copy,
  Loader2,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { useCurrentUser } from "@/lib/hooks/use-current-user";
import { canViewAdminPages } from "@/lib/permissions-client";
import { apiFetch } from "@/lib/api-fetch";

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
}

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
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
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const loadCodes = useCallback(async () => {
    try {
      const res = await apiFetch("/api/admin/invite-codes");
      if (res.ok) {
        const data = await res.json();
        setCodes(data.codes);
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
        description="管理注册邀请码，控制角色分配"
        actions={
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors"
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
                <option value="admin">管理员</option>
                <option value="sales">销售</option>
                <option value="trade">外贸助手</option>
                <option value="user">普通用户</option>
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
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors disabled:opacity-50"
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

      <div className="rounded-xl border border-border/60 bg-card-bg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/40 text-left text-xs text-muted">
              <th className="px-4 py-3 font-medium">邀请码</th>
              <th className="px-4 py-3 font-medium">角色</th>
              <th className="px-4 py-3 font-medium">备注</th>
              <th className="px-4 py-3 font-medium text-center">已用/上限</th>
              <th className="px-4 py-3 font-medium text-center">状态</th>
              <th className="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {codes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-muted">
                  暂无邀请码，点击上方按钮创建
                </td>
              </tr>
            )}
            {codes.map((c) => (
              <tr key={c.id} className="border-b border-border/20 last:border-0 hover:bg-white/[0.02] transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <code className="rounded bg-white/5 px-2 py-0.5 font-mono text-xs text-foreground">
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
                  <span className={cn("inline-flex rounded-md border px-2 py-0.5 text-[10px] font-medium", ROLE_COLORS[c.role] || ROLE_COLORS.user)}>
                    {ROLE_LABELS[c.role] || c.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-muted">{c.label || "—"}</td>
                <td className="px-4 py-3 text-center">
                  <span className="text-foreground">{c.usedCount}</span>
                  <span className="text-muted">/{c.maxUses ?? "∞"}</span>
                </td>
                <td className="px-4 py-3 text-center">
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
                      className="rounded-md p-1.5 text-muted hover:bg-white/5 hover:text-foreground transition-colors"
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
