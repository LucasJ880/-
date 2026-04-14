"use client";

import { useState } from "react";
import { Loader2, WifiOff } from "lucide-react";
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
import { useOnlineStatus } from "@/lib/offline/hooks";
import { offlineDb } from "@/lib/offline/db";
import { enqueue } from "@/lib/offline/sync-engine";

export function NewCustomerDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    source: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOnline = useOnlineStatus();

  async function saveOffline() {
    const now = new Date().toISOString();
    const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await offlineDb.customers.add({
      localId,
      name: form.name.trim(),
      phone: form.phone || undefined,
      email: form.email || undefined,
      address: form.address || undefined,
      source: form.source || undefined,
      syncStatus: "pending",
      createdAt: now,
      updatedAt: now,
    });
    await enqueue({
      table: "customers",
      localId,
      method: "POST",
      url: "/api/sales/customers",
      body: JSON.stringify(form),
    });
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError("客户名称不能为空");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (!isOnline) {
        await saveOffline();
        onSuccess();
        return;
      }
      const res = await apiFetch("/api/sales/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "创建失败");
      }
      onSuccess();
    } catch (err) {
      if (!navigator.onLine) {
        await saveOffline();
        onSuccess();
        return;
      }
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setSaving(false);
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
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
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

        {!isOnline && (
          <div className="flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
            <WifiOff className="h-3.5 w-3.5 shrink-0" />
            离线模式 — 客户将保存到本地，联网后自动同步
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {isOnline ? "创建" : "保存到本地"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
