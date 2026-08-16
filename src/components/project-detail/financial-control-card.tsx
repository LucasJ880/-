"use client";

/**
 * T2-P1.5 Financial Control Card — 嵌入 Project Workbench。
 * 入口简单、信息很深：概览 tiles + 移动端「添加费用/拍票据」+ Accounting 审核。
 * feature dark（summary 404）时不渲染。移动优先（375px 可用）。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Wallet, Camera, Loader2, CheckCircle2, XCircle, HelpCircle, Plus, Trash2, Lock, Play } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  EXPENSE_COST_CATEGORIES,
  BUDGET_LINE_CATEGORIES,
  PERCENTAGE_BUDGET_CATEGORIES,
} from "@/lib/project-finance/types";

type CategoryVsActual = {
  category: string;
  currentBudgetAmount: string;
  baselineAmount: string;
  actualAmount: string;
  varianceAmount: string;
  variancePercentage: number | null;
};

type Summary = {
  currency: string | null;
  hasActiveBudget: boolean;
  hasBaseline: boolean;
  activeVersionNumber: number | null;
  baselineVersionNumber: number | null;
  total: {
    baselineAmount: string;
    currentBudgetAmount: string;
    committedAmount: string;
    actualAmount: string;
    varianceAmount: string;
    variancePercentage: number | null;
  };
  byCategory: CategoryVsActual[];
  pendingReviewCount: number;
};

type Expense = {
  id: string;
  costCategory: string;
  vendorName: string | null;
  description: string;
  totalAmount: string;
  currency: string;
  status: string;
  submittedById: string;
  expenseOccurredAt: string;
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿", SUBMITTED: "已提交", PENDING_REVIEW: "待审核", NEEDS_INFO: "待补充",
  RESUBMITTED: "已重提", REJECTED: "已拒绝", APPROVED: "已批准",
};

function money(v: string | null | undefined, c: string | null): string {
  if (v == null) return "—";
  const n = Number(v);
  return `${c ?? ""} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`.trim();
}

export function FinancialControlCard({ projectId, currentUserId }: { projectId: string; currentUserId?: string }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [canReview, setCanReview] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"overview" | "add" | "budget" | "review">("overview");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/projects/${projectId}/finance/summary`);
    if (res.status === 404) { setEnabled(false); return; }
    setEnabled(true);
    if (res.ok) setSummary(((await res.json()) as { summary: Summary }).summary);
    const eRes = await apiFetch(`/api/projects/${projectId}/finance/expenses`);
    if (eRes.ok) {
      const d = (await eRes.json()) as { expenses: Expense[]; canReview: boolean };
      setExpenses(d.expenses);
      setCanReview(d.canReview);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  if (enabled === false) return null; // feature dark — 不渲染

  const t = summary?.total;
  const pending = expenses.filter((e) => e.status === "PENDING_REVIEW");

  return (
    <div className="rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="financial-control-card">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Wallet size={16} className="text-accent/60" /> 财务控制
        </h3>
        {canReview && summary && summary.pendingReviewCount > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
            待审 {summary.pendingReviewCount}
          </span>
        )}
      </div>

      {/* 分段导航（移动优先，自动换行） */}
      <div className="mt-3 flex flex-wrap gap-1 rounded-lg bg-muted/40 p-1 text-xs">
        {([["overview", "概览"], ["add", "添加费用"], ["budget", "预算"], ...(canReview ? [["review", "费用审核"] as const] : [])] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k as typeof tab)}
            className={`flex-1 whitespace-nowrap rounded-md px-2 py-1.5 ${tab === k ? "bg-accent text-[color:var(--on-accent)]" : "text-muted"}`}>
            {label}
          </button>
        ))}
      </div>

      {err && <p className="mt-2 rounded-md bg-danger-bg px-3 py-2 text-xs text-danger">{err}</p>}

      {tab === "overview" && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile label="中标基线" value={summary?.hasBaseline ? money(t?.baselineAmount, summary.currency) : "未冻结"} />
          <Tile label="当前预算" value={summary?.hasActiveBudget ? money(t?.currentBudgetAmount, summary?.currency ?? null) : "未设置"} />
          <Tile label="已承诺" value={money(t?.committedAmount, summary?.currency ?? null)} />
          <Tile label="实际" value={money(t?.actualAmount, summary?.currency ?? null)} />
          <Tile label="差异" value={money(t?.varianceAmount, summary?.currency ?? null)}
            hint={t?.variancePercentage != null ? `${t.variancePercentage}%` : undefined} />
          <Tile label="待审核" value={String(summary?.pendingReviewCount ?? 0)} />
        </div>
      )}

      {tab === "add" && (
        <AddExpenseForm projectId={projectId} onDone={() => { setTab("overview"); void load(); }} setErr={setErr} />
      )}

      {tab === "budget" && (
        <BudgetPanel projectId={projectId} summary={summary} setErr={setErr} onChanged={load} />
      )}

      {tab === "review" && canReview && (
        <ReviewList projectId={projectId} pending={pending} currentUserId={currentUserId}
          busy={busy} setBusy={setBusy} setErr={setErr} onDone={load} />
      )}
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 p-2.5">
      <div className="text-[11px] text-muted">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-foreground">{value}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

function AddExpenseForm({ projectId, onDone, setErr }: { projectId: string; onDone: () => void; setErr: (s: string | null) => void }) {
  const [category, setCategory] = useState<string>("SUPPLIER");
  const [amount, setAmount] = useState("");
  const [vendor, setVendor] = useState("");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [desc, setDesc] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    setErr(null);
    if (!amount || Number(amount) <= 0) { setErr("金额必须为正"); return; }
    if (!desc.trim()) { setErr("请填写费用说明"); return; }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/finance/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ costCategory: category, totalAmount: amount, vendorName: vendor || null, expenseOccurredAt: occurredAt, description: desc, submit: true }),
      });
      if (!res.ok) { setErr(((await res.json()) as { error?: string }).error ?? "提交失败"); return; }
      const { expense } = (await res.json()) as { expense: { id: string } };
      if (file && expense?.id) {
        const fd = new FormData(); fd.append("file", file);
        await apiFetch(`/api/projects/${projectId}/finance/expenses/${expense.id}/receipt`, { method: "POST", body: fd });
      }
      onDone();
    } finally { setSaving(false); }
  };

  return (
    <div className="mt-3 space-y-2.5">
      <label className="block text-xs text-muted">类别
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm">
          {EXPENSE_COST_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-muted">金额
          <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm" />
        </label>
        <label className="block text-xs text-muted">发生日期
          <input type="date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm" />
        </label>
      </div>
      <label className="block text-xs text-muted">供应商（可选）
        <input value={vendor} onChange={(e) => setVendor(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm" />
      </label>
      <label className="block text-xs text-muted">说明
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm" />
      </label>
      {/* 移动端拍票据：隐藏 camera input + gallery */}
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => cameraRef.current?.click()}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm text-foreground">
          <Camera size={15} /> {file ? "已选票据" : "拍/传票据"}
        </button>
        {file && <span className="truncate text-xs text-muted">{file.name}</span>}
      </div>
      <button onClick={submit} disabled={saving}
        className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2.5 text-sm font-medium text-[color:var(--on-accent)] disabled:opacity-60">
        {saving && <Loader2 size={15} className="animate-spin" />} 提交费用
      </button>
    </div>
  );
}

function ReviewList({ projectId, pending, currentUserId, busy, setBusy, setErr, onDone }: {
  projectId: string; pending: Expense[]; currentUserId?: string;
  busy: boolean; setBusy: (b: boolean) => void; setErr: (s: string | null) => void; onDone: () => Promise<void> | void;
}) {
  const act = async (expenseId: string, action: "approve" | "reject" | "request_info") => {
    setErr(null);
    let note = "";
    if (action !== "approve") {
      note = window.prompt(action === "reject" ? "拒绝理由" : "需补充的信息") ?? "";
      if (!note.trim()) return;
    }
    setBusy(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/finance/expenses/${expenseId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      if (!res.ok) setErr(((await res.json()) as { error?: string }).error ?? "操作失败");
      await onDone();
    } finally { setBusy(false); }
  };

  if (pending.length === 0) return <p className="mt-3 text-sm text-muted">无待审核费用。</p>;
  return (
    <ul className="mt-3 space-y-2">
      {pending.map((e) => {
        const isOwn = currentUserId && e.submittedById === currentUserId;
        return (
          <li key={e.id} className="rounded-lg border border-border p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm text-foreground">{e.vendorName ?? e.costCategory} · {e.currency} {e.totalAmount}</div>
                <div className="truncate text-xs text-muted">{e.description}</div>
              </div>
              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">{STATUS_LABEL[e.status]}</span>
            </div>
            {isOwn ? (
              <p className="mt-2 text-[11px] text-danger">不能审核自己提交的费用</p>
            ) : (
              <div className="mt-2 flex items-center gap-1.5">
                <button disabled={busy} onClick={() => act(e.id, "approve")}
                  className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs text-[color:var(--on-accent)] disabled:opacity-60"><CheckCircle2 size={13} /> 批准</button>
                <button disabled={busy} onClick={() => act(e.id, "request_info")}
                  className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-60"><HelpCircle size={13} /> 补充</button>
                <button disabled={busy} onClick={() => act(e.id, "reject")}
                  className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-danger disabled:opacity-60"><XCircle size={13} /> 拒绝</button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ── 预算：Budget vs Actual（按类别）+ 版本管理（create / activate / freeze baseline） ── */

type BudgetVersion = {
  id: string;
  versionNumber: number;
  status: string;
  totalBudgetAmount: string;
  note: string | null;
};
type DraftLine = { category: string; amount: string; note: string };

const VERSION_STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿", ACTIVE: "生效中", SUPERSEDED: "已被取代", AWARD_BASELINE: "中标基线",
};

// 百分比型类别（OVERHEAD/CONTINGENCY/PROFIT）需 basis，超出移动端简易录入范围 → 仅提供直接金额类别
const SIMPLE_BUDGET_CATEGORIES = BUDGET_LINE_CATEGORIES.filter(
  (c) => !(PERCENTAGE_BUDGET_CATEGORIES as readonly string[]).includes(c),
);

function BudgetPanel({ projectId, summary, setErr, onChanged }: {
  projectId: string;
  summary: Summary | null;
  setErr: (s: string | null) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [versions, setVersions] = useState<BudgetVersion[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([{ category: "MATERIAL", amount: "", note: "" }]);
  const currency = summary?.currency ?? null;

  const loadBudget = useCallback(async () => {
    const res = await apiFetch(`/api/projects/${projectId}/finance/budget`);
    if (res.ok) {
      const d = (await res.json()) as { versions?: BudgetVersion[]; canManage?: boolean };
      setVersions(d.versions ?? []);
      setCanManage(Boolean(d.canManage));
    }
  }, [projectId]);
  useEffect(() => { void loadBudget(); }, [loadBudget]);

  const refresh = async () => { await loadBudget(); await onChanged(); };

  const post = async (body: unknown) => {
    setErr(null); setBusy(true);
    try {
      const res = await apiFetch(`/api/projects/${projectId}/finance/budget`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (!res.ok) { setErr(((await res.json()) as { error?: string }).error ?? "操作失败"); return false; }
      await refresh();
      return true;
    } finally { setBusy(false); }
  };

  const createVersion = async () => {
    const clean = lines
      .filter((l) => l.amount && Number(l.amount) > 0)
      .map((l) => ({ category: l.category, amount: l.amount, note: l.note || null }));
    if (clean.length === 0) { setErr("请至少填写一条有效预算行（金额>0）"); return; }
    if (await post({ action: "create_version", currency: currency ?? "CAD", lines: clean })) {
      setShowCreate(false); setLines([{ category: "MATERIAL", amount: "", note: "" }]);
    }
  };

  const cat = summary?.byCategory ?? [];

  return (
    <div className="mt-3 space-y-3">
      {/* Budget vs Actual（按类别） */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-muted">预算 vs 实际（按类别）</div>
        {cat.length === 0 ? (
          <p className="text-xs text-muted">尚无生效预算或实际支出。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] text-muted">
                  <th className="py-1 pr-2 font-normal">类别</th>
                  <th className="py-1 pr-2 text-right font-normal">预算</th>
                  <th className="py-1 pr-2 text-right font-normal">实际</th>
                  <th className="py-1 text-right font-normal">差异</th>
                </tr>
              </thead>
              <tbody>
                {cat.map((c) => {
                  const over = Number(c.varianceAmount) < 0;
                  return (
                    <tr key={c.category} className="border-t border-border/60">
                      <td className="py-1 pr-2 text-foreground">{c.category}</td>
                      <td className="py-1 pr-2 text-right text-foreground">{money(c.currentBudgetAmount, currency)}</td>
                      <td className="py-1 pr-2 text-right text-foreground">{money(c.actualAmount, currency)}</td>
                      <td className={`py-1 text-right ${over ? "text-danger" : "text-foreground"}`}>{money(c.varianceAmount, currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 版本列表 */}
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium text-muted">预算版本</span>
          {canManage && (
            <button onClick={() => setShowCreate((v) => !v)}
              className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-foreground">
              <Plus size={12} /> 新建版本
            </button>
          )}
        </div>
        {versions.length === 0 ? (
          <p className="text-xs text-muted">尚未创建预算版本。</p>
        ) : (
          <ul className="space-y-1.5">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
                <div className="min-w-0">
                  <div className="text-xs text-foreground">v{v.versionNumber} · {money(v.totalBudgetAmount, currency)}</div>
                  {v.note && <div className="truncate text-[11px] text-muted">{v.note}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${v.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : v.status === "AWARD_BASELINE" ? "bg-indigo-100 text-indigo-800" : "bg-muted/60 text-muted"}`}>
                    {VERSION_STATUS_LABEL[v.status] ?? v.status}
                  </span>
                  {canManage && v.status === "DRAFT" && (
                    <button disabled={busy} onClick={() => post({ action: "activate", versionId: v.id })}
                      className="flex items-center gap-0.5 rounded-md border border-border px-1.5 py-1 text-[10px] disabled:opacity-60" title="激活为当前预算">
                      <Play size={11} /> 激活
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 冻结中标基线 */}
      {canManage && summary?.hasActiveBudget && !summary?.hasBaseline && (
        <button disabled={busy} onClick={() => post({ action: "freeze_baseline" })}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-800 disabled:opacity-60">
          <Lock size={13} /> 冻结中标基线（不可逆，永久保留原始成本假设）
        </button>
      )}

      {/* 新建版本表单 */}
      {canManage && showCreate && (
        <div className="space-y-2 rounded-lg border border-border bg-background/40 p-2.5">
          <div className="text-xs font-medium text-foreground">新建预算版本</div>
          {lines.map((l, i) => (
            <div key={i} className="flex items-end gap-1.5">
              <label className="min-w-0 flex-1 text-[11px] text-muted">类别
                <select value={l.category} onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, category: e.target.value } : x))}
                  className="mt-0.5 w-full rounded-md border border-border bg-background px-1.5 py-1.5 text-xs">
                  {SIMPLE_BUDGET_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="w-24 text-[11px] text-muted">金额
                <input inputMode="decimal" value={l.amount} placeholder="0.00"
                  onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))}
                  className="mt-0.5 w-full rounded-md border border-border bg-background px-1.5 py-1.5 text-xs" />
              </label>
              <button onClick={() => setLines((ls) => ls.length > 1 ? ls.filter((_, j) => j !== i) : ls)}
                className="mb-0.5 rounded-md border border-border p-1.5 text-muted disabled:opacity-40" disabled={lines.length <= 1} title="删除行">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
          <button onClick={() => setLines((ls) => [...ls, { category: "MATERIAL", amount: "", note: "" }])}
            className="flex items-center gap-1 text-[11px] text-accent">
            <Plus size={12} /> 添加行
          </button>
          <div className="flex items-center gap-2 pt-1">
            <button disabled={busy} onClick={createVersion}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-medium text-[color:var(--on-accent)] disabled:opacity-60">
              {busy && <Loader2 size={13} className="animate-spin" />} 创建草稿版本
            </button>
            <button onClick={() => setShowCreate(false)} className="rounded-md border border-border px-3 py-2 text-xs text-muted">取消</button>
          </div>
          <p className="text-[10px] text-muted">提示：OVERHEAD/CONTINGENCY/PROFIT 等百分比型预算行需计算基础，暂不支持移动端快速录入。</p>
        </div>
      )}
    </div>
  );
}
