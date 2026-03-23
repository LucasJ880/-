"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, X, Check, Building2, User, Users, Send } from "lucide-react";
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
      {/* Backdrop */}
      <div className="absolute inset-0 bg-[#1a2420]/60 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-lg mx-4 max-h-[85vh] flex flex-col rounded-2xl border border-[rgba(26,36,32,0.12)] bg-[#faf8f4] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[rgba(26,36,32,0.08)] px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-[#1a2420]">分发项目</h2>
            <p className="text-sm text-[#6e7d76] mt-0.5 truncate max-w-[360px]">{project.name}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#6e7d76] hover:bg-[rgba(26,36,32,0.06)] hover:text-[#1a2420] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-5 space-y-5 flex-1">
          {/* Org select */}
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-sm font-semibold text-[#1a2420]">
              <Building2 className="h-4 w-4 text-[#4F7C78]" />
              目标组织 <span className="text-[#a63d3d]">*</span>
            </label>
            {orgsLoading ? (
              <div className="flex items-center gap-2 text-sm text-[#6e7d76] py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> 加载组织…
              </div>
            ) : (
              <select
                value={selectedOrgId}
                onChange={(e) => setSelectedOrgId(e.target.value)}
                className="w-full rounded-lg border border-[rgba(26,36,32,0.15)] bg-white px-3 py-2.5 text-sm text-[#1a2420] shadow-sm outline-none focus:border-[#4F7C78] focus:ring-2 focus:ring-[#4F7C78]/20 transition-colors"
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
          <div className="space-y-2">
            <label className="flex items-center gap-1.5 text-sm font-semibold text-[#1a2420]">
              <User className="h-4 w-4 text-[#4F7C78]" />
              项目负责人
              <span className="text-xs font-normal text-[#93A39F]">（可选）</span>
            </label>
            {membersLoading ? (
              <div className="flex items-center gap-2 text-sm text-[#6e7d76] py-2">
                <Loader2 className="h-4 w-4 animate-spin" /> 加载成员…
              </div>
            ) : !selectedOrgId ? (
              <p className="rounded-lg border border-dashed border-[rgba(26,36,32,0.12)] bg-[#f2f0eb] px-3 py-2.5 text-xs text-[#93A39F]">
                请先选择组织
              </p>
            ) : (
              <select
                value={ownerUserId}
                onChange={(e) => setOwnerUserId(e.target.value)}
                className="w-full rounded-lg border border-[rgba(26,36,32,0.15)] bg-white px-3 py-2.5 text-sm text-[#1a2420] shadow-sm outline-none focus:border-[#4F7C78] focus:ring-2 focus:ring-[#4F7C78]/20 transition-colors"
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
            <div className="space-y-2">
              <label className="flex items-center gap-1.5 text-sm font-semibold text-[#1a2420]">
                <Users className="h-4 w-4 text-[#4F7C78]" />
                项目成员
                <span className="text-xs font-normal text-[#93A39F]">（可选，可多选）</span>
              </label>
              <div className="max-h-44 overflow-y-auto space-y-0.5 rounded-lg border border-[rgba(26,36,32,0.15)] bg-white p-1.5 shadow-sm">
                {members.map((m) => {
                  const selected = selectedMemberIds.includes(m.userId);
                  return (
                    <button
                      type="button"
                      key={m.userId}
                      onClick={() => toggleMember(m.userId)}
                      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                        selected
                          ? "bg-[#4F7C78]/10 text-[#4F7C78]"
                          : "text-[#1a2420] hover:bg-[rgba(26,36,32,0.04)]"
                      }`}
                    >
                      <div
                        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border transition-colors ${
                          selected
                            ? "border-[#4F7C78] bg-[#4F7C78] text-white"
                            : "border-[rgba(26,36,32,0.2)] bg-white"
                        }`}
                      >
                        {selected && <Check className="h-3 w-3" />}
                      </div>
                      <span className="flex-1 truncate font-medium">
                        {m.user.name || m.user.email}
                      </span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        m.role === "org_admin"
                          ? "bg-[#4F7C78]/10 text-[#4F7C78]"
                          : "bg-[rgba(26,36,32,0.06)] text-[#93A39F]"
                      }`}>
                        {m.role === "org_admin" ? "管理员" : "成员"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {selectedMemberIds.length > 0 && (
                <p className="text-xs text-[#4F7C78]">
                  已选 {selectedMemberIds.length} 人
                </p>
              )}
            </div>
          )}

          {/* Note */}
          <div className="space-y-2">
            <label className="text-sm font-semibold text-[#1a2420]">
              备注
              <span className="text-xs font-normal text-[#93A39F] ml-1">（可选）</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="填写分发说明…"
              rows={2}
              className="w-full rounded-lg border border-[rgba(26,36,32,0.15)] bg-white px-3 py-2.5 text-sm text-[#1a2420] placeholder:text-[#B8C4C0] shadow-sm outline-none focus:border-[#4F7C78] focus:ring-2 focus:ring-[#4F7C78]/20 transition-colors resize-none"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.06)] px-3 py-2.5 text-sm font-medium text-[#a63d3d]">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[rgba(26,36,32,0.08)] bg-[#f2f0eb]/60 px-6 py-4 rounded-b-2xl">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-[rgba(26,36,32,0.12)] bg-white px-4 py-2 text-sm font-medium text-[#1a2420] shadow-sm hover:bg-[#f2f0eb] transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !selectedOrgId}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#4F7C78] px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#3d6662] transition-colors disabled:opacity-40"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            确认分发
          </button>
        </div>
      </div>
    </div>
  );
}
