"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, Sparkles, Loader2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { extractWorkSuggestion, type WorkSuggestion } from "@/lib/ai";
import { WorkSuggestionCard, type SimpleProject } from "@/components/work-suggestion-card";
import { AiServiceConfigHint } from "@/components/ai-service-config-hint";
import { apiFetch } from "@/lib/api-fetch";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  workSuggestion?: WorkSuggestion | null;
  isStreaming?: boolean;
  isError?: boolean;
}

const QUICK_PROMPTS = [
  "明天下午两点开产品评审会",
  "这周五之前要完成季度销售报表",
  "提醒我后天给供应商回复报价单",
  "周三上午十点客户来访，在会议室A",
];

/**
 * 在流式传输过程中，实时隐藏 [TASK_JSON]... 块，
 * 避免用户看到原始 JSON 闪过。
 */
function cleanStreamingText(raw: string): string {
  for (const marker of ["[WORK_JSON]", "[TASK_JSON]"]) {
    const idx = raw.indexOf(marker);
    if (idx !== -1) return raw.substring(0, idx).trim();
  }
  return raw;
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "你好！我是青砚 AI 助手，适合多轮对话与规划：你可以逐步补充背景，我会结合上文给出任务或日程建议。\n\n若只想一句话快速落库，侧栏「收件箱」更高效（单条输入、一次解析）。\n\n例如可以问我：\n\n\u2022 明天要提交项目方案给客户\n\u2022 这周五之前完成季度报表\n\u2022 帮我安排下周的工作计划\n\n试试看吧！",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [noApiKey, setNoApiKey] = useState(false);
  const [projects, setProjects] = useState<SimpleProject[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiFetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setProjects(data.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
        }
      })
      .catch(() => {});
  }, []);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = async (text?: string) => {
    const content = (text || input).trim();
    if (!content || isLoading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
    };

    const assistantId = `assistant-${Date.now()}`;
    const assistantMsg: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsLoading(true);

    const chatHistory = [...messages, userMsg]
      .filter((m) => m.id !== "welcome")
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await apiFetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatHistory }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        const errMsg = String(errData.error || "");
        if (
          res.status === 500 &&
          (errMsg.includes("OPENAI") || errMsg.includes("API 密钥"))
        ) {
          setNoApiKey(true);
          setMessages((prev) => prev.filter((m) => m.id !== assistantId && m.id !== userMsg.id));
          return;
        }
        throw new Error(errData.error || `\u8BF7\u6C42\u5931\u8D25 (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u54CD\u5E94\u6D41");

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

          if (parsed.error) {
            throw new Error(parsed.error);
          }

          if (parsed.content) {
            fullText += parsed.content;
            const displayText = cleanStreamingText(fullText);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? { ...m, content: displayText, isStreaming: true }
                  : m
              )
            );
          }
        }
      }

      const { cleanText, suggestion } = extractWorkSuggestion(fullText);

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: cleanText,
                workSuggestion: suggestion,
                isStreaming: false,
              }
            : m
        )
      );
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "AI \u670D\u52A1\u6682\u65F6\u4E0D\u53EF\u7528";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: errorMessage,
                isStreaming: false,
                isError: true,
              }
            : m
        )
      );
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  if (noApiKey) {
    return <AiServiceConfigHint variant="full" />;
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold">AI 助手</h1>
        <p className="mt-1 text-sm text-muted">
          用自然语言描述工作需求，AI 帮你生成任务或日程
        </p>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-[var(--radius-xl)] border border-border bg-gradient-to-b from-card-bg to-[rgba(45,106,122,0.01)] shadow-card"
      >
        <div className="space-y-4 p-5">
          {messages.map((msg) => (
            <div key={msg.id}>
              <div
                className={cn(
                  "flex gap-3",
                  msg.role === "user" && "flex-row-reverse"
                )}
              >
                <div
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    msg.role === "assistant"
                      ? "bg-gradient-to-br from-[#2b6055] to-[#2b6055] text-white"
                      : "bg-[rgba(110,125,118,0.15)] text-[#6e7d76]"
                  )}
                >
                  {msg.role === "assistant" ? (
                    <Bot size={16} />
                  ) : (
                    <User size={16} />
                  )}
                </div>
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    msg.role === "assistant"
                      ? "bg-background text-foreground"
                      : "bg-accent text-white",
                    msg.isError &&
                      "border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] text-[#a63d3d]"
                  )}
                >
                  {msg.isError && (
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[#a63d3d]">
                      <AlertCircle size={13} />
                      请求失败
                    </div>
                  )}
                  {msg.content ? (
                    msg.content.split("\n").map((line, i) => (
                      <p key={i} className={line === "" ? "h-2" : ""}>
                        {line}
                      </p>
                    ))
                  ) : msg.isStreaming ? (
                    <div className="flex items-center gap-2 text-muted">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="text-xs">思考中...</span>
                    </div>
                  ) : null}
                  {msg.isStreaming && msg.content && (
                    <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent/60" />
                  )}
                </div>
              </div>

              {msg.workSuggestion && !msg.isStreaming && (
                <div className="ml-11 mt-2 max-w-[80%]">
                  <WorkSuggestionCard
                    suggestion={msg.workSuggestion}
                    projects={projects}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {messages.length <= 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => handleSend(prompt)}
              disabled={isLoading}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card-bg px-3 py-1.5 text-xs text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <Sparkles size={12} />
              {prompt}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 rounded-xl border border-border bg-card-bg p-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder={
            isLoading
              ? "AI 正在回复..."
              : "输入工作需求或对话内容，按 Enter 发送..."
          }
          disabled={isLoading}
          className="flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-muted disabled:opacity-50"
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || isLoading}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          {isLoading ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Send size={15} />
          )}
        </button>
      </div>
    </div>
  );
}
