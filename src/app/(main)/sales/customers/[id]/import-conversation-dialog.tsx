"use client";

import { useState } from "react";
import { Loader2, Brain } from "lucide-react";
import { cn } from "@/lib/utils";
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
import { Badge } from "@/components/ui/badge";

export function ImportConversationDialog({
  open,
  onOpenChange,
  customerId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId: string;
  onSuccess: () => void;
}) {
  const [channel, setChannel] = useState("wechat");
  const [rawText, setRawText] = useState("");
  const [importing, setImporting] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<{
    id: string;
    messageCount: number;
    language: string;
    topicTags: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const CHANNELS = [
    { key: "wechat", label: "微信", hint: "粘贴微信聊天记录导出" },
    { key: "xiaohongshu", label: "小红书", hint: "粘贴小红书私信对话" },
    { key: "facebook", label: "Facebook", hint: "粘贴 Messenger 对话" },
    { key: "email", label: "邮件", hint: "粘贴邮件往来内容" },
  ];

  async function handleImport() {
    if (!rawText.trim()) {
      setError("请粘贴对话内容");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/sales/conversations/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, channel, rawText }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "导入失败");
      }
      const data = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "未知错误");
    } finally {
      setImporting(false);
    }
  }

  async function handleExtractKnowledge() {
    if (!result?.id) return;
    setExtracting(true);
    try {
      await apiFetch("/api/sales/knowledge/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interactionId: result.id }),
      });
    } catch {
      // non-critical
    } finally {
      setExtracting(false);
      onSuccess();
    }
  }

  function handleReset() {
    setRawText("");
    setResult(null);
    setError(null);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>导入对话记录</DialogTitle>
          <DialogDescription>
            粘贴聊天记录，系统会自动解析并提取知识
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>渠道</Label>
              <div className="grid grid-cols-4 gap-2">
                {CHANNELS.map((ch) => (
                  <button
                    key={ch.key}
                    onClick={() => setChannel(ch.key)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                      channel === ch.key
                        ? "border-foreground bg-foreground text-white"
                        : "border-border bg-white/80 text-muted hover:text-foreground"
                    )}
                  >
                    {ch.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted">
                {CHANNELS.find((c) => c.key === channel)?.hint}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>对话内容</Label>
              <textarea
                className="flex w-full rounded-lg border border-border bg-white/80 px-3 py-2 text-sm transition-colors placeholder:text-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/20 h-48 resize-none font-mono text-xs leading-relaxed"
                placeholder={
                  channel === "wechat"
                    ? "2024-03-15 14:23 张三\n你好，想问一下窗帘价格\n\n2024-03-15 14:25 Sunny Shutter\n您好！请问是什么窗型呢？\n\n或简化格式：\n客户: 你好，想问价格\n我: 您好！什么窗型？"
                    : channel === "email"
                    ? "From: customer@email.com\nSubject: Quote for blinds\n\nHi, I'd like to get a quote...\n---\nFrom: sunny@shutter.com\n\nDear Customer, ..."
                    : "客户: 你好\n我: 您好！有什么可以帮您的？"
                }
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
            </div>

            {error && (
              <p className="rounded-lg bg-danger-bg px-3 py-2 text-sm text-danger">
                {error}
              </p>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button
                onClick={handleImport}
                disabled={!rawText.trim() || importing}
              >
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                导入解析
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg bg-success-bg px-4 py-3 text-sm text-success">
              导入成功！解析了 {result.messageCount} 条消息
              <span className="ml-2 text-xs opacity-70">
                语言: {result.language === "zh" ? "中文" : result.language === "en" ? "英文" : "中英混合"}
              </span>
            </div>

            {result.topicTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {result.topicTags.map((tag) => (
                  <Badge key={tag} variant="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={handleReset}>
                继续导入
              </Button>
              <Button
                variant="secondary"
                onClick={handleExtractKnowledge}
                disabled={extracting}
              >
                {extracting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Brain className="h-4 w-4" />
                )}
                提取知识
              </Button>
              <Button onClick={onSuccess}>完成</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
