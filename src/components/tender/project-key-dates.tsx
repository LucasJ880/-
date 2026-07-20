"use client";

import { useState } from "react";
import { Calendar, AlertTriangle, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TenderProject } from "@/lib/tender/types";
import { formatDateTimeToronto } from "@/lib/time";
import { apiFetch } from "@/lib/api-fetch";

function fmtDateShort(raw: string | null): string {
  if (!raw) return "待补充";
  return formatDateTimeToronto(raw);
}

function toDateInputValue(raw: string | null | undefined): string {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  // 用本地日历日，避免 UTC 偏移导致日期错一天
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isWithin48h(raw: string | null): boolean {
  if (!raw) return false;
  const diff = new Date(raw).getTime() - Date.now();
  return diff > 0 && diff < 48 * 3600_000;
}

function isPast(raw: string | null): boolean {
  if (!raw) return false;
  return new Date(raw).getTime() < Date.now();
}

interface DateChipProps {
  label: string;
  value: string | null;
  warn?: boolean;
  overdue?: boolean;
  icon?: React.ReactNode;
  editable?: boolean;
  editing?: boolean;
  onEdit?: () => void;
  inputValue?: string;
  onInputChange?: (v: string) => void;
  onSave?: () => void;
  onCancel?: () => void;
  saving?: boolean;
}

function DateChip({
  label,
  value,
  warn,
  overdue,
  icon,
  editable,
  editing,
  onEdit,
  inputValue,
  onInputChange,
  onSave,
  onCancel,
  saving,
}: DateChipProps) {
  const isEmpty = !value;
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
        overdue
          ? "border-danger/30 bg-danger-light"
          : warn
            ? "border-warning/30 bg-warning-light"
            : isEmpty
              ? "border-border border-dashed bg-background"
              : "border-border bg-card-bg"
      )}
    >
      <span className="text-muted">{icon || <Calendar size={14} />}</span>
      <div className="min-w-0">
        <span className="text-[11px] text-muted">{label}</span>
        {editing ? (
          <div className="mt-0.5 flex items-center gap-1">
            <input
              type="date"
              value={inputValue ?? ""}
              onChange={(e) => onInputChange?.(e.target.value)}
              className="rounded border border-border bg-background px-1.5 py-0.5 text-xs outline-none focus:border-accent"
            />
            <button
              type="button"
              disabled={saving}
              onClick={onSave}
              className="text-[11px] text-accent hover:underline disabled:opacity-50"
            >
              保存
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={onCancel}
              className="text-[11px] text-muted hover:underline disabled:opacity-50"
            >
              取消
            </button>
          </div>
        ) : (
          <p
            className={cn(
              "text-xs font-medium",
              overdue
                ? "text-danger-text"
                : warn
                  ? "text-warning-text"
                  : isEmpty
                    ? "text-muted italic"
                    : "text-foreground"
            )}
          >
            {fmtDateShort(value)}
            {editable && (
              <button
                type="button"
                onClick={onEdit}
                className="ml-1.5 text-[11px] font-normal text-accent hover:underline"
              >
                调整
              </button>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

export function ProjectKeyDates({
  project,
  projectId,
  canManage,
  onUpdated,
}: {
  project: TenderProject;
  projectId?: string;
  canManage?: boolean;
  onUpdated?: () => void;
}) {
  const closeDate = project.closeDate || project.dueDate;
  const openDate = project.openDate ?? null;
  const qCloseOverdue = isPast(project.questionCloseDate);
  const qCloseWarn = !qCloseOverdue && isWithin48h(project.questionCloseDate);
  const closeOverdue = isPast(closeDate) && !project.submittedAt;
  const closeWarn = !closeOverdue && isWithin48h(closeDate);
  const openWarn = !isPast(openDate) && isWithin48h(openDate);

  const [editing, setEditing] = useState<"close" | "open" | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const editable = Boolean(canManage && projectId);

  async function saveField(field: "closeDate" | "openDate") {
    if (!projectId) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          [field]: draft ? `${draft}T12:00:00` : null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "保存失败");
      setEditing(null);
      onUpdated?.();
    } catch (err) {
      alert(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <DateChip
        label="发布时间"
        value={project.publicDate}
        icon={<Calendar size={14} />}
      />
      <DateChip
        label="提问截止"
        value={project.questionCloseDate}
        warn={qCloseWarn}
        overdue={qCloseOverdue}
        icon={qCloseWarn || qCloseOverdue ? <AlertTriangle size={14} /> : <Clock size={14} />}
      />
      <DateChip
        label="截标时间"
        value={closeDate}
        warn={closeWarn}
        overdue={closeOverdue}
        icon={closeWarn || closeOverdue ? <AlertTriangle size={14} /> : <Clock size={14} />}
        editable={editable}
        editing={editing === "close"}
        onEdit={() => {
          setEditing("close");
          setDraft(toDateInputValue(closeDate));
        }}
        inputValue={draft}
        onInputChange={setDraft}
        onSave={() => saveField("closeDate")}
        onCancel={() => setEditing(null)}
        saving={saving}
      />
      <DateChip
        label="开标时间"
        value={openDate}
        warn={openWarn}
        icon={<Calendar size={14} />}
        editable={editable}
        editing={editing === "open"}
        onEdit={() => {
          setEditing("open");
          setDraft(toDateInputValue(openDate));
        }}
        inputValue={draft}
        onInputChange={setDraft}
        onSave={() => saveField("openDate")}
        onCancel={() => setEditing(null)}
        saving={saving}
      />
    </div>
  );
}
