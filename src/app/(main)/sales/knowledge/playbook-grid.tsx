"use client";

import { useState } from "react";
import {
  BookOpen,
  Star,
  Archive,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";
import { Badge } from "@/components/ui/badge";
import { CHANNEL_COLORS } from "./constants";
import type { Playbook } from "./types";

export function PlaybookGrid({
  playbooks,
  onRefresh,
}: {
  playbooks: Playbook[];
  onRefresh: () => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  if (playbooks.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 text-muted">
        <BookOpen className="h-10 w-10 opacity-30" />
        <p className="mt-3 text-sm">暂无话术模板</p>
        <p className="mt-1 text-xs opacity-60">
          导入客户对话后，点击"提取知识"自动生成
        </p>
      </div>
    );
  }

  async function handleCopy(content: string, id: string) {
    await navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleArchive(id: string) {
    await apiFetch(`/api/sales/playbooks/${id}`, {
      method: "DELETE",
    });
    onRefresh();
  }

  async function handleRate(id: string, score: number) {
    await apiFetch(`/api/sales/playbooks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effectiveness: score }),
    });
    onRefresh();
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {playbooks.map((pb) => (
        <div
          key={pb.id}
          className="group relative rounded-xl border border-border bg-white/70 p-4 transition-shadow hover:shadow-md"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              <Badge
                className={CHANNEL_COLORS[pb.channel] || "bg-gray-100 text-gray-600"}
              >
                {pb.channel}
              </Badge>
              <Badge variant="outline">{pb.sceneLabel}</Badge>
              {pb.language !== "zh" && (
                <Badge variant="secondary">
                  {pb.language === "en" ? "EN" : "混合"}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => handleCopy(pb.content, pb.id)}
                className="rounded p-1 text-muted hover:text-foreground hover:bg-foreground/5"
                title="复制话术"
              >
                {copiedId === pb.id ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                onClick={() => handleArchive(pb.id)}
                className="rounded p-1 text-muted hover:text-danger hover:bg-danger/5"
                title="归档"
              >
                <Archive className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <p className="mt-3 text-sm text-foreground leading-relaxed line-clamp-4">
            {pb.content}
          </p>

          {pb.example && (
            <div className="mt-2 rounded-lg bg-foreground/[0.03] px-3 py-2 text-xs text-muted italic line-clamp-2">
              {pb.example}
            </div>
          )}

          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((s) => (
                <button
                  key={s}
                  onClick={() => handleRate(pb.id, s)}
                  className="p-0.5"
                >
                  <Star
                    className={cn(
                      "h-3.5 w-3.5",
                      s <= pb.effectiveness
                        ? "fill-amber-400 text-amber-400"
                        : "text-gray-200"
                    )}
                  />
                </button>
              ))}
            </div>
            <span className="text-[10px] text-muted">
              使用 {pb.usageCount} 次
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
