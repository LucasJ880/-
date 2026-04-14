"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { STAGES } from "./types";

export function NewOpportunityDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    customerId: "",
    title: "",
    stage: "new_lead",
    estimatedValue: "",
    productTypes: "",
    priority: "warm",
  });
  const [customerOptions, setCustomerOptions] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    apiFetch("/api/sales/customers")
      .then((r) => r.json())
      .then((d) => {
        setCustomerOptions(
          (d.customers || []).map((c: { id: string; name: string }) => ({
            id: c.id,
            name: c.name,
          }))
        );
      })
      .catch(() => {});
  }, [open]);

  async function handleSave() {
    if (!form.customerId || !form.title.trim()) {
      setError("请选择客户并填写标题");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/sales/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          estimatedValue: form.estimatedValue || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建失败");
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建销售机会</DialogTitle>
          <DialogDescription>为客户创建新的销售跟进机会</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>客户 *</Label>
            <ShadSelect
              value={form.customerId}
              onValueChange={(v) => setForm({ ...form, customerId: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择客户…" />
              </SelectTrigger>
              <SelectContent>
                {customerOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </ShadSelect>
          </div>
          <div className="space-y-1.5">
            <Label>标题 *</Label>
            <Input
              placeholder="例：客厅窗帘报价"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>阶段</Label>
              <ShadSelect
                value={form.stage}
                onValueChange={(v) => setForm({ ...form, stage: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            </div>
            <div className="space-y-1.5">
              <Label>优先级</Label>
              <ShadSelect
                value={form.priority}
                onValueChange={(v) => setForm({ ...form, priority: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hot">热</SelectItem>
                  <SelectItem value="warm">温</SelectItem>
                  <SelectItem value="cold">冷</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>预估金额 ($)</Label>
              <Input
                type="number"
                placeholder="0"
                value={form.estimatedValue}
                onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>产品类型</Label>
              <Input
                placeholder="Zebra, Roller…"
                value={form.productTypes}
                onChange={(e) => setForm({ ...form, productTypes: e.target.value })}
              />
            </div>
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
