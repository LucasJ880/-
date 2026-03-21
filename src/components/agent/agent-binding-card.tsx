"use client";

import { FileText, BookOpen, Wrench } from "lucide-react";

interface BindingCardProps {
  prompt: { id: string; key: string; name: string } | null;
  knowledgeBase: { id: string; key: string; name: string } | null;
  toolBindings: {
    id: string;
    tool: { id: string; key: string; name: string; category: string };
    enabled: boolean;
  }[];
}

export function AgentBindingCard({ prompt, knowledgeBase, toolBindings }: BindingCardProps) {
  const enabledTools = toolBindings.filter((b) => b.enabled);
  const hasData = prompt || knowledgeBase || enabledTools.length > 0;

  if (!hasData) {
    return (
      <div className="rounded-xl border border-border bg-card-bg p-4">
        <h3 className="text-sm font-semibold text-muted">绑定资产</h3>
        <p className="mt-2 text-xs text-muted">暂未绑定 Prompt、知识库或工具</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card-bg p-4">
      <h3 className="mb-3 text-sm font-semibold text-muted">绑定资产</h3>
      <div className="space-y-3">
        {prompt && (
          <div className="flex items-center gap-2 text-sm">
            <FileText size={14} className="shrink-0 text-[#805078]" />
            <span className="text-muted">Prompt:</span>
            <span className="font-medium">{prompt.name}</span>
            <code className="rounded bg-card-bg px-1 text-xs text-muted">{prompt.key}</code>
          </div>
        )}
        {knowledgeBase && (
          <div className="flex items-center gap-2 text-sm">
            <BookOpen size={14} className="shrink-0 text-[#2d6a7a]" />
            <span className="text-muted">知识库:</span>
            <span className="font-medium">{knowledgeBase.name}</span>
            <code className="rounded bg-card-bg px-1 text-xs text-muted">{knowledgeBase.key}</code>
          </div>
        )}
        {enabledTools.length > 0 && (
          <div>
            <div className="mb-1.5 flex items-center gap-2 text-sm text-muted">
              <Wrench size={14} className="shrink-0 text-[#9a6a2f]" />
              <span>工具 ({enabledTools.length})</span>
            </div>
            <div className="flex flex-wrap gap-1.5 pl-6">
              {enabledTools.map((b) => (
                <span
                  key={b.id}
                  className="rounded bg-[rgba(154,106,47,0.08)] px-1.5 py-0.5 text-[10px] font-medium text-[#9a6a2f]"
                >
                  {b.tool.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
