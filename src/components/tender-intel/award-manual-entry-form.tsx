"use client";

/**
 * CHAIN-1b「历史中标」页上的 Alberta 授标人工录入表单。
 * 系统只保存链接、不访问它；录入后是「待人工复核」，经人工确认属实后才计入统计。
 * 一条公告常有几个中标方：录完一条后保留公告信息，只清空中标方与金额，焦点回到「中标方」。
 */

import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { MANUAL_ENTRY_TEXT, type ManualEntryField } from "@/lib/tender-intel/award-manual-entry";

const field = "w-full rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm aria-[invalid=true]:border-danger";
const hint = "text-xs text-[var(--muted)]";

type FormState = Record<ManualEntryField, string>;
const EMPTY: FormState = { buyerName: "", winnerName: "", apcUrl: "", solicitationNumber: "", awardDate: "", contractAmount: "", currency: "CAD", scopeSummary: "" };
const FIELD_IDS: Record<ManualEntryField, string> = {
  buyerName: "ame-buyer",
  winnerName: "ame-winner",
  apcUrl: "ame-url",
  solicitationNumber: "ame-solicitation",
  awardDate: "ame-date",
  contractAmount: "ame-amount",
  currency: "ame-currency",
  scopeSummary: "ame-scope",
};

function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

export function AwardManualEntryForm({
  orgId,
  buyerSuggestions,
  scopeSuggestions,
  onSaved,
}: {
  orgId: string;
  buyerSuggestions: string[];
  scopeSuggestions: string[];
  onSaved: (recordId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState<string | null>(null);
  const [error, setError] = useState<{ text: string; field: ManualEntryField | null } | null>(null);
  const winnerRef = useRef<HTMLInputElement>(null);

  const set = (k: ManualEntryField) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
    setOk(null);
    setError((er) => (er && er.field === k ? null : er));
  };
  const invalid = (k: ManualEntryField) => (error?.field === k ? true : undefined);
  const describedBy = (k: ManualEntryField, hintId?: string) => [hintId, error?.field === k ? "ame-error" : null].filter(Boolean).join(" ") || undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setOk(null);
    setError(null);
    const winner = form.winnerName.trim();
    try {
      const res = await apiFetch(`/api/organizations/${encodeURIComponent(orgId)}/tender-awards/manual`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        field?: ManualEntryField;
        messageZh?: string;
        outcome?: string;
        record?: { id?: string };
      };
      if (!res.ok) {
        const text = res.status === 403 ? MANUAL_ENTRY_TEXT.forbidden : json.error ?? MANUAL_ENTRY_TEXT.failed;
        const f = json.field && json.field in FIELD_IDS ? json.field : null;
        setError({ text, field: f });
        if (f) document.getElementById(FIELD_IDS[f])?.focus();
      } else {
        setOk(`「${winner}」：${json.messageZh ?? MANUAL_ENTRY_TEXT.created}`);
        if (json.outcome !== "ALREADY_ENTERED") {
          // 公告信息留着（同一条公告的下一个中标方），只清空中标方与金额
          setForm((f) => ({ ...f, winnerName: "", contractAmount: "" }));
          winnerRef.current?.focus();
        }
        onSaved(typeof json.record?.id === "string" ? json.record.id : null);
      }
    } catch {
      setError({ text: MANUAL_ENTRY_TEXT.network, field: null });
    }
    setBusy(false);
  };

  return (
    <div className="rounded-xl border border-[var(--border)] p-4 text-sm" data-testid="award-manual-entry">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-center justify-between gap-2 text-left font-medium text-[var(--foreground)] hover:text-[var(--accent)]"
        aria-expanded={open}
        aria-controls="award-manual-entry-form"
      >
        <span>{MANUAL_ENTRY_TEXT.formTitle}</span>
        <ChevronDown size={16} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {!open ? <p className={`mt-1 ${hint}`}>{MANUAL_ENTRY_TEXT.collapsedNote}</p> : null}
      {open ? (
        <form id="award-manual-entry-form" onSubmit={submit} className="mt-3 space-y-4" noValidate>
          <p className={hint}>{MANUAL_ENTRY_TEXT.formNote}</p>

          <fieldset className="space-y-3">
            <legend className="mb-1 text-xs font-medium">{MANUAL_ENTRY_TEXT.noticeGroup}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <label htmlFor={FIELD_IDS.apcUrl} className="text-xs">APC 公告链接（必填）</label>
                <input id={FIELD_IDS.apcUrl} className={field} value={form.apcUrl} onChange={set("apcUrl")} placeholder="例如 https://purchasing.alberta.ca/posting/AB-2026-07664" inputMode="url" required aria-invalid={invalid("apcUrl")} aria-describedby={describedBy("apcUrl", "ame-url-hint")} />
                <p id="ame-url-hint" className={hint}>{MANUAL_ENTRY_TEXT.urlHint}</p>
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label htmlFor={FIELD_IDS.buyerName} className="text-xs">采购方（必填）</label>
                <input id={FIELD_IDS.buyerName} className={field} value={form.buyerName} onChange={set("buyerName")} list="award-manual-buyers" maxLength={200} required aria-invalid={invalid("buyerName")} aria-describedby={describedBy("buyerName", "ame-buyer-hint")} />
                <datalist id="award-manual-buyers">
                  {buyerSuggestions.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
                <p id="ame-buyer-hint" className={hint}>{MANUAL_ENTRY_TEXT.buyerHint}</p>
              </div>
              <div className="space-y-1">
                <label htmlFor={FIELD_IDS.solicitationNumber} className="text-xs">招标编号</label>
                <input id={FIELD_IDS.solicitationNumber} className={field} value={form.solicitationNumber} onChange={set("solicitationNumber")} maxLength={100} aria-invalid={invalid("solicitationNumber")} aria-describedby={describedBy("solicitationNumber", "ame-solicitation-hint")} />
                <p id="ame-solicitation-hint" className={hint}>{MANUAL_ENTRY_TEXT.solicitationHint}</p>
              </div>
              <div className="space-y-1">
                <label htmlFor={FIELD_IDS.awardDate} className="text-xs">授标日期</label>
                <input id={FIELD_IDS.awardDate} className={field} type="date" min="1900-01-01" max={localToday()} value={form.awardDate} onChange={set("awardDate")} aria-invalid={invalid("awardDate")} aria-describedby={describedBy("awardDate")} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <label htmlFor={FIELD_IDS.scopeSummary} className="text-xs">范围摘要</label>
                <input id={FIELD_IDS.scopeSummary} className={field} value={form.scopeSummary} onChange={set("scopeSummary")} list="award-manual-scopes" maxLength={2000} aria-invalid={invalid("scopeSummary")} aria-describedby={describedBy("scopeSummary", "ame-scope-hint")} />
                <datalist id="award-manual-scopes">
                  {scopeSuggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
                <p id="ame-scope-hint" className={hint}>{MANUAL_ENTRY_TEXT.scopeHint}</p>
              </div>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="mb-1 text-xs font-medium">{MANUAL_ENTRY_TEXT.winnerGroup}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <label htmlFor={FIELD_IDS.winnerName} className="text-xs">中标方（必填）</label>
                <input id={FIELD_IDS.winnerName} ref={winnerRef} className={field} value={form.winnerName} onChange={set("winnerName")} maxLength={200} required aria-invalid={invalid("winnerName")} aria-describedby={describedBy("winnerName")} />
              </div>
              <div className="space-y-1">
                <label htmlFor={FIELD_IDS.contractAmount} className="text-xs">合同金额</label>
                <input id={FIELD_IDS.contractAmount} className={field} value={form.contractAmount} onChange={set("contractAmount")} inputMode="decimal" placeholder="例如 1,250,000.00" aria-invalid={invalid("contractAmount")} aria-describedby={describedBy("contractAmount", "ame-amount-hint")} />
              </div>
              <div className="space-y-1">
                <label htmlFor={FIELD_IDS.currency} className="text-xs">币种</label>
                <select id={FIELD_IDS.currency} className={field} value={form.currency} onChange={set("currency")} disabled={!form.contractAmount.trim()} aria-invalid={invalid("currency")} aria-describedby={describedBy("currency")}>
                  <option value="CAD">CAD</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <p id="ame-amount-hint" className={`${hint} sm:col-span-2`}>{MANUAL_ENTRY_TEXT.amountHint}</p>
            </div>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50">
              {busy ? MANUAL_ENTRY_TEXT.submitting : MANUAL_ENTRY_TEXT.submit}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setForm(EMPTY);
                setOk(null);
                setError(null);
              }}
              className="text-xs text-[var(--muted)] underline disabled:opacity-50"
            >
              {MANUAL_ENTRY_TEXT.clearNotice}
            </button>
          </div>
          <p className="text-xs text-[var(--success)]" role="status" aria-live="polite">
            {ok ?? ""}
          </p>
          <p id="ame-error" className="text-xs text-danger" role="alert">
            {error?.text ?? ""}
          </p>
        </form>
      ) : null}
    </div>
  );
}
