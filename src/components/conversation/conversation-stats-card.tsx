"use client";

import { MessageSquare, Zap, Clock, DollarSign } from "lucide-react";

interface StatsCardProps {
  messageCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  avgLatencyMs: number;
}

export function ConversationStatsCard({
  messageCount,
  inputTokens,
  outputTokens,
  totalTokens,
  estimatedCost,
  avgLatencyMs,
}: StatsCardProps) {
  const items = [
    {
      icon: MessageSquare,
      label: "消息数",
      value: messageCount.toString(),
    },
    {
      icon: Zap,
      label: "总令牌数",
      value: totalTokens > 0 ? totalTokens.toLocaleString("zh-CN") : "—",
      sub:
        totalTokens > 0
          ? `入 ${inputTokens.toLocaleString("zh-CN")} / 出 ${outputTokens.toLocaleString("zh-CN")}`
          : undefined,
    },
    {
      icon: Clock,
      label: "平均延迟",
      value: avgLatencyMs > 0 ? `${avgLatencyMs}ms` : "—",
    },
    {
      icon: DollarSign,
      label: "预估成本",
      value:
        estimatedCost > 0
          ? `$${estimatedCost.toFixed(4)}`
          : "—",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-[var(--radius-md)] border border-border bg-card-bg p-3"
        >
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <item.icon size={12} className="text-accent/50" />
            {item.label}
          </div>
          <div className="mt-1 text-lg font-bold tracking-tight">{item.value}</div>
          {item.sub && (
            <div className="mt-0.5 text-[10px] text-muted">{item.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}
