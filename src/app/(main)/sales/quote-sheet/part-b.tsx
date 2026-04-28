"use client";

import { useCallback, useMemo, useState } from "react";
import type { PartBAddon, PaymentMethod } from "./types";
import { HST_RATE } from "./types";
import { cn } from "@/lib/utils";
import { Plus, Trash2, AlertTriangle, Lock, Unlock, ShieldCheck, Loader2 } from "lucide-react";
import { PencilCanvas, type PencilCanvasRef } from "@/components/pencil-canvas";
import { ADDON_CATALOG } from "@/lib/blinds/pricing-addons";
import { formatCAD } from "@/lib/blinds/pricing-engine";
import { apiFetch } from "@/lib/api-fetch";

interface PartBProps {
  addons: PartBAddon[];
  onAddonsChange: (addons: PartBAddon[]) => void;
  notes: string;
  onNotesChange: (notes: string) => void;
  paymentMethod: PaymentMethod;
  onPaymentMethodChange: (m: PaymentMethod) => void;
  depositAmount: string;
  onDepositChange: (v: string) => void;
  balanceAmount: string;
  onBalanceChange: (v: string) => void;
  financeEligible: string;
  onFinanceEligibleChange: (v: string) => void;
  financeApproved: string;
  onFinanceApprovedChange: (v: string) => void;
  financeDifference: string;
  onFinanceDifferenceChange: (v: string) => void;
  subtotalA: number;
  subtotalC: number; // 独立 Part C 已取消；此处表示最低安装/运费补差
  signatureRef: React.RefObject<PencilCanvasRef | null>;
  onSignatureChange?: (strokeCount: number) => void;
  // Special Promotion（税前直减，销售可手填）
  specialPromotion: string;
  onSpecialPromotionChange: (v: string) => void;
  totalMsrp: number; // 用于预览"相对 MSRP 的折扣率"
  productsPreTax: number; // = productsSubtotal + 安装补差（不含 Part B 自身）用于校验上限
  // Special Promotion 阈值（0~1 小数，从全局折扣设置拉取）
  promoWarnPct?: number;
  promoDangerPct?: number;
  promoMaxPct?: number;
  // 当前用户是否为管理员（admin/super_admin）；admin 不受 max 上限约束
  isAdmin?: boolean;
  // 含税总价（Direct Payment 下计算定金百分比的分母）
  grandTotal?: number;
  // 定金阈值（0~1 小数）
  depositWarnPct?: number;
  depositMinPct?: number;
  // 老板是否已配置解锁码（未配置时 < 最低阈值直接阻止且无法解锁）
  hasDepositOverrideCode?: boolean;
  // 本单定金"低于最低阈值"是否已通过 code 解锁
  depositUnlocked?: boolean;
  onDepositUnlockedChange?: (v: boolean) => void;
}

export function PartBForm({
  addons,
  onAddonsChange,
  notes,
  onNotesChange,
  paymentMethod,
  onPaymentMethodChange,
  depositAmount,
  onDepositChange,
  onBalanceChange,
  financeEligible,
  onFinanceEligibleChange,
  financeApproved,
  onFinanceApprovedChange,
  financeDifference,
  onFinanceDifferenceChange,
  subtotalA,
  subtotalC,
  signatureRef,
  onSignatureChange,
  specialPromotion,
  onSpecialPromotionChange,
  totalMsrp,
  productsPreTax,
  promoWarnPct,
  promoDangerPct,
  promoMaxPct,
  isAdmin = false,
  grandTotal = 0,
  depositWarnPct = 0.4,
  depositMinPct = 0.3,
  hasDepositOverrideCode = false,
  depositUnlocked = false,
  onDepositUnlockedChange,
}: PartBProps) {
  const catalogByKey = useMemo(
    () => Object.fromEntries(ADDON_CATALOG.map((a) => [a.key, a])),
    []
  );

  const updateAddon = useCallback(
    (id: string, field: keyof PartBAddon, value: unknown) => {
      onAddonsChange(
        addons.map((a) => {
          if (a.id !== id) return a;
          const updated = { ...a, [field]: value };
          if (field === "skuItem") {
            const def = catalogByKey[value as string];
            if (def) {
              updated.price = def.unitPrice;
              updated.total = (updated.qty || 1) * def.unitPrice;
            }
          }
          if (field === "qty" || field === "price") {
            updated.total = (updated.qty || 0) * (updated.price || 0);
          }
          return updated;
        })
      );
    },
    [addons, onAddonsChange, catalogByKey]
  );

  const addAddon = () => {
    onAddonsChange([
      ...addons,
      { id: crypto.randomUUID(), skuItem: "", qty: 1, price: 0, total: 0 },
    ]);
  };

  const removeAddon = (id: string) => {
    onAddonsChange(addons.filter((a) => a.id !== id));
  };

  const subtotalB = addons.reduce((s, a) => s + a.total, 0);
  const grandSubtotal = subtotalA + subtotalB;
  const installMinimumAdjustment = subtotalC;
  const promoNum = Math.max(0, parseFloat(specialPromotion) || 0);
  const preTax = Math.max(0, grandSubtotal + installMinimumAdjustment - promoNum);
  const hst = Math.round(preTax * HST_RATE * 100) / 100;
  const total = preTax + hst;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-bold">PART B — Add-ons & Payment</h2>

      {/* Add-on table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/30">
              <th className="px-3 py-2 text-left">SKU / ITEM</th>
              <th className="px-3 py-2 text-center w-20">QTY</th>
              <th className="px-3 py-2 text-right w-24">Price</th>
              <th className="px-3 py-2 text-right w-24">Total</th>
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {addons.map((a) => (
              <tr key={a.id} className="border-t border-border/50">
                <td className="px-2 py-1">
                  <select
                    value={a.skuItem}
                    onChange={(e) => {
                      const next = e.target.value;
                      onAddonsChange(
                        addons.map((x) => {
                          if (x.id !== a.id) return x;
                          // 切换回预设项时，重置 customName 并应用 catalog 价格
                          if (next !== "__custom") {
                            const def = catalogByKey[next];
                            return {
                              ...x,
                              skuItem: next,
                              customName: "",
                              price: def ? def.unitPrice : x.price,
                              total: (x.qty || 1) * (def ? def.unitPrice : x.price || 0),
                            };
                          }
                          // 进入 custom 模式：不动 price / customName
                          return { ...x, skuItem: "__custom" };
                        }),
                      );
                    }}
                    className="w-full bg-transparent border-0 outline-none text-sm min-h-[44px] px-1"
                  >
                    <option value="">Select add-on...</option>
                    {ADDON_CATALOG.map((cat) => (
                      <option key={cat.key} value={cat.key}>
                        {cat.displayName} — ${cat.unitPrice}
                      </option>
                    ))}
                    <option value="__custom">Custom item...</option>
                  </select>
                  {a.skuItem === "__custom" && (
                    <input
                      type="text"
                      value={a.customName ?? ""}
                      onChange={(e) => updateAddon(a.id, "customName", e.target.value)}
                      className="mt-1 w-full bg-transparent border-b border-dashed border-border outline-none text-xs px-1 min-h-[44px]"
                      placeholder="Enter custom item name"
                      autoFocus
                    />
                  )}
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    value={a.qty || ""}
                    onChange={(e) =>
                      updateAddon(a.id, "qty", parseInt(e.target.value) || 0)
                    }
                    className="w-full bg-transparent border-0 outline-none text-sm text-center min-h-[44px]"
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="number"
                    step="0.01"
                    value={a.price || ""}
                    onChange={(e) =>
                      updateAddon(a.id, "price", parseFloat(e.target.value) || 0)
                    }
                    className="w-full bg-transparent border-0 outline-none text-sm text-right min-h-[44px]"
                  />
                </td>
                <td className="px-3 py-1 text-right font-mono">
                  {a.total > 0 ? `$${a.total.toFixed(2)}` : "—"}
                </td>
                <td className="px-1 py-1">
                  <button
                    onClick={() => removeAddon(a.id)}
                    className="p-1 text-muted-foreground hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-border/50 p-2">
          <button
            onClick={addAddon}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-teal-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add item
          </button>
        </div>
      </div>

      <div className="flex justify-end">
        <div className="text-sm">
          <span className="text-muted-foreground mr-3">SUBTOTAL (B):</span>
          <span className="font-bold">{formatCAD(subtotalB)}</span>
        </div>
      </div>

      {/* Special Promotion（销售手填让利，税前直减） */}
      <SpecialPromotionRow
        value={specialPromotion}
        onChange={onSpecialPromotionChange}
        totalMsrp={totalMsrp}
        productsPreTax={productsPreTax}
        warnPct={promoWarnPct}
        dangerPct={promoDangerPct}
        maxPct={promoMaxPct}
        isAdmin={isAdmin}
      />

      {/* Notes */}
      <div>
        <label className="text-sm font-medium text-muted-foreground">NOTES:</label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-border bg-white/60 px-3 py-2 text-sm outline-none min-h-[66px]"
          placeholder="Additional notes..."
        />
      </div>

      {/* Payment methods + totals side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment method */}
        <div className="space-y-4 rounded-lg border border-border bg-white/60 p-4">
          <h3 className="text-sm font-semibold">Payment Method</h3>

          <label
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
              paymentMethod === "direct"
                ? "border-teal-400 bg-teal-50"
                : "border-border hover:border-teal-200"
            )}
          >
            <input
              type="radio"
              checked={paymentMethod === "direct"}
              onChange={() => onPaymentMethodChange("direct")}
              className="mt-1"
            />
            <div className="flex-1 space-y-2">
              <span className="text-sm font-medium">Method 1 — Direct Payment</span>
              <DirectPaymentBlock
                depositAmount={depositAmount}
                onDepositChange={onDepositChange}
                onBalanceChange={onBalanceChange}
                grandTotal={grandTotal}
                depositWarnPct={depositWarnPct}
                depositMinPct={depositMinPct}
                hasDepositOverrideCode={hasDepositOverrideCode}
                depositUnlocked={depositUnlocked}
                onDepositUnlockedChange={onDepositUnlockedChange}
                isAdmin={isAdmin}
                active={paymentMethod === "direct"}
              />
            </div>
          </label>

          <label
            className={cn(
              "flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors",
              paymentMethod === "finance"
                ? "border-teal-400 bg-teal-50"
                : "border-border hover:border-teal-200"
            )}
          >
            <input
              type="radio"
              checked={paymentMethod === "finance"}
              onChange={() => onPaymentMethodChange("finance")}
              className="mt-1"
            />
            <div className="flex-1 space-y-2">
              <span className="text-sm font-medium">Method 2 — Finance (Financeit)</span>
              <p className="text-[10px] text-muted-foreground">
                For product charges totaling $2,000 or more, before tax
              </p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Required Payment (fee+tax):</span>
                  <input
                    type="text"
                    value={depositAmount}
                    onChange={(e) => onDepositChange(e.target.value)}
                    className="mt-0.5 w-full rounded border border-border px-2 py-1 text-xs min-h-[44px]"
                    placeholder="$"
                  />
                </div>
                <div>
                  <span className="text-muted-foreground">Eligible (A+B):</span>
                  <input
                    type="text"
                    value={financeEligible}
                    onChange={(e) => onFinanceEligibleChange(e.target.value)}
                    className="mt-0.5 w-full rounded border border-border px-2 py-1 text-xs min-h-[44px]"
                    placeholder="$"
                  />
                </div>
                <div>
                  <span className="text-muted-foreground">Approved:</span>
                  <input
                    type="text"
                    value={financeApproved}
                    onChange={(e) => onFinanceApprovedChange(e.target.value)}
                    className="mt-0.5 w-full rounded border border-border px-2 py-1 text-xs min-h-[44px]"
                    placeholder="$"
                  />
                </div>
                <div>
                  <span className="text-muted-foreground">Difference:</span>
                  <input
                    type="text"
                    value={financeDifference}
                    onChange={(e) => onFinanceDifferenceChange(e.target.value)}
                    className="mt-0.5 w-full rounded border border-border px-2 py-1 text-xs min-h-[44px]"
                    placeholder="$"
                  />
                </div>
              </div>
            </div>
          </label>
        </div>

        {/* Order totals */}
        <div className="space-y-3 rounded-xl border-2 border-teal-300 bg-gradient-to-br from-teal-50/80 to-white p-5">
          <h3 className="text-sm font-semibold">ORDER CHARGE</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">GRAND SUBTOTAL (A+B):</span>
              <span className="font-bold">{formatCAD(grandSubtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Install minimum adjustment:</span>
              <span>{formatCAD(installMinimumAdjustment)}</span>
            </div>
            {promoNum > 0 && (
              <div className="flex justify-between text-orange-700">
                <span>Special Promotion:</span>
                <span>− {formatCAD(promoNum)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-teal-200 pt-2">
              <span className="text-muted-foreground">
                HST (13%):
              </span>
              <span>{formatCAD(hst)}</span>
            </div>
            <div className="flex justify-between items-center text-lg font-bold text-teal-700 border-t border-teal-200 pt-2">
              <span>TOTAL:</span>
              <span>{formatCAD(total)}</span>
            </div>
          </div>

          <div className="border-t border-teal-200 pt-3 space-y-2">
            <p className="text-[10px] text-muted-foreground">
              DATE: {new Date().toLocaleDateString("en-CA")}
            </p>
            <PencilCanvas
              ref={signatureRef}
              width={500}
              height={120}
              label="Signature"
              onStrokesChange={onSignatureChange}
            />
            <p className="text-[9px] text-muted-foreground leading-snug">
              By signing, I confirm all details are correct and acknowledge that Sunny Shutter Inc. is not liable for inaccuracies. Custom-made items, returns or exchanges are only accepted if the product is defective.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Special Promotion 输入行 —— 销售在现场可手填的额外让利（税前直减）
 * - 不走折扣率系统，就是从 pre-tax 里直接扣钱
 * - 提示上限：不能超过 (productsPreTax + subtotalB)
 * - 右侧小字显示：让利后相对 MSRP 的总折扣率（近似值，实际服务端会重算）
 */
function SpecialPromotionRow({
  value,
  onChange,
  productsPreTax,
  warnPct = 0.06,
  dangerPct = 0.15,
  maxPct = 0.25,
  isAdmin = false,
}: {
  value: string;
  onChange: (v: string) => void;
  /** 仅为 API 兼容保留；已不再用于展示（销售端统一看税前口径）*/
  totalMsrp?: number;
  productsPreTax: number;
  warnPct?: number;
  dangerPct?: number;
  maxPct?: number;
  isAdmin?: boolean;
}) {
  const amount = Math.max(0, parseFloat(value) || 0);
  // 让利占产品税前比例（销售端统一看这一口径，不再与 MSRP 比较）
  const ratio = productsPreTax > 0 ? amount / productsPreTax : 0;
  // 分级：warn < danger < over（超过上限）
  const overMax = ratio > maxPct;
  const danger = !overMax && ratio > dangerPct;
  const warning = !overMax && !danger && ratio > warnPct;
  const accent = overMax
    ? "border-red-500 bg-red-50"
    : danger
      ? "border-amber-500 bg-amber-100/80"
      : warning
        ? "border-amber-300 bg-amber-50"
        : "border-orange-200 bg-orange-50/60";
  return (
    <div className={cn("rounded-lg border p-3 transition-colors", accent)}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <label className="text-sm font-semibold text-orange-800 block">
            Special Promotion
          </label>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-orange-700">$</span>
            <input
              type="number"
              min={0}
              step={10}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="0.00"
              className={cn(
                "w-28 rounded-md border bg-white px-2 py-1.5 pl-6 text-sm font-semibold outline-none focus:ring-2",
                overMax
                  ? "border-red-500 focus:ring-red-500"
                  : danger
                    ? "border-amber-500 focus:ring-amber-500"
                    : warning
                      ? "border-amber-400 focus:ring-amber-400"
                      : "border-orange-300 focus:ring-orange-500",
              )}
            />
          </div>
          {productsPreTax > 0 && (
            <div className="text-right">
              <div className="text-[10px] text-orange-700/80">相对税前价</div>
              <div className="text-sm font-bold text-orange-700">
                {(ratio * 100).toFixed(1)}%
              </div>
            </div>
          )}
        </div>
      </div>
      {overMax && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] font-medium text-red-800">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            Special Promotion 已达产品税前小计的{" "}
            <strong>{(ratio * 100).toFixed(1)}%</strong>
            （&gt;{Math.round(maxPct * 100)}%），
            {isAdmin
              ? "已超过公司设定的最高让利上限，请确认是否继续"
              : "已超过公司设定的最高让利上限，请联系管理员审核，或由管理员账号登录提交"}
            。
          </span>
        </div>
      )}
      {(warning || danger) && !overMax && (
        <div
          className={cn(
            "mt-2 flex items-start gap-1.5 text-[11px] font-medium",
            danger ? "text-amber-900" : "text-amber-800",
          )}
        >
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            Special Promotion 已达产品税前小计的{" "}
            <strong>{(ratio * 100).toFixed(1)}%</strong>
            {danger
              ? `（>${Math.round(dangerPct * 100)}%），让利过高，建议经理审核后再签单`
              : `（>${Math.round(warnPct * 100)}%），请确认是否符合公司让利政策`}
            。
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Method 1 — Direct Payment 子块
 * - Deposit 销售自己填（支持切换「$ 金额」/「% 百分比」两种输入模式）
 * - Balance 永远只读，= Grand Total − Deposit
 * - Deposit / Balance 标签旁实时显示百分比
 * - 低于 warnPct：黄色提醒
 * - 低于 minPct 且未解锁：红色阻止 + 解锁码输入框（admin 跳过）
 */
function DirectPaymentBlock({
  depositAmount,
  onDepositChange,
  onBalanceChange,
  grandTotal,
  depositWarnPct,
  depositMinPct,
  hasDepositOverrideCode,
  depositUnlocked,
  onDepositUnlockedChange,
  isAdmin,
  active,
}: {
  depositAmount: string;
  onDepositChange: (v: string) => void;
  onBalanceChange: (v: string) => void;
  grandTotal: number;
  depositWarnPct: number;
  depositMinPct: number;
  hasDepositOverrideCode: boolean;
  depositUnlocked: boolean;
  onDepositUnlockedChange?: (v: boolean) => void;
  isAdmin: boolean;
  active: boolean;
}) {
  const [mode, setMode] = useState<"amount" | "percent">("amount");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verifyErr, setVerifyErr] = useState<string | null>(null);

  const depositNum = Math.max(0, parseFloat(depositAmount) || 0);
  const balanceNum = Math.max(0, grandTotal - depositNum);
  const depositPct = grandTotal > 0 ? depositNum / grandTotal : 0;
  const balancePct = grandTotal > 0 ? balanceNum / grandTotal : 0;

  const below = grandTotal > 0 && depositPct < depositMinPct;
  const warn = grandTotal > 0 && !below && depositPct < depositWarnPct;

  const verifyCode = useCallback(async () => {
    if (!code.trim()) return;
    setVerifying(true);
    setVerifyErr(null);
    try {
      const res = await apiFetch("/api/sales/quote-settings/verify-deposit-code", {
        method: "POST",
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setVerifyErr(data?.error || "解锁码不正确");
        return;
      }
      onDepositUnlockedChange?.(true);
      setCode("");
    } catch {
      setVerifyErr("网络异常，请稍后重试");
    } finally {
      setVerifying(false);
    }
  }, [code, onDepositUnlockedChange]);

  const handlePercentChange = useCallback(
    (v: string) => {
      const pct = Math.max(0, Math.min(100, parseFloat(v) || 0));
      if (grandTotal <= 0) {
        onDepositChange("");
        return;
      }
      const amount = (grandTotal * pct) / 100;
      onDepositChange(amount.toFixed(2));
    },
    [grandTotal, onDepositChange],
  );

  // 切换 mode 不重置 deposit 值：amount 和 percent 展示同一数据的不同视图
  const currentPercentInput = grandTotal > 0 ? (depositPct * 100).toFixed(1) : "";

  // 视觉 accent
  const accent = below
    ? "border-red-400 bg-red-50/70"
    : warn
      ? "border-amber-400 bg-amber-50/70"
      : "border-transparent";

  return (
    <div className={cn("rounded-md border p-2 transition-colors", accent)}>
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1 text-[10px]">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setMode("amount");
            }}
            className={cn(
              "rounded px-1.5 py-0.5 font-medium transition-colors",
              mode === "amount" ? "bg-teal-600 text-white" : "text-muted-foreground hover:bg-slate-100",
            )}
          >
            $ 金额
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setMode("percent");
            }}
            className={cn(
              "rounded px-1.5 py-0.5 font-medium transition-colors",
              mode === "percent" ? "bg-teal-600 text-white" : "text-muted-foreground hover:bg-slate-100",
            )}
          >
            % 比例
          </button>
        </div>
        <span className="text-[10px] text-muted-foreground">
          含税总价 <span className="font-mono text-foreground">{formatCAD(grandTotal)}</span>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              Deposit{" "}
              <span className={cn(
                "ml-0.5 font-semibold",
                below ? "text-red-600" : warn ? "text-amber-700" : "text-teal-700",
              )}>
                ({(depositPct * 100).toFixed(1)}%)
              </span>
            </span>
          </div>
          {mode === "amount" ? (
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={depositAmount}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onDepositChange(e.target.value)}
              className={cn(
                "mt-0.5 w-full rounded border px-2 py-1 text-xs min-h-[44px] bg-white",
                below ? "border-red-400" : warn ? "border-amber-400" : "border-border",
              )}
              placeholder="$"
            />
          ) : (
            <div className="relative mt-0.5">
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={100}
                step="0.1"
                value={currentPercentInput}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => handlePercentChange(e.target.value)}
                className={cn(
                  "w-full rounded border px-2 py-1 pr-6 text-xs min-h-[44px] bg-white",
                  below ? "border-red-400" : warn ? "border-amber-400" : "border-border",
                )}
                placeholder="%"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
                %
              </span>
            </div>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">
              Balance{" "}
              <span className="ml-0.5 font-semibold text-teal-700">
                ({(balancePct * 100).toFixed(1)}%)
              </span>
            </span>
          </div>
          <input
            type="text"
            readOnly
            value={balanceNum > 0 ? `$${balanceNum.toFixed(2)}` : ""}
            onClick={(e) => {
              e.stopPropagation();
              // 读只字段也同步到父状态（防止老浏览器拦截）
              onBalanceChange(balanceNum > 0 ? balanceNum.toFixed(2) : "");
            }}
            tabIndex={-1}
            className="mt-0.5 w-full rounded border border-dashed border-border bg-slate-50 px-2 py-1 text-xs min-h-[44px] text-muted-foreground"
            placeholder="$"
            title="Balance 自动 = 含税总价 − Deposit"
          />
        </div>
      </div>

      {/* 状态提示条（仅当用户选中 Method 1 时高亮） */}
      {active && below && !isAdmin && !depositUnlocked && (
        <div className="mt-2 rounded-md border border-red-300 bg-white p-2">
          <div className="flex items-start gap-1.5 text-[11px] font-medium text-red-800">
            <Lock size={12} className="mt-0.5 shrink-0" />
            <span>
              定金低于公司最低比例 <strong>{Math.round(depositMinPct * 100)}%</strong>
              （当前 {(depositPct * 100).toFixed(1)}%），
              {hasDepositOverrideCode
                ? "请输入老板提供的解锁码才能保存。"
                : "且公司尚未配置解锁码，请提高定金或联系管理员。"}
            </span>
          </div>
          {hasDepositOverrideCode && (
            <div className="mt-2 flex items-center gap-2">
              <input
                type="password"
                value={code}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setCode(e.target.value)}
                placeholder="输入解锁码"
                className="flex-1 rounded border border-red-300 bg-white px-2 py-1 text-xs min-h-[36px]"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  void verifyCode();
                }}
                disabled={verifying || !code.trim()}
                className="inline-flex items-center gap-1 rounded bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {verifying ? <Loader2 className="animate-spin" size={12} /> : <Unlock size={12} />}
                解锁
              </button>
            </div>
          )}
          {verifyErr && <p className="mt-1 text-[10px] text-red-600">{verifyErr}</p>}
        </div>
      )}
      {active && below && (isAdmin || depositUnlocked) && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-[11px] font-medium text-emerald-800">
          <ShieldCheck size={12} className="mt-0.5 shrink-0" />
          <span>
            定金 {(depositPct * 100).toFixed(1)}% 低于最低比例{" "}
            {Math.round(depositMinPct * 100)}%，
            {isAdmin ? "已由管理员权限放行" : "已通过解锁码放行"}
            。
          </span>
        </div>
      )}
      {active && warn && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] font-medium text-amber-800">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span>
            定金 {(depositPct * 100).toFixed(1)}% 低于建议比例{" "}
            {Math.round(depositWarnPct * 100)}%，建议向客户争取提高定金以降低违约风险。
          </span>
        </div>
      )}
    </div>
  );
}
