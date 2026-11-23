"use client";

/**
 * 新版「标书与报价」页 ② 定报价的共用小件：逐行报价（BIDPAGE-3）与只报总价（BIDPAGE-4）两个编辑器都用。
 * 从 `quote-step.tsx` 原样挪出来（写法与渲染结果不变），这里不算数、不读写浏览器存储。
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { formatMoneyZh } from "@/lib/bid-page-v2/next-step";
import { CURRENCY_NAME_ZH, currencyLabelZh, parseNumInput, type InquiryQuoteOption, type PresetState } from "@/lib/bid-page-v2/quote-line/contract";

export const CURRENCIES = ["CAD", "CNY", "USD", "EUR", "GBP"] as const;

export const PRESET_EXPLAIN_ZH = {
  financing: "到手成本 × 年化比例 ÷ 12 × 月数，不足一月按一月",
  admin: "管理费按含自身算：比例 3% 时，成本 100 → 103.09（管理费是 3.09，不是 3）。这里的成本 = 到手成本 + 资金使用",
  cashAllowance: "到手成本 × 比例",
  commission: "（报价 − 不含销售提成和按报价算的各项的成本）× 比例，算进成本",
} as const;

export const money = (v: number | null | undefined, ccy = "CAD") => (v == null ? "—" : formatMoneyZh(v, ccy));
/** 到手单位成本：不到 1 元时写 4 位（只取到分会失真） */
export const unitMoney = (v: number | null | undefined) => (v != null && v !== 0 && Math.abs(v) < 1 && Number.isFinite(v) ? `${v.toFixed(4)} ${CURRENCY_NAME_ZH.CAD}` : money(v));
export const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${(Math.round(v * 10) / 10).toFixed(1)}%`);

export function Note({ children, tone = "muted", testId }: { children: ReactNode; tone?: "muted" | "warn" | "error"; testId?: string }) {
  const cls = tone === "error" ? "border-red-300/60 bg-red-50/60 text-red-700" : tone === "warn" ? "border-amber-300/60 bg-amber-50/60 text-amber-800" : "border-border/60 bg-card-bg/60 text-muted";
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`} data-testid={testId}>
      {children}
    </div>
  );
}

/** 不合法输入的登记：编辑器据此不让保存（输入框自己标红） */
export type InvalidReporter = (label: string, invalid: boolean) => void;
export const InvalidContext = createContext<InvalidReporter>(() => undefined);

/** 编辑器里用：登记哪几格填的不是数字 */
export function useInvalidRegistry() {
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const reportInvalid = useCallback<InvalidReporter>((label, bad) => {
    setInvalid((prev) => {
      if (prev.has(label) === bad) return prev;
      const next = new Set(prev);
      if (bad) next.add(label);
      else next.delete(label);
      return next;
    });
  }, []);
  return { invalid, setInvalid, reportInvalid };
}

/**
 * 数字输入框：框里留着人打的字（「12.」「0.0」不会被改写），能读成数时才往上报；读不成数就标红并登记，不往上报。
 * 外面的值变了（恢复、导入、点选询价回复）且与框里的字不是同一个数时，才把框里的字换掉。
 */
export function NumInput({ value, onChange, disabled, label, className = "w-24" }: { value: number | null; onChange: (v: number | null) => void; disabled: boolean; label: string; className?: string }) {
  const report = useContext(InvalidContext);
  const [text, setText] = useState(value == null ? "" : String(value));
  const [bad, setBad] = useState(false);
  useEffect(() => {
    const cur = parseNumInput(text);
    if (!(cur.ok && cur.value === value)) {
      setText(value == null ? "" : String(value));
      setBad(false);
      report(label, false);
    }
    // 只在外面的值变了时对齐；text 不进依赖，免得打字时被改写
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  // 框被拿掉（删行）或换了名字（删行后行号变了）：撤掉它登记过的「不合法」
  useEffect(() => () => report(label, false), [label, report]);
  return (
    <input
      aria-label={label}
      aria-invalid={bad || undefined}
      inputMode="decimal"
      title={bad ? "这里要填数字" : undefined}
      className={`rounded border px-2 py-1 ${bad ? "border-red-500" : "border-border"} ${className}`}
      disabled={disabled}
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        const parsed = parseNumInput(raw);
        setBad(!parsed.ok);
        report(label, !parsed.ok);
        if (parsed.ok) onChange(parsed.value);
      }}
    />
  );
}

export function CurrencySelect({ value, onChange, disabled, label }: { value: string; onChange: (v: string) => void; disabled: boolean; label: string }) {
  return (
    <select aria-label={label} className="rounded border border-border px-1 py-1" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)}>
      {CURRENCIES.map((c) => (
        <option key={c} value={c}>
          {currencyLabelZh(c)}
        </option>
      ))}
    </select>
  );
}

/** 从询价回复里点选：逐行表与明细取单价（unit），货品总数取总价（total） */
export function InquiryPicker({ options, selectedId, onPick, disabled, price = "unit" }: { options: InquiryQuoteOption[]; selectedId: string | null; onPick: (o: InquiryQuoteOption | null) => void; disabled: boolean; price?: "unit" | "total" }) {
  if (options.length === 0) return null;
  const usable = (o: InquiryQuoteOption) => (CURRENCIES as readonly string[]).includes(o.currency);
  return (
    <select
      aria-label={price === "total" ? "从询价回复里选总价" : "从询价回复里选"}
      className="max-w-[12rem] rounded border border-border px-1 py-1 text-xs"
      disabled={disabled}
      value={selectedId ?? ""}
      onChange={(e) => onPick(options.find((o) => o.inquiryItemId === e.target.value) ?? null)}
    >
      <option value="">从询价回复里选…</option>
      {options.map((o) =>
        price === "total" ? (
          <option key={o.inquiryItemId} value={o.inquiryItemId} disabled={o.totalPrice == null || !usable(o)}>
            {o.supplierName} · 第 {o.roundNumber} 轮 · {!usable(o) ? `币种「${o.currency}」用不了，请手填` : o.totalPrice == null ? "回复里没有总价，请手填" : `总价 ${money(o.totalPrice, o.currency)}`}
          </option>
        ) : (
          <option key={o.inquiryItemId} value={o.inquiryItemId} disabled={o.unitPrice == null || !usable(o)}>
            {o.supplierName} · 第 {o.roundNumber} 轮 ·{" "}
            {!usable(o)
              ? `币种「${o.currency}」用不了，请手填`
              : o.unitPrice == null
                ? o.totalPrice == null
                  ? "回复里没有金额，请手填单价"
                  : `只报了总价 ${money(o.totalPrice, o.currency)}，请手填单价`
                : money(o.unitPrice, o.currency)}
          </option>
        ),
      )}
    </select>
  );
}

export function PresetRow({ label, explain, included, disabled, onToggle, children }: { label: string; explain: string; included: boolean; disabled: boolean; onToggle: (b: boolean) => void; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={included} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} />
          {label}
        </label>
        {children}
      </div>
      <div className="pl-6 text-xs text-muted">{explain}</div>
    </div>
  );
}

/** 四条预置（资金使用、管理费、现金备用金、销售提成）：两个编辑器同一套写法与说明 */
export function PresetRows({ presets, editable, onChange }: { presets: PresetState; editable: boolean; onChange: (fn: (p: PresetState) => PresetState) => void }) {
  return (
    <>
      <PresetRow label="资金使用" explain={PRESET_EXPLAIN_ZH.financing} included={presets.financing.included} disabled={!editable} onToggle={(b) => onChange((p) => ({ ...p, financing: { ...p.financing, included: b } }))}>
        <span>年化</span>
        <NumInput label="资金使用年化比例" value={presets.financing.ratePct} disabled={!editable} onChange={(v) => onChange((p) => ({ ...p, financing: { ...p.financing, ratePct: v } }))} className="w-16" />
        <span>% ×</span>
        <NumInput label="资金使用月数" value={presets.financing.months} disabled={!editable} onChange={(v) => onChange((p) => ({ ...p, financing: { ...p.financing, months: v } }))} className="w-16" />
        <span>个月</span>
      </PresetRow>
      <PresetRow label="管理费" explain={PRESET_EXPLAIN_ZH.admin} included={presets.admin.included} disabled={!editable} onToggle={(b) => onChange((p) => ({ ...p, admin: { ...p.admin, included: b } }))}>
        <NumInput label="管理费比例" value={presets.admin.ratePct} disabled={!editable} onChange={(v) => onChange((p) => ({ ...p, admin: { ...p.admin, ratePct: v } }))} className="w-16" />
        <span>%</span>
      </PresetRow>
      <PresetRow label="现金备用金" explain={PRESET_EXPLAIN_ZH.cashAllowance} included={presets.cashAllowance.included} disabled={!editable} onToggle={(b) => onChange((p) => ({ ...p, cashAllowance: { ...p.cashAllowance, included: b } }))}>
        <NumInput label="现金备用金比例" value={presets.cashAllowance.ratePct} disabled={!editable} onChange={(v) => onChange((p) => ({ ...p, cashAllowance: { ...p.cashAllowance, ratePct: v } }))} className="w-16" />
        <span>%</span>
      </PresetRow>
      <PresetRow label="销售提成" explain={PRESET_EXPLAIN_ZH.commission} included={presets.commission.included} disabled={!editable} onToggle={(b) => onChange((p) => ({ ...p, commission: { ...p.commission, included: b } }))}>
        <span>毛利 ×</span>
        <NumInput label="销售提成比例" value={presets.commission.ratePct} disabled={!editable} onChange={(v) => onChange((p) => ({ ...p, commission: { ...p.commission, ratePct: v } }))} className="w-16" />
        <span>%</span>
      </PresetRow>
    </>
  );
}
