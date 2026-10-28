"use client";

/**
 * INSTALL-2b：会计"待收尾款"页签
 * — 待收尾款：已安装 / 已完成且未确认尾款的工艺单；展开看收口照片（/api/install/tasks/{appointmentId}，会计持 install.task.read ORG）
 * — 确认收到尾款：实收（预填应收）/ 方式 / 日期 / 备注；与应收不一致时备注必填（服务端同样拦截）
 * — 最近已确认
 * 不链到 /blinds-orders/[id]：会计没有工艺单读权（design D5）。
 */

import { useCallback, useEffect, useState } from "react";
import { Camera, CheckCircle2, ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { BALANCE_METHOD_LABEL, BALANCE_METHODS, balanceMismatch, type BalanceMethod } from "@/lib/install/balance";
import type { InstallTaskDetailData } from "@/components/install/install-types";

export type BalancePendingRow = {
  orderId: string;
  code: string;
  status: string;
  customerName: string;
  salesName: string | null;
  installedAt: string | null;
  appointmentId: string | null;
  closeout: { total: number; completed: number };
  quoteId: string | null;
  expectedBalance: number | null;
};

export type BalanceConfirmedRow = {
  orderId: string;
  code: string;
  customerName: string;
  received: number;
  expected: number | null;
  method: string;
  receivedAt: string;
  note: string;
  confirmedByName: string | null;
  confirmedAt: string;
};

export type BalanceResp = { pending: BalancePendingRow[]; recentConfirmed: BalanceConfirmedRow[] };

const money = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
const day = (s: string | null) => (s ? new Date(s).toLocaleDateString("zh-CN") : "—");
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const methodLabel = (m: string) => BALANCE_METHOD_LABEL[m as BalanceMethod] ?? m;

export function BalanceTab({ data, focusOrderId, onChanged }: { data: BalanceResp; focusOrderId: string | null; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(focusOrderId);
  const [confirming, setConfirming] = useState<BalancePendingRow | null>(null);

  useEffect(() => {
    if (!focusOrderId) return;
    setOpen(focusOrderId);
    // 通知直达：滚到该行
    const el = typeof document !== "undefined" ? document.getElementById(`balance-row-${focusOrderId}`) : null;
    el?.scrollIntoView({ block: "center" });
  }, [focusOrderId]);

  const focusConfirmed = focusOrderId && !data.pending.some((r) => r.orderId === focusOrderId)
    ? data.recentConfirmed.find((r) => r.orderId === focusOrderId) ?? null
    : null;

  return (
    <div className="space-y-4">
      {focusConfirmed && (
        <p className="rounded-lg border border-[rgba(46,122,86,0.3)] bg-[rgba(46,122,86,0.06)] px-3 py-2 text-sm text-[#2e7a56]">
          {focusConfirmed.code} 的尾款已于 {day(focusConfirmed.confirmedAt)} 由 {focusConfirmed.confirmedByName ?? "—"} 确认
        </p>
      )}

      <div className="space-y-2">
        <p className="text-xs text-muted">已完成安装收口、尚未确认尾款的工艺单（应收尾款 = 报价约定尾款；没有约定时为总价 − 已登记定金）</p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card-bg text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">工艺单</th>
                <th className="px-3 py-2">客户</th>
                <th className="px-3 py-2">销售</th>
                <th className="px-3 py-2">安装完成</th>
                <th className="px-3 py-2">收口</th>
                <th className="px-3 py-2 text-right">应收尾款</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {data.pending.map((r) => (
                <PendingRow
                  key={r.orderId}
                  row={r}
                  open={open === r.orderId}
                  focused={focusOrderId === r.orderId}
                  onToggle={() => setOpen((cur) => (cur === r.orderId ? null : r.orderId))}
                  onConfirm={() => setConfirming(r)}
                />
              ))}
              {data.pending.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-xs text-muted">
                    没有待收尾款的单
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">最近已确认</p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-card-bg text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2">工艺单</th>
                <th className="px-3 py-2">客户</th>
                <th className="px-3 py-2 text-right">实收</th>
                <th className="px-3 py-2">方式</th>
                <th className="px-3 py-2">收款日期</th>
                <th className="px-3 py-2">确认</th>
              </tr>
            </thead>
            <tbody>
              {data.recentConfirmed.map((r) => (
                <tr key={r.orderId} id={`balance-row-${r.orderId}`} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-3 py-2 text-foreground">{r.customerName}</td>
                  <td className="px-3 py-2 text-right">
                    {money(r.received)}
                    {r.expected != null && balanceMismatch(r.expected, r.received) && (
                      <div className="text-[11px] text-[#a86a12]">应收 {money(r.expected)}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{methodLabel(r.method)}</td>
                  <td className="px-3 py-2 text-xs">{r.receivedAt}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.confirmedByName ?? "—"} · {day(r.confirmedAt)}
                    {r.note && <div className="mt-0.5 text-muted">{r.note}</div>}
                  </td>
                </tr>
              ))}
              {data.recentConfirmed.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-xs text-muted">
                    暂无记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {confirming && (
        <ConfirmDialog
          row={confirming}
          onClose={() => setConfirming(null)}
          onDone={() => {
            setConfirming(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function PendingRow({
  row,
  open,
  focused,
  onToggle,
  onConfirm,
}: {
  row: BalancePendingRow;
  open: boolean;
  focused: boolean;
  onToggle: () => void;
  onConfirm: () => void;
}) {
  const allClosed = row.closeout.total > 0 && row.closeout.completed === row.closeout.total;
  return (
    <>
      <tr id={`balance-row-${row.orderId}`} className={`border-t border-border ${focused ? "bg-accent-soft" : ""}`}>
        <td className="px-3 py-2">
          <button type="button" onClick={onToggle} className="flex items-center gap-1 font-mono text-xs text-accent" aria-expanded={open}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {row.code}
          </button>
        </td>
        <td className="px-3 py-2 text-foreground">{row.customerName}</td>
        <td className="px-3 py-2 text-xs">{row.salesName ?? "—"}</td>
        <td className="px-3 py-2 text-xs">{day(row.installedAt)}</td>
        <td className={`px-3 py-2 text-xs ${allClosed ? "text-[#2e7a56]" : "text-[#a86a12]"}`}>
          {row.closeout.completed}/{row.closeout.total}
        </td>
        <td className="px-3 py-2 text-right">{money(row.expectedBalance)}</td>
        <td className="px-3 py-2 text-right">
          <button
            type="button"
            onClick={onConfirm}
            className="whitespace-nowrap rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-[color:var(--on-accent)]"
          >
            确认收到尾款
          </button>
        </td>
      </tr>
      {open && (
        <tr className="border-t border-border bg-card-bg">
          <td colSpan={7} className="px-3 py-3">
            <CloseoutPhotos appointmentId={row.appointmentId} />
          </td>
        </tr>
      )}
    </>
  );
}

function CloseoutPhotos({ appointmentId }: { appointmentId: string | null }) {
  const [task, setTask] = useState<InstallTaskDetailData | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    if (!appointmentId) {
      setState("error");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/install/tasks/${appointmentId}`);
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { task: InstallTaskDetailData };
        if (!cancelled) {
          setTask(data.task);
          setState("ok");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted">
        <Loader2 size={14} className="animate-spin" /> 加载收口照片
      </div>
    );
  }
  if (state === "error" || !task) return <p className="text-xs text-muted">没有可查看的收口记录</p>;
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1 text-xs text-muted">
        <Camera size={13} /> 安装：{task.assignedTo.name} · 已收口 {task.closeout.completed}/{task.closeout.total} 项
        {task.completedAt && ` · 完成于 ${new Date(task.completedAt).toLocaleString("zh-CN")}`}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {task.windows.map((w) => (
          <div key={w.itemId} className="rounded-lg border border-border bg-background p-1.5">
            {w.latest ? (
              <a href={w.latest.proxyUrl} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={w.latest.proxyUrl} alt={`#${w.itemNumber} ${w.location} 收口照片`} className="h-24 w-full rounded object-cover" />
              </a>
            ) : (
              <div className="flex h-24 items-center justify-center rounded border border-dashed border-border text-[11px] text-muted">未收口</div>
            )}
            <div className="mt-1 truncate text-[11px] text-foreground">
              #{w.itemNumber} {w.location}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfirmDialog({ row, onClose, onDone }: { row: BalancePendingRow; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(row.expectedBalance != null ? row.expectedBalance.toFixed(2) : "");
  const [method, setMethod] = useState<BalanceMethod>("visa");
  const [receivedAt, setReceivedAt] = useState(localToday);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number(amount);
  const mismatch = Number.isFinite(amountNum) && amount.trim() !== "" && balanceMismatch(row.expectedBalance, amountNum);
  const canSubmit = !busy && amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0 && (!mismatch || note.trim() !== "");

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/accounting/balance/${row.orderId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: amountNum, method, receivedAt, note }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "确认失败");
        return;
      }
      onDone();
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }, [amountNum, method, note, onDone, receivedAt, row.orderId]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label="确认收到尾款">
      <div className="w-full max-w-md space-y-3 rounded-xl border border-border bg-card-bg p-4 shadow-lg">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">确认收到尾款</h2>
            <p className="mt-0.5 text-xs text-muted">
              {row.customerName} · {row.code} · 应收 {money(row.expectedBalance)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-muted" aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <label className="block text-xs text-muted">
          实收金额（CAD）
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="block text-xs text-muted">
          收款方式
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as BalanceMethod)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          >
            {BALANCE_METHODS.map((m) => (
              <option key={m} value={m}>
                {BALANCE_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-muted">
          收款日期
          <input
            type="date"
            value={receivedAt}
            max={localToday()}
            onChange={(e) => setReceivedAt(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        <label className="block text-xs text-muted">
          备注{mismatch && <span className="text-[#a86a12]">（实收与应收不一致，必须写明原因）</span>}
          <textarea
            value={note}
            maxLength={500}
            rows={2}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#2e7a56] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
          确认收到尾款
        </button>
        <p className="text-[11px] text-muted">确认后工艺单转为「已完成」，并通知该单销售。每张单只确认一次。</p>
      </div>
    </div>
  );
}
