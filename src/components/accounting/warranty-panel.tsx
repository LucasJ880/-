"use client";

/**
 * INSTALL-2c：质保邮件（会计"待收尾款"页签内）
 * — WarrantyApprove：邮件预览（iframe srcdoc + 空沙箱，不跑脚本）+ "批准发送"（POST /api/ai/pending-actions/{id}）
 * — WarrantyCell："最近已确认"每行的质保状态与"生成质保邮件"
 * — WarrantySettingsPanel：质保年限 / 联系方式（老板可改，会计只读）
 * 批准前零出站；发送只在审批执行器。
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Mail, Save, Settings2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  CATEGORY_LABEL_ZH,
  PART_LABEL_ZH,
  WARRANTY_CATEGORIES,
  WARRANTY_PARTS,
  type WarrantyPart,
  type WarrantySettings,
} from "@/lib/install/warranty";

export type WarrantyView = {
  status: "none" | "blocked" | "pending_approval" | "sent" | "failed" | "rejected" | "expired" | "error";
  approvalId?: string;
  sentAt?: string;
  reason?: string;
  blockers?: string[];
  canRegenerate?: boolean;
  preview?: { to: string; subject: string; html: string };
  error?: string;
};

const day = (s: string | undefined) => (s ? new Date(s).toLocaleString("zh-CN") : "—");

/** 预览 + 批准发送；done(true) = 已发送 */
export function WarrantyApprove({ view, onDone }: { view: WarrantyView; onDone: (sent: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const approve = useCallback(async () => {
    if (!view.approvalId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/ai/pending-actions/${view.approvalId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "approve" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error || "发送失败");
        return;
      }
      setSent(true);
    } catch {
      setError("网络错误，请重试");
    } finally {
      setBusy(false);
    }
  }, [view.approvalId]);

  if (!view.preview) return <p className="text-sm text-muted">没有可预览的邮件</p>;
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted">
        <div>
          收件人：<b className="text-foreground">{view.preview.to}</b>
        </div>
        <div className="truncate">主题：{view.preview.subject}</div>
      </div>
      <iframe
        title="质保邮件预览"
        srcDoc={view.preview.html}
        sandbox=""
        className="h-80 w-full rounded-lg border border-border bg-white"
      />
      {sent ? (
        <p className="flex items-center gap-1.5 rounded-lg border border-[rgba(46,122,86,0.3)] bg-[rgba(46,122,86,0.06)] px-3 py-2 text-sm text-[#2e7a56]">
          <CheckCircle2 size={16} /> 质保邮件已发送
        </p>
      ) : (
        <>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={approve}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#2e7a56] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
              批准发送
            </button>
            <button type="button" onClick={() => onDone(false)} className="rounded-lg border border-border px-4 py-2.5 text-sm text-foreground">
              稍后再批
            </button>
          </div>
          <p className="text-[11px] text-muted">批准后以组织发件身份发给客户档案邮箱；每张单只发一封。</p>
        </>
      )}
      {sent && (
        <button type="button" onClick={() => onDone(true)} className="w-full rounded-lg border border-border px-4 py-2 text-sm text-foreground">
          完成
        </button>
      )}
    </div>
  );
}

/** 阻断原因 */
export function WarrantyBlocked({ view }: { view: WarrantyView }) {
  return (
    <div className="rounded-lg border border-[rgba(201,138,34,0.4)] bg-[rgba(201,138,34,0.08)] px-3 py-2 text-sm text-foreground">
      <div className="font-medium">质保邮件暂未生成：</div>
      <ul className="mt-1 list-disc pl-5 text-xs">
        {(view.blockers ?? [view.error ?? "未知原因"]).map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <p className="mt-1 text-[11px] text-muted">缺报修电话 / 邮箱或年限时，老板在本页下方「质保设置」补齐；客户邮箱在客户档案里补。补齐后在「最近已确认」点「生成质保邮件」。</p>
    </div>
  );
}

const STATUS_LABEL: Record<WarrantyView["status"], string> = {
  none: "未生成",
  blocked: "缺资料",
  pending_approval: "待批准",
  sent: "已发送",
  failed: "发送失败",
  rejected: "已拒绝",
  expired: "已过期",
  error: "生成失败",
};

/** "最近已确认"每行的质保状态 */
export function WarrantyCell({ orderId, view, onChanged }: { orderId: string; view: WarrantyView | null; onChanged: () => void }) {
  const [current, setCurrent] = useState<WarrantyView | null>(view);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setCurrent(view), [view]);

  const regenerate = async () => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/accounting/balance/${orderId}/warranty`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => ({}))) as { warranty?: WarrantyView; error?: string };
      if (data.warranty) setCurrent(data.warranty);
      else setCurrent({ status: "error", error: data.error || "生成失败" });
      setOpen(true);
    } catch {
      setCurrent({ status: "error", error: "网络错误，请重试" });
      setOpen(true);
    } finally {
      setBusy(false);
    }
  };

  const v = current ?? { status: "none" as const, canRegenerate: true };
  const tone = v.status === "sent" ? "text-[#2e7a56]" : v.status === "pending_approval" ? "text-accent" : v.status === "none" ? "text-muted" : "text-[#a86a12]";
  return (
    <div className="min-w-[9rem] text-xs">
      <div className={tone}>
        {STATUS_LABEL[v.status]}
        {v.status === "sent" && ` · ${day(v.sentAt)}`}
      </div>
      {(v.status === "failed" || v.status === "rejected" || v.status === "expired") && v.reason && <div className="mt-0.5 text-muted">{v.reason}</div>}
      <div className="mt-1 flex flex-wrap gap-1.5">
        {v.status === "pending_approval" && (
          <button type="button" onClick={() => setOpen((x) => !x)} className="rounded-md border border-accent px-2 py-0.5 text-accent">
            预览并批准
          </button>
        )}
        {v.status === "blocked" && (
          <button type="button" onClick={() => setOpen((x) => !x)} className="rounded-md border border-border px-2 py-0.5 text-foreground">
            查看原因
          </button>
        )}
        {v.canRegenerate !== false && v.status !== "pending_approval" && v.status !== "sent" && (
          <button type="button" disabled={busy} onClick={regenerate} className="rounded-md bg-accent px-2 py-0.5 text-[color:var(--on-accent)] disabled:opacity-50">
            {busy ? "生成中…" : "生成质保邮件"}
          </button>
        )}
      </div>
      {open && v.status === "pending_approval" && (
        <div className="mt-2 w-[min(36rem,80vw)]">
          <WarrantyApprove
            view={v}
            onDone={(didSend) => {
              setOpen(false);
              if (didSend) onChanged();
            }}
          />
        </div>
      )}
      {open && (v.status === "blocked" || v.status === "error") && (
        <div className="mt-2 w-[min(28rem,80vw)]">
          <WarrantyBlocked view={v} />
        </div>
      )}
    </div>
  );
}

/** 质保设置面板（老板可改，会计只读） */
export function WarrantySettingsPanel() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<WarrantySettings | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await apiFetch(`/api/install/warranty-settings`);
    if (!res.ok) {
      setMsg("无权查看质保设置");
      return;
    }
    const data = (await res.json()) as { settings: WarrantySettings; canEdit: boolean; saved: boolean };
    setSettings(data.settings);
    setCanEdit(data.canEdit);
    setSaved(data.saved);
  }, []);

  useEffect(() => {
    if (open && !settings) void load();
  }, [open, settings, load]);

  const setYears = (c: (typeof WARRANTY_CATEGORIES)[number], part: WarrantyPart, value: string) => {
    if (!settings) return;
    const list = settings.terms[c].filter((t) => t.part !== part);
    if (value.trim() !== "") list.push({ part, years: Number(value) });
    list.sort((a, b) => WARRANTY_PARTS.indexOf(a.part) - WARRANTY_PARTS.indexOf(b.part));
    setSettings({ ...settings, terms: { ...settings.terms, [c]: list } });
  };
  const setContact = (k: keyof WarrantySettings["contact"], value: string) => {
    if (!settings) return;
    setSettings({ ...settings, contact: { ...settings.contact, [k]: value } });
  };

  const save = async () => {
    if (!settings) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiFetch(`/api/install/warranty-settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; settings?: WarrantySettings };
      if (!res.ok) {
        setMsg(data.error || "保存失败");
        return;
      }
      if (data.settings) setSettings(data.settings);
      setSaved(true);
      setMsg("已保存");
    } finally {
      setBusy(false);
    }
  };

  const yearsOf = (c: (typeof WARRANTY_CATEGORIES)[number], part: WarrantyPart) =>
    settings?.terms[c].find((t) => t.part === part)?.years?.toString() ?? "";

  return (
    <div className="rounded-lg border border-border">
      <button type="button" onClick={() => setOpen((x) => !x)} className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm text-foreground" aria-expanded={open}>
        <Settings2 size={15} className="text-accent" /> 质保设置
        <span className="ml-auto text-xs text-muted">年限以报价单为准；报修电话 / 邮箱填好后才会生成质保邮件</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3 text-sm">
          {!settings && !msg && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 size={14} className="animate-spin" /> 加载中
            </div>
          )}
          {settings && (
            <>
              {!saved && <p className="text-xs text-muted">当前为默认值（报价单口径），尚未保存过。</p>}
              <div className="overflow-x-auto">
                <table className="text-xs">
                  <thead className="text-muted">
                    <tr>
                      <th className="px-2 py-1 text-left">品类（年）</th>
                      {WARRANTY_PARTS.map((p) => (
                        <th key={p} className="px-2 py-1">
                          {PART_LABEL_ZH[p]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {WARRANTY_CATEGORIES.map((c) => (
                      <tr key={c}>
                        <td className="px-2 py-1 text-foreground">{CATEGORY_LABEL_ZH[c]}</td>
                        {WARRANTY_PARTS.map((p) => (
                          <td key={p} className="px-2 py-1">
                            <input
                              aria-label={`${CATEGORY_LABEL_ZH[c]} ${PART_LABEL_ZH[p]} 年限`}
                              type="number"
                              min={0}
                              max={50}
                              disabled={!canEdit}
                              value={yearsOf(c, p)}
                              placeholder="—"
                              onChange={(e) => setYears(c, p, e.target.value)}
                              className="w-16 rounded border border-border bg-background px-1.5 py-1 text-center disabled:opacity-70"
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["companyName", "公司名"],
                    ["phone", "报修电话"],
                    ["email", "报修邮箱"],
                    ["address", "地址"],
                    ["warrantyUrl", "质保条款链接"],
                  ] as Array<[keyof WarrantySettings["contact"], string]>
                ).map(([k, label]) => (
                  <label key={k} className="block text-xs text-muted">
                    {label}
                    <input
                      disabled={!canEdit}
                      value={settings.contact[k]}
                      onChange={(e) => setContact(k, e.target.value)}
                      className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground disabled:opacity-70"
                    />
                  </label>
                ))}
              </div>
              {canEdit ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={save}
                  className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm text-[color:var(--on-accent)] disabled:opacity-50"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  保存质保设置
                </button>
              ) : (
                <p className="text-xs text-muted">只有老板可以修改。</p>
              )}
            </>
          )}
          {msg && <p className={`text-xs ${msg === "已保存" ? "text-[#2e7a56]" : "text-danger"}`}>{msg}</p>}
        </div>
      )}
    </div>
  );
}
