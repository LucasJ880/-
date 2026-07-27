"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Calendar,
  Loader2,
  ExternalLink,
  Pencil,
  Clock,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import type { EventSuggestion } from "@/lib/ai/schemas";
import { formatTime, formatDateLabel } from "./utils";

export function EventCard({
  suggestion,
  onCreated,
}: {
  suggestion: EventSuggestion;
  onCreated?: () => void;
}) {
  const [status, setStatus] = useState<"pending" | "creating" | "created" | "error">("pending");
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    title: suggestion.title,
    date: suggestion.startTime?.split("T")[0] || "",
    startTime: formatTime(suggestion.startTime) || "09:00",
    endTime: formatTime(suggestion.endTime) || "10:00",
    allDay: suggestion.allDay,
    location: suggestion.location || "",
  });

  const handleCreate = async () => {
    setStatus("creating");
    const payload: Record<string, unknown> = {
      title: form.title,
      allDay: form.allDay,
      location: form.location || null,
    };
    if (form.allDay) {
      payload.startTime = `${form.date}T00:00:00`;
      payload.endTime = `${form.date}T23:59:59`;
    } else {
      payload.startTime = `${form.date}T${form.startTime}:00`;
      payload.endTime = `${form.date}T${form.endTime}:00`;
    }
    try {
      const res = await apiFetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      setStatus("created");
      onCreated?.();
    } catch {
      setStatus("error");
    }
  };

  if (status === "created") {
    return (
      <div className="my-2 flex items-center gap-3 rounded-xl border border-success/15 bg-success-bg px-4 py-3">
        <CheckCircle2 size={18} className="text-success" />
        <span className="text-sm font-medium text-success">
          日程「{form.title}」已创建成功
        </span>
        <Link href="/" className="ml-auto flex items-center gap-1 text-xs text-success hover:text-success">
          查看工作台 <ExternalLink size={12} />
        </Link>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-xl border border-success/15 bg-gradient-to-br from-success-bg/60 to-success-bg/40">
      <div className="flex items-center justify-between border-b border-success/10 px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-success">
          <Calendar size={13} />
          AI 日程建议
        </span>
        <button
          onClick={() => setEditing(!editing)}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-success transition-colors hover:bg-success-light"
        >
          <Pencil size={11} />
          {editing ? "完成" : "修改"}
        </button>
      </div>

      <div className="space-y-3 p-4">
        {editing ? (
          <div className="space-y-2">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full rounded-lg border border-success/15 bg-card-bg px-3 py-1.5 text-sm font-semibold outline-none focus:border-accent"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="rounded-lg border border-success/15 bg-card-bg px-2 py-1 text-xs outline-none"
              />
              <button
                type="button"
                onClick={() => setForm({ ...form, allDay: !form.allDay })}
                className={cn(
                  "rounded-lg border px-2 py-1 text-xs transition-colors",
                  form.allDay ? "border-accent bg-accent/5 font-medium text-accent" : "border-success/15 text-muted"
                )}
              >
                {form.allDay ? "✓ 全天" : "全天"}
              </button>
            </div>
            {!form.allDay && (
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  className="rounded-lg border border-success/15 bg-card-bg px-2 py-1 text-xs outline-none"
                />
                <input
                  type="time"
                  value={form.endTime}
                  onChange={(e) => setForm({ ...form, endTime: e.target.value })}
                  className="rounded-lg border border-success/15 bg-card-bg px-2 py-1 text-xs outline-none"
                />
              </div>
            )}
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              placeholder="地点（可选）"
              className="w-full rounded-lg border border-success/15 bg-card-bg px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
          </div>
        ) : (
          <>
            <h4 className="text-sm font-semibold text-foreground">{form.title}</h4>
            <div className="flex flex-wrap gap-2">
              <span className="flex items-center gap-1 rounded-full border border-success/15 bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success">
                <Calendar size={11} />
                {formatDateLabel(form.date ? `${form.date}T00:00` : suggestion.startTime)}
              </span>
              <span className="flex items-center gap-1 rounded-full border border-muted/15 bg-muted/10 px-2 py-0.5 text-[11px] font-medium text-muted">
                <Clock size={11} />
                {form.allDay ? "全天" : `${form.startTime} - ${form.endTime}`}
              </span>
              {form.location && (
                <span className="flex items-center gap-1 rounded-full border border-muted/15 bg-muted/10 px-2 py-0.5 text-[11px] font-medium text-muted">
                  <MapPin size={11} />
                  {form.location}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-success/10 px-4 py-2.5">
        <button
          onClick={handleCreate}
          disabled={status === "creating" || !form.title.trim()}
          className="flex items-center gap-1.5 rounded-lg bg-success px-3.5 py-1.5 text-xs font-medium text-[color:var(--on-accent)] transition-colors hover:bg-success/90 disabled:opacity-50"
        >
          {status === "creating" ? <Loader2 size={13} className="animate-spin" /> : <Calendar size={13} />}
          {status === "creating" ? "创建中..." : "确认创建日程"}
        </button>
        {status === "error" && <span className="text-xs text-danger">创建失败，请重试</span>}
      </div>
    </div>
  );
}
