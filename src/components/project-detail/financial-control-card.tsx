"use client";

/**
 * T2-P1.5 / P1.6 Financial Control Card — 嵌入 Project Workbench。
 * 入口简单、信息很深：概览 tiles + 移动端「记一笔费用」全屏面板 + Accounting 审核
 * + 付款队列 + Tender 经营结果。feature dark（summary 404）时不渲染。移动优先（375px 可用）。
 *
 * P1.6：原 AddExpenseForm 由 MobileExpenseSheet 取代（严格超集：多币种 + FX 快照 +
 * 出资来源 + 金额人工确认 + camera/gallery 双通道 + 上传失败重试且不丢表单）。
 */
import { useCallback, useEffect, useState } from "react";
import { Wallet, Camera, Loader2, CheckCircle2, XCircle, HelpCircle, Plus, Trash2, Lock, Play, Banknote } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  BUDGET_LINE_CATEGORIES,
  PERCENTAGE_BUDGET_CATEGORIES,
} from "@/lib/project-finance/types";
import { MobileExpenseSheet } from "./mobile-expense-sheet";
import { PaymentQueuePanel, TenderOutcomePanel } from "./finance-settlement-panels";

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
  const [tab, setTab] = useState<"overview" | "mine" | "budget" | "review" | "payments" | "outcome">("overview");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [canRecordPayment, setCanRecordPayment] = useState(false);

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
    // 付款权是独立第四权（RULE 6）：由服务端告知，不从 canReview 推断
    const pRes = await apiFetch(`/api/projects/${projectId}/finance/payables`);
    if (pRes.ok) {
      const d = (await pRes.json()) as { canRecordPayment?: boolean };
      setCanRecordPayment(Boolean(d.canRecordPayment));
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

      {/* 移动端主入口：记一笔费用（44px+ 触控目标，全宽，永远在最上面） */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        data-testid="quick-record-expense"
        className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-accent text-[15px] font-medium text-[color:var(--on-accent)]"
      >
        <Camera size={17} /> 记一笔费用
      </button>

      {/* 分段导航（移动优先，自动换行） */}
      <div className="mt-3 flex flex-wrap gap-1 rounded-lg bg-muted/40 p-1 text-xs">
        {([
          ["overview", "概览"],
          ["mine", "我的费用"],
          ["budget", "预算"],
          ...(canReview ? [["review", "费用审核"] as const] : []),
          ["payments", "付款"],
          ["outcome", "经营结果"],
        ] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k as typeof tab)}
            className={`min-h-[36px] flex-1 whitespace-nowrap rounded-md px-2 py-1.5 ${tab === k ? "bg-accent text-[color:var(--on-accent)]" : "text-muted"}`}>
            {label}
          </button>
        ))}
      </div>

      {err && <p className="mt-2 break-words rounded-md bg-danger-bg px-3 py-2 text-xs text-danger">{err}</p>}

      {sheetOpen && (
        <MobileExpenseSheet
          projectId={projectId}
          onClose={() => setSheetOpen(false)}
          onSaved={() => { void load(); }}
        />
      )}

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

      {tab === "mine" && (
        <MyExpenseList expenses={expenses} currentUserId={currentUserId} canReview={canReview} />
      )}

      {tab === "budget" && (
        <BudgetPanel projectId={projectId} summary={summary} setErr={setErr} onChanged={load} />
      )}

      {tab === "review" && canReview && (
        <ReviewList projectId={projectId} pending={pending} currentUserId={currentUserId}
          busy={busy} setBusy={setBusy} setErr={setErr} onDone={load} />
      )}

      {tab === "payments" && (
        <PaymentQueuePanel projectId={projectId} canRecordPayment={canRecordPayment} setErr={setErr} />
      )}

      {tab === "outcome" && <TenderOutcomePanel projectId={projectId} setErr={setErr} />}
    </div>
  );
}

/* ── 我的费用：Draft / Submitted / Needs Info / Approved / Rejected / 待报销 / 已付 ── */

function MyExpenseList({
  expenses,
  currentUserId,
  canReview,
}: {
  expenses: Expense[];
  currentUserId?: string;
  canReview: boolean;
}) {
  // 列表 API 对无审核权者已在服务端只返回本人；有审核权者本地再过滤成「我的」
  const mine = canReview && currentUserId
    ? expenses.filter((e) => e.submittedById === currentUserId)
    : expenses;

  if (mine.length === 0) return <p className="mt-3 text-sm text-muted">还没有费用记录。点上面「记一笔费用」开始。</p>;
  return (
    <ul className="mt-3 space-y-2" data-testid="my-expense-list">
      {mine.map((e) => (
        <li key={e.id} className="rounded-lg border border-border p-2.5">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm text-foreground">
                {e.vendorName ?? e.costCategory} · {e.currency} {e.totalAmount}
              </div>
              <div className="truncate text-xs text-muted">{e.description}</div>
            </div>
            <span className="shrink-0 rounded-full bg-muted/40 px-2 py-0.5 text-[11px] text-foreground">
              {STATUS_LABEL[e.status] ?? e.status}
            </span>
          </div>
          {e.status === "APPROVED" && (
            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted">
              <Banknote size={12} /> 已批准为项目成本；是否已打款见「付款」页
            </p>
          )}
        </li>
      ))}
    </ul>
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
