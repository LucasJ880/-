"use client";

import { useEffect, useState } from "react";
import { Loader2, AlertTriangle } from "lucide-react";
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
import { useFormDialog } from "@/lib/hooks/use-form-dialog";

interface ExistingCustomer {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
}

const INITIAL_FORM = {
  name: "",
  phone: "",
  email: "",
  address: "",
  source: "",
};

export function NewCustomerDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState(INITIAL_FORM);
  const [conflict, setConflict] = useState<ExistingCustomer | null>(null);
  const [merging, setMerging] = useState(false);
  const { loading: saving, error, setError, handleSubmit } = useFormDialog();

  // 每次打开都回到空白模版，避免看到上一条客户的残留
  useEffect(() => {
    if (open) {
      setForm(INITIAL_FORM);
      setConflict(null);
      setError(null);
    }
  }, [open, setError]);

  async function handleSave(mergeToCustomerId?: string) {
    if (!form.name.trim()) {
      setError("客户名称不能为空");
      return;
    }
    await handleSubmit(async () => {
      const res = await apiFetch("/api/sales/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ...(mergeToCustomerId ? { mergeToCustomerId } : {}),
        }),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        if (data?.existingCustomer) {
          setConflict(data.existingCustomer as ExistingCustomer);
          // 抛错阻断 handleSubmit 的 onSuccess / close
          throw new Error(
            `该电话号码已绑定到 "${data.existingCustomer.name}"`,
          );
        }
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "创建失败");
      }
    }, { onSuccess });
  }

  async function handleMerge() {
    if (!conflict) return;
    setMerging(true);
    try {
      await handleSave(conflict.id);
    } finally {
      setMerging(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新建客户</DialogTitle>
          <DialogDescription>添加新客户到 Sunny Shutter 销售系统</DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="name">客户名称 *</Label>
            <Input
              id="name"
              placeholder="例：John Smith"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="phone">电话</Label>
              <Input
                id="phone"
                placeholder="416-xxx-xxxx"
                value={form.phone}
                onChange={(e) => {
                  setForm({ ...form, phone: e.target.value });
                  // 改了电话号码就清掉冲突提示，重新校验
                  if (conflict) setConflict(null);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                placeholder="email@example.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="address">地址</Label>
            <Input
              id="address"
              placeholder="123 Main St, Toronto"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>来源</Label>
            <ShadSelect
              value={form.source}
              onValueChange={(v) => setForm({ ...form, source: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="请选择…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="referral">转介绍</SelectItem>
                <SelectItem value="google_ads">Google Ads</SelectItem>
                <SelectItem value="walk_in">上门</SelectItem>
                <SelectItem value="wechat">微信</SelectItem>
                <SelectItem value="phone">电话</SelectItem>
                <SelectItem value="other">其他</SelectItem>
              </SelectContent>
            </ShadSelect>
          </div>
        </div>

        {/* 电话重复时的合并提示 */}
        {conflict && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
            <div className="mb-1.5 flex items-center gap-1.5 font-medium text-amber-800">
              <AlertTriangle size={14} />
              该电话已存在客户：{conflict.name}
            </div>
            <div className="mb-2 space-y-0.5 text-xs text-amber-900/80">
              {conflict.phone && <div>电话：{conflict.phone}</div>}
              {conflict.address && (
                <div className="whitespace-pre-wrap">
                  已有地址：{conflict.address}
                </div>
              )}
            </div>
            <p className="mb-2 text-xs text-amber-900/70">
              老客户在新地址二次购买？可以把下面输入的新地址追加到这位客户：
              <span className="ml-1 font-medium text-amber-900">
                {form.address || "（未填写新地址）"}
              </span>
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleMerge}
                disabled={merging || saving || !form.address.trim()}
              >
                {merging && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                追加新地址到此客户
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConflict(null)}
                disabled={merging}
              >
                修改电话，创建新客户
              </Button>
            </div>
          </div>
        )}

        {error && !conflict && (
          <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={() => handleSave()}
            disabled={saving || merging || !!conflict}
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
