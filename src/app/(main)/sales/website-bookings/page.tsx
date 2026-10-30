"use client";

/**
 * CAL-2 网站预约待转入（spec calendar/website-booking-intake）
 *
 * 列表来自 CAL-1 账本；打开"转入"时实时读取事件描述做预填（不落库），销售确认后建客户 + 预约（销售认领）。
 * 只读成员（老板）可看与忽略，没有转入按钮。
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { stripHtml } from "@/lib/calendar-watch/intake-pure";
import type { PendingBooking } from "@/lib/calendar-watch/intake-pure";
import type { WebsiteBookingDetail } from "@/lib/calendar-watch/intake";

type ListState =
  | { kind: "loading" }
  | { kind: "forbidden" }
  | { kind: "error" }
  | { kind: "ready"; enabled: boolean; canConvert: boolean; items: PendingBooking[] };

const TYPE_LABELS: Record<string, string> = { measure: "量房", install: "安装", revisit: "回访", consultation: "咨询" };

function when(b: Pick<PendingBooking, "start" | "end" | "allDay">): string {
  if (b.allDay) return `${b.start.slice(0, 10)}（全天）`;
  const fmt = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const s = fmt.format(new Date(b.start));
  if (!b.end) return s;
  const e = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(b.end));
  return `${s}–${e}`;
}

function ConvertPanel({ booking, onDone, onClose }: { booking: PendingBooking; onDone: (msg: string, customerId?: string) => void; onClose: () => void }) {
  const [detail, setDetail] = useState<WebsiteBookingDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [existingId, setExistingId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [type, setType] = useState("measure");
  const [title, setTitle] = useState(booking.summary ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch(`/api/sales/website-bookings/${encodeURIComponent(booking.eventId)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok) {
          setDetailError(body?.code === "READER_NOT_CONNECTED" ? "读取账号未连接 Google 日历，无法预填，请手工填写。" : body?.error ?? "详情读取失败，请手工填写。");
          return;
        }
        const d = body as WebsiteBookingDetail;
        setDetail(d);
        setName(d.prefill.name ?? "");
        setPhone(d.prefill.phone ?? "");
        setEmail(d.prefill.email ?? "");
        setAddress(d.prefill.address ?? "");
        if (d.existingCustomers.length) {
          setMode("existing");
          setExistingId(d.existingCustomers[0].id);
        }
      })
      .catch(() => alive && setDetailError("详情读取失败，请手工填写。"));
    return () => {
      alive = false;
    };
  }, [booking.eventId]);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    const customer = mode === "existing" ? { existingCustomerId: existingId } : { name, phone, email, address };
    try {
      const res = await apiFetch(`/api/sales/website-bookings/${encodeURIComponent(booking.eventId)}/convert`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ calendarId: booking.calendarId, customer, appointment: { type, title, address: address || null } }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 201) return onDone("已转入：客户与预约已建好", body.customerId);
      if (body?.code === "ALREADY_CONVERTED") return onDone("这条网站预约已被同事转入");
      if (body?.code === "CUSTOMER_EXISTS" && body.existingCustomer) {
        setDetail((d) => (d ? { ...d, existingCustomers: [body.existingCustomer, ...d.existingCustomers.filter((c) => c.id !== body.existingCustomer.id)] } : d));
        setMode("existing");
        setExistingId(body.existingCustomer.id);
        setError("这个电话已在你名下的客户里，已切换为关联该客户，确认后再提交。");
        return;
      }
      setError(body?.error ?? "转入失败");
    } catch {
      setError("转入失败");
    } finally {
      setSubmitting(false);
    }
  };

  const existing = detail?.existingCustomers ?? [];
  const field = "w-full rounded-md border border-[var(--border)] bg-transparent px-2 py-1.5 text-[13px]";
  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4">
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-medium">转入：{booking.summary ?? "（无标题）"} · {when(booking)}</p>
        <button type="button" onClick={onClose} className="text-[12px] text-[var(--muted)]">
          收起
        </button>
      </div>
      {detailError ? <p className="text-[12px] text-amber-700">{detailError}</p> : null}
      {detail?.event.description ? (
        <details className="text-[12px] text-[var(--muted)]" open>
          <summary>日历事件描述（只读，用于核对预填）</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words font-sans">{stripHtml(detail.event.description)}</pre>
        </details>
      ) : null}

      {existing.length ? (
        <div className="flex flex-wrap gap-4 text-[13px]">
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "existing"} onChange={() => setMode("existing")} /> 关联我名下已有客户
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> 新建客户
          </label>
        </div>
      ) : null}

      {mode === "existing" ? (
        <select value={existingId} onChange={(e) => setExistingId(e.target.value)} className={field} aria-label="已有客户">
          {existing.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.phone ?? "无电话"}
            </option>
          ))}
        </select>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          <input className={field} placeholder="客户姓名（必填）" value={name} onChange={(e) => setName(e.target.value)} aria-label="客户姓名" />
          <input className={field} placeholder="电话" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="电话" />
          <input className={field} placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="邮箱" />
          <input className={field} placeholder="地址" value={address} onChange={(e) => setAddress(e.target.value)} aria-label="地址" />
        </div>
      )}

      <div className="grid gap-2 md:grid-cols-[160px_1fr]">
        <select value={type} onChange={(e) => setType(e.target.value)} className={field} aria-label="预约类型">
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <input className={field} placeholder="预约标题" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="预约标题" />
      </div>
      <p className="text-[12px] text-[var(--muted)]">时间取日历事件的时间；客户归你，预约负责人是你。不会在 Google 日历里新建事件。</p>
      {error ? <p className="text-[12px] text-rose-600">{error}</p> : null}
      <button
        type="button"
        onClick={submit}
        disabled={submitting || (mode === "new" ? !name.trim() : !existingId)}
        className="rounded-md bg-[var(--accent)] px-4 py-1.5 text-[13px] text-[var(--on-accent)] disabled:opacity-60"
      >
        {submitting ? "提交中…" : "确认转入"}
      </button>
    </div>
  );
}

export default function WebsiteBookingsPage() {
  const [st, setSt] = useState<ListState>({ kind: "loading" });
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; customerId?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/sales/website-bookings");
      if (res.status === 403) return setSt({ kind: "forbidden" });
      if (!res.ok) return setSt({ kind: "error" });
      const body = (await res.json()) as { enabled: boolean; canConvert: boolean; items: PendingBooking[] };
      setSt({ kind: "ready", ...body });
    } catch {
      setSt({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dismiss = async (b: PendingBooking) => {
    const reason = window.prompt("忽略这条网站预约？可填写原因（如测试 / 重复），不填直接确定", "");
    if (reason === null) return;
    const res = await apiFetch(`/api/sales/website-bookings/${encodeURIComponent(b.eventId)}/dismiss`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ calendarId: b.calendarId, reason }),
    });
    setNotice({ text: res.ok ? "已忽略" : "忽略失败" });
    load();
  };

  return (
    <div className="mx-auto max-w-[960px] space-y-4 py-6">
      <div>
        <h1 className="text-xl font-semibold">网站预约待转入</h1>
        <p className="text-[13px] text-[var(--muted)]">客户在网站自主预约后会出现在共享日历里；这里列出还没建青砚客户与预约的，确认后一键转入。</p>
      </div>
      {notice ? (
        <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-800 dark:text-emerald-300">
          {notice.text}
          {notice.customerId ? (
            <>
              {" "}
              · <Link href={`/sales/customers/${notice.customerId}`} className="underline">查看客户</Link>
            </>
          ) : null}
        </p>
      ) : null}
      {st.kind === "loading" ? <p className="text-[13px] text-[var(--muted)]">加载中…</p> : null}
      {st.kind === "forbidden" ? <p className="text-[13px] text-[var(--muted)]">你没有查看网站预约的权限。</p> : null}
      {st.kind === "error" ? <p className="text-[13px] text-[var(--muted)]">暂时无法加载，请稍后重试。</p> : null}
      {st.kind === "ready" && !st.enabled ? <p className="text-[13px] text-[var(--muted)]">企业还没有开启日历观察，开启后网站预约会出现在这里。</p> : null}
      {st.kind === "ready" && st.enabled && st.items.length === 0 ? <p className="text-[13px] text-[var(--muted)]">没有待转入的网站预约。</p> : null}
      {st.kind === "ready" && st.items.length > 0 ? (
        <ul className="space-y-2">
          {st.items.map((b) => (
            <li key={b.eventId} className="space-y-2 rounded-xl border border-[var(--border)] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[14px] font-medium">{b.summary ?? "（无标题）"}</p>
                  <p className="text-[12px] text-[var(--muted)]">{when(b)}</p>
                </div>
                <div className="flex gap-2">
                  {st.canConvert ? (
                    <button type="button" onClick={() => setOpenId(openId === b.eventId ? null : b.eventId)} className="rounded-md bg-[var(--accent)] px-3 py-1 text-[12px] text-[var(--on-accent)]">
                      转入
                    </button>
                  ) : null}
                  <button type="button" onClick={() => dismiss(b)} className="rounded-md border border-[var(--border)] px-3 py-1 text-[12px] text-[var(--muted)]">
                    忽略
                  </button>
                </div>
              </div>
              {openId === b.eventId && st.canConvert ? (
                <ConvertPanel
                  booking={b}
                  onClose={() => setOpenId(null)}
                  onDone={(text, customerId) => {
                    setNotice({ text, customerId });
                    setOpenId(null);
                    load();
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
