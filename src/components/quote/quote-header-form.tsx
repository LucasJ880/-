"use client";

import { cn } from "@/lib/utils";
import {
  TEMPLATE_LABELS,
  TRADE_TERMS_OPTIONS,
  CURRENCY_OPTIONS,
  type QuoteHeaderData,
  type TemplateType,
} from "@/lib/quote/types";
import { TEMPLATE_CONFIGS } from "@/lib/quote/templates";

interface Props {
  header: QuoteHeaderData;
  onChange: (patch: Partial<QuoteHeaderData>) => void;
  disabled?: boolean;
}

export function QuoteHeaderForm({ header, onChange, disabled }: Props) {
  const config = TEMPLATE_CONFIGS[header.templateType];
  const visibleFields = new Set(config.defaultHeaderFields);

  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <div className="border-b border-border/40 px-4 py-2.5">
        <h3 className="text-sm font-medium">报价信息</h3>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 sm:grid-cols-3 lg:grid-cols-4">
        <Field label="标题" span={2}>
          <input
            type="text"
            value={header.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="报价单标题"
            disabled={disabled}
            className="field-input"
          />
        </Field>

        {visibleFields.has("currency") && (
          <Field label="币种">
            <select
              value={header.currency}
              onChange={(e) => onChange({ currency: e.target.value })}
              disabled={disabled}
              className="field-input"
            >
              {CURRENCY_OPTIONS.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
        )}

        {visibleFields.has("tradeTerms") && (
          <Field label="贸易方式">
            <select
              value={header.tradeTerms}
              onChange={(e) => onChange({ tradeTerms: e.target.value })}
              disabled={disabled}
              className="field-input"
            >
              <option value="">选择...</option>
              {TRADE_TERMS_OPTIONS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </Field>
        )}

        {visibleFields.has("paymentTerms") && (
          <Field label="付款条款">
            <input
              type="text"
              value={header.paymentTerms}
              onChange={(e) => onChange({ paymentTerms: e.target.value })}
              placeholder="如 T/T 30/70"
              disabled={disabled}
              className="field-input"
            />
          </Field>
        )}

        {visibleFields.has("deliveryDays") && (
          <Field label="交期（天）">
            <input
              type="number"
              value={header.deliveryDays ?? ""}
              onChange={(e) => onChange({ deliveryDays: e.target.value ? Number(e.target.value) : null })}
              placeholder="天数"
              min={0}
              disabled={disabled}
              className="field-input"
            />
          </Field>
        )}

        {visibleFields.has("validUntil") && (
          <Field label="报价有效期">
            <input
              type="date"
              value={header.validUntil}
              onChange={(e) => onChange({ validUntil: e.target.value })}
              disabled={disabled}
              className="field-input"
            />
          </Field>
        )}

        {visibleFields.has("moq") && (
          <Field label="MOQ">
            <input
              type="number"
              value={header.moq ?? ""}
              onChange={(e) => onChange({ moq: e.target.value ? Number(e.target.value) : null })}
              placeholder="最小起订量"
              min={0}
              disabled={disabled}
              className="field-input"
            />
          </Field>
        )}

        {visibleFields.has("originCountry") && (
          <Field label="原产地">
            <input
              type="text"
              value={header.originCountry}
              onChange={(e) => onChange({ originCountry: e.target.value })}
              placeholder="如 China"
              disabled={disabled}
              className="field-input"
            />
          </Field>
        )}
      </div>

      <style jsx>{`
        .field-input {
          width: 100%;
          padding: 0.375rem 0.5rem;
          font-size: 0.8125rem;
          border: 1px solid var(--border);
          border-radius: var(--radius-sm);
          background: var(--background);
          color: var(--foreground);
          outline: none;
          transition: border-color 0.15s;
        }
        .field-input:focus {
          border-color: var(--accent);
        }
        .field-input:disabled {
          opacity: 0.5;
        }
      `}</style>
    </div>
  );
}

function Field({ label, span, children }: { label: string; span?: number; children: React.ReactNode }) {
  return (
    <label className={cn("block", span === 2 && "col-span-2")}>
      <span className="mb-1 block text-[11px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
