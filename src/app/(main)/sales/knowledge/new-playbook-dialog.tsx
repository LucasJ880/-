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
import { Label } from "@/components/ui/label";
import {
  Select as ShadSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SCENES, CHANNELS } from "./constants";

export function NewPlaybookDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [form, setForm] = useState({
    channel: "wechat",
    scene: "first_contact",
    sceneLabel: "首次接触",
    language: "zh",
    content: "",
    example: "",
  });
  const [saving, setSaving] = useState(false);

  const sceneOptions = SCENES.filter((s) => s.key !== "all");

  async function handleSave() {
    if (!form.content.trim()) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/sales/playbooks", {
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
          <DialogTitle>新建话术模板</DialogTitle>
          <DialogDescription>
            手动添加销售话术模板
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>渠道</Label>
              <ShadSelect
                value={form.channel}
                onValueChange={(v) => setForm({ ...form, channel: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.filter((c) => c.key !== "all").map((c) => (
                    <SelectItem key={c.key} value={c.key}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </ShadSelect>
            </div>
            <div className="space-y-1.5">
              <Label>场景</Label>
              <ShadSelect
                value={form.scene}
                onValueChange={(v) => {
                  const label =
                    sceneOptions.find((s) => s.key === v)?.label || v;
                  setForm({ ...form, scene: v, sceneLabel: label });
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sceneOptions.map((s) => (
                    <SelectItem key={s.key} value={s.key}>
                      {s.label}
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
            <Label>话术内容 *</Label>
            <textarea
              className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 h-28 resize-none"
              placeholder="输入话术模板，可使用 [客户名] [产品名] 等占位符…"
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <Label>使用范例</Label>
            <textarea
              className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 h-16 resize-none"
              placeholder="可选：实际使用的话术范例…"
              value={form.example}
              onChange={(e) => setForm({ ...form, example: e.target.value })}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={!form.content.trim() || saving}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
