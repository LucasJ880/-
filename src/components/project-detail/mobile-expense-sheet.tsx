"use client";

/**
 * T2-P1.6 移动端「记一笔费用」全屏面板 —— 375px 为真实验收尺寸。
 *
 * 目标：普通成员（销售 / PM / 现场 / 估价 / 管理层）20–30 秒完成一笔记录。
 * 顺序：拍照 → 金额 + 币种 → 类别 → 谁付的钱 → 日期/商家/备注 → 提交。
 *
 * 移动交互硬要求（任务书 §13.1）：
 * - 375px 无横向滚动：全部单列 + `min-w-0` + `break-words`
 * - 输入 font-size ≥ 16px（`text-[16px]`）—— 小于 16px 会触发 iOS Safari 自动放大
 * - 触控目标 ≥ 44px（`min-h-[44px]`）
 * - 金额走数字键盘（`inputMode="decimal"`）
 * - camera-first：`capture="environment"`，另给「从相册/文件选」与 PDF 通道
 * - 上传有 progress / failure / retry，且**上传失败绝不丢已填表单**
 *   （先建 DRAFT 落库 → 再传票据 → 最后提交；失败停在草稿态可重试）
 * - 币种切换显眼；非 CAD 时显示「≈ 预估 CAD」并**明确标注预估**，与最终结算视觉分离
 */
import { useMemo, useRef, useState } from "react";
import { Camera, Check, ImageIcon, Loader2, RefreshCw, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  EXPENSE_COST_CATEGORIES,
  EXPENSE_FUNDING_SOURCES,
  FUNDING_SOURCE_LABELS,
  type ExpenseFundingSource,
} from "@/lib/project-finance/types";
import { SUPPORTED_EXPENSE_CURRENCIES } from "@/lib/project-finance/money";

const CATEGORY_LABELS: Record<string, string> = {
  INTERNAL_LABOR: "内部工时",
  SITE_VISIT: "踏勘 / 现场",
  MILEAGE: "里程",
  PARKING: "停车",
  SAMPLE: "样品",
  COURIER: "快递",
  BOND_INSURANCE: "保证金 / 保险",
  CONSULTANT: "顾问",
  SUPPLIER: "供应商",
  SUBCONTRACTOR: "分包",
  OTHER: "其它",
};

const CURRENCY_SYMBOL: Record<string, string> = { CAD: "$", CNY: "¥", USD: "US$" };

type UploadState = "idle" | "uploading" | "done" | "failed";

/** 纯展示用的预估折算（权威折算恒在服务端 Decimal 完成；此处仅为让用户看懂数量级）。 */
function previewCad(amount: string, rate: string): string | null {
  const a = Number(amount);
  const r = Number(rate);
  if (!Number.isFinite(a) || !Number.isFinite(r) || a <= 0 || r <= 0) return null;
  return (a * r).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function MobileExpenseSheet({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<string>("CAD");
  const [fxRate, setFxRate] = useState("");
  const [category, setCategory] = useState<string>("SUPPLIER");
  const [fundingSource, setFundingSource] = useState<ExpenseFundingSource>("EMPLOYEE_PERSONAL");
  const [occurredAt, setOccurredAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [vendor, setVendor] = useState("");
  const [note, setNote] = useState("");
  const [amountConfirmed, setAmountConfirmed] = useState(false);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  /** 已落库的草稿 id —— 上传失败后重试用，保证表单内容不丢 */
  const [draftId, setDraftId] = useState<string | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const isBase = currency === "CAD";
  const symbol = CURRENCY_SYMBOL[currency] ?? "";
  const estimate = useMemo(
    () => (isBase ? null : previewCad(amount, fxRate)),
    [isBase, amount, fxRate],
  );

  const inputClass =
    "mt-1 w-full min-h-[44px] rounded-lg border border-border bg-background px-3 py-2 text-[16px] text-foreground";

  const uploadReceipt = async (expenseId: string): Promise<boolean> => {
    if (!file) return true;
    setUploadState("uploading");
    const fd = new FormData();
    fd.append("file", file);
    const res = await apiFetch(`/api/projects/${projectId}/finance/expenses/${expenseId}/receipt`, {
      method: "POST",
      body: fd,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(`票据上传失败：${body.error ?? "请重试"}（费用已存为草稿，内容未丢失）`);
      setUploadState("failed");
      return false;
    }
    setUploadState("done");
    return true;
  };

  const submit = async () => {
    setErr(null);
    if (!amount || Number(amount) <= 0) return setErr("金额必须为正数");
    if (!amountConfirmed) return setErr("请先确认金额（金额必须由你本人确认，不能由识别结果自动提交）");
    if (!isBase && (!fxRate || Number(fxRate) <= 0)) {
      return setErr(`请填写汇率：1 ${currency} = ? CAD`);
    }
    if (!note.trim() && !vendor.trim()) return setErr("请填写商家或备注，便于财务识别");

    setSaving(true);
    try {
      let expenseId = draftId;

      // ① 先落 DRAFT（不提交）—— 之后即使票据上传失败，已填内容也在服务端安全存着
      if (!expenseId) {
        const res = await apiFetch(`/api/projects/${projectId}/finance/expenses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            costCategory: category,
            totalAmount: amount,
            currency,
            ...(isBase ? {} : { fxRateCadPerOriginalUnit: fxRate, fxRateSource: "MANUAL" }),
            fundingSource,
            vendorName: vendor.trim() || null,
            expenseOccurredAt: occurredAt,
            description: note.trim() || vendor.trim(),
            submit: false,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          setErr(body.error ?? "保存失败");
          return;
        }
        const { expense } = (await res.json()) as { expense: { id: string } };
        expenseId = expense.id;
        setDraftId(expenseId);
      }

      // ② 票据（可失败可重试；失败时停在草稿态）
      const uploaded = await uploadReceipt(expenseId);
      if (!uploaded) return;

      // ③ 提交进入审核
      const sub = await apiFetch(`/api/projects/${projectId}/finance/expenses/${expenseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit" }),
      });
      if (!sub.ok) {
        const body = (await sub.json().catch(() => ({}))) as { error?: string };
        setErr(body.error ?? "提交失败（费用已存为草稿）");
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const retryUpload = async () => {
    if (!draftId) return;
    setErr(null);
    setSaving(true);
    try {
      await uploadReceipt(draftId);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      data-testid="mobile-expense-sheet"
      role="dialog"
      aria-label="记录费用"
    >
      {/* 头部 */}
      <div className="flex min-h-[52px] items-center justify-between border-b border-border px-3">
        <button
          type="button"
          onClick={onClose}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-muted"
          aria-label="关闭"
        >
          <X size={20} />
        </button>
        <span className="text-sm font-semibold text-foreground">记录费用</span>
        <span className="min-w-[44px]" />
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto px-3 pb-28 pt-3">
        {err && (
          <p className="mb-3 break-words rounded-lg bg-danger-bg px-3 py-2 text-[13px] text-danger">{err}</p>
        )}

        {/* ① 拍照优先 */}
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setUploadState("idle");
          }}
        />
        <input
          ref={galleryRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setUploadState("idle");
          }}
        />
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-border bg-card-bg text-[15px] text-foreground"
          >
            <Camera size={18} /> 拍票据
          </button>
          <button
            type="button"
            onClick={() => galleryRef.current?.click()}
            className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-border bg-card-bg text-[15px] text-foreground"
          >
            <ImageIcon size={18} /> 相册 / PDF
          </button>
        </div>
        {file && (
          <div className="mt-2 flex min-w-0 items-center gap-2 rounded-lg bg-muted/30 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{file.name}</span>
            {uploadState === "uploading" && <Loader2 size={15} className="animate-spin text-muted" />}
            {uploadState === "done" && <Check size={15} className="text-success" />}
            {uploadState === "failed" && (
              <button
                type="button"
                onClick={retryUpload}
                className="flex min-h-[36px] items-center gap-1 rounded-md border border-border px-2 text-[13px] text-foreground"
              >
                <RefreshCw size={13} /> 重试
              </button>
            )}
          </div>
        )}

        {/* ② 金额 + 币种 */}
        <div className="mt-4">
          <span className="text-[13px] text-muted">金额</span>
          <div className="mt-1 flex gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded-lg border border-border bg-background px-3">
              <span className="mr-1 shrink-0 text-[16px] text-muted">
                {symbol}
              </span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setAmountConfirmed(false);
                }}
                placeholder="0.00"
                aria-label="金额"
                className="min-h-[44px] w-full min-w-0 bg-transparent py-2 text-[16px] text-foreground outline-none"
              />
            </div>
            <select
              value={currency}
              onChange={(e) => {
                setCurrency(e.target.value);
                setAmountConfirmed(false);
                if (e.target.value === "CAD") setFxRate("");
              }}
              aria-label="币种"
              className="min-h-[44px] shrink-0 rounded-lg border border-border bg-background px-2 text-[16px] font-medium text-foreground"
            >
              {SUPPORTED_EXPENSE_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 非 CAD：汇率 + 预估（明确标注 estimated，与最终结算视觉分离） */}
        {!isBase && (
          <div className="mt-2 rounded-lg border border-dashed border-border bg-muted/20 p-3">
            <label className="block text-[13px] text-muted">
              汇率：1 {currency} = ? CAD
              <input
                inputMode="decimal"
                value={fxRate}
                onChange={(e) => setFxRate(e.target.value)}
                placeholder="0.1917"
                className={inputClass}
              />
            </label>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                预估
              </span>
              <span className="break-words text-[15px] font-semibold text-foreground">
                ≈ CAD ${estimate ?? "—"}
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted">
              这是按你填写的汇率预估的加币金额。银行最终实际结算金额与手续费由财务确认后入账，可能不同。
            </p>
          </div>
        )}

        {/* 金额确认（AI/OCR 不得自动提交金额） */}
        <button
          type="button"
          onClick={() => setAmountConfirmed((v) => !v)}
          aria-pressed={amountConfirmed}
          className={`mt-3 flex min-h-[48px] w-full items-center gap-2 rounded-xl border px-3 text-left text-[14px] ${
            amountConfirmed
              ? "border-success bg-success-bg text-success"
              : "border-border bg-card-bg text-foreground"
          }`}
        >
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
              amountConfirmed ? "border-success bg-success text-white" : "border-border"
            }`}
          >
            {amountConfirmed && <Check size={13} />}
          </span>
          <span className="min-w-0">
            我确认金额为 {symbol}
            {amount.trim().length > 0 ? amount : "—"} {currency}
          </span>
        </button>

        {/* ③ 费用类型 */}
        <label className="mt-4 block text-[13px] text-muted">
          费用类型
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
            {EXPENSE_COST_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c] ?? c}
              </option>
            ))}
          </select>
        </label>

        {/* ④ 谁付的钱 */}
        <div className="mt-4">
          <span className="text-[13px] text-muted">谁付的钱</span>
          <div className="mt-1 grid gap-1.5">
            {EXPENSE_FUNDING_SOURCES.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFundingSource(f)}
                aria-pressed={fundingSource === f}
                className={`flex min-h-[44px] items-center rounded-lg border px-3 text-left text-[14px] ${
                  fundingSource === f
                    ? "border-accent bg-accent/10 text-foreground"
                    : "border-border bg-card-bg text-muted"
                }`}
              >
                {FUNDING_SOURCE_LABELS[f]}
              </button>
            ))}
          </div>
          {fundingSource === "EMPLOYEE_PERSONAL" && (
            <p className="mt-1.5 text-[11px] leading-snug text-muted">
              财务批准后会自动生成一笔应报销给你的记录；批准 ≠ 已打款，实际到账以付款记录为准。
            </p>
          )}
        </div>

        {/* ⑤ 其余 */}
        <label className="mt-4 block text-[13px] text-muted">
          发生日期
          <input
            type="date"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="mt-3 block text-[13px] text-muted">
          商家 / 供应商
          <input
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
            placeholder="如 Impark、义乌某厂"
            className={inputClass}
          />
        </label>
        <label className="mt-3 block text-[13px] text-muted">
          备注
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="用途说明，便于财务核对"
            className={inputClass}
          />
        </label>
      </div>

      {/* 底部固定提交条 */}
      <div className="sticky bottom-0 border-t border-border bg-background px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          onClick={submit}
          disabled={saving}
          className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-accent text-[16px] font-medium text-[color:var(--on-accent)] disabled:opacity-60"
        >
          {saving && <Loader2 size={16} className="animate-spin" />}
          {uploadState === "failed" ? "重试并提交" : "提交费用"}
        </button>
      </div>
    </div>
  );
}
