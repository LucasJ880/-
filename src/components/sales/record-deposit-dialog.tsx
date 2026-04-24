"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type PaymentMethod = "cash" | "check" | "etransfer";

const METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "现金 Cash" },
  { value: "check", label: "支票 Check" },
  { value: "etransfer", label: "Email Transfer" },
];

export function RecordDepositDialog({
  open,
  onOpenChange,
  quoteId,
  grandTotal,
  /** Part B 签单时写入的约定定金（含税）；有则优先预填，无则 30% */
  agreedDepositAmount = null,
  agreedBalanceAmount = null,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quoteId: string;
  grandTotal: number;
  agreedDepositAmount?: number | null;
  agreedBalanceAmount?: number | null;
  onSaved: (payload: {
    depositAmount: number;
    depositMethod: string;
    depositCollectedAt: string;
    depositNote: string | null;
  }) => void;
}) {
  const defaultDeposit = useMemo(() => {
    if (
      agreedDepositAmount != null &&
      Number.isFinite(agreedDepositAmount) &&
      agreedDepositAmount >= 0
    ) {
      return Number(agreedDepositAmount.toFixed(2));
    }
    return Number((grandTotal * 0.3).toFixed(2));
  }, [grandTotal, agreedDepositAmount]);

  const hasAgreed =
    agreedDepositAmount != null &&
    Number.isFinite(agreedDepositAmount) &&
    agreedDepositAmount >= 0;

  const [amount, setAmount] = useState<string>("");
  const [method, setMethod] = useState<PaymentMethod>("etransfer");
  const [note, setNote] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAmount(defaultDeposit.toFixed(2));
      setMethod("etransfer");
      setNote("");
      setError(null);
    }
  }, [open, defaultDeposit]);

  const amountNum = Number(amount);
  const amountValid = Number.isFinite(amountNum) && amountNum >= 0;
  const balance = amountValid ? Math.max(0, Number((grandTotal - amountNum).toFixed(2))) : grandTotal;
  const pct = grandTotal > 0 && amountValid ? (amountNum / grandTotal) * 100 : 0;

  async function handleSave() {
    setError(null);
    if (!amountValid) {
      setError("请输入正确的金额");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/sales/quotes/${quoteId}/record-deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amountNum,
          method,
          note: note.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setError(data?.error || "登记失败，请重试");
        return;
      }
      onSaved({
        depositAmount: data.quote.depositAmount,
        depositMethod: data.quote.depositMethod,
        depositCollectedAt: data.quote.depositCollectedAt,
        depositNote: data.quote.depositNote,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "网络错误";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-orange-600" />
            登记定金收款
          </DialogTitle>
          <DialogDescription>
            客户已签字成单（订单总额 ${grandTotal.toFixed(2)}）。请登记
            <span className="font-medium">本次实际收到</span>
            的定金金额与支付方式（可与签单约定略有不同，如客户分笔支付）。系统会记入客户档案。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-orange-50 border border-orange-200 px-3 py-2.5 text-xs text-orange-900 leading-relaxed space-y-1.5">
            <p>
              订单总额 <span className="font-semibold">${grandTotal.toFixed(2)}</span>
              {amountValid && (
                <>
                  {" "}· 本次登记定金{" "}
                  <span className="font-semibold">${amountNum.toFixed(2)}</span>
                  {" "}（{pct.toFixed(1)}%）· 对应余款{" "}
                  <span className="font-semibold">${balance.toFixed(2)}</span>
                </>
              )}
            </p>
            {hasAgreed && agreedDepositAmount != null && (
              <p className="text-orange-950/90 border-t border-orange-200/80 pt-1.5">
                签单约定（Part B）：定金{" "}
                <span className="font-semibold">${agreedDepositAmount.toFixed(2)}</span>
                {agreedBalanceAmount != null &&
                Number.isFinite(agreedBalanceAmount) &&
                agreedBalanceAmount >= 0 ? (
                  <>
                    {" "}· 约定余款{" "}
                    <span className="font-semibold">${agreedBalanceAmount.toFixed(2)}</span>
                  </>
                ) : null}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="deposit-amount">本次实收定金 (CAD)</Label>
            <Input
              id="deposit-amount"
              type="number"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={saving}
              placeholder={
                hasAgreed
                  ? `默认 ${defaultDeposit.toFixed(2)}（签单约定）`
                  : `默认 ${defaultDeposit.toFixed(2)}（约 30%）`
              }
            />
          </div>

          <div className="space-y-2">
            <Label>支付方式</Label>
            <ShadSelect value={method} onValueChange={(v) => setMethod(v as PaymentMethod)} disabled={saving}>
              <SelectTrigger>
                <SelectValue placeholder="请选择支付方式" />
              </SelectTrigger>
              <SelectContent>
                {METHOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </ShadSelect>
          </div>

          <div className="space-y-2">
            <Label htmlFor="deposit-note">备注（可选）</Label>
            <Input
              id="deposit-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={saving}
              placeholder="如支票号、转账参考号等"
              maxLength={200}
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || !amountValid}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
            确认登记
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
