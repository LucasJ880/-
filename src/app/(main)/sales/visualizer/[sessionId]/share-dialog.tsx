"use client";

/**
 * ShareDialog — 销售侧分享对话框
 *
 * 功能：
 * - 生成 / 撤销 / 续期 客户分享链接（默认 7 天，最长 60 天）
 * - 复制链接 / 显示二维码（占位：先复制为主）
 * - 展示已收集到的客户偏好（按 variant 聚合）
 *
 * 数据：父组件传 session（VisualizerSessionDetail），完成后调 onChanged() 触发 reload
 */

import { useEffect, useMemo, useState } from "react";
import { Copy, Check, Eye, Link as LinkIcon, Loader2, Mail, RotateCcw, Send, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/components/ui/toast";
import type { VisualizerSessionDetail } from "@/lib/visualizer/types";

interface ShareDialogProps {
  open: boolean;
  session: VisualizerSessionDetail;
  onClose: () => void;
  onChanged: () => void;
}

function buildShareUrl(token: string): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/sales/share/visualizer/${token}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function diffDays(iso: string | null, now: number | null): number | null {
  if (!iso || now === null) return null;
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return null;
  return Math.ceil((d - now) / (24 * 3600 * 1000));
}

export default function ShareDialog(props: ShareDialogProps) {
  const { open, session, onClose, onChanged } = props;
  const toast = useToast();
  const [busy, setBusy] = useState<null | "create" | "revoke" | "renew" | "email">(null);
  const [copied, setCopied] = useState(false);
  const [ttlDays, setTtlDays] = useState(7);
  const [recipient, setRecipient] = useState("");
  const [openedAt, setOpenedAt] = useState<number | null>(null);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setTtlDays(7);
    } else {
      setRecipient(session.customer.email ?? "");
      setOpenedAt(Date.now());
    }
  }, [open, session.customer.email]);

  const shareUrl = session.shareToken ? buildShareUrl(session.shareToken) : null;
  const remaining = diffDays(session.shareExpiresAt, openedAt);

  const expired = useMemo(() => {
    if (!session.shareExpiresAt) return false;
    if (openedAt === null) return false;
    return new Date(session.shareExpiresAt).getTime() <= openedAt;
  }, [openedAt, session.shareExpiresAt]);

  const totalCustomerCount = session.customerSelections.reduce(
    (sum, s) => sum + s.customerCount,
    0,
  );

  const create = async (mode: "create" | "renew" = "create") => {
    setBusy(mode);
    try {
      const res = await apiFetch(`/api/visualizer/sessions/${session.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ttlDays }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error((j as { error?: string }).error ?? "生成失败");
        return;
      }
      toast.success("链接已生成");
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const renew = () => create("renew");

  const revoke = async () => {
    if (!confirm("撤销链接后，客户的链接将立即失效（不影响已收集的偏好）。继续吗？")) {
      return;
    }
    setBusy("revoke");
    try {
      const res = await apiFetch(`/api/visualizer/sessions/${session.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revoke: true }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        toast.error((j as { error?: string }).error ?? "撤销失败");
        return;
      }
      toast.success("已撤销");
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("已复制链接");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("复制失败，请手动选择");
    }
  };

  const sendEmail = async () => {
    if (!recipient.trim()) {
      toast.error("请输入客户邮箱");
      return;
    }
    setBusy("email");
    try {
      const res = await apiFetch(`/api/visualizer/sessions/${session.id}/share/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: recipient.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(body.error ?? "邮件发送失败");
        return;
      }
      toast.success("效果方案已发送到客户邮箱");
    } finally {
      setBusy(null);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="关闭"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-lg rounded-xl border border-border bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-foreground">分享给客户</h3>
            <p className="mt-0.5 text-xs text-muted">
              生成只读链接，客户无需登录即可查看方案并标记喜欢的款式。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-muted hover:bg-slate-100 hover:text-foreground"
            aria-label="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!shareUrl || expired ? (
          <div className="space-y-3 rounded-lg border border-dashed border-border bg-slate-50/60 p-3">
            <div className="text-xs text-muted">
              {expired
                ? "原链接已过期，重新生成将覆盖旧 token。"
                : "尚未生成链接。生成后，客户用浏览器打开即可查看方案。"}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted">有效期</span>
              <select
                value={ttlDays}
                onChange={(e) => setTtlDays(parseInt(e.target.value, 10) || 7)}
                className="rounded-md border border-border bg-white px-2 py-1 text-xs"
              >
                <option value={3}>3 天</option>
                <option value={7}>7 天（推荐）</option>
                <option value={14}>14 天</option>
                <option value={30}>30 天</option>
                <option value={60}>60 天</option>
              </select>
              <button
                type="button"
                onClick={() => void create()}
                disabled={busy !== null}
                className="ml-auto inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs font-medium text-white hover:bg-foreground/90 disabled:opacity-60"
              >
                <LinkIcon className="h-3.5 w-3.5" />
                {busy === "create" ? "生成中…" : "生成分享链接"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={shareUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1.5 text-xs text-foreground"
              />
              <button
                type="button"
                onClick={copy}
                className="inline-flex items-center gap-1 rounded-md bg-foreground px-2.5 py-1.5 text-xs font-medium text-white hover:bg-foreground/90"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "已复制" : "复制"}
              </button>
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>
                有效期至：{fmtDate(session.shareExpiresAt)}
                {remaining !== null && remaining >= 0 ? `（剩 ${remaining} 天）` : ""}
              </span>
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-900"
              >
                <Eye className="h-3 w-3" />
                预览客户视图
              </a>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <select
                value={ttlDays}
                onChange={(e) => setTtlDays(parseInt(e.target.value, 10) || 7)}
                className="rounded-md border border-border bg-white px-2 py-1 text-xs"
              >
                <option value={3}>3 天</option>
                <option value={7}>7 天</option>
                <option value={14}>14 天</option>
                <option value={30}>30 天</option>
                <option value={60}>60 天</option>
              </select>
              <button
                type="button"
                onClick={renew}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-60"
                title="生成新 token 并重置有效期（旧链接立即失效）"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {busy === "renew" ? "续期中…" : "续期"}
              </button>
              <button
                type="button"
                onClick={revoke}
                disabled={busy !== null}
                className="ml-auto inline-flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {busy === "revoke" ? "撤销中…" : "撤销链接"}
              </button>
            </div>
            <div className="border-t border-emerald-200 pt-3">
              <label className="mb-1 flex items-center gap-1 text-[11px] font-medium text-emerald-900">
                <Mail className="h-3.5 w-3.5" />
                发送到客户邮箱
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder="customer@example.com"
                  className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1.5 text-xs text-foreground"
                />
                <button
                  type="button"
                  onClick={sendEmail}
                  disabled={busy !== null || !recipient.trim()}
                  className="inline-flex items-center justify-center gap-1 rounded-md bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-900 disabled:opacity-60"
                >
                  {busy === "email" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  {busy === "email" ? "发送中" : "发送方案"}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-foreground">
            <span>客户偏好统计</span>
            <span className="text-[11px] text-muted">
              共收到 {totalCustomerCount} 次标记
            </span>
          </div>
          {session.customerSelections.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-slate-50/40 px-3 py-4 text-center text-[11px] text-muted">
              尚未收到客户标记。把链接发给客户，他们点「我喜欢这套」后会显示在这里。
            </div>
          ) : (
            <ul className="space-y-1.5">
              {session.customerSelections
                .slice()
                .sort((a, b) => b.customerCount - a.customerCount)
                .map((s) => (
                  <li
                    key={s.variantId}
                    className="flex items-center gap-2 rounded-md border border-border/60 bg-white px-2 py-1.5 text-xs"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                      {s.variantName}
                    </span>
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                      {s.customerCount} 票
                    </span>
                    <span className="text-[10px] text-muted">{fmtDate(s.latestAt)}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
