"use client";

/** PROC-1 采购情报与资料申请：界面小部件（沿用青砚既有配色变量与卡片风格，不做整站重设计） */

import { useCallback, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { formatLocal } from "@/lib/procurement-records/schedule";

export function Section({ title, hint, actions, children, testId }: { title: string; hint?: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <section className="scroll-mt-4 rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid={testId} id={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {hint ? <p className="mt-0.5 text-xs text-muted">{hint}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

type Tone = "neutral" | "good" | "warn" | "bad" | "info";
const TONES: Record<Tone, string> = {
  neutral: "border-border text-foreground/80 bg-background",
  good: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  bad: "border-red-200 bg-red-50 text-red-800",
  info: "border-sky-200 bg-sky-50 text-sky-800",
};

export function Chip({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] leading-5 ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export function toneForStatus(s: string | null | undefined): Tone {
  switch (s) {
    case "SUCCESS":
    case "SUCCEEDED":
    case "READY":
    case "SUBMITTED":
    case "ACKNOWLEDGED":
    case "COMPLETED":
    case "FILES_RECEIVED":
    case "PARSED":
    case "VERIFIED":
    case "CONFIRMED":
    case "CLEAR":
    case "document_verified":
      return "good";
    case "PARTIAL":
    case "USER_REPORTED_SUBMISSION":
    case "HANDOFF_PENDING":
    case "NEEDS_REVIEW":
    case "NOTICE_RECEIVED":
    case "PARTIAL_FILES_RECEIVED":
    case "UNVERIFIED":
    case "UNCONFIRMED":
    case "DRAFT_EXISTS":
    case "NEEDS_REASON":
    case "NEEDS_OCR":
    case "user_reported":
    case "QUEUED":
    case "RUNNING":
    case "PROCESSING":
      return "warn";
    case "UNAVAILABLE":
    case "PARSE_FAILED":
    case "FAILED":
    case "SUBMISSION_UNKNOWN":
    case "BLOCKING":
    case "CORRUPT":
    case "ENCRYPTED":
      return "bad";
    default:
      return "neutral";
  }
}

export function Btn({ children, onClick, disabled, busy, variant = "secondary", type = "button", title, testId }: { children: ReactNode; onClick?: () => void; disabled?: boolean; busy?: boolean; variant?: "primary" | "secondary" | "danger" | "link"; type?: "button" | "submit"; title?: string; testId?: string }) {
  const cls =
    variant === "primary"
      ? "bg-accent text-[color:var(--on-accent)] border-transparent"
      : variant === "danger"
        ? "border-red-200 text-red-700 bg-background"
        : variant === "link"
          ? "border-transparent text-accent underline px-0"
          : "border-border bg-background text-foreground";
  return (
    <button type={type} title={title} data-testid={testId} onClick={onClick} disabled={disabled || busy} className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50 ${cls}`}>
      {busy ? <Loader2 size={12} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

export const inputCls = "w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-accent";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-muted">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-muted">{hint}</span> : null}
    </label>
  );
}

export function KV({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 text-xs sm:flex-row sm:gap-2">
      <span className="shrink-0 text-muted sm:w-32">{k}</span>
      <span className="min-w-0 flex-1 break-words text-foreground">{v ?? "—"}</span>
    </div>
  );
}

export function Unknown({ value, suffix }: { value: ReactNode | null | undefined; suffix?: string }) {
  if (value === null || value === undefined || value === "") return <span className="text-muted">未知</span>;
  return (
    <>
      {value}
      {suffix ?? ""}
    </>
  );
}

export function when(v: string | null | undefined): string {
  return v ? formatLocal(v) : "—";
}

export function cents(c: number | null | undefined, cur?: string | null): string {
  if (c === null || c === undefined) return "未知（不按 0 处理）";
  return `${(c / 100).toFixed(2)} ${cur ?? ""}`.trim();
}

/** 统一调用：返回 { ok, status, body }；错误文本放进 note */
export function useApiCall() {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ tone: Tone; text: string } | null>(null);
  const call = useCallback(async (key: string, url: string, init?: RequestInit & { json?: unknown }): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> => {
    setBusy(key);
    setNote(null);
    try {
      const { json, ...rest } = init ?? {};
      const res = await apiFetch(url, {
        ...rest,
        ...(json !== undefined ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) } } : {}),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) setNote({ tone: "bad", text: `${String(body.error ?? `请求失败（${res.status}）`)}${body.code ? `［${String(body.code)}］` : ""}` });
      return { ok: res.ok, status: res.status, body };
    } catch (e) {
      setNote({ tone: "bad", text: e instanceof Error ? e.message : "请求失败" });
      return { ok: false, status: 0, body: {} };
    } finally {
      setBusy(null);
    }
  }, []);
  return { busy, note, setNote, call };
}

export function Note({ note }: { note: { tone: Tone; text: string } | null }) {
  if (!note) return null;
  return <p className={`mt-2 rounded-lg border px-3 py-2 text-xs ${TONES[note.tone]}`}>{note.text}</p>;
}

export function NotEnabled({ reason }: { reason?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted">
      采购情报与资料申请尚未在本环境启用（{reason ?? "SCHEMA_NOT_READY"}）：数据库迁移须按 Owner Gate 执行并开启 <code>PROCUREMENT_RECORDS_SCHEMA_READY</code> 后才可使用。
    </div>
  );
}
