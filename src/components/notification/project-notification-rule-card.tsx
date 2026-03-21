"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, Loader2, Save } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import type { ProjectNotificationRuleDTO } from "@/lib/notifications/project-rules";

function Row({
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
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/80 bg-background/30 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-[11px] text-muted">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-[rgba(110,125,118,0.25)]",
          disabled && "opacity-50"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked ? "left-4" : "left-0.5"
          )}
        />
      </button>
    </div>
  );
}

export function ProjectNotificationRuleCard({ projectId }: { projectId: string }) {
  const [rule, setRule] = useState<ProjectNotificationRuleDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    apiFetch(`/api/projects/${projectId}/notification-rule`)
      .then((r) => r.json())
      .then((d) => setRule(d.rule))
      .catch(() => setRule(null))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!rule) return;
    setSaving(true);
    setHint(null);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/notification-rule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          watchEnabled: rule.watchEnabled,
          notifyProjectUpdates: rule.notifyProjectUpdates,
          notifyRuntimeFailed: rule.notifyRuntimeFailed,
          notifyFeedbackCreated: rule.notifyFeedbackCreated,
          notifyLowEvaluations: rule.notifyLowEvaluations,
          notifyTaskDue: rule.notifyTaskDue,
          minimumPriority: rule.minimumPriority,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      setRule(data.rule);
      setHint("已保存");
    } catch (e) {
      setHint(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !rule) {
    return (
      <div className="flex items-center justify-center py-8 text-muted">
        <Loader2 size={18} className="animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Bell size={16} className="text-accent/70" />
        此项目的通知与关注
      </div>
      <p className="mt-1 text-xs text-muted">
        关注后，可在满足全局偏好时收到更多「项目动态」类通知；负责人不关注也会收到重要项目变更。
      </p>

      {hint && (
        <p
          className={cn(
            "mt-2 text-xs",
            hint === "已保存" ? "text-[#2e7a56]" : "text-[#a63d3d]"
          )}
        >
          {hint}
        </p>
      )}

      <div className="mt-4 space-y-2">
        <Row
          label="关注此项目"
          description="开启后，可接收该项目的配置与状态类动态（仍受全局偏好与下方开关约束）。"
          checked={rule.watchEnabled}
          onChange={(v) => setRule({ ...rule, watchEnabled: v })}
          disabled={saving}
        />
        <Row
          label="项目与配置变更"
          description="如状态变更等审计动态。"
          checked={rule.notifyProjectUpdates}
          onChange={(v) => setRule({ ...rule, notifyProjectUpdates: v })}
          disabled={saving}
        />
        <Row
          label="运行失败时提醒我"
          description="Agent / Runtime 失败类告警。"
          checked={rule.notifyRuntimeFailed}
          onChange={(v) => setRule({ ...rule, notifyRuntimeFailed: v })}
          disabled={saving}
        />
        <Row
          label="新反馈与反馈更新"
          description="会话或消息反馈相关通知。"
          checked={rule.notifyFeedbackCreated}
          onChange={(v) => setRule({ ...rule, notifyFeedbackCreated: v })}
          disabled={saving}
        />
        <Row
          label="低分评估提醒"
          description="最近 7 天出现低分评估（<=3）时提醒。"
          checked={rule.notifyLowEvaluations}
          onChange={(v) => setRule({ ...rule, notifyLowEvaluations: v })}
          disabled={saving}
        />
        <Row
          label="任务与日程提醒"
          description="与此项目关联的任务截止、跟进与日程。"
          checked={rule.notifyTaskDue}
          onChange={(v) => setRule({ ...rule, notifyTaskDue: v })}
          disabled={saving}
        />
      </div>

      <div className="mt-4">
        <label className="text-xs font-medium text-muted">最低优先级</label>
        <select
          value={rule.minimumPriority}
          disabled={saving}
          onChange={(e) => setRule({ ...rule, minimumPriority: e.target.value })}
          className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        >
          <option value="low">低</option>
          <option value="medium">中</option>
          <option value="high">高</option>
          <option value="urgent">紧急</option>
        </select>
        <p className="mt-1 text-[11px] text-muted">
          低于所选优先级的通知不会同步到您的通知中心。
        </p>
      </div>

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
      >
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
        保存项目规则
      </button>
    </div>
  );
}
