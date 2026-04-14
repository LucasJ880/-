"use client";

import { useState } from "react";
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
import { FAQ_CATEGORIES } from "./constants";

export function NewFAQDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    question: "",
    answer: "",
    category: "product",
    categoryLabel: "产品相关",
    language: "zh",
  });
  const [saving, setSaving] = useState(false);

  const catOptions = FAQ_CATEGORIES.filter((c) => c.key !== "all");

  async function handleSave() {
    if (!form.question.trim() || !form.answer.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/sales/faqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) onSuccess();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新建 FAQ</DialogTitle>
          <DialogDescription>
            添加客户常见问题和最佳回答
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>分类</Label>
              <ShadSelect
                value={form.category}
                onValueChange={(v) => {
                  const label =
                    catOptions.find((c) => c.key === v)?.label || v;
                  setForm({ ...form, category: v, categoryLabel: label });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {catOptions.map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            </div>
            <div className="space-y-1.5">
              <Label>语言</Label>
              <ShadSelect
                value={form.language}
                onValueChange={(v) => setForm({ ...form, language: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="zh">中文</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="mixed">中英混合</SelectItem>
                </SelectContent>
              </ShadSelect>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>常见问题 *</Label>
            <Input
              placeholder="客户常问的问题…"
              value={form.question}
              onChange={(e) => setForm({ ...form, question: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>最佳回答 *</Label>
            <textarea
              className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 h-28 resize-none"
              placeholder="标准回答内容…"
              value={form.answer}
              onChange={(e) => setForm({ ...form, answer: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            onClick={handleSave}
            disabled={
              !form.question.trim() || !form.answer.trim() || saving
            }
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
