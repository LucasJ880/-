"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Inbox,
  Send,
  Loader2,
  Sparkles,
  Trash2,
  Bot,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { extractWorkSuggestion, type WorkSuggestion } from "@/lib/ai";
import {
  WorkSuggestionCard,
  type SimpleProject,
} from "@/components/work-suggestion-card";
import Link from "next/link";
import { AiServiceConfigHint } from "@/components/ai-service-config-hint";
import { apiFetch, apiJson } from "@/lib/api-fetch";

interface InboxItem {
  id: string;
  rawText: string;
  aiText: string;
  suggestion: WorkSuggestion | null;
  status: "parsing" | "ready" | "error";
  createdCount: number;
}

export default function InboxPage() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [projects, setProjects] = useState<SimpleProject[]>([]);
  const [showAiConfigHint, setShowAiConfigHint] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    apiJson<{ id: string; name: string }[]>("/api/projects")
      .then((data) => {
        if (Array.isArray(data)) {
          setProjects(
            data.map((p) => ({
              id: p.id,
              name: p.name,
            }))
          );
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isLoading) inputRef.current?.focus();
  }, [isLoading]);

  const handleSubmit = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const itemId = `inbox-${Date.now()}`;
    const newItem: InboxItem = {
      id: itemId,
      rawText: text,
      aiText: "",
      suggestion: null,
      status: "parsing",
      createdCount: 0,
    };

    setItems((prev) => [newItem, ...prev]);
    setInput("");
    setIsLoading(true);

    try {
      const res = await apiFetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: text }],
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errStr = String((errData as { error?: string }).error || "");
        if (
          res.status === 500 &&
          (errStr.includes("OPENAI") || errStr.includes("API 密钥"))
        ) {
          setShowAiConfigHint(true);
        }
        throw new Error(errStr || `请求失败 (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("无法读取响应流");

      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") continue;

          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            continue;
          }
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.content) fullText += parsed.content;
        }
      }

      const { cleanText, suggestion, parseError } = extractWorkSuggestion(fullText);
      const finalText = parseError
        ? `${cleanText}\n\n> [AI 建议解析异常] ${parseError.reason}`
        : cleanText;

      setItems((prev) =>
        prev.map((it) =>
          it.id === itemId
            ? { ...it, aiText: finalText, suggestion, status: "ready" as const }
            : it
        )
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "解析失败";
      setItems((prev) =>
        prev.map((it) =>
          it.id === itemId
            ? { ...it, aiText: msg, status: "error" as const }
            : it
        )
      );
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading]);

  const handleRemove = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleTaskCreated = (itemId: string) => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === itemId ? { ...it, createdCount: it.createdCount + 1 } : it
      )
    );
  };

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col">
      {showAiConfigHint && (
        <div className="mb-4">
          <AiServiceConfigHint variant="compact" />
        </div>
      )}
      <div className="mb-4">
        <h1 className="text-2xl font-bold">收件箱</h1>
        <p className="mt-1 text-sm text-muted">
          面向<strong className="text-foreground">单条捕获</strong>：写一句话 → AI 解析 → 一键生成任务或日程，无需多轮对话。
        </p>
        <p className="mt-2 rounded-lg border border-border bg-background/60 px-3 py-2 text-xs leading-relaxed text-muted">
          <span className="font-medium text-foreground">与 AI 助手的区别：</span>
          收件箱适合「马上记下来」；若需要补充背景、拆步骤或连续讨论，请使用{" "}
          <Link href="/assistant" className="text-accent hover:underline">
            AI 助手
          </Link>
          （保留完整对话上下文）。
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card-bg p-3">
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={
            isLoading
              ? "AI 正在解析上一条..."
              : "例如：明天下午提交季度报表给财务部"
          }
          disabled={isLoading}
          rows={2}
          className="w-full resize-none bg-transparent px-1 text-sm leading-relaxed outline-none placeholder:text-muted disabled:opacity-50"
        />
        <div className="mt-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <Sparkles size={12} />
            <span>Enter 发送，AI 自动识别任务或日程</span>
          </div>
          <button
            onClick={handleSubmit}
            disabled={!input.trim() || isLoading}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {isLoading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Send size={13} />
            )}
            {isLoading ? "解析中..." : "发送"}
          </button>
        </div>
      </div>

      <div className="mt-5 flex-1 space-y-4 overflow-y-auto pb-4">
        {items.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-4 pt-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(110,125,118,0.08)]">
              <Inbox size={26} className="text-[#8a9590]" />
            </div>
            <div>
              <p className="text-sm text-muted">写下工作事项，AI 帮你变成任务或日程</p>
              <div className="mt-2 flex flex-col gap-1 text-xs text-muted">
                <span>创建<b className="text-[#2b6055]">任务</b>？试试 &ldquo;周五前完成季度报表&rdquo;</span>
                <span>安排<b className="text-[#2e7a56]">日程</b>？试试 &ldquo;明天下午两点开产品评审会&rdquo;</span>
              </div>
            </div>
            <Link
              href="/assistant"
              className="flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-accent"
            >
              <Bot size={12} />
              需要多轮讨论或规划？去 AI 助手
            </Link>
          </div>
        )}

        {items.map((item) => (
          <InboxCard
            key={item.id}
            item={item}
            projects={projects}
            onRemove={handleRemove}
            onTaskCreated={handleTaskCreated}
          />
        ))}
      </div>
    </div>
  );
}

function InboxCard({
  item,
  projects,
  onRemove,
  onTaskCreated,
}: {
  item: InboxItem;
  projects: SimpleProject[];
  onRemove: (id: string) => void;
  onTaskCreated: (id: string) => void;
}) {
  const [showAiText, setShowAiText] = useState(false);
  const hasAiText = item.aiText && item.aiText.trim().length > 0;

  return (
    <div className="rounded-xl border border-border bg-card-bg">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
          {item.rawText}
        </p>
        <button
          onClick={() => onRemove(item.id)}
          className="shrink-0 rounded p-1 text-muted transition-colors hover:bg-[rgba(166,61,61,0.04)] hover:text-[#a63d3d]"
          title="移除"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="px-4 py-3">
        {item.status === "parsing" && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Loader2 size={14} className="animate-spin" />
            AI 正在解析...
          </div>
        )}

        {item.status === "error" && (
          <p className="text-sm text-[#a63d3d]">{item.aiText}</p>
        )}

        {item.status === "ready" && (
          <>
            {item.suggestion ? (
              <WorkSuggestionCard
                suggestion={item.suggestion}
                projects={projects}
                onCreated={() => onTaskCreated(item.id)}
              />
            ) : (
              <div className="space-y-1 text-xs text-muted">
                <p>未识别出明确的工作事项。</p>
                <p>创建<b className="text-[#2b6055]">任务</b>？试试 &ldquo;周五前完成XX&rdquo;</p>
                <p>安排<b className="text-[#2e7a56]">日程</b>？试试 &ldquo;明天下午两点开会&rdquo;</p>
              </div>
            )}

            {hasAiText && (
              <div className="mt-2">
                <button
                  onClick={() => setShowAiText(!showAiText)}
                  className="flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-foreground"
                >
                  {showAiText ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                  {showAiText ? "收起 AI 回复" : "查看 AI 回复"}
                </button>
                {showAiText && (
                  <div className="mt-1.5 rounded-lg bg-background px-3 py-2 text-xs leading-relaxed text-muted">
                    {item.aiText.split("\n").map((line, i) => (
                      <p key={i} className={line === "" ? "h-1.5" : ""}>
                        {line}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
