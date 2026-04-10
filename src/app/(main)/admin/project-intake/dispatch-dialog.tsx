"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, Building2, User, Users, Send } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useOrganizations } from "@/lib/hooks/use-organizations";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const EMPTY_SELECT = "__none__";

interface DispatchDialogProps {
  project: {
    id: string;
    name: string;
    org: { id: string; name: string } | null;
  };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

interface OrgMember {
  id: string;
  userId: string;
  role: string;
  user: { id: string; name: string; email: string };
}

export function DispatchDialog({ project, open, onOpenChange, onSuccess }: DispatchDialogProps) {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] flex flex-col gap-0 overflow-hidden border-[rgba(26,36,32,0.12)] bg-[#faf8f4] p-0 shadow-2xl sm:max-w-lg">
        <DialogHeader className="border-b border-[rgba(26,36,32,0.08)] px-6 py-4 text-left">
          <DialogTitle className="text-lg font-bold text-[#1a2420]">分发项目</DialogTitle>
          <DialogDescription className="mt-0.5 max-w-[360px] truncate text-sm text-[#6e7d76]">
            {project.name}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[min(60vh,520px)] flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Org select */}
          <div className="space-y-2">
            <Label
              htmlFor="dispatch-org"
              className="flex items-center gap-1.5 text-sm font-semibold text-[#1a2420]"
            >
              <Building2 className="h-4 w-4 text-[#4F7C78]" />
              目标组织 <span className="text-[#a63d3d]">*</span>
            </Label>
            {orgsLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-[#6e7d76]">
                <Loader2 className="h-4 w-4 animate-spin" /> 加载组织…
              </div>
            ) : (
              <ShadSelect
                value={selectedOrgId || EMPTY_SELECT}
                onValueChange={(v) => setSelectedOrgId(v === EMPTY_SELECT ? "" : v)}
              >
                <SelectTrigger id="dispatch-org" className="h-auto min-h-9 w-full py-2.5 text-sm">
                  <SelectValue placeholder="请选择组织" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_SELECT}>请选择组织</SelectItem>
                  {organizations.map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            )}
          </div>

          {/* Owner select */}
          <div className="space-y-2">
            <Label
              htmlFor="dispatch-owner"
              className="flex items-center gap-1.5 text-sm font-semibold text-[#1a2420]"
            >
              <User className="h-4 w-4 text-[#4F7C78]" />
              项目负责人
              <span className="text-xs font-normal text-[#93A39F]">（可选）</span>
            </Label>
            {membersLoading ? (
              <div className="flex items-center gap-2 py-2 text-sm text-[#6e7d76]">
                <Loader2 className="h-4 w-4 animate-spin" /> 加载成员…
              </div>
            ) : !selectedOrgId ? (
              <p className="rounded-lg border border-dashed border-[rgba(26,36,32,0.12)] bg-[#f2f0eb] px-3 py-2.5 text-xs text-[#93A39F]">
                请先选择组织
              </p>
            ) : (
              <ShadSelect
                value={ownerUserId || EMPTY_SELECT}
                onValueChange={(v) => setOwnerUserId(v === EMPTY_SELECT ? "" : v)}
              >
                <SelectTrigger id="dispatch-owner" className="h-auto min-h-9 w-full py-2.5 text-sm">
                  <SelectValue placeholder="不指定（保持系统默认）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_SELECT}>不指定（保持系统默认）</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {`${m.user.name || m.user.email} (${m.role === "org_admin" ? "管理员" : "成员"})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            )}
          </div>

          {/* Members multi-select */}
          {selectedOrgId && members.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-[#1a2420]">
                <Users className="h-4 w-4 text-[#4F7C78]" />
                项目成员
                <span className="text-xs font-normal text-[#93A39F]">（可选，可多选）</span>
              </div>
              <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-[rgba(26,36,32,0.15)] bg-white p-1.5 shadow-sm">
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
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          m.role === "org_admin"
                            ? "bg-[#4F7C78]/10 text-[#4F7C78]"
                            : "bg-[rgba(26,36,32,0.06)] text-[#93A39F]"
                        }`}
                      >
                        {m.role === "org_admin" ? "管理员" : "成员"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {selectedMemberIds.length > 0 && (
                <p className="text-xs text-[#4F7C78]">已选 {selectedMemberIds.length} 人</p>
              )}
            </div>
          )}

          {/* Note */}
          <div className="space-y-2">
            <Label htmlFor="dispatch-note" className="text-sm font-semibold text-[#1a2420]">
              备注
              <span className="ml-1 text-xs font-normal text-[#93A39F]">（可选）</span>
            </Label>
            <textarea
              id="dispatch-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="填写分发说明…"
              rows={2}
              className="w-full resize-none rounded-lg border border-[rgba(26,36,32,0.15)] bg-white px-3 py-2.5 text-sm text-[#1a2420] shadow-sm outline-none transition-colors placeholder:text-[#B8C4C0] focus:border-[#4F7C78] focus:ring-2 focus:ring-[#4F7C78]/20"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.06)] px-3 py-2.5 text-sm font-medium text-[#a63d3d]">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-3 border-t border-[rgba(26,36,32,0.08)] bg-[#f2f0eb]/60 px-6 py-4 sm:gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            className="border-[rgba(26,36,32,0.12)] bg-white text-[#1a2420] shadow-sm hover:bg-[#f2f0eb]"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={submitting || !selectedOrgId}
            className="bg-[#4F7C78] font-semibold text-white shadow-sm hover:bg-[#3d6662] disabled:opacity-40"
            onClick={handleSubmit}
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            确认分发
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
