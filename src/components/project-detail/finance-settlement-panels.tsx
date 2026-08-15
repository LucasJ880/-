"use client";

/**
 * T2-P1.6 结算 / 经营结果面板（嵌入 FinancialControlCard，移动优先 375px）
 *
 * PaymentQueuePanel  —— 付款队列：待付 / 部分已付 / 已付；记录付款需 PROJECT_PAYMENT_RECORD。
 * TenderOutcomePanel —— 单个 Tender 财务全景：投标成本 / 交付成本 / 收入 / 预测利润 / 最终利润。
 *
 * 视觉纪律：**预测（Forecast）与最终（Final）绝不混排**，最终利润不具备资格时明确显示
 * 「暂不可得」并列出缺什么证据，绝不用预测值冒充最终值。
 */
import { useCallback, useEffect, useState } from "react";
import { Banknote, Loader2, TrendingUp } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

type Payable = {
  id: string;
  expenseSubmissionId: string;
  settlementType: string;
  payeeType: string;
  payeeUserId: string | null;
  payeeName: string | null;
  amountCad: string;
  paidAmountCad: string;
  outstandingCad: string;
  status: string;
};

const SETTLEMENT_LABEL: Record<string, string> = {
  EMPLOYEE_REIMBURSEMENT: "员工报销",
  VENDOR_PAYMENT: "供应商付款",
  AFFILIATE_SETTLEMENT: "国内公司结算",
};

const PAYABLE_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "待付款",
  PARTIALLY_PAID: "部分已付",
  PAID: "已付清",
  VOID: "已作废",
};

const PAYMENT_METHOD_OPTIONS: Array<[string, string]> = [
  ["BANK_TRANSFER", "银行转账"],
  ["ETRANSFER", "e-Transfer"],
  ["PAYROLL", "随工资发放"],
  ["CHEQUE", "支票"],
  ["CASH", "现金"],
  ["OTHER", "其它"],
];

function cad(v: string | null | undefined): string {
  if (v == null) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return `CAD $${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PaymentQueuePanel({
  projectId,
  canRecordPayment,
  setErr,
}: {
  projectId: string;
  canRecordPayment: boolean;
  setErr: (s: string | null) => void;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [payables, setPayables] = useState<Payable[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/projects/${projectId}/finance/payables`);
    if (!res.ok) {
      setAvailable(false);
      return;
    }
    const d = (await res.json()) as { available: boolean; payables: Payable[] };
    setAvailable(d.available);
    setPayables(d.payables ?? []);
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (available === false) {
    return <p className="mt-3 text-sm text-muted">结算功能尚未在本环境启用。</p>;
  }
  if (payables.length === 0) {
    return <p className="mt-3 text-sm text-muted">当前没有待结算记录。</p>;
  }

  return (
    <div className="mt-3 space-y-2" data-testid="payment-queue">
      {payables.map((p) => (
        <div key={p.id} className="rounded-lg border border-border p-2.5">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm text-foreground">
                {SETTLEMENT_LABEL[p.settlementType] ?? p.settlementType}
                {p.payeeName ? ` · ${p.payeeName}` : ""}
              </div>
              <div className="mt-0.5 text-xs text-muted">
                应付 {cad(p.amountCad)} · 已付 {cad(p.paidAmountCad)} · 未付{" "}
                <span className="font-medium text-foreground">{cad(p.outstandingCad)}</span>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-muted/40 px-2 py-0.5 text-[11px] text-foreground">
              {PAYABLE_STATUS_LABEL[p.status] ?? p.status}
            </span>
          </div>

          {canRecordPayment && p.status !== "PAID" && p.status !== "VOID" && (
            <>
              <button
                type="button"
                onClick={() => setOpenId(openId === p.id ? null : p.id)}
                className="mt-2 flex min-h-[40px] items-center gap-1.5 rounded-md border border-border px-3 text-[13px] text-foreground"
              >
                <Banknote size={14} /> 记录付款
              </button>
              {openId === p.id && (
                <PaymentForm
                  projectId={projectId}
                  payable={p}
                  busy={busy}
                  setBusy={setBusy}
                  setErr={setErr}
                  onDone={async () => {
                    setOpenId(null);
                    await load();
                  }}
                />
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function PaymentForm({
  projectId,
  payable,
  busy,
  setBusy,
  setErr,
  onDone,
}: {
  projectId: string;
  payable: Payable;
  busy: boolean;
  setBusy: (b: boolean) => void;
  setErr: (s: string | null) => void;
  onDone: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(payable.outstandingCad);
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [paidAt, setPaidAt] = useState(() => new Date().toISOString().slice(0, 10));
  /**
   * 幂等键在打开表单时固定一次：双击提交 / 网络重试都会带同一个键，
   * 服务端据此收敛为同一条付款（绝不重复放款）。
   */
  const [clientKey] = useState(() => `${payable.id}-${payable.paidAmountCad}-${Date.now()}`);

  const submit = async () => {
    setErr(null);
    if (!amount || Number(amount) <= 0) return setErr("付款金额必须为正");
    setBusy(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/finance/payables/${payable.id}/payments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amountCad: amount,
            paymentMethod: method,
            paymentReference: reference || null,
            paidAt,
            clientKey,
          }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setErr(body.error ?? "记录付款失败");
        return;
      }
      await onDone();
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "mt-1 w-full min-h-[44px] rounded-lg border border-border bg-background px-3 py-2 text-[16px] text-foreground";

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-muted/20 p-2.5">
      <label className="block text-[13px] text-muted">
        付款金额（CAD）
        <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
      </label>
      <label className="block text-[13px] text-muted">
        付款方式
        <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputClass}>
          {PAYMENT_METHOD_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-[13px] text-muted">
          付款日期
          <input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-[13px] text-muted">
          流水号
          <input value={reference} onChange={(e) => setReference(e.target.value)} className={inputClass} />
        </label>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg bg-accent text-[15px] font-medium text-[color:var(--on-accent)] disabled:opacity-60"
      >
        {busy && <Loader2 size={15} className="animate-spin" />} 确认已付款
      </button>
    </div>
  );
}

/* ═══════════════════════ Tender 经营结果 ═══════════════════════ */

type TenderSummary = {
  outcome: string;
  bidCostCad: string;
  deliveryCostCad: string;
  totalCostCad: string;
  phaseSplitAvailable: boolean;
  phaseBoundarySource: string;
  unknownCurrencyCostCount: number;
  revenueAvailable: boolean;
  contractRevenueCad: string;
  approvedChangeOrdersCad: string;
  forecastRevenueCad: string;
  recognizedRevenueCad: string;
  settlementAvailable: boolean;
  outstandingReimbursementCad: string;
  outstandingPayablesCad: string;
  settlementStatus: string;
  employeeReimbursementOutstandingCad: string;
  vendorPayableOutstandingCad: string;
  affiliatePayableOutstandingCad: string;
  forecastProfitCad: string | null;
  forecastMarginPercentage: string | null;
  finalProfitCad: string | null;
  finalMarginPercentage: string | null;
  finalProfitEligible: boolean;
  finalProfitBlockers: string[];
  lostTenderSpendCad: string | null;
  primaryLossReason: string | null;
};

const OUTCOME_LABEL: Record<string, string> = {
  WON: "已中标",
  LOST: "未中标",
  PENDING: "等待结果",
  NOT_SUBMITTED: "未提交",
};

const BLOCKER_LABEL: Record<string, string> = {
  REVENUE_LEDGER_UNAVAILABLE: "收入账未启用",
  PROJECT_NOT_COMPLETED: "项目尚未完工",
};

function blockerText(b: string): string {
  const base = b.split("(")[0];
  if (base === "OUTCOME_NOT_WON") return "项目未中标";
  if (base === "REVENUE_NOT_FINAL") return "收入尚未定案";
  if (base === "UNRESOLVED_COST_CORRECTION") return "仍有未落实的承诺成本";
  if (base === "PENDING_COST_REVIEW") return "仍有待审费用";
  if (base === "UNKNOWN_CURRENCY_COST") return "存在未折算币种的成本行";
  if (base === "UNKNOWN_REVENUE_CURRENCY") return "存在未折算币种的收入行";
  return BLOCKER_LABEL[base] ?? base;
}

export function TenderOutcomePanel({
  projectId,
  setErr,
}: {
  projectId: string;
  setErr: (s: string | null) => void;
}) {
  const [data, setData] = useState<TenderSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await apiFetch(`/api/projects/${projectId}/finance/tender-summary`);
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setErr("无法加载经营结果");
        return;
      }
      setData((await res.json()) as TenderSummary);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, setErr]);

  if (loading) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" /> 加载中…
      </p>
    );
  }
  if (!data) return <p className="mt-3 text-sm text-muted">暂无数据。</p>;

  return (
    <div className="mt-3 space-y-3" data-testid="tender-outcome-panel">
      <div className="flex items-center gap-2">
        <TrendingUp size={15} className="text-accent/60" />
        <span className="text-sm font-medium text-foreground">{OUTCOME_LABEL[data.outcome] ?? data.outcome}</span>
      </div>

      {/* 成本 */}
      <div className="grid grid-cols-2 gap-2">
        <Cell label="投标阶段成本" value={cad(data.bidCostCad)} />
        <Cell label="交付阶段成本" value={cad(data.deliveryCostCad)} />
        <Cell label="总成本" value={cad(data.totalCostCad)} strong />
        <Cell
          label="未结应付"
          value={cad(
            data.settlementAvailable
              ? String(
                  Number(data.employeeReimbursementOutstandingCad) +
                    Number(data.vendorPayableOutstandingCad) +
                    Number(data.affiliatePayableOutstandingCad),
                )
              : null,
          )}
        />
      </div>
      {!data.phaseSplitAvailable && (
        <p className="text-[11px] leading-snug text-muted">
          该项目暂无可用的中标时间边界（来源：{data.phaseBoundarySource}），全部成本按投标阶段计入。
        </p>
      )}
      {data.unknownCurrencyCostCount > 0 && (
        <p className="text-[11px] leading-snug text-danger">
          有 {data.unknownCurrencyCostCount} 条成本缺少加币折算，已排除在合计之外。
        </p>
      )}

      {/* 未结应付明细 */}
      {data.settlementAvailable && (
        <div className="grid grid-cols-3 gap-2">
          <Cell label="待报销给员工" value={cad(data.employeeReimbursementOutstandingCad)} />
          <Cell label="待付供应商" value={cad(data.vendorPayableOutstandingCad)} />
          <Cell label="待与国内结算" value={cad(data.affiliatePayableOutstandingCad)} />
        </div>
      )}

      {/* 收入 */}
      {data.revenueAvailable ? (
        <div className="grid grid-cols-2 gap-2">
          <Cell label="合同收入" value={cad(data.contractRevenueCad)} />
          <Cell label="已批变更单" value={cad(data.approvedChangeOrdersCad)} />
          <Cell label="预测收入" value={cad(data.forecastRevenueCad)} />
          <Cell label="已确认收入" value={cad(data.recognizedRevenueCad)} />
        </div>
      ) : (
        <p className="text-[11px] leading-snug text-muted">收入账未启用，暂不能计算利润。</p>
      )}

      {/* 利润：预测与最终严格分区，绝不混排 */}
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3">
        <div className="flex items-baseline gap-2">
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">预测</span>
          <span className="text-[15px] font-semibold text-foreground">{cad(data.forecastProfitCad)}</span>
          {data.forecastMarginPercentage && (
            <span className="text-[12px] text-muted">毛利率 {data.forecastMarginPercentage}%</span>
          )}
        </div>
        <p className="mt-1 text-[11px] leading-snug text-muted">按当前预测收入减去已发生总成本；施工未结束前会变化。</p>
      </div>

      <div className="rounded-lg border border-border bg-card-bg p-3">
        <div className="flex items-baseline gap-2">
          <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">最终</span>
          {data.finalProfitEligible ? (
            <>
              <span className="text-[15px] font-semibold text-foreground">{cad(data.finalProfitCad)}</span>
              {data.finalMarginPercentage && (
                <span className="text-[12px] text-muted">毛利率 {data.finalMarginPercentage}%</span>
              )}
            </>
          ) : (
            <span className="text-[15px] font-semibold text-muted">暂不可得</span>
          )}
        </div>
        {!data.finalProfitEligible && data.finalProfitBlockers.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {data.finalProfitBlockers.map((b) => (
              <li key={b} className="text-[11px] leading-snug text-muted">
                · {blockerText(b)}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 结算：与利润**并列**，不是利润的前置条件（R1 §G）。
          「最终利润 CAD 282,000 + 结算 OPEN + 待报销 CAD 1,280」可以同时成立。 */}
      {data.settlementAvailable && (
        <div className="rounded-lg border border-border bg-card-bg p-3">
          <div className="flex items-baseline gap-2">
            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-medium text-sky-800">结算</span>
            <span className="text-[14px] font-medium text-foreground">
              {data.settlementStatus === "OPEN" ? "尚未结清" : "已结清"}
            </span>
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <Cell label="待报销给员工" value={cad(data.outstandingReimbursementCad)} />
            <Cell label="其余未结应付" value={cad(data.outstandingPayablesCad)} />
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-muted">
            这些钱是否已经付出去，不影响上面的项目利润 —— 费用一经批准就已计入项目成本。
          </p>
        </div>
      )}

      {/* 落标 */}
      {data.outcome === "LOST" && (
        <div className="rounded-lg border border-border p-3">
          <div className="text-[13px] text-foreground">本次投标共投入 {cad(data.lostTenderSpendCad)}</div>
          <div className="mt-1 text-[11px] text-muted">
            {data.primaryLossReason ? `已确认失败原因：${data.primaryLossReason}` : "失败原因尚未人工确认"}
          </div>
        </div>
      )}
    </div>
  );
}

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background/40 p-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`mt-0.5 break-words text-[13px] ${strong ? "font-semibold" : ""} text-foreground`}>{value}</div>
    </div>
  );
}
