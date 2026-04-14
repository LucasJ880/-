"use client";

import { useState } from "react";
import { HelpCircle, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { Badge } from "@/components/ui/badge";
import type { FAQ } from "./types";

export function FAQList({
  faqs,
  onRefresh,
}: {
  faqs: FAQ[];
  onRefresh: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (faqs.length === 0) {
    return (
      <div className="flex flex-col items-center py-16 text-muted">
        <HelpCircle className="h-10 w-10 opacity-30" />
        <p className="mt-3 text-sm">暂无 FAQ</p>
        <p className="mt-1 text-xs opacity-60">
          导入客户对话后自动提取，或手动创建
        </p>
      </div>
    );
  }

  async function handleArchive(id: string) {
    await apiFetch(`/api/sales/faqs/${id}`, { method: "DELETE" });
    onRefresh();
  }

  return (
    <div className="space-y-3">
      {faqs.map((faq) => (
        <div
          key={faq.id}
          className="group rounded-xl border border-border bg-white/70 overflow-hidden"
        >
          <button
            onClick={() =>
              setExpandedId(expandedId === faq.id ? null : faq.id)
            }
            className="flex w-full items-start gap-3 px-4 py-3 text-left"
          >
            <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">
                {faq.question}
              </p>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {faq.categoryLabel}
                </Badge>
                {faq.productTags &&
                  faq.productTags.split(",").map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="text-[10px]"
                    >
                      {tag.trim()}
                    </Badge>
                  ))}
                <span className="text-[10px] text-muted">
                  被问 {faq.frequency} 次
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleArchive(faq.id);
                }}
                className="rounded p-1 text-muted hover:text-danger hover:bg-danger/5"
                title="归档"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </button>

          {expandedId === faq.id && (
            <div className="border-t border-border/50 bg-foreground/[0.02] px-4 py-3 pl-11">
              <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                {faq.answer}
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
