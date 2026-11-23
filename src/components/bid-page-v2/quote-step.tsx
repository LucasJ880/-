"use client";

/**
 * BIDPAGE-3 新版「标书与报价」页 ② 定报价：报价列表、新建两问、逐行报价、按招标方价格表导出
 *
 * 只挂在看得到金额的人的新页面上（`bid-page-v2.tsx` 的金额门）；接口自己再判一次（报价权限守卫 + 财务查看权）。
 * 所有数都由服务端用报价引擎算好再返回；这里不算数，只在保存前标明「数字是上次保存时的」。
 * 不写浏览器本地存储里的成本；只读一次旧的本地成本草稿，提示过后记一个不含金额的标记。
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { formatMoneyZh } from "@/lib/bid-page-v2/next-step";
import {
  BUSINESS_TYPES,
  BUSINESS_TYPE_ZH,
  CURRENCY_NAME_ZH,
  LINE_EVIDENCE_KINDS,
  LINE_EVIDENCE_LABELS_ZH,
  LINE_MODE_MAX_ROWS,
  LINE_UOMS,
  QUOTE_STATUS_ZH,
  parseNumInput,
  piecesPerUnit,
  quoteDisplayName,
  remainingPasteText,
  rowsFromParsed,
  uomLabelZh,
  currencyLabelZh,
  type BusinessType,
  type ExportAvailability,
  type InquiryQuoteOption,
  type LineModeIssue,
  type LineModeState,
  type LineModeView,
  type LineRow,
  type QuoteListItem,
  type QuoteListView,
} from "@/lib/bid-page-v2/quote-line/contract";
import { costDraftPromptedKey, draftToPrompt, importCostDraft } from "@/lib/bid-page-v2/quote-line/draft-import";
import { costDraftStorageKey, parseCostDraft, type CostDraft } from "@/lib/tender-bid-workspace/cost-draft";
import { parseSchedulePaste } from "@/lib/tender-bid-workspace/paste-import";

const CURRENCIES = ["CAD", "CNY", "USD", "EUR", "GBP"] as const;

export const QUOTE_STEP_TEXT = {
  notEnabled: "报价功能未开通",
  loadFailed: "报价列表没加载出来，请刷新后再试",
  noQuotes: "还没有报价",
  createTitle: "新建报价",
  askHow: "这个标怎么交价？",
  lineOption: "逐行报价（招标方有价格表，每行填单价）",
  askBusiness: "业务类型",
  proModeOnly: "供货加安装、长期供货协议在专业模式里做，建好后会打开专业模式",
  proMode: "专业模式",
  openInProMode: "在专业模式里打开",
  openLineInProMode: "用专业模式打开",
  submitInProMode: "提交、批准在专业模式里做",
  dirty: "有修改还没保存：下面的数字是上次保存时的，保存后更新",
  marginNote: "毛利率已扣销售提成，所以比目标毛利率低（目标毛利率按扣提成前算）",
  exportButton: "按招标方价格表导出",
  draftPrompt: "发现这台电脑上有未保存到系统的成本草稿，导入到这份报价？",
  draftSkip: "不导入（草稿留在这台电脑上，不会删，也不再提示）",
  readOnly: "你可以看这份报价，但没有编辑权限；要修改请找项目负责人",
  noEditList: "新建、修改报价需要项目编辑权限，请找项目负责人",
  exportNote: "导出的是逐行表里的行（品名、数量、单位以表里为准），交出去之前请与招标方的价格表核对",
  landedNote: "到手单位成本 = 这一行的货值，加上按货值摊到这一行的海运费、报关费、国内运费、关税，再除以数量（专业模式里加的其它直接成本也摊进来）",
  marginColNote: "行毛利率 =（行合计 − 这一行按货值分到的全部成本，含资金使用、管理费、现金备用金、销售提成）÷ 行合计；单价取到分以后，各行和顶部毛利率会略有不同",
  sharedNote: "海运费、报关费、国内运费、关税都算进报价合计（所以每行我方单价也跟着变）；它们在各行之间按货值分，分到多少显示在「到手单位成本」那一列",
  landedDefine: "到手成本 = 货值 + 海运费 + 报关费 + 国内运费 + 关税",
  formula: "报价 = 不含销售提成的成本 ÷（1 − 目标毛利率）；专业模式里加了按售价算的费用时，分母再减去这些比例。销售提成再从毛利里扣",
  targetEmpty: "目标毛利率还没填，按 0% 算",
  pasteSummary: "粘贴价格表（从 Excel 选中这几列复制、粘贴即可：行号、品名、数量、单位、包装数（可不填）；第一行是表头也没关系）",
  conflictHint: "你这次的修改还在框里：先把要改的记下来，点「收起」再「打开」看最新内容，然后重新填",
  discard: "放弃修改",
} as const;

/** 锁定的报价：带上状态名（「已定」在这一页指「定为我方报价」，已批准但没选上的也锁着） */
export const frozenNoteZh = (status: string) => `这份报价「${QUOTE_STATUS_ZH[status] ?? status}」，内容锁定；要改请在专业模式里另起新版`;

export const LINE_TABLE_HEADERS = ["品名", "数量", "供应商报价（原币）", "到手单位成本（加元）", "我方单价", "行合计", "毛利率"] as const;

export const PRESET_EXPLAIN_ZH = {
  financing: "到手成本 × 年化比例 ÷ 12 × 月数，不足一月按一月",
  admin: "管理费按含自身算：比例 3% 时，成本 100 → 103.09（管理费是 3.09，不是 3）。这里的成本 = 到手成本 + 资金使用",
  cashAllowance: "到手成本 × 比例",
  commission: "（报价 − 不含销售提成的成本）× 比例，算进成本",
} as const;

const money = (v: number | null | undefined, ccy = "CAD") => (v == null ? "—" : formatMoneyZh(v, ccy));
/** 到手单位成本：不到 1 元时写 4 位（只取到分会失真） */
const unitMoney = (v: number | null | undefined) => (v != null && v !== 0 && Math.abs(v) < 1 && Number.isFinite(v) ? `${v.toFixed(4)} ${CURRENCY_NAME_ZH.CAD}` : money(v));
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? "—" : `${(Math.round(v * 10) / 10).toFixed(1)}%`);

function Note({ children, tone = "muted", testId }: { children: ReactNode; tone?: "muted" | "warn" | "error"; testId?: string }) {
  const cls = tone === "error" ? "border-red-300/60 bg-red-50/60 text-red-700" : tone === "warn" ? "border-amber-300/60 bg-amber-50/60 text-amber-800" : "border-border/60 bg-card-bg/60 text-muted";
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`} data-testid={testId}>
      {children}
    </div>
  );
}

/* ---------------------------------- 列表 ---------------------------------- */

export function QuoteListPanel({ view, onOpen, onCreate, creating, createError }: { view: QuoteListView; onOpen: (q: QuoteListItem) => void; onCreate: (businessType: BusinessType, name: string) => Promise<boolean> | void; creating: boolean; createError: string | null }) {
  const [showForm, setShowForm] = useState(false);
  const [business, setBusiness] = useState<BusinessType>("SUPPLY_ONLY");
  const [name, setName] = useState("");
  return (
    <div className="space-y-3" data-testid="quote-step-list">
      {view.quotes.length === 0 ? (
        <Note testId="quote-step-empty">{QUOTE_STEP_TEXT.noQuotes}</Note>
      ) : (
        <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
          {view.quotes.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm" data-testid="quote-step-row">
              <span className="font-medium">{quoteDisplayName(q)}</span>
              <span className="text-muted">第 {q.version} 版 · {QUOTE_STATUS_ZH[q.status] ?? q.status}</span>
              <span className="text-muted">{q.entryMode === "LINE" ? "逐行报价" : QUOTE_STEP_TEXT.proMode}</span>
              <span>报价合计 {money(q.sellingPrice, q.currency)}</span>
              {q.isOurBid ? <span className="rounded bg-emerald-100 px-1.5 text-xs text-emerald-800">我方报价</span> : null}
              <span className="ml-auto flex gap-3">
                {q.entryMode === "LINE" ? (
                  <button type="button" className="text-accent underline-offset-2 hover:underline" onClick={() => onOpen(q)}>
                    打开
                  </button>
                ) : null}
                <a className="text-accent underline-offset-2 hover:underline" href={q.proModeHref} data-testid="quote-step-pro-link">
                  {q.entryMode === "LINE" ? QUOTE_STEP_TEXT.openLineInProMode : QUOTE_STEP_TEXT.openInProMode}
                </a>
              </span>
            </li>
          ))}
        </ul>
      )}
      {!view.capabilities.canEdit ? <Note testId="quote-step-no-edit">{QUOTE_STEP_TEXT.noEditList}</Note> : null}
      {view.capabilities.canEdit ? (
        showForm ? (
          <div className="space-y-3 rounded-xl border border-border/60 px-4 py-3 text-sm" data-testid="quote-step-create">
            <div>
              <div className="font-medium">{QUOTE_STEP_TEXT.askHow}</div>
              <label className="mt-1 flex items-center gap-2">
                <input type="radio" checked readOnly /> {QUOTE_STEP_TEXT.lineOption}
              </label>
              {view.scheduleLineCount > 0 ? <div className="mt-1 text-xs text-muted">已有价格表 {view.scheduleLineCount} 行，新建后自动带进来</div> : <div className="mt-1 text-xs text-muted">还没有保存的价格表，新建后可以粘贴、从招标分析带入或加一行</div>}
            </div>
            <div>
              <div className="font-medium">{QUOTE_STEP_TEXT.askBusiness}</div>
              {BUSINESS_TYPES.map((b) => (
                <label key={b} className="mt-1 flex items-center gap-2">
                  <input type="radio" name="bid-page-business" checked={business === b} onChange={() => setBusiness(b)} /> {BUSINESS_TYPE_ZH[b]}
                  {b === "SUPPLY_ONLY" ? <span className="text-xs text-muted">（默认）</span> : null}
                </label>
              ))}
              {business !== "SUPPLY_ONLY" ? <div className="mt-1 text-xs text-muted">{QUOTE_STEP_TEXT.proModeOnly}</div> : null}
            </div>
            <label className="flex items-center gap-2">
              名称（可不填）
              <input className="rounded border border-border px-2 py-1" maxLength={160} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            {createError ? <Note tone="error">{createError}</Note> : null}
            <div className="flex gap-3">
              <button type="button" disabled={creating} className="rounded bg-accent px-3 py-1 text-[color:var(--on-accent)] hover:bg-accent-hover disabled:opacity-60" onClick={async () => {
                  if (await onCreate(business, name)) {
                    setShowForm(false);
                    setName("");
                  }
                }}>
                {creating ? "正在新建…" : "新建"}
              </button>
              <button type="button" className="text-muted" onClick={() => setShowForm(false)}>
                取消
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="rounded border border-border px-3 py-1 text-sm" onClick={() => setShowForm(true)} data-testid="quote-step-new">
            {QUOTE_STEP_TEXT.createTitle}
          </button>
        )
      ) : null}
    </div>
  );
}

export function ExportBar({ projectId, availability }: { projectId: string; availability: ExportAvailability }) {
  return (
    <div id="bid-page-export" className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 px-4 py-3 text-sm" data-testid="quote-step-export">
      {availability.available ? (
        <a className="rounded bg-accent px-3 py-1 text-[color:var(--on-accent)] hover:bg-accent-hover" href={`/api/projects/${encodeURIComponent(projectId)}/bid-page/quotes/${encodeURIComponent(availability.quoteId)}/export`} download>
          {QUOTE_STEP_TEXT.exportButton}
        </a>
      ) : (
        <>
          <button type="button" disabled className="rounded border border-border px-3 py-1 opacity-60">
            {QUOTE_STEP_TEXT.exportButton}
          </button>
          <span className="text-muted">{availability.reasonZh}</span>
        </>
      )}
      <span className="basis-full text-xs text-muted">{QUOTE_STEP_TEXT.exportNote}</span>
    </div>
  );
}

/* ---------------------------------- 逐行报价 ---------------------------------- */

export function LineTotals({ view, dirty }: { view: LineModeView; dirty: boolean }) {
  const c = view.computed;
  const commissionOn = view.state.presets.commission.included && (view.state.presets.commission.ratePct ?? 0) > 0;
  return (
    <div className="space-y-2" data-testid="line-totals">
      {dirty ? <Note tone="warn">{QUOTE_STEP_TEXT.dirty}</Note> : null}
      {c.ok ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["报价合计", money(c.totals.sellingPrice)],
              ["成本合计", money(c.totals.estimatedCost)],
              ["利润", money(c.totals.grossProfit)],
              ["毛利率", pct(c.totals.grossMarginPct)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-border/60 px-3 py-2">
                <div className="text-xs text-muted">{k}</div>
                <div className="text-base font-semibold">{v}</div>
              </div>
            ))}
          </div>
          {commissionOn ? <div className="text-xs text-muted">{QUOTE_STEP_TEXT.marginNote}</div> : null}
          {view.state.targetMarginPct == null ? <div className="text-xs text-muted">{QUOTE_STEP_TEXT.targetEmpty}</div> : null}
          {c.allocation.diff != null && c.allocation.diff !== 0 ? (
            <Note tone="warn" testId="line-diff">
              逐行合计 {money(c.allocation.linesTotal)} 比报价合计 {money(c.totals.sellingPrice)} {c.allocation.diff > 0 ? "多" : "少"} {money(Math.abs(c.allocation.diff))}：每行单价四舍五入到分再乘数量，合起来会和报价合计差一点（最多差 {money(c.allocation.diffBound)}）。系统记的我方报价是报价合计；导出给招标方的价格表用逐行合计。
            </Note>
          ) : null}
          {c.warnings.map((w) => (
            // 没有预备金是常态（判断点 5 不默认带），写成灰色说明，不当警告
            <Note key={w.code} tone={w.code === "NO_CONTINGENCY" ? "muted" : "warn"}>
              {w.messageZh}
            </Note>
          ))}
        </>
      ) : (
        <Note tone="error" testId="line-errors">
          还算不出报价：{c.errorsZh.join("；")}
        </Note>
      )}
    </div>
  );
}

/** 不合法输入的登记：编辑器据此不让保存（输入框自己标红） */
type InvalidReporter = (label: string, invalid: boolean) => void;
const InvalidContext = createContext<InvalidReporter>(() => undefined);

/**
 * 数字输入框：框里留着人打的字（「12.」「0.0」不会被改写），能读成数时才往上报；读不成数就标红并登记，不往上报。
 * 外面的值变了（恢复、导入、点选询价回复）且与框里的字不是同一个数时，才把框里的字换掉。
 */
function NumInput({ value, onChange, disabled, label, className = "w-24" }: { value: number | null; onChange: (v: number | null) => void; disabled: boolean; label: string; className?: string }) {
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

function CurrencySelect({ value, onChange, disabled, label }: { value: string; onChange: (v: string) => void; disabled: boolean; label: string }) {
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

function InquiryPicker({ options, row, onPick, disabled }: { options: InquiryQuoteOption[]; row: LineRow; onPick: (o: InquiryQuoteOption | null) => void; disabled: boolean }) {
  if (options.length === 0) return null;
  return (
    <select
      aria-label="从询价回复里选"
      className="max-w-[12rem] rounded border border-border px-1 py-1 text-xs"
      disabled={disabled}
      value={row.inquiryItemId ?? ""}
      onChange={(e) => onPick(options.find((o) => o.inquiryItemId === e.target.value) ?? null)}
    >
      <option value="">从询价回复里选…</option>
      {options.map((o) => (
        <option key={o.inquiryItemId} value={o.inquiryItemId} disabled={o.unitPrice == null || !(CURRENCIES as readonly string[]).includes(o.currency)}>
          {o.supplierName} · 第 {o.roundNumber} 轮 ·{" "}
          {!(CURRENCIES as readonly string[]).includes(o.currency)
            ? `币种「${o.currency}」用不了，请手填`
            : o.unitPrice == null
              ? o.totalPrice == null
                ? "回复里没有金额，请手填单价"
                : `只报了总价 ${money(o.totalPrice, o.currency)}，请手填单价`
              : money(o.unitPrice, o.currency)}
        </option>
      ))}
    </select>
  );
}

export function LineQuoteEditor({ projectId, view, onSaved, onClose }: { projectId: string; view: LineModeView; onSaved: (v: LineModeView) => void; onClose: () => void }) {
  const [state, setState] = useState<LineModeState>(view.state);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; issues: LineModeIssue[]; conflict: boolean } | null>(null);
  const [paste, setPaste] = useState("");
  const [pasteIssues, setPasteIssues] = useState<string[]>([]);
  const [draft, setDraft] = useState<CostDraft | null>(null);
  const [draftNotes, setDraftNotes] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const [resetKey, setResetKey] = useState(0);
  const reportInvalid = useCallback<InvalidReporter>((label, bad) => {
    setInvalid((prev) => {
      if (prev.has(label) === bad) return prev;
      const next = new Set(prev);
      if (bad) next.add(label);
      else next.delete(label);
      return next;
    });
  }, []);
  const editable = view.capabilities.canEdit && !view.quote.frozen;

  // 换了一份报价或保存成功后，以服务端的状态为准
  useEffect(() => {
    setState(view.state);
    setDirty(false);
  }, [view]);

  // 旧的本地成本草稿：只读一次；提示过的不再提示（标记不含金额）
  // 表里还没有行时不提示（一行都对不上，提示却会被用掉）；有了行、保存后再判一次
  const savedRowCount = view.state.rows.length;
  useEffect(() => {
    if (!editable) return;
    try {
      const d = draftToPrompt(window.localStorage.getItem(costDraftPromptedKey(projectId)), window.localStorage.getItem(costDraftStorageKey(projectId)), parseCostDraft, savedRowCount);
      setDraft(d);
    } catch {
      /* 读不了本地存储就不提示 */
    }
  }, [projectId, editable, savedRowCount]);

  const markPrompted = () => {
    try {
      window.localStorage.setItem(costDraftPromptedKey(projectId), "1");
    } catch {
      /* 写不了就下次再提示 */
    }
    setDraft(null);
  };

  const update = (fn: (s: LineModeState) => LineModeState) => {
    setState((s) => fn(s));
    setDirty(true);
  };
  const setRow = (i: number, patch: Partial<LineRow>) => update((s) => ({ ...s, rows: s.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const ensureFx = (s: LineModeState, ccy: string): LineModeState => (ccy === "CAD" || s.fx[ccy] ? s : { ...s, fx: { ...s.fx, [ccy]: { rate: null, source: null } } });

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/projects/${encodeURIComponent(projectId)}/bid-page/quotes/${encodeURIComponent(view.quote.id)}/line`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUpdatedAt: view.quote.updatedAt, state }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const issues = (data?.details?.issues ?? []) as LineModeIssue[];
        setError({ message: String(data?.error ?? "保存没成功，请稍后再试"), issues, conflict: res.status === 409 });
        return;
      }
      onSaved(data as LineModeView);
    } catch {
      setError({ message: "保存没成功（网络问题），请稍后再试", issues: [], conflict: false });
    } finally {
      setSaving(false);
    }
  }, [projectId, view.quote.id, view.quote.updatedAt, state, onSaved]);

  const alloc = view.computed.ok && !dirty ? view.computed.allocation.lines : null;
  // 汇率格按实际用到的外币列（各行与共用参数），不只看已登记的：粘贴 / 加行带进来的人民币行也要有汇率格
  const usedCurrencies = [
    ...new Set([
      ...Object.keys(state.fx),
      ...state.rows.map((r) => r.currency),
      state.shared.oceanFreight.currency,
      state.shared.customs.currency,
      state.shared.domesticFreight.currency,
    ]),
  ].filter((c) => c !== "CAD");

  return (
    <InvalidContext.Provider value={reportInvalid}>
    <div key={`${view.quote.updatedAt}-${resetKey}`} className="space-y-4 rounded-xl border border-border/60 px-4 py-3" data-testid="line-editor">
      <div className="flex flex-wrap items-center gap-3">
        <div className="font-medium">
          逐行报价 · {quoteDisplayName(view.quote)} · 第 {view.quote.version} 版 · {QUOTE_STATUS_ZH[view.quote.status] ?? view.quote.status}
        </div>
        <a className="text-xs text-accent underline-offset-2 hover:underline" href={view.proModeHref}>
          {QUOTE_STEP_TEXT.submitInProMode}
        </a>
        <div className="relative ml-auto">
          <button type="button" className="rounded border border-border px-2 py-1 text-xs" aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
            更多
          </button>
          {moreOpen ? (
            <div className="absolute right-0 z-10 mt-1 w-32 rounded border border-border bg-card-bg py-1 text-sm shadow" role="menu">
              <a role="menuitem" className="block px-3 py-1 hover:bg-accent-soft" href={view.proModeHref} data-testid="line-editor-pro-mode">
                {QUOTE_STEP_TEXT.openLineInProMode}
              </a>
            </div>
          ) : null}
        </div>
        <button type="button" className="text-xs text-muted" onClick={onClose}>
          收起
        </button>
      </div>

      {view.quote.frozen ? <Note>{frozenNoteZh(view.quote.status)}</Note> : !view.capabilities.canEdit ? <Note>{QUOTE_STEP_TEXT.readOnly}</Note> : null}
      {view.notices.map((n) => (
        <Note key={n} tone="warn">
          {n}
        </Note>
      ))}

      <LineTotals view={view} dirty={dirty} />

      {draft ? (
        <Note tone="warn" testId="line-draft-prompt">
          {QUOTE_STEP_TEXT.draftPrompt}
          <span className="ml-3 inline-flex gap-3">
            <button
              type="button"
              className="text-accent underline"
              onClick={() => {
                const r = importCostDraft(state, draft);
                setState(r.state);
                setDirty(true);
                setDraftNotes(r.notes);
                markPrompted();
              }}
            >
              导入
            </button>
            <button type="button" className="text-muted underline" onClick={markPrompted}>
              {QUOTE_STEP_TEXT.draftSkip}
            </button>
          </span>
        </Note>
      ) : null}
      {draftNotes.map((n) => (
        <Note key={n}>{n}</Note>
      ))}

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm" data-testid="line-table">
          <thead>
            <tr className="text-left text-xs text-muted">
              {LINE_TABLE_HEADERS.map((h) => (
                <th key={h} className="px-2 py-1 font-normal">
                  {h}
                </th>
              ))}
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {state.rows.map((r, i) => {
              const a = alloc?.[i] ?? null;
              const canPiece = piecesPerUnit(r.uom, r.packCount) != null && (r.packCount ?? 1) > 1;
              return (
                <tr key={i} className="border-t border-border/60 align-top" data-testid="line-row">
                  <td className="px-2 py-1">
                    <span className="mr-1 text-xs text-muted">{i + 1}</span>
                    <input aria-label={`第 ${i + 1} 行品名`} className="w-56 rounded border border-border px-2 py-1" disabled={!editable} maxLength={500} title={r.description} value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} />
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <NumInput label={`第 ${i + 1} 行数量`} value={r.quantity} disabled={!editable} onChange={(v) => setRow(i, { quantity: v ?? 0 })} className="w-20" />
                    <select aria-label={`第 ${i + 1} 行单位`} className="ml-1 rounded border border-border px-1 py-1" disabled={!editable} value={r.uom} onChange={(e) => setRow(i, { uom: e.target.value })}>
                      {(LINE_UOMS as readonly string[]).includes(r.uom) ? null : <option value={r.uom}>{r.uom}（不在列表里）</option>}
                      {LINE_UOMS.map((u) => (
                        <option key={u} value={u}>
                          {uomLabelZh(u)}
                        </option>
                      ))}
                    </select>
                    {r.packCount ? <div className="text-xs text-muted">每单位 {r.packCount} 件</div> : null}
                  </td>
                  <td className="space-y-1 px-2 py-1">
                    <div className="flex items-center gap-1">
                      <NumInput label={`第 ${i + 1} 行供应商报价`} value={r.unitPrice} disabled={!editable} onChange={(v) => setRow(i, { unitPrice: v, inquiryItemId: null, supplierId: null, supplierName: null })} />
                      <CurrencySelect label={`第 ${i + 1} 行币种`} value={r.currency} disabled={!editable} onChange={(c) => update((s) => ensureFx({ ...s, rows: s.rows.map((x, j) => (j === i ? { ...x, currency: c, inquiryItemId: null, supplierId: null, supplierName: null } : x)) }, c))} />
                    </div>
                    {canPiece || r.basis === "PER_PIECE" ? (
                      // 按件但这一行已不能按件（例如改了单位）：照样显示口径，好改回按招标单位
                      <select aria-label={`第 ${i + 1} 行报价口径`} className="rounded border border-border px-1 py-1 text-xs" disabled={!editable} value={r.basis} onChange={(e) => setRow(i, { basis: e.target.value as LineRow["basis"], inquiryItemId: null, supplierId: null, supplierName: null })}>
                        <option value="PER_TENDER_UOM">按招标单位</option>
                        <option value="PER_PIECE">{canPiece ? `按件（× ${r.packCount}）` : "按件（这一行没有包装数，不能按件）"}</option>
                      </select>
                    ) : null}
                    {r.inquiryItemId ? (
                      <div className="text-xs text-muted">来自询价回复：{r.supplierName ?? "供应商"}（{CURRENCY_NAME_ZH[r.currency] ?? r.currency}，请与回复核对单位与币种）</div>
                    ) : r.unitPrice != null ? (
                      <select aria-label={`第 ${i + 1} 行证据类别`} className="rounded border border-border px-1 py-1 text-xs" disabled={!editable} value={r.evidenceKind ?? ""} onChange={(e) => setRow(i, { evidenceKind: (e.target.value || null) as LineRow["evidenceKind"] })}>
                        <option value="">选证据类别（必选）</option>
                        {LINE_EVIDENCE_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {LINE_EVIDENCE_LABELS_ZH[k]}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <InquiryPicker
                      options={view.inquiryQuotes}
                      row={r}
                      disabled={!editable}
                      onPick={(o) =>
                        o && o.unitPrice != null
                          ? update((s) => ensureFx({ ...s, rows: s.rows.map((x, j) => (j === i ? { ...x, unitPrice: o.unitPrice, currency: o.currency, inquiryItemId: o.inquiryItemId, supplierId: o.supplierId, supplierName: o.supplierName, evidenceKind: null } : x)) }, o.currency))
                          : setRow(i, { inquiryItemId: null, supplierId: null, supplierName: null })
                      }
                    />
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap">{a ? unitMoney(a.landedUnitCostCad) : "—"}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{a ? money(a.unitPrice) : "—"}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{a ? money(a.extended) : "—"}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{a ? pct(a.marginPct) : "—"}</td>
                  <td className="px-2 py-1">
                    {editable ? (
                      <button type="button" aria-label={`删掉第 ${i + 1} 行`} className="text-xs text-muted" onClick={() => update((s) => ({ ...s, rows: s.rows.filter((_, j) => j !== i) }))}>
                        删
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {state.rows.length === 0 ? (
          <Note>还没有行：粘贴价格表、从招标分析带入，或加一行</Note>
        ) : (
          <div className="mt-1 space-y-0.5 text-xs text-muted">
            <div>{QUOTE_STEP_TEXT.landedNote}</div>
            <div>{QUOTE_STEP_TEXT.marginColNote}</div>
          </div>
        )}
      </div>

      {editable ? (
        <div className="space-y-2 text-sm" data-testid="line-add">
          <button
            type="button"
            className="rounded border border-border px-3 py-1"
            disabled={state.rows.length >= LINE_MODE_MAX_ROWS}
            onClick={() => update((s) => ({ ...s, rows: [...s.rows, { costLineId: null, description: "", quantity: 1, uom: "Each", packCount: null, basis: "PER_TENDER_UOM", unitPrice: null, currency: "CNY", evidenceKind: null, inquiryItemId: null, supplierId: null, supplierName: null, rowSource: "manual" }] }))}
          >
            加一行
          </button>
          <details>
            <summary className="cursor-pointer text-muted">{QUOTE_STEP_TEXT.pasteSummary}</summary>
            {view.seed?.prefill ? (
              <div className="mt-2 space-y-1">
                <div className="text-xs text-muted">{view.seed.prefill.messageZh}</div>
                {view.seed.prefill.text ? (
                  <button type="button" className="text-xs text-accent underline" onClick={() => setPaste(view.seed!.prefill.text)}>
                    从招标分析带入到粘贴框
                  </button>
                ) : null}
              </div>
            ) : null}
            <textarea aria-label="粘贴价格表" className="mt-2 h-28 w-full rounded border border-border px-2 py-1 font-mono text-xs" value={paste} onChange={(e) => setPaste(e.target.value)} />
            <button
              type="button"
              className="rounded border border-border px-3 py-1"
              onClick={() => {
                const parsed = parseSchedulePaste(paste);
                const source = view.seed?.prefill?.text && paste === view.seed.prefill.text ? "analysis" : "paste";
                const room = LINE_MODE_MAX_ROWS - state.rows.length;
                const added = rowsFromParsed(parsed.lines, source).slice(0, Math.max(0, room));
                if (added.length) update((s) => ({ ...s, rows: [...s.rows, ...added] }));
                // 粘贴框的说法统一成表头的「品名」
                setPasteIssues([
                  ...parsed.issues.map((x) => x.messageZh.replace("缺少说明", "缺少品名")),
                  ...(parsed.issues.length ? ["没导入的行留在框里，改好后再点「导入这些行」"] : []),
                  ...(parsed.lines.length > room ? [`超过 ${LINE_MODE_MAX_ROWS} 行，后面 ${parsed.lines.length - room} 行没导入`] : []),
                ]);
                // 只去掉已导入的行，没导入的留在框里改了再导
                setPaste(remainingPasteText(paste, parsed.issues.map((x) => x.row)));
              }}
            >
              导入这些行
            </button>
            {pasteIssues.map((m) => (
              <div key={m} className="text-xs text-red-700">
                {m}
              </div>
            ))}
          </details>
        </div>
      ) : null}

      <fieldset className="space-y-2 rounded-lg border border-border/60 px-3 py-2 text-sm" data-testid="line-shared">
        <legend className="px-1 text-xs text-muted">共用参数（空着 = 这项没有）</legend>
        {usedCurrencies.map((ccy) => (
          <div key={ccy} className="flex flex-wrap items-center gap-2">
            <span>汇率：1 {currencyLabelZh(ccy)} =</span>
            <NumInput label={`${ccy} 汇率`} value={state.fx[ccy]?.rate ?? null} disabled={!editable} onChange={(v) => update((s) => ({ ...s, fx: { ...s.fx, [ccy]: { rate: v, source: s.fx[ccy]?.source ?? null } } }))} />
            <span>加元，来源</span>
            <input aria-label={`${ccy} 汇率来源`} placeholder="例：中国银行 11 月 20 日牌价" className="w-48 rounded border border-border px-2 py-1" maxLength={40} disabled={!editable} value={state.fx[ccy]?.source ?? ""} onChange={(e) => update((s) => ({ ...s, fx: { ...s.fx, [ccy]: { rate: s.fx[ccy]?.rate ?? null, source: e.target.value || null } } }))} />
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <span>海运费：</span>
          <NumInput label="海运柜数" value={state.shared.oceanFreight.containers} disabled={!editable} onChange={(v) => update((s) => ({ ...s, shared: { ...s.shared, oceanFreight: { ...s.shared.oceanFreight, containers: v } } }))} className="w-16" />
          <span>柜 × 每柜</span>
          <NumInput label="每柜海运费" value={state.shared.oceanFreight.perContainer} disabled={!editable} onChange={(v) => update((s) => ({ ...s, shared: { ...s.shared, oceanFreight: { ...s.shared.oceanFreight, perContainer: v } } }))} />
          <CurrencySelect label="海运费币种" value={state.shared.oceanFreight.currency} disabled={!editable} onChange={(c) => update((s) => ensureFx({ ...s, shared: { ...s.shared, oceanFreight: { ...s.shared.oceanFreight, currency: c } } }, c))} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span>报关费：</span>
          <NumInput label="报关费" value={state.shared.customs.amount} disabled={!editable} onChange={(v) => update((s) => ({ ...s, shared: { ...s.shared, customs: { ...s.shared.customs, amount: v } } }))} />
          <CurrencySelect label="报关费币种" value={state.shared.customs.currency} disabled={!editable} onChange={(c) => update((s) => ensureFx({ ...s, shared: { ...s.shared, customs: { ...s.shared.customs, currency: c } } }, c))} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span>关税率：</span>
          <NumInput label="关税率" value={state.shared.dutyPct} disabled={!editable} onChange={(v) => update((s) => ({ ...s, shared: { ...s.shared, dutyPct: v } }))} className="w-20" />
          <span>%（按货值）</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span>国内运费（中国境内）：</span>
          <NumInput label="国内运费" value={state.shared.domesticFreight.amount} disabled={!editable} onChange={(v) => update((s) => ({ ...s, shared: { ...s.shared, domesticFreight: { ...s.shared.domesticFreight, amount: v } } }))} />
          <CurrencySelect label="国内运费币种" value={state.shared.domesticFreight.currency} disabled={!editable} onChange={(c) => update((s) => ensureFx({ ...s, shared: { ...s.shared, domesticFreight: { ...s.shared.domesticFreight, currency: c } } }, c))} />
        </div>
        <div className="text-xs text-muted">{QUOTE_STEP_TEXT.sharedNote}</div>
      </fieldset>

      <fieldset className="space-y-2 rounded-lg border border-border/60 px-3 py-2 text-sm" data-testid="line-presets">
        <legend className="px-1 text-xs text-muted">预置（每个项目可改、可关）</legend>
        <div className="text-xs text-muted">{QUOTE_STEP_TEXT.landedDefine}</div>
        <PresetRow label="资金使用" explain={PRESET_EXPLAIN_ZH.financing} included={state.presets.financing.included} disabled={!editable} onToggle={(b) => update((s) => ({ ...s, presets: { ...s.presets, financing: { ...s.presets.financing, included: b } } }))}>
          <span>年化</span>
          <NumInput label="资金使用年化比例" value={state.presets.financing.ratePct} disabled={!editable} onChange={(v) => update((s) => ({ ...s, presets: { ...s.presets, financing: { ...s.presets.financing, ratePct: v } } }))} className="w-16" />
          <span>% ×</span>
          <NumInput label="资金使用月数" value={state.presets.financing.months} disabled={!editable} onChange={(v) => update((s) => ({ ...s, presets: { ...s.presets, financing: { ...s.presets.financing, months: v } } }))} className="w-16" />
          <span>个月</span>
        </PresetRow>
        <PresetRow label="管理费" explain={PRESET_EXPLAIN_ZH.admin} included={state.presets.admin.included} disabled={!editable} onToggle={(b) => update((s) => ({ ...s, presets: { ...s.presets, admin: { ...s.presets.admin, included: b } } }))}>
          <NumInput label="管理费比例" value={state.presets.admin.ratePct} disabled={!editable} onChange={(v) => update((s) => ({ ...s, presets: { ...s.presets, admin: { ...s.presets.admin, ratePct: v } } }))} className="w-16" />
          <span>%</span>
        </PresetRow>
        <PresetRow label="现金备用金" explain={PRESET_EXPLAIN_ZH.cashAllowance} included={state.presets.cashAllowance.included} disabled={!editable} onToggle={(b) => update((s) => ({ ...s, presets: { ...s.presets, cashAllowance: { ...s.presets.cashAllowance, included: b } } }))}>
          <NumInput label="现金备用金比例" value={state.presets.cashAllowance.ratePct} disabled={!editable} onChange={(v) => update((s) => ({ ...s, presets: { ...s.presets, cashAllowance: { ...s.presets.cashAllowance, ratePct: v } } }))} className="w-16" />
          <span>%</span>
        </PresetRow>
        <PresetRow label="销售提成" explain={PRESET_EXPLAIN_ZH.commission} included={state.presets.commission.included} disabled={!editable} onToggle={(b) => update((s) => ({ ...s, presets: { ...s.presets, commission: { ...s.presets.commission, included: b } } }))}>
          <span>毛利 ×</span>
          <NumInput label="销售提成比例" value={state.presets.commission.ratePct} disabled={!editable} onChange={(v) => update((s) => ({ ...s, presets: { ...s.presets, commission: { ...s.presets.commission, ratePct: v } } }))} className="w-16" />
          <span>%</span>
        </PresetRow>
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
          <span>目标毛利率（按售价）：</span>
          <NumInput label="目标毛利率" value={state.targetMarginPct} disabled={!editable} onChange={(v) => update((s) => ({ ...s, targetMarginPct: v }))} className="w-16" />
          <span>%</span>
          <span className="basis-full text-xs text-muted">{QUOTE_STEP_TEXT.formula}</span>
        </div>
      </fieldset>

      {view.others.length > 0 ? (
        <Note testId="line-others">
          另有 {view.others.length} 条其它成本行（在专业模式里加的）：
          {view.others.map((o) => `${o.description}${o.included ? `（${money(o.amount)}）` : "（不计入）"}`).join("、")}。标了金额的已算进上面的报价合计和成本合计。
        </Note>
      ) : null}

      {error ? (
        <Note tone="error" testId="line-save-error">
          {error.message}
          {error.issues.length > 1 ? (
            <ul className="mt-1 list-disc pl-5">
              {error.issues.map((x) => (
                <li key={x.messageZh}>{x.messageZh}</li>
              ))}
            </ul>
          ) : null}
          {error.conflict ? <div className="mt-1">{QUOTE_STEP_TEXT.conflictHint}</div> : null}
        </Note>
      ) : null}
      {invalid.size > 0 ? (
        <Note tone="error" testId="line-invalid">
          有 {invalid.size} 个格子填的不是数字（标红的那几格），改好才能保存
        </Note>
      ) : null}
      {editable ? (
        <div className="flex gap-3">
          <button type="button" disabled={saving || !dirty || invalid.size > 0} className="rounded bg-accent px-4 py-1.5 text-sm text-[color:var(--on-accent)] hover:bg-accent-hover disabled:opacity-60" onClick={save} data-testid="line-save">
            {saving ? "正在保存…" : "保存"}
          </button>
          {dirty ? (
            <button
              type="button"
              className="text-sm text-muted"
              onClick={() => {
                setState(view.state);
                setDirty(false);
                setError(null);
                setInvalid(new Set());
                setResetKey((k) => k + 1);
              }}
            >
              {QUOTE_STEP_TEXT.discard}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
    </InvalidContext.Provider>
  );
}

function PresetRow({ label, explain, included, disabled, onToggle, children }: { label: string; explain: string; included: boolean; disabled: boolean; onToggle: (b: boolean) => void; children: ReactNode }) {
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

/* ---------------------------------- 容器 ---------------------------------- */

type ListState = { kind: "loading" } | { kind: "disabled" } | { kind: "error"; messageZh?: string | null } | { kind: "ready"; view: QuoteListView };

export function QuoteStep({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [list, setList] = useState<ListState>({ kind: "loading" });
  const [open, setOpen] = useState<LineModeView | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const base = `/api/projects/${encodeURIComponent(projectId)}/bid-page/quotes`;

  const loadList = useCallback(async () => {
    try {
      const res = await apiFetch(base, { cache: "no-store" });
      if (res.status === 404) return setList({ kind: "disabled" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return setList({ kind: "error", messageZh: typeof data?.error === "string" ? data.error : null });
      }
      setList({ kind: "ready", view: (await res.json()) as QuoteListView });
    } catch {
      setList({ kind: "error" });
    }
  }, [base]);
  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openQuote = useCallback(
    async (quoteId: string) => {
      setOpenError(null);
      try {
        const res = await apiFetch(`${base}/${encodeURIComponent(quoteId)}/line`, { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return setOpenError(String(data?.error ?? "这份报价没打开，请稍后再试"));
        setOpen(data as LineModeView);
      } catch {
        setOpenError("这份报价没打开（网络问题），请稍后再试");
      }
    },
    [base],
  );

  const create = useCallback(
    async (businessType: BusinessType, name: string): Promise<boolean> => {
      setCreating(true);
      setCreateError(null);
      try {
        const res = await apiFetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryMode: "LINE", businessType, name: name.trim() || null }) });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setCreateError(String(data?.error ?? "没建成，请稍后再试"));
          return false;
        }
        if (data.entryMode === "LINE") {
          await loadList();
          await openQuote(String(data.id));
        } else router.push(String(data.proModeHref));
        return true;
      } catch {
        setCreateError("没建成（网络问题），请稍后再试");
        return false;
      } finally {
        setCreating(false);
      }
    },
    [base, loadList, openQuote, router],
  );

  if (list.kind === "loading") return <Note>正在加载报价…</Note>;
  if (list.kind === "disabled") return <Note testId="quote-step-disabled">{QUOTE_STEP_TEXT.notEnabled}</Note>;
  if (list.kind === "error") return <Note tone="error">{list.messageZh ?? QUOTE_STEP_TEXT.loadFailed}</Note>;
  return (
    <div className="space-y-4" data-testid="quote-step">
      <QuoteListPanel view={list.view} onOpen={(q) => void openQuote(q.id)} onCreate={create} creating={creating} createError={createError} />
      {openError ? <Note tone="error">{openError}</Note> : null}
      {open ? (
        <LineQuoteEditor
          projectId={projectId}
          view={open}
          onSaved={(v) => {
            setOpen(v);
            void loadList();
          }}
          onClose={() => setOpen(null)}
        />
      ) : null}
      <ExportBar projectId={projectId} availability={list.view.export} />
    </div>
  );
}
