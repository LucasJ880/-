"use client";

/**
 * CHAIN-1b「历史中标」页上的 Alberta 授标人工录入表单。
 * 系统不打开这个链接；录入后是「待人工复核」，组织管理员确认属实后才进入统计。
 */

import { useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { MANUAL_ENTRY_TEXT } from "@/lib/tender-intel/award-manual-entry";

const field = "w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm";

export function AwardManualEntryForm({ orgId, buyerSuggestions, onSaved }: { orgId: string; buyerSuggestions: string[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ buyerName: "", winnerName: "", apcUrl: "", solicitationNumber: "", awardDate: "", contractAmount: "", currency: "CAD", scopeSummary: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch(`/api/organizations/${orgId}/tender-awards/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; messageZh?: string };
      if (!res.ok) {
        setMsg({ text: json.error ?? "没有录入成功，请稍后再试。", error: true });
      } else {
        setMsg({ text: json.messageZh ?? MANUAL_ENTRY_TEXT.created, error: false });
        setForm((f) => ({ ...f, winnerName: "", apcUrl: "", solicitationNumber: "", awardDate: "", contractAmount: "", scopeSummary: "" }));
        onSaved();
      }
    } catch {
      setMsg({ text: "网络出错，请稍后再试。", error: true });
    }
    setBusy(false);
  };

  return (
    <div className="rounded-xl border border-[var(--border)] p-4 text-sm" data-testid="award-manual-entry">
      <button type="button" onClick={() => setOpen((o) => !o)} className="font-medium text-[var(--foreground)]" aria-expanded={open}>
        {MANUAL_ENTRY_TEXT.formTitle}
      </button>
      {open ? (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <p className="text-xs text-[var(--muted)]">{MANUAL_ENTRY_TEXT.formNote}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs">
              <span>采购方（必填）</span>
              <input className={field} value={form.buyerName} onChange={set("buyerName")} list="award-manual-buyers" maxLength={200} required />
              <datalist id="award-manual-buyers">
                {buyerSuggestions.map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
              <span className="block text-[var(--muted)]">{MANUAL_ENTRY_TEXT.buyerHint}</span>
            </label>
            <label className="space-y-1 text-xs">
              <span>中标方（必填）</span>
              <input className={field} value={form.winnerName} onChange={set("winnerName")} maxLength={200} required />
            </label>
            <label className="space-y-1 text-xs sm:col-span-2">
              <span>APC 公告链接（必填）</span>
              <input className={field} value={form.apcUrl} onChange={set("apcUrl")} placeholder="https://purchasing.alberta.ca/…" inputMode="url" required />
            </label>
            <label className="space-y-1 text-xs">
              <span>招标编号</span>
              <input className={field} value={form.solicitationNumber} onChange={set("solicitationNumber")} maxLength={100} />
            </label>
            <label className="space-y-1 text-xs">
              <span>授标日期</span>
              <input className={field} type="date" value={form.awardDate} onChange={set("awardDate")} />
            </label>
            <label className="space-y-1 text-xs">
              <span>合同金额</span>
              <input className={field} value={form.contractAmount} onChange={set("contractAmount")} inputMode="decimal" />
            </label>
            <label className="space-y-1 text-xs">
              <span>币种</span>
              <select className={field} value={form.currency} onChange={set("currency")}>
                <option value="CAD">CAD</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label className="space-y-1 text-xs sm:col-span-2">
              <span>范围摘要</span>
              <textarea className={field} rows={2} value={form.scopeSummary} onChange={set("scopeSummary")} maxLength={2000} />
              <span className="block text-[var(--muted)]">{MANUAL_ENTRY_TEXT.scopeHint}</span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50">
              {busy ? "正在录入…" : "录入"}
            </button>
            {msg ? (
              <span className={`text-xs ${msg.error ? "text-danger" : "text-[var(--muted)]"}`} role="status" aria-live="polite">
                {msg.text}
              </span>
            ) : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}
