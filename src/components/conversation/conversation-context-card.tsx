"use client";

import { BookOpen, FileText, Globe } from "lucide-react";

interface ContextCardProps {
  environment: { code: string; name: string } | null;
  prompt: {
    id: string;
    key: string;
    name: string;
    version: number | null;
  } | null;
  knowledgeBase: {
    id: string;
    key: string;
    name: string;
    version: number | null;
  } | null;
  systemPromptPreview?: string | null;
}

export function ConversationContextCard({
  environment,
  prompt,
  knowledgeBase,
  systemPromptPreview,
}: ContextCardProps) {
  const hasData = environment || prompt || knowledgeBase;

  if (!hasData) {
    return (
      <div className="rounded-[var(--radius-md)] border border-border bg-card-bg p-4">
        <h3 className="text-sm font-semibold text-muted">上下文</h3>
        <p className="mt-2 text-xs text-muted">未绑定上下文信息</p>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-md)] border border-border bg-card-bg p-4">
      <h3 className="mb-3 text-sm font-semibold text-muted">会话上下文</h3>
      <div className="space-y-3">
        {environment && (
          <div className="flex items-center gap-2 text-sm">
            <Globe size={14} className="shrink-0 text-accent/50" />
            <span className="text-muted">环境:</span>
            <span className="rounded-md bg-[rgba(43,96,85,0.08)] px-1.5 py-0.5 text-xs font-medium text-[#2b6055]">
              {environment.name} ({environment.code})
            </span>
          </div>
        )}
        {prompt && (
          <div className="flex items-center gap-2 text-sm">
            <FileText size={14} className="shrink-0 text-accent/50" />
            <span className="text-muted">Prompt:</span>
            <span className="font-medium">{prompt.name}</span>
            <code className="rounded-md bg-[rgba(26,36,32,0.04)] px-1 text-xs text-muted">
              {prompt.key}
            </code>
            {prompt.version != null && (
              <span className="text-xs text-muted">v{prompt.version}</span>
            )}
          </div>
        )}
        {knowledgeBase && (
          <div className="flex items-center gap-2 text-sm">
            <BookOpen size={14} className="shrink-0 text-accent/50" />
            <span className="text-muted">知识库:</span>
            <span className="font-medium">{knowledgeBase.name}</span>
            <code className="rounded-md bg-[rgba(26,36,32,0.04)] px-1 text-xs text-muted">
              {knowledgeBase.key}
            </code>
            {knowledgeBase.version != null && (
              <span className="text-xs text-muted">
                v{knowledgeBase.version}
              </span>
            )}
          </div>
        )}
        {systemPromptPreview && (
          <div className="mt-2 border-t border-border pt-2">
            <p className="mb-1 text-xs font-semibold text-muted">
              System Prompt 快照
            </p>
            <pre className="max-h-24 overflow-auto whitespace-pre-wrap rounded-[var(--radius-sm)] border border-border bg-[rgba(26,36,32,0.02)] p-2 text-xs">
              {systemPromptPreview.length > 500
                ? systemPromptPreview.slice(0, 500) + "…"
                : systemPromptPreview}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
