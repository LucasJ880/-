"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Loader2,
  Send,
  MessageCircle,
  Trash2,
  Sparkles,
  ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  messages: { content: string; createdAt: string }[];
}

interface Message {
  id?: string;
  role: "user" | "assistant" | "system";
  content: string;
}

const QUICK_COMMANDS = [
  { label: "总览", text: "给我看一下外贸业务总览" },
  { label: "待跟进", text: "有哪些线索需要跟进？" },
  { label: "建议", text: "给我一些下一步行动建议" },
  { label: "活动列表", text: "列出所有获客活动" },
  { label: "列待研究", text: "请列出阶段为 new 的外贸线索，每条给出 prospectId、公司名、国家、所属活动名" },
  { label: "报价统计", text: "目前报价单情况怎么样？" },
  { label: "高分线索", text: "评分最高的线索有哪些？" },
];

export default function TradeChatPage() {
  const draftAppliedRef = useRef(false);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  /** 线索详情「对话里研究」等入口：/trade/chat?draft=... */
  useEffect(() => {
    if (typeof window === "undefined" || draftAppliedRef.current) return;
    const raw = new URLSearchParams(window.location.search).get("draft");
    if (!raw?.trim()) return;
    draftAppliedRef.current = true;
    try {
      setInput(decodeURIComponent(raw));
    } catch {
      setInput(raw);
    }
  }, []);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const loadSessions = useCallback(async () => {
    const res = await apiFetch("/api/trade/chat");
    if (res.ok) setSessions(await res.json());
    setLoadingSessions(false);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const loadSession = async (sessionId: string) => {
    setActiveId(sessionId);
    const res = await apiFetch(`/api/trade/chat/${sessionId}`);
    if (res.ok) {
      const data = await res.json();
      setMessages(data.messages.map((m: Message) => ({ role: m.role, content: m.content })));
    }
  };

  const createSession = async () => {
    const res = await apiFetch("/api/trade/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgId: "default" }),
    });
    if (res.ok) {
      const session = await res.json();
      setActiveId(session.id);
      setMessages([]);
      loadSessions();
    }
  };

  const deleteSession = async (sessionId: string) => {
    await apiFetch(`/api/trade/chat/${sessionId}`, { method: "DELETE" });
    if (activeId === sessionId) {
      setActiveId(null);
      setMessages([]);
    }
    loadSessions();
  };

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || sending) return;

    let sessionId = activeId;

    if (!sessionId) {
      const res = await apiFetch("/api/trade/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: "default" }),
      });
      if (!res.ok) return;
      const session = await res.json();
      sessionId = session.id;
      setActiveId(sessionId);
    }

    setInput("");
    setMessages((prev) => [...prev, { role: "user", content }]);
    setSending(true);

    try {
      const res = await apiFetch(`/api/trade/chat/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      if (res.ok) {
        const data = await res.json();
        setMessages((prev) => [...prev, { role: "assistant", content: data.assistantMessage.content }]);
      } else {
        setMessages((prev) => [...prev, { role: "assistant", content: "请求失败，请重试" }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "网络错误，请重试" }]);
    } finally {
      setSending(false);
      loadSessions();
    }
  };

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-4">
      {/* Session List */}
      <div className="hidden w-56 shrink-0 flex-col rounded-xl border border-border/60 bg-card-bg lg:flex">
        <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
          <span className="text-xs font-medium text-foreground">对话</span>
          <button onClick={createSession} className="rounded-lg p-1 text-muted transition hover:text-blue-400">
            <Plus size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {loadingSessions ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={14} className="animate-spin text-muted" />
            </div>
          ) : sessions.length === 0 ? (
            <p className="py-8 text-center text-[10px] text-muted">暂无对话</p>
          ) : (
            sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => loadSession(s.id)}
                className={cn(
                  "group flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 transition",
                  activeId === s.id ? "bg-blue-500/10 text-blue-400" : "text-foreground hover:bg-border/20",
                )}
              >
                <MessageCircle size={12} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs">{s.title}</p>
                  <p className="text-[10px] text-muted">{new Date(s.updatedAt).toLocaleDateString("zh-CN")}</p>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSession(s.id); }}
                  className="shrink-0 rounded p-0.5 text-muted opacity-0 transition group-hover:opacity-100 hover:text-red-400"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex min-w-0 flex-1 flex-col rounded-xl border border-border/60 bg-card-bg">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <EmptyChat onQuickCommand={sendMessage} />
          ) : (
            <div className="space-y-4">
              {messages.filter((m) => m.role !== "system").map((m, i) => (
                <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2.5",
                    m.role === "user"
                      ? "rounded-br-md bg-blue-600 text-white"
                      : "rounded-bl-md bg-background text-foreground",
                  )}>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</div>
                  </div>
                </div>
              ))}
              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md bg-background px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <Sparkles size={14} className="animate-pulse text-blue-400" />
                      AI 思考中...
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-border/60 p-3">
          {messages.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_COMMANDS.slice(0, 4).map((cmd) => (
                <button
                  key={cmd.label}
                  onClick={() => sendMessage(cmd.text)}
                  disabled={sending}
                  className="rounded-full border border-border/60 px-2.5 py-0.5 text-[10px] text-muted transition hover:border-blue-500/40 hover:text-blue-400 disabled:opacity-50"
                >
                  {cmd.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
              rows={1}
              className="min-h-[36px] max-h-32 flex-1 resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-blue-500 focus:outline-none"
            />
            <button
              onClick={() => sendMessage()}
              disabled={sending || !input.trim()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-500 disabled:opacity-40"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyChat({ onQuickCommand }: { onQuickCommand: (text: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-500/10">
        <Sparkles className="h-8 w-8 text-blue-400" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">外贸 AI 助手</h2>
      <p className="mt-2 max-w-md text-center text-sm text-muted">
        用自然语言管理外贸流程 — 查询线索、跟进状态、报价管理、获取行动建议
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {QUICK_COMMANDS.map((cmd) => (
          <button
            key={cmd.label}
            onClick={() => onQuickCommand(cmd.text)}
            className="rounded-xl border border-border/60 bg-background px-4 py-2 text-xs text-foreground transition hover:border-blue-500/40 hover:bg-blue-500/5"
          >
            {cmd.text}
          </button>
        ))}
      </div>
    </div>
  );
}
