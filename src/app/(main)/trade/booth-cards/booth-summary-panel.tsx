"use client";

/**
 * 展会小结：当天录入的卡汇总成一段中文。复制贴到微信群，或一键发给管理层（青砚通知 + 微信）。
 * 每天当地 07:00 也会自动发一次前一天的小结（同样张数不重复发）。
 */

import { useEffect, useState } from "react";
import { Check, ClipboardCopy, Loader2, Send } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

interface SummaryData {
  day: string;
  total: number;
  title: string;
  text: string;
}

export function BoothSummaryPanel({ orgId, refreshKey }: { orgId: string | null; refreshKey: number }) {
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let day = "";
    try {
      day = new URL(window.location.href).searchParams.get("day") ?? "";
    } catch {
      /* ignore */
    }
    setLoading(true);
    void (async () => {
      try {
        const res = await apiFetch(`/api/trade/booth-cards/summary${day ? `?day=${encodeURIComponent(day)}` : ""}`);
        if (res.ok) setData(await res.json());
      } catch {
        /* 小结读不到不影响录入 */
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, refreshKey]);

  const copy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setMsg({ tone: "error", text: "浏览器不允许复制，请手动选中文字复制" });
    }
  };

  const send = async () => {
    if (!data) return;
    setSending(true);
    setMsg(null);
    try {
      const res = await apiFetch("/api/trade/booth-cards/summary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, day: data.day }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tone: "error", text: r.error ?? "发送失败" });
      } else if (!r.recipients) {
        setMsg({ tone: "error", text: "没找到管理层账号（老板 / 经理 / 组织管理员），请先在组织成员里设置" });
      } else {
        setMsg({ tone: "ok", text: r.sent ? `已发给 ${r.sent} 位管理层（青砚通知；绑定了微信的同时推送）` : "这一版已经发过了（张数没变）" });
      }
    } catch {
      setMsg({ tone: "error", text: "发送失败，请检查网络后重试" });
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-border/60 bg-card-bg p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-foreground">4. 展会小结</h2>
        <span className="text-xs text-muted">
          {data ? `${data.day} · 录入 ${data.total} 张` : "当天录入的卡汇总"}（展会日按当地 07:00 到次日 07:00；每天 07:00 自动发给管理层）
        </span>
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={() => void copy()}
            disabled={!data?.total}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:border-blue-500/40 disabled:opacity-50"
          >
            {copied ? <Check size={14} /> : <ClipboardCopy size={14} />} {copied ? "已复制" : "复制（贴到微信群）"}
          </button>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!data?.total || sending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} 发给管理层
          </button>
        </div>
      </div>
      {msg && <p className={`text-xs ${msg.tone === "ok" ? "text-emerald-700" : "text-red-600"}`}>{msg.text}</p>}
      {loading && !data ? (
        <Loader2 size={16} className="animate-spin text-muted" />
      ) : data?.total ? (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-background p-3 text-xs leading-relaxed text-foreground">{data.text}</pre>
      ) : (
        <p className="text-xs text-muted">这一天还没有录入速记卡。</p>
      )}
    </section>
  );
}
