"use client";

import { useState, useEffect } from "react";
import {
  CalendarDays,
  Clock,
  MapPin,
  FileText,
  ExternalLink,
  Loader2,
  Trash2,
  Save,
  Lock,
  RotateCcw,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";

export interface EditableGoogleEvent {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string | null;
  description?: string | null;
  calendarId?: string;
  calendarName?: string;
  color?: string;
  htmlLink?: string | null;
  recurringEventId?: string | null;
  accessRole?: string;
}

/** Date → "YYYY-MM-DDTHH:mm"（本地时区，供 datetime-local 输入框用） */
function toDatetimeLocal(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DD" → 当天 00:00 ISO */
function toDateOnly(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function GoogleEventDialog({
  event,
  onClose,
  onChanged,
}: {
  event: EditableGoogleEvent | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    startAt: "",
    endAt: "",
    allDay: false,
    allDayStart: "",
    allDayEnd: "",
    location: "",
    description: "",
  });
  // 重复事件时用户的编辑范围选择
  const [scope, setScope] = useState<"single" | "series">("single");

  useEffect(() => {
    if (event) {
      setForm({
        title: event.title,
        startAt: toDatetimeLocal(event.startTime),
        endAt: toDatetimeLocal(event.endTime),
        allDay: event.allDay,
        allDayStart: toDateOnly(event.startTime),
        allDayEnd: toDateOnly(event.endTime),
        location: event.location || "",
        description: event.description || "",
      });
      setScope("single");
      setError(null);
    }
  }, [event]);

  if (!event) return null;

  const isRecurring = Boolean(event.recurringEventId);
  const canEdit =
    event.accessRole === "owner" ||
    event.accessRole === "writer" ||
    event.accessRole === undefined; // primary 常常不返回 accessRole，默认允许

  const readOnlyNote =
    !canEdit &&
    (event.accessRole === "reader"
      ? "当前日历为只读权限，无法修改"
      : event.accessRole === "freeBusyReader"
        ? "当前日历仅可见忙闲，无法修改"
        : "无修改权限");

  const buildPayload = () => {
    if (form.allDay) {
      return {
        title: form.title,
        startTime: `${form.allDayStart}T00:00:00`,
        endTime: `${form.allDayEnd || form.allDayStart}T23:59:59`,
        allDay: true,
        location: form.location || null,
        description: form.description || null,
      };
    }
    return {
      title: form.title,
      startTime: new Date(form.startAt).toISOString(),
      endTime: new Date(form.endAt).toISOString(),
      allDay: false,
      location: form.location || null,
      description: form.description || null,
    };
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      setError("标题不能为空");
      return;
    }
    if (!form.allDay && new Date(form.endAt) <= new Date(form.startAt)) {
      setError("结束时间必须晚于开始时间");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/calendar/google/events/${encodeURIComponent(event.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            calendarId: event.calendarId,
            scope: isRecurring ? scope : "single",
            data: buildPayload(),
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "保存失败");
        return;
      }
      onChanged();
      onClose();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const scopeLabel = isRecurring && scope === "series" ? "整个重复系列" : "此事件";
    if (!window.confirm(`确定删除${scopeLabel}吗？此操作不可撤销。`)) return;

    setDeleting(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (event.calendarId) params.set("calendarId", event.calendarId);
      params.set("scope", isRecurring ? scope : "single");

      const res = await apiFetch(
        `/api/calendar/google/events/${encodeURIComponent(event.id)}?${params.toString()}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || "删除失败");
        return;
      }
      onChanged();
      onClose();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setDeleting(false);
    }
  };

  const accent = event.color || "#4285f4";

  return (
    <Dialog open={!!event} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: accent }}
            />
            <span className="truncate">{event.title || "(无标题)"}</span>
          </DialogTitle>
          {event.calendarName && (
            <p className="text-xs text-muted-foreground">
              来源：{event.calendarName}
              {isRecurring && " · 重复事件"}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {!canEdit && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-2.5 text-xs text-amber-800">
              <Lock size={14} className="shrink-0 mt-0.5" />
              <span>{readOnlyNote}（该事件在青砚内仅可查看，需到 Google 日历端修改）</span>
            </div>
          )}

          {isRecurring && canEdit && (
            <div className="rounded-lg border border-border bg-muted/20 p-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-foreground">
                <RotateCcw size={12} />
                修改范围
              </div>
              <div className="flex gap-3 text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={scope === "single"}
                    onChange={() => setScope("single")}
                  />
                  仅此事件
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    checked={scope === "series"}
                    onChange={() => setScope("series")}
                  />
                  整个系列
                </label>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>标题</Label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              disabled={!canEdit}
              className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm disabled:bg-muted/30"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              id="allDay"
              type="checkbox"
              checked={form.allDay}
              disabled={!canEdit}
              onChange={(e) => setForm({ ...form, allDay: e.target.checked })}
            />
            <label htmlFor="allDay" className="text-xs text-muted-foreground cursor-pointer">
              全天事件
            </label>
          </div>

          {form.allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1">
                  <CalendarDays size={12} /> 开始日期
                </Label>
                <input
                  type="date"
                  value={form.allDayStart}
                  onChange={(e) => setForm({ ...form, allDayStart: e.target.value })}
                  disabled={!canEdit}
                  className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm disabled:bg-muted/30"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1">
                  <CalendarDays size={12} /> 结束日期
                </Label>
                <input
                  type="date"
                  value={form.allDayEnd}
                  onChange={(e) => setForm({ ...form, allDayEnd: e.target.value })}
                  disabled={!canEdit}
                  className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm disabled:bg-muted/30"
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1">
                  <Clock size={12} /> 开始
                </Label>
                <input
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(e) => setForm({ ...form, startAt: e.target.value })}
                  disabled={!canEdit}
                  className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm disabled:bg-muted/30"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1">
                  <Clock size={12} /> 结束
                </Label>
                <input
                  type="datetime-local"
                  value={form.endAt}
                  onChange={(e) => setForm({ ...form, endAt: e.target.value })}
                  disabled={!canEdit}
                  className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm disabled:bg-muted/30"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              <MapPin size={12} /> 地点
            </Label>
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              disabled={!canEdit}
              placeholder="地点（可选）"
              className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm disabled:bg-muted/30"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="flex items-center gap-1">
              <FileText size={12} /> 描述
            </Label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              disabled={!canEdit}
              rows={3}
              placeholder="描述（可选）"
              className="w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm disabled:bg-muted/30"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60">
            <div className="flex gap-2">
              {event.htmlLink && (
                <a
                  href={event.htmlLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                >
                  <ExternalLink size={12} />
                  Google 打开
                </a>
              )}
              {canEdit && (
                <button
                  onClick={handleDelete}
                  disabled={deleting || saving}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50",
                  )}
                >
                  {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  删除
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
              >
                关闭
              </button>
              {canEdit && (
                <button
                  onClick={handleSave}
                  disabled={saving || deleting}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  保存
                </button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
