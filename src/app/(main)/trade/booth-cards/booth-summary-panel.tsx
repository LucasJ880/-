"use client";

/**
 * 展会小结：当天录入的卡汇总成一段中文。复制贴到微信群，或一键发给管理层（青砚通知 + 微信）。
 * 每天当地 07:00 也会自动发一次前一天的小结（同样张数不重复发）。
 * 「当地」= 组织时区（settingsJson.timezone，未设置时是多伦多）；组织管理员可在这里改。
 */

import { useEffect, useState } from "react";
import { Check, ClipboardCopy, Loader2, Send } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

interface SummaryData {
  day: string;
  timeZone: string;
  total: number;
  title: string;
  text: string;
}

const TIME_ZONES: Array<{ value: string; label: string }> = [
  { value: "Asia/Shanghai", label: "北京时间（Asia/Shanghai）" },
  { value: "America/Toronto", label: "多伦多（America/Toronto）" },
];

export function BoothSummaryPanel({ orgId, refreshKey }: { orgId: string | null; refreshKey: number }) {
  const [data, setData] = useState<SummaryData | null>(null);
  const [tz, setTz] = useState("");
  const [savingTz, setSavingTz] = useState(false);
  const [reload, setReload] = useState(0);
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
        if (res.ok) {
          const d: SummaryData = await res.json();
          setData(d);
          setTz(d.timeZone);
        }
      } catch {
        /* 小结读不到不影响录入 */
      } finally {
        setLoading(false);
      }
    })();
  }, [orgId, refreshKey, reload]);

  const saveTimeZone = async () => {
    if (!orgId || !tz) return;
    setSavingTz(true);
    setMsg(null);
    try {
      const res = await apiFetch(`/api/organizations/${encodeURIComponent(orgId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: tz }),
      });
      const r = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMsg({ tone: "error", text: res.status === 403 ? "改时区需要组织管理员（或组织所有者）" : r.error ?? "保存失败" });
        return;
      }
      setMsg({ tone: "ok", text: `组织时区已改为 ${r.organization?.timezone ?? tz}：展会日、07:00 小结和每日简报都按这个时间` });
      setReload((n) => n + 1);
    } catch {
      setMsg({ tone: "error", text: "保存失败，请检查网络后重试" });
    } finally {
      setSavingTz(false);
    }
  };

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
      {data ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>组织时区</span>
          <select value={tz} onChange={(e) => setTz(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-xs text-foreground">
            {(TIME_ZONES.some((z) => z.value === data.timeZone) ? TIME_ZONES : [{ value: data.timeZone, label: data.timeZone }, ...TIME_ZONES]).map((z) => (
              <option key={z.value} value={z.value}>
                {z.label}
              </option>
            ))}
          </select>
          {tz !== data.timeZone ? (
            <button
              type="button"
              onClick={() => void saveTimeZone()}
              disabled={savingTz}
              className="inline-flex items-center gap-1 rounded border border-blue-600 px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
            >
              {savingTz && <Loader2 size={12} className="animate-spin" />}保存时区
            </button>
          ) : null}
          {data.timeZone !== "Asia/Shanghai" ? (
            <span className="text-amber-700">
              {data.timeZone === "America/Toronto" ? "现在按多伦多 07:00 发小结，相当于北京时间晚上 7–8 点" : `现在按 ${data.timeZone} 的 07:00 发小结`}；团队在国内请改成北京时间
            </span>
          ) : null}
        </div>
      ) : null}
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
