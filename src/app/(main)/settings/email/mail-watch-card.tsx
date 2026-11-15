"use client";

/**
 * 客户来信提醒（MAIL-2 · spec mail/inbound-watch）
 *
 * 成员本人的勾选项（默认不勾）+ 持销售设置管理权限的成员才看到的组织开关。
 * 显示哪种状态由 mailWatchPanelState 决定；平台开关关闭时接口返回 404 → 整块不渲染。
 * 数据：GET / PUT /api/sales/mail-watch/opt-in；PUT /api/organizations/{orgId}/mail-watch-settings
 */

import { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { mailWatchPanelState, type MailWatchOptInStatus } from "@/lib/mail-watch/ui-pure";

export function MailWatchCard({ orgId, onReauth }: { orgId: string | null; onReauth: () => void }) {
  const [status, setStatus] = useState<MailWatchOptInStatus | null>(null);
  const [saving, setSaving] = useState<"opt_in" | "org" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await apiFetch("/api/sales/mail-watch/opt-in");
      // 平台开关关闭（404）或邮箱绑定页不对本人放行（403）：整块不显示
      if (!res.ok) return setStatus(null);
      const data = (await res.json()) as { status?: MailWatchOptInStatus };
      setStatus(data.status ?? null);
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, orgId]);

  const panel = mailWatchPanelState(status);
  if (!panel.visible) return null;

  const put = async (kind: "opt_in" | "org", url: string, body: Record<string, boolean>) => {
    setSaving(kind);
    setError("");
    try {
      const res = await apiFetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "保存失败，请重试");
      }
      await load();
    } catch {
      setError("保存失败，请重试");
    } finally {
      setSaving(null);
    }
  };

  const checkboxDisabled = panel.checkbox !== "enabled" || saving !== null;

  return (
    <div data-testid="mail-watch-panel" className="rounded-xl border border-border bg-card-bg p-5">
      <div className="flex items-start gap-3">
        <div className="shrink-0 rounded-lg bg-accent/10 p-2">
          <BellRing size={18} className="text-accent" />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">客户来信提醒</h3>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              勾选后，青砚每 15 分钟看一次你本人邮箱的收件箱：已建档的客户来信，会给你发一条站内通知（绑定了微信也会推一条），并记到客户的时间线上。
              只读取你本人的邮箱，只提醒已建档客户的来信；只看发件人、主题和时间，不读取正文，也不会标已读、归档或删除。
            </p>
          </div>

          <label
            className={`flex items-start gap-2 text-sm ${
              panel.checkbox === "enabled" ? "cursor-pointer text-foreground" : "cursor-not-allowed text-muted-foreground"
            }`}
          >
            <input
              type="checkbox"
              data-testid="mail-watch-opt-in"
              className="mt-0.5 h-4 min-h-0 w-4 shrink-0 rounded border-border"
              checked={panel.checked}
              disabled={checkboxDisabled}
              onChange={(e) => put("opt_in", "/api/sales/mail-watch/opt-in", { optedIn: e.target.checked })}
            />
            <span className="min-w-0">
              客户来信时提醒我
              {saving === "opt_in" && <Loader2 size={12} className="ml-1.5 inline animate-spin" />}
              {panel.checkbox === "disabled_org_off" && (
                <span data-testid="mail-watch-org-off-note" className="mt-0.5 block text-[11px] leading-relaxed">
                  {panel.showOrgSwitch
                    ? "企业还没有开启客户来信提醒，开启下面的企业开关后才能勾选。"
                    : "企业还没有开启客户来信提醒，需要管理员先开启后才能勾选。"}
                </span>
              )}
            </span>
          </label>

          {panel.checkbox === "enabled" && panel.checked && panel.hint && (
            <div
              data-testid="mail-watch-hint"
              className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2"
            >
              <p className="text-[11px] leading-relaxed text-amber-900">
                {panel.hint === "needs_google"
                  ? "已勾选，但你还没有连接 Google 邮箱，暂时不会提醒。请先在上面连接 Google 邮箱。"
                  : "已勾选，但当前授权没有读信权限，暂时不会提醒。请重新授权并同意读取邮件。"}
              </p>
              {panel.hint === "needs_reauth" && (
                <button
                  onClick={onReauth}
                  className="shrink-0 rounded-md border border-amber-300 bg-card-bg px-2.5 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100"
                >
                  重新授权
                </button>
              )}
            </div>
          )}

          {panel.showOrgSwitch && (
            <div
              data-testid="mail-watch-org-switch"
              className="flex items-center justify-between gap-3 border-t border-border pt-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">企业开关（仅管理员可见）</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  {panel.orgEnabled
                    ? "已开启：成员可以各自勾选。关闭后所有人的来信提醒都会停，成员的勾选会保留。"
                    : "未开启：成员的勾选项不可用。开启后只有自己勾选的成员才会被读取收件箱。"}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={panel.orgEnabled}
                aria-label="企业客户来信提醒开关"
                disabled={saving !== null || !orgId}
                onClick={() => orgId && put("org", `/api/organizations/${orgId}/mail-watch-settings`, { enabled: !panel.orgEnabled })}
                className="inline-flex shrink-0 items-center disabled:opacity-60"
              >
                {/* 全局样式给 button 定了 44px 的最小高度（触控目标）：按钮本身透明，里面这条才是看得见的开关 */}
                <span className={`relative block h-6 w-11 rounded-full transition-colors ${panel.orgEnabled ? "bg-accent" : "bg-border"}`}>
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      panel.orgEnabled ? "left-[22px]" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      </div>
    </div>
  );
}
