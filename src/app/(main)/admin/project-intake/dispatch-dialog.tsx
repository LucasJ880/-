"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, X, Check, Building2, User, Users } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useOrganizations } from "@/lib/hooks/use-organizations";

interface DispatchDialogProps {
  project: {
    id: string;
    name: string;
    org: { id: string; name: string } | null;
  };
  onClose: () => void;
  onSuccess: () => void;
}

interface OrgMember {
  id: string;
  userId: string;
  role: string;
  user: { id: string; name: string; email: string };
}

export function DispatchDialog({ project, onClose, onSuccess }: DispatchDialogProps) {
  const { organizations, loading: orgsLoading } = useOrganizations();
  const [selectedOrgId, setSelectedOrgId] = useState(project.org?.id ?? "");
  const [ownerUserId, setOwnerUserId] = useState("");
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const loadMembers = useCallback(async (orgId: string) => {
    if (!orgId) {
      setMembers([]);
      return;
    }
    setMembersLoading(true);
    try {
      const res = await apiFetch(`/api/organizations/${orgId}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members ?? data ?? []);
      }
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedOrgId) {
      loadMembers(selectedOrgId);
      setOwnerUserId("");
      setSelectedMemberIds([]);
    }
  }, [selectedOrgId, loadMembers]);

  const handleSubmit = async () => {
    if (!selectedOrgId) {
      setError("请选择目标组织");
      return;
    }
    setSubmitting(true);
    setError("");

    try {
      const res = await apiFetch(`/api/admin/project-intake/${project.id}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId: selectedOrgId,
          ownerUserId: ownerUserId || undefined,
          memberUserIds: selectedMemberIds.length ? selectedMemberIds : undefined,
          note: note || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as Record<string, string>).error || "分发失败");
        return;
      }

      onSuccess();
    } catch {
      setError("网络错误");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMember = (uid: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-card shadow-xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">分发项目</h2>
            <p className="text-sm text-muted mt-0.5 truncate max-w-[360px]">{project.name}</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5 flex-1">
          {/* Org select */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Building2 className="h-4 w-4 text-primary" />
              目标组织 <span className="text-[#a63d3d]">*</span>
            </label>
            {orgsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> 加载组织…
              </div>
            ) : (
              <select
                value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">请选择组织</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Owner select */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <User className="h-4 w-4 text-primary" />
              项目负责人（可选）
            </label>
            {membersLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> 加载成员…
              </div>
            ) : !selectedOrgId ? (
              <p className="text-xs text-muted">请先选择组织</p>
            ) : (
              <select
                value={ownerUserId}
                onChange={(e) => setOwnerUserId(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                <option value="">不指定（保持系统默认）</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.user.name || m.user.email} ({m.role === "org_admin" ? "管理员" : "成员"})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Members multi-select */}
          {selectedOrgId && members.length > 0 && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                <Users className="h-4 w-4 text-primary" />
                项目成员（可选，可多选）
              </label>
              <div className="max-h-40 overflow-y-auto space-y-1 rounded-lg border border-border p-2">
                {members.map((m) => {
                  const selected = selectedMemberIds.includes(m.userId);
                  return (
                    <label
                      key={m.userId}
                      className={`flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer transition-colors text-sm ${
                        selected
                          ? "bg-primary/8 text-primary"
                          : "hover:bg-card-hover text-foreground"
                      }`}
                    >
                      <div
                        className={`flex h-4 w-4 items-center justify-center rounded border ${
                          selected
                            ? "border-primary bg-primary text-white"
                            : "border-border"
                        }`}
                      >
                        {selected && <Check className="h-3 w-3" />}
                      </div>
                      <span>{m.user.name || m.user.email}</span>
                      <span className="text-xs text-muted ml-auto">
                        {m.role === "org_admin" ? "管理员" : "成员"}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

          {/* Note */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">备注（可选）</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="分发说明…"
              rows={2}
              className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-[rgba(166,61,61,0.08)] px-3 py-2 text-sm text-[#a63d3d]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-border px-6 py-4">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-card-hover transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !selectedOrgId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-primary-hover transition-colors disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            确认分发
          </button>
        </div>
      </div>
    </div>
  );
}
