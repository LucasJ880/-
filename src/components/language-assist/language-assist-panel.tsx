"use client";

import { useState, useCallback, useRef } from "react";
import {
  Languages,
  Loader2,
  FileText,
  List,
  AlertCircle,
  MessageSquareReply,
  Lightbulb,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api-fetch";

// ── 类型 ──────────────────────────────────────────────────

interface TranslateResult {
  detectedLang: string;
  translated: string;
}

interface UnderstandAndReplyResult {
  detectedLang: string;
  summaryZh: string;
  keyPointsZh: string[];
  actionItemsZh: string[];
  suggestedReplyZh: string;
  suggestedReplyEn: string;
}

type AssistResult =
  | { mode: "translate"; result: TranslateResult }
  | { mode: "understand_and_reply"; result: UnderstandAndReplyResult };

// 前端缓存：相同 text+mode 不重复调用
const resultCache = new Map<string, AssistResult>();

function cacheKey(text: string, mode: string): string {
  return `${mode}:${text.slice(0, 200)}:${text.length}`;
}

// ── LanguageAssistButton（触发入口） ─────────────────────────

interface ButtonProps {
  text: string;
  context?: string;
  mode?: "translate" | "understand_and_reply";
  label?: string;
  className?: string;
}

export function LanguageAssistButton({
  text,
  context,
  mode = "understand_and_reply",
  label,
  className,
}: ButtonProps) {
  const [open, setOpen] = useState(false);

  if (!text || text.trim().length < 3) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-accent/20 bg-accent/5 px-2 py-0.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/10",
          className
        )}
      >
        <Languages size={11} />
        {label || (mode === "translate" ? "翻译" : "中文理解")}
      </button>
      {open && (
        <LanguageAssistPanel
          text={text}
          context={context}
          defaultMode={mode}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ── LanguageAssistPanel（结果面板，modal 形式） ────────────────

interface PanelProps {
  text: string;
  context?: string;
  defaultMode?: "translate" | "understand_and_reply";
  onClose: () => void;
  onUseReply?: (reply: string) => void;
}

export function LanguageAssistPanel({
  text,
  context,
  defaultMode = "understand_and_reply",
  onClose,
  onUseReply,
}: PanelProps) {
  const [mode, setMode] = useState<"translate" | "understand_and_reply">(defaultMode);
  const [data, setData] = useState<AssistResult | null>(() => {
    const cached = resultCache.get(cacheKey(text, defaultMode));
    return cached ?? null;
  });
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const requestedRef = useRef(!!data);

  const fetchResult = useCallback(
    async (targetMode: "translate" | "understand_and_reply") => {
      const key = cacheKey(text, targetMode);
      const cached = resultCache.get(key);
      if (cached) {
        setData(cached);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const res = await apiFetch("/api/ai/language-assist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            mode: targetMode,
            targetLang: "zh",
            context,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || "处理失败");
        }
        const resp = await res.json();
        const result: AssistResult = { mode: targetMode, result: resp.result };
        resultCache.set(key, result);
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "处理失败");
      } finally {
        setLoading(false);
      }
    },
    [text, context]
  );

  if (!requestedRef.current) {
    requestedRef.current = true;
    fetchResult(mode);
  }

  function switchMode(newMode: "translate" | "understand_and_reply") {
    setMode(newMode);
    const cached = resultCache.get(cacheKey(text, newMode));
    if (cached) {
      setData(cached);
    } else {
      setData(null);
      fetchResult(newMode);
    }
  }

  function handleCopy(field: string, value: string) {
    navigator.clipboard.writeText(value).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1500);
    });
  }

  function handleRefresh() {
    const key = cacheKey(text, mode);
    resultCache.delete(key);
    setData(null);
    fetchResult(mode);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-card-bg shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <Languages size={16} className="text-accent" />
            <h3 className="text-sm font-semibold">跨语言理解</h3>
          </div>
          <div className="flex items-center gap-2">
            {/* Mode switcher */}
            <div className="flex rounded-lg border border-border bg-background p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => switchMode("understand_and_reply")}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium transition-colors",
                  mode === "understand_and_reply"
                    ? "bg-accent text-white"
                    : "text-muted hover:text-foreground"
                )}
              >
                理解 + 回复
              </button>
              <button
                type="button"
                onClick={() => switchMode("translate")}
                className={cn(
                  "rounded-md px-2.5 py-1 font-medium transition-colors",
                  mode === "translate"
                    ? "bg-accent text-white"
                    : "text-muted hover:text-foreground"
                )}
              >
                纯翻译
              </button>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="rounded p-1 text-muted hover:bg-background hover:text-foreground disabled:opacity-50"
              title="重新分析"
            >
              <RefreshCw size={13} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted hover:bg-background hover:text-foreground"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {/* Original text toggle */}
          <button
            type="button"
            onClick={() => setShowOriginal(!showOriginal)}
            className="flex items-center gap-1.5 text-[11px] font-medium text-muted hover:text-foreground"
          >
            <FileText size={11} />
            原文 ({text.length} 字符)
            {showOriginal ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
          {showOriginal && (
            <div className="rounded-lg border border-border/60 bg-background/50 px-3 py-2.5 text-[12px] leading-relaxed text-foreground/80">
              <pre className="whitespace-pre-wrap font-sans">{text}</pre>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-2 py-8 text-sm text-muted">
              <Loader2 size={16} className="animate-spin text-accent" />
              {mode === "translate" ? "正在翻译…" : "AI 正在分析并生成回复建议…"}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="space-y-3 py-4">
              <div className="flex items-center gap-2 rounded-lg border border-[rgba(166,61,61,0.15)] bg-[rgba(166,61,61,0.04)] px-4 py-3 text-sm text-[#a63d3d]">
                <AlertCircle size={14} />
                {error}
              </div>
              <button
                type="button"
                onClick={handleRefresh}
                className="text-xs text-accent hover:underline"
              >
                重试
              </button>
            </div>
          )}

          {/* Translate result */}
          {!loading && !error && data?.mode === "translate" && (
            <TranslateResultView
              result={data.result as TranslateResult}
              onCopy={(v) => handleCopy("translated", v)}
              copied={copiedField === "translated"}
            />
          )}

          {/* Understand & Reply result */}
          {!loading && !error && data?.mode === "understand_and_reply" && (
            <UnderstandReplyResultView
              result={data.result as UnderstandAndReplyResult}
              onCopy={handleCopy}
              copiedField={copiedField}
              onUseReply={onUseReply}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── 纯翻译结果 ──────────────────────────────────────────────

function TranslateResultView({
  result,
  onCopy,
  copied,
}: {
  result: TranslateResult;
  onCopy: (v: string) => void;
  copied: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px] text-muted">
        检测语言：<span className="font-medium text-foreground">{langLabel(result.detectedLang)}</span>
      </div>
      <div className="relative rounded-lg border border-border/60 bg-background/50 px-4 py-3">
        <p className="text-sm leading-relaxed">{result.translated}</p>
        <button
          type="button"
          onClick={() => onCopy(result.translated)}
          className="absolute right-2 top-2 rounded p-1 text-muted hover:bg-background hover:text-foreground"
          title="复制"
        >
          {copied ? <Check size={12} className="text-[#2e7a56]" /> : <Copy size={12} />}
        </button>
      </div>
    </div>
  );
}

// ── 理解+回复结果 ─────────────────────────────────────────

function UnderstandReplyResultView({
  result,
  onCopy,
  copiedField,
  onUseReply,
}: {
  result: UnderstandAndReplyResult;
  onCopy: (field: string, value: string) => void;
  copiedField: string | null;
  onUseReply?: (reply: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Detected lang */}
      <div className="flex items-center gap-2 text-[11px] text-muted">
        检测语言：<span className="font-medium text-foreground">{langLabel(result.detectedLang)}</span>
      </div>

      {/* Summary */}
      <Section
        icon={FileText}
        title="中文摘要"
        color="text-accent"
      >
        <p className="text-[13px] leading-relaxed">{result.summaryZh}</p>
      </Section>

      {/* Key points */}
      {result.keyPointsZh.length > 0 && (
        <Section
          icon={List}
          title="关键要点"
          color="text-[#2e7a56]"
        >
          <ul className="space-y-1.5">
            {result.keyPointsZh.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2e7a56]" />
                {p}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Action items */}
      {result.actionItemsZh.length > 0 && (
        <Section
          icon={AlertCircle}
          title="需要跟进的事项"
          color="text-[#b06a28]"
        >
          <ul className="space-y-1.5">
            {result.actionItemsZh.map((a, i) => (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#b06a28]" />
                {a}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Suggested reply thought (Chinese) */}
      <Section
        icon={Lightbulb}
        title="回复思路"
        color="text-[#805078]"
      >
        <p className="text-[13px] leading-relaxed">{result.suggestedReplyZh}</p>
      </Section>

      {/* English reply draft */}
      <Section
        icon={MessageSquareReply}
        title="英文回复草稿"
        color="text-accent"
        action={
          <div className="flex items-center gap-1">
            {onUseReply && (
              <button
                type="button"
                onClick={() => onUseReply(result.suggestedReplyEn)}
                className="rounded-md border border-accent/20 bg-accent/5 px-2 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/10"
              >
                使用此回复
              </button>
            )}
            <button
              type="button"
              onClick={() => onCopy("replyEn", result.suggestedReplyEn)}
              className="rounded p-1 text-muted hover:text-foreground"
              title="复制"
            >
              {copiedField === "replyEn" ? (
                <Check size={11} className="text-[#2e7a56]" />
              ) : (
                <Copy size={11} />
              )}
            </button>
          </div>
        }
      >
        <div className="rounded-lg border border-accent/15 bg-accent/5 px-3 py-2.5">
          <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed">
            {result.suggestedReplyEn}
          </pre>
        </div>
      </Section>
    </div>
  );
}

// ── 通用区块 ─────────────────────────────────────────────

function Section({
  icon: Icon,
  title,
  color,
  action,
  children,
}: {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  color: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border/60 px-4 py-3">
      <div className="mb-2 flex items-center justify-between">
        <div className={cn("flex items-center gap-1.5 text-xs font-semibold", color)}>
          <Icon size={13} />
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── 工具 ──────────────────────────────────────────────────

function langLabel(code: string): string {
  const map: Record<string, string> = {
    en: "英文",
    zh: "中文",
    ja: "日文",
    ko: "韩文",
    fr: "法文",
    de: "德文",
    es: "西班牙文",
    pt: "葡萄牙文",
    ar: "阿拉伯文",
    ru: "俄文",
  };
  return map[code] || code;
}
