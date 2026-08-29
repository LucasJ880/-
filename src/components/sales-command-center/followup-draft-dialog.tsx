"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  Copy,
  Loader2,
  RefreshCcw,
  Send,
  Sparkles,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useSalesCurrentOrgId } from "@/lib/hooks/use-sales-current-org-id";
import { withSalesOrgId } from "@/lib/sales/sales-client-org";
import { SalesBottomSheet } from "./sales-bottom-sheet";

/** 首页「今日重点」的类目 → 邮件作曲场景 */
function categoryToScene(category: string): string {
  switch (category) {
    case "quote_pending":
      return "quote_followup";
    case "viewed_not_signed":
      return "quote_viewed";
    default:
      return "general_followup";
  }
}

/** 编辑后的纯文本 → 简单 HTML 段落（供审阅后发送） */
function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

/**
 * 「生成跟进消息」— 首页今日重点的主按钮真实实现。
 * 复用 /api/sales/email-compose：AI 按场景生成，销售可改可复制；
 * 客户有邮箱且已绑定发信渠道时可直接发送。
 */
export function FollowupDraftDialog({
  open,
  onClose,
  customerId,
  customerName,
  category,
}: {
  open: boolean;
  onClose: () => void;
  customerId: string | null;
  customerName: string;
  category: string;
}) {
  const { orgId } = useSalesCurrentOrgId();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [to, setTo] = useState("");
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const generate = useCallback(async () => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    setCopied(false);
    setSentTo(null);
    try {
      const payload = { customerId, scene: categoryToScene(category) };
      const res = await apiFetch("/api/sales/email-compose", {
        method: "POST",
        body: JSON.stringify(orgId ? withSalesOrgId(orgId, payload) : payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "生成失败，请重试");
      }
      const email = (data as {
        email?: { subject?: string; text?: string; to?: string };
      }).email;
      setSubject(email?.subject ?? "");
      setBody(email?.text ?? "");
      setTo(email?.to ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败，请重试");
    } finally {
      setLoading(false);
    }
  }, [customerId, category, orgId]);

  useEffect(() => {
    if (open && customerId) {
      setSubject("");
      setBody("");
      setTo("");
      void generate();
    }
  }, [open, customerId, generate]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("复制失败，请手动选择文本复制");
    }
  };

  const handleSend = async () => {
    if (!customerId || !to) return;
    setSending(true);
    setError(null);
    try {
      const payload = {
        customerId,
        scene: categoryToScene(category),
        approvedSubject: subject,
        approvedHtml: textToHtml(body),
      };
      const res = await apiFetch("/api/sales/email-compose?action=send-approved", {
        method: "POST",
        body: JSON.stringify(orgId ? withSalesOrgId(orgId, payload) : payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error || "发送失败");
      }
      setSentTo(to);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  return (
    <SalesBottomSheet open={open} onClose={onClose} title={`跟进 ${customerName}`}>
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-[var(--muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在为 {customerName} 生成跟进话术…
        </div>
      ) : sentTo ? (
        <div className="space-y-3 py-4">
          <p className="flex items-center gap-2 text-sm font-medium text-emerald-600">
            <Check className="h-4 w-4" />
            已发送到 {sentTo}
          </p>
          <Link
            href={customerId ? `/sales/customers/${customerId}` : "/sales"}
            onClick={onClose}
            className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[var(--border)] px-3 text-[13px]"
          >
            查看客户详情
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {body ? (
            <>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="主题"
                className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm font-medium"
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm leading-relaxed"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 text-[13px] font-medium text-[var(--on-accent)]"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "已复制" : "复制内容"}
                </button>
                {to ? (
                  <button
                    type="button"
                    onClick={handleSend}
                    disabled={sending}
                    className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 text-[13px] font-medium disabled:opacity-50"
                  >
                    {sending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Send className="h-3.5 w-3.5" />
                    )}
                    发邮件到 {to}
                  </button>
                ) : (
                  <span className="text-[12px] text-[var(--muted)]">
                    客户没有邮箱——复制后用微信/短信发送
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void generate()}
                  className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[var(--border)] px-3 text-[13px]"
                >
                  <RefreshCcw className="h-3.5 w-3.5" />
                  重新生成
                </button>
                {customerId && (
                  <Link
                    href={`/sales/customers/${customerId}`}
                    onClick={onClose}
                    className="ml-auto inline-flex min-h-10 items-center gap-1 text-[13px] text-[var(--accent)]"
                  >
                    客户详情
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                )}
              </div>
            </>
          ) : (
            !error && (
              <div className="flex items-center gap-2 py-6 text-sm text-[var(--muted)]">
                <Sparkles className="h-4 w-4" />
                准备生成…
              </div>
            )
          )}
          {error && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[13px] text-red-600">{error}</p>
              <button
                type="button"
                onClick={() => void generate()}
                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 text-[12px]"
              >
                <RefreshCcw className="h-3 w-3" />
                重试
              </button>
            </div>
          )}
        </div>
      )}
    </SalesBottomSheet>
  );
}
