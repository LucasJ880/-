"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Sparkles,
  AlertTriangle,
  Clock,
  Users,
  CheckCircle2,
  ArrowRight,
  Loader2,
  RefreshCw,
  ChevronRight,
  Mail,
  Eye,
  ListTodo,
  Zap,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { BatchFollowupDialog } from "@/components/batch-followup/batch-followup-dialog";
import type {
  ProactiveSuggestion,
  TriggerKind,
  TriggerSeverity,
  SuggestedActionType,
} from "@/lib/proactive/types";

const SEVERITY_STYLES: Record<TriggerSeverity, { bg: string; text: string; border: string; dot: string }> = {
  urgent: {
    bg: "bg-[rgba(166,61,61,0.04)]",
    text: "text-[#a63d3d]",
    border: "border-[rgba(166,61,61,0.15)]",
    dot: "bg-[#a63d3d]",
  },
  warning: {
    bg: "bg-[rgba(154,106,47,0.04)]",
    text: "text-[#9a6a2f]",
    border: "border-[rgba(154,106,47,0.15)]",
    dot: "bg-[#9a6a2f]",
  },
  info: {
    bg: "bg-[rgba(43,96,85,0.04)]",
    text: "text-accent",
    border: "border-[rgba(43,96,85,0.15)]",
    dot: "bg-accent",
  },
};

const KIND_ICONS: Record<TriggerKind, typeof AlertTriangle> = {
  deadline_approaching: Clock,
  stage_stalled: AlertTriangle,
  supplier_no_response: Users,
  tasks_overdue: ListTodo,
  missing_documents: AlertTriangle,
  risk_alert: AlertTriangle,
};

const ACTION_ICONS: Record<SuggestedActionType, typeof ArrowRight> = {
  send_followup_email: Mail,
  advance_stage: ChevronRight,
  view_project: Eye,
  create_task: ListTodo,
  generate_summary: Sparkles,
};

interface AutoActionResult {
  actionType: string;
  success: boolean;
  message: string;
  createdEntityId?: string;
}

interface ScanResult {
  scannedAt: string;
  projectCount: number;
  suggestions: ProactiveSuggestion[];
  notificationsCreated: number;
  autoActions?: AutoActionResult[];
  automationEnabled?: boolean;
}

function SuggestionRow({
  suggestion,
  onProjectClick,
  onBatchFollowup,
}: {
  suggestion: ProactiveSuggestion;
  onProjectClick?: (id: string) => void;
  onBatchFollowup?: (projectId: string) => void;
}) {
  const style = SEVERITY_STYLES[suggestion.severity];
  const KindIcon = KIND_ICONS[suggestion.kind] ?? AlertTriangle;
  const action = suggestion.suggestedAction;
  const ActionIcon = action ? ACTION_ICONS[action.type] ?? ArrowRight : ArrowRight;

  function handleAction() {
    if (!action) return;
    if (action.type === "send_followup_email" && action.params?.projectId) {
      onBatchFollowup?.(action.params.projectId);
    } else if (action.params?.projectId) {
      onProjectClick?.(action.params.projectId);
    }
  }

  return (
    <div className={cn("flex items-start gap-3 rounded-lg border px-4 py-3", style.bg, style.border)}>
      <div className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full", style.bg)}>
        <KindIcon size={14} className={style.text} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", style.dot)} />
          <span className="text-sm font-medium text-foreground leading-tight">
            {suggestion.title}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted leading-relaxed">
          {suggestion.description}
        </p>
        <div className="mt-2 flex items-center gap-3">
          {action && (
            <button
              type="button"
              onClick={handleAction}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                "bg-accent/10 text-accent hover:bg-accent/20"
              )}
            >
              <ActionIcon size={11} />
              {action.label}
            </button>
          )}
          <Link
            href={`/projects/${suggestion.projectId}`}
            className="text-[11px] text-muted hover:text-foreground"
          >
            {suggestion.projectName}
          </Link>
        </div>
      </div>
    </div>
  );
}

interface Props {
  onProjectClick?: (id: string) => void;
}

export function DashboardAiSuggestions({ onProjectClick }: Props) {
  const [result, setResult] = useState<ScanResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [followupProjectId, setFollowupProjectId] = useState<string | null>(null);

  const scan = useCallback((isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    apiFetch("/api/proactive/scan", { method: "POST" })
      .then((r) => r.json())
      .then(setResult)
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    scan();

    const REFRESH_MS = 5 * 60 * 1000;
    const timer = setInterval(() => scan(true), REFRESH_MS);
    return () => clearInterval(timer);
  }, [scan]);

  if (loading) {
    return (
      <div className="rounded-xl border border-accent/20 bg-card-bg p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles size={15} className="text-accent" />
          AI 智能建议
        </div>
        <div className="mt-4 flex items-center justify-center py-6">
          <Loader2 size={20} className="animate-spin text-accent/40" />
        </div>
      </div>
    );
  }

  const suggestions = result?.suggestions ?? [];
  const autoActions = (result?.autoActions ?? []).filter((a) => a.success);
  const urgentCount = suggestions.filter((s) => s.severity === "urgent").length;

  return (
    <div className="rounded-xl border border-accent/20 bg-card-bg">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-accent" />
          <h2 className="text-sm font-semibold">AI 智能建议</h2>
          {urgentCount > 0 && (
            <span className="rounded-full bg-[rgba(166,61,61,0.1)] px-2 py-0.5 text-[11px] font-medium text-[#a63d3d]">
              {urgentCount} 项紧急
            </span>
          )}
          {suggestions.length > 0 && urgentCount === 0 && (
            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
              {suggestions.length} 项建议
            </span>
          )}
          {result?.automationEnabled && (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
              <Zap size={9} />
              自动化已开启
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <AutomationToggleButton onChanged={() => scan(true)} />
          <button
            type="button"
            onClick={() => scan(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:text-foreground disabled:opacity-50"
          >
            <RefreshCw size={11} className={cn(refreshing && "animate-spin")} />
            刷新
          </button>
        </div>
      </div>

      {autoActions.length > 0 && (
        <div className="mx-4 mt-3 rounded-lg border border-accent/20 bg-[rgba(43,96,85,0.04)] px-3 py-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-accent">
            <Zap size={12} />
            AI 已自动执行 {autoActions.length} 项操作
          </div>
          <div className="mt-1.5 space-y-1">
            {autoActions.map((a, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[11px] text-muted">
                <CheckCircle2 size={10} className={a.success ? "text-[#2e7a56]" : "text-[#a63d3d]"} />
                {a.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {suggestions.length > 0 ? (
        <div className="space-y-2 p-4">
          {suggestions.slice(0, 6).map((s) => (
            <SuggestionRow
              key={s.id}
              suggestion={s}
              onProjectClick={onProjectClick}
              onBatchFollowup={(pid) => setFollowupProjectId(pid)}
            />
          ))}
          {suggestions.length > 6 && (
            <p className="pt-1 text-center text-[11px] text-muted">
              还有 {suggestions.length - 6} 项建议...
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <CheckCircle2 size={24} className="text-accent/30" />
          <p className="text-sm font-medium text-muted">所有项目运行正常</p>
          <p className="text-xs text-muted/60">
            已扫描 {result?.projectCount ?? 0} 个项目，暂未发现需要关注的问题
          </p>
        </div>
      )}

      {followupProjectId && (
        <BatchFollowupDialog
          projectId={followupProjectId}
          onClose={() => setFollowupProjectId(null)}
          onSent={() => scan(true)}
        />
      )}
    </div>
  );
}

// ── 自动化快捷开关 ──────────────────────────────────────────────

function AutomationToggleButton({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<{
    enabled: boolean;
    autoCreateTasks: boolean;
    autoOverdueFollowup: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    apiFetch("/api/user/automation")
      .then((r) => r.json())
      .then((d) => setPrefs(d.prefs))
      .catch(() => {});
  }, [open]);

  async function toggle(key: string, value: boolean) {
    setSaving(true);
    try {
      const res = await apiFetch("/api/user/automation", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (res.ok) {
        const d = await res.json();
        setPrefs(d.prefs);
        onChanged();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted hover:text-foreground"
      >
        <Settings size={11} />
        自动化
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-card shadow-lg">
            <div className="border-b border-border/60 px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs font-medium">
                <Zap size={12} className="text-accent" />
                AI 自动化设置
              </div>
              <p className="mt-0.5 text-[10px] text-muted">
                开启后，AI 会自动执行低风险操作
              </p>
            </div>
            {prefs ? (
              <div className="space-y-1 p-2">
                <ToggleRow
                  label="启用自动化"
                  description="总开关"
                  checked={prefs.enabled}
                  onChange={(v) => toggle("enabled", v)}
                  disabled={saving}
                />
                <ToggleRow
                  label="自动创建提醒任务"
                  description="截止日逼近时自动创建"
                  checked={prefs.autoCreateTasks}
                  onChange={(v) => toggle("autoCreateTasks", v)}
                  disabled={saving || !prefs.enabled}
                />
                <ToggleRow
                  label="自动创建逾期跟进"
                  description="任务逾期时自动创建跟进"
                  checked={prefs.autoOverdueFollowup}
                  onChange={(v) => toggle("autoOverdueFollowup", v)}
                  disabled={saving || !prefs.enabled}
                />
              </div>
            ) : (
              <div className="flex justify-center py-4">
                <Loader2 size={16} className="animate-spin text-accent/40" />
              </div>
            )}
          </div>
        </>
      )}
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
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
        "hover:bg-muted/5 disabled:opacity-50"
      )}
    >
      <div
        className={cn(
          "h-4 w-7 shrink-0 rounded-full transition-colors",
          checked ? "bg-accent" : "bg-border"
        )}
      >
        <div
          className={cn(
            "h-3 w-3 rounded-full bg-white shadow-sm transition-transform mt-0.5",
            checked ? "translate-x-3.5" : "translate-x-0.5"
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[10px] text-muted">{description}</div>
      </div>
    </button>
  );
}
