"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bell, Loader2, Save } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch, apiJson } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { NotificationTypeToggleList } from "@/components/notification/notification-type-toggle-list";
import type { UserNotificationPreferenceDTO } from "@/lib/notifications/preferences";

function QuietHoursPicker({
  start,
  end,
  enabled,
  onStart,
  onEnd,
  disabled,
}: {
  start: string;
  end: string;
  enabled: boolean;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/40 px-4 py-3",
        !enabled && "opacity-50"
      )}
    >
      <label className="flex items-center gap-2 text-sm text-muted">
        从
        <input
          type="time"
          value={start}
          disabled={disabled || !enabled}
          onChange={(e) => onStart(e.target.value)}
          className="rounded-md border border-border bg-card-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
      </label>
      <span className="text-muted">至</span>
      <label className="flex items-center gap-2 text-sm text-muted">
        <input
          type="time"
          value={end}
          disabled={disabled || !enabled}
          onChange={(e) => onEnd(e.target.value)}
          className="rounded-md border border-border bg-card-bg px-2 py-1.5 text-sm outline-none focus:border-accent"
        />
        （次日若跨午夜）
      </label>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card-bg px-4 py-3">
      <div>
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-7 w-11 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-[rgba(110,125,118,0.25)]",
          disabled && "cursor-not-allowed opacity-50"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform",
            checked ? "left-4" : "left-0.5"
          )}
        />
      </button>
    </div>
  );
}

export default function NotificationSettingsPage() {
  const [pref, setPref] = useState<UserNotificationPreferenceDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiJson<{ preference: UserNotificationPreferenceDTO }>("/api/notifications/preferences/me")
      .then((d) => setPref(d.preference))
      .catch(() => setPref(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!pref) return;
    setSaving(true);
    setMessage(null);
    try {
      const res = await apiFetch("/api/notifications/preferences/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enableInAppNotifications: pref.enableInAppNotifications,
          onlyHighPriority: pref.onlyHighPriority,
          onlyMyItems: pref.onlyMyItems,
          includeWatchedProjects: pref.includeWatchedProjects,
          quietHoursEnabled: pref.quietHoursEnabled,
          quietHoursStart: pref.quietHoursStart,
          quietHoursEnd: pref.quietHoursEnd,
          emailEnabled: pref.emailEnabled,
          pushEnabled: pref.pushEnabled,
          enabledTypes: pref.enabledTypes,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setPref(data.preference);
      setMessage({ ok: true, text: "已保存" });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "保存失败" });
    } finally {
      setSaving(false);
    }
  };

  if (loading || !pref) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-accent"
      >
        <ArrowLeft size={12} />
        返回设置
      </Link>

      <PageHeader
        title="通知偏好"
        description="控制站内通知类型、优先级与静默时段。邮件与推送通道已预留，后续版本接入。"
      />

      {message && (
        <div
          className={cn(
            "rounded-lg border px-4 py-2 text-sm",
            message.ok
              ? "border-[rgba(46,122,86,0.2)] bg-[rgba(46,122,86,0.04)] text-[#2e7a56]"
              : "border-[rgba(166,61,61,0.2)] bg-[rgba(166,61,61,0.04)] text-[#a63d3d]"
          )}
        >
          {message.text}
        </div>
      )}

      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted">
          <Bell size={14} />
          总开关与范围
        </h2>
        <ToggleRow
          label="接收站内通知"
          description="关闭后，通知中心与铃铛将不展示新通知（已生成的历史仍可稍后恢复显示）。"
          checked={pref.enableInAppNotifications}
          onChange={(v) => setPref({ ...pref, enableInAppNotifications: v })}
          disabled={saving}
        />
        <ToggleRow
          label="只接收高优先级通知"
          description="列表与未读数仅统计高 / 紧急；同步时也会过滤掉普通优先级。"
          checked={pref.onlyHighPriority}
          onChange={(v) => setPref({ ...pref, onlyHighPriority: v })}
          disabled={saving || !pref.enableInAppNotifications}
        />
        <ToggleRow
          label="仅与我相关的事项"
          description="任务类仅本人负责或创建；反馈类仅我会话；项目动态需您是负责人或已关注该项目。"
          checked={pref.onlyMyItems}
          onChange={(v) => setPref({ ...pref, onlyMyItems: v })}
          disabled={saving || !pref.enableInAppNotifications}
        />
        <ToggleRow
          label="关注项目上的团队动态"
          description="在「仅与我相关」开启时，仍接收已关注项目中的反馈与更新（需在项目页打开关注）。"
          checked={pref.includeWatchedProjects}
          onChange={(v) => setPref({ ...pref, includeWatchedProjects: v })}
          disabled={saving || !pref.enableInAppNotifications || !pref.onlyMyItems}
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">静默时段</h2>
        <ToggleRow
          label="启用静默时段"
          description="时段内不生成普通提醒；运行失败等高优先级仍可突破。"
          checked={pref.quietHoursEnabled}
          onChange={(v) => setPref({ ...pref, quietHoursEnabled: v })}
          disabled={saving || !pref.enableInAppNotifications}
        />
        <QuietHoursPicker
          start={pref.quietHoursStart ?? "22:00"}
          end={pref.quietHoursEnd ?? "08:00"}
          enabled={pref.quietHoursEnabled && pref.enableInAppNotifications}
          onStart={(quietHoursStart) => setPref({ ...pref, quietHoursStart })}
          onEnd={(quietHoursEnd) => setPref({ ...pref, quietHoursEnd })}
          disabled={saving}
        />
      </div>

      <div className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">通知类型</h2>
        <p className="text-xs text-muted">
          关闭某类型后，同步时不会为该类型生成新通知。
        </p>
        <NotificationTypeToggleList
          enabledTypes={pref.enabledTypes}
          onChange={(enabledTypes) => setPref({ ...pref, enabledTypes })}
          disabled={saving || !pref.enableInAppNotifications}
        />
      </div>

      <div className="space-y-3 rounded-xl border border-dashed border-border bg-[rgba(43,96,85,0.02)] p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">站外通道（预留）</h2>
        <ToggleRow
          label="邮件通知"
          description="开启后，将来可在重大告警时发送邮件（当前未连接发信）。"
          checked={pref.emailEnabled}
          onChange={(v) => setPref({ ...pref, emailEnabled: v })}
          disabled={saving}
        />
        <ToggleRow
          label="推送通知"
          description="浏览器或 App 推送（后续版本）。"
          checked={pref.pushEnabled}
          onChange={(v) => setPref({ ...pref, pushEnabled: v })}
          disabled={saving}
        />
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          保存设置
        </button>
        <Link
          href="/notifications"
          className="inline-flex items-center rounded-lg border border-border px-5 py-2.5 text-sm text-muted transition-colors hover:bg-[rgba(43,96,85,0.04)]"
        >
          前往通知中心
        </Link>
      </div>
    </div>
  );
}
