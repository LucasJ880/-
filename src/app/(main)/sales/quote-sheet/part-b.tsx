"use client";

import { useCallback, useMemo } from "react";
import type { PartBAddon, PaymentMethod } from "./types";
import { HST_RATE } from "./types";
import { cn } from "@/lib/utils";
import { Plus, Trash2 } from "lucide-react";
import { PencilCanvas, type PencilCanvasRef } from "@/components/pencil-canvas";
import { ADDON_CATALOG } from "@/lib/blinds/pricing-addons";
import { formatCAD } from "@/lib/blinds/pricing-engine";

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
  subtotalC: number;
  signatureRef: React.RefObject<PencilCanvasRef | null>;
  onSignatureChange?: (strokeCount: number) => void;
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
  balanceAmount,
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
  const optionalC = subtotalC;
  const preTax = grandSubtotal + optionalC;
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
                    onChange={(e) => updateAddon(a.id, "skuItem", e.target.value)}
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
                      onChange={(e) => updateAddon(a.id, "skuItem", e.target.value)}
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
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Deposit (40%):</span>
                  <input
                    type="text"
                    value={depositAmount}
                    onChange={(e) => onDepositChange(e.target.value)}
                    className="mt-0.5 w-full rounded border border-border px-2 py-1 text-xs min-h-[44px]"
                    placeholder="$"
                  />
                </div>
                <div>
                  <span className="text-muted-foreground">Balance (60%):</span>
                  <input
                    type="text"
                    value={balanceAmount}
                    onChange={(e) => onBalanceChange(e.target.value)}
                    className="mt-0.5 w-full rounded border border-border px-2 py-1 text-xs min-h-[44px]"
                    placeholder="$"
                  />
                </div>
              </div>
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
              <span className="text-muted-foreground">Optional — SUBTOTAL (C):</span>
              <span>{formatCAD(optionalC)}</span>
            </div>
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
