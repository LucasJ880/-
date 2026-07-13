"use client";

/**
 * 矩阵账号登记 — 运营矩阵的账号台账
 * 英文社媒（IG/FB/TikTok → Postiz）+ 小红书（→ PostFlow worker）
 * 按账号组管理 persona 与发布通道，供视频资产扇出派发使用。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Plus, RefreshCw, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { cn } from "@/lib/utils";

interface MatrixAccount {
  id: string;
  platform: string;
  handle: string;
  displayName: string | null;
  groupName: string;
  publishChannel: string;
  externalChannelId: string | null;
  status: string;
  tier: string;
  dailyQuota: number;
}

const PLATFORM_LABELS: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  xiaohongshu: "小红书",
};

const CHANNEL_LABELS: Record<string, string> = {
  postiz: "Postiz（官方 API）",
  postflow: "PostFlow（服务器 worker）",
  manual: "手动发布",
};

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700",
  limited: "bg-amber-100 text-amber-700",
  banned: "bg-red-100 text-red-700",
  paused: "bg-stone-200 text-stone-600",
};

const STATUS_LABELS: Record<string, string> = {
  active: "正常",
  limited: "限流",
  banned: "封禁",
  paused: "暂停",
};

export default function MatrixAccountsPage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [accounts, setAccounts] = useState<MatrixAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fPlatform, setFPlatform] = useState("instagram");
  const [fHandle, setFHandle] = useState("");
  const [fGroup, setFGroup] = useState("");
  const [fChannel, setFChannel] = useState("postiz");
  const [fChannelId, setFChannelId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/api/operations/matrix-accounts");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      setAccounts(data.accounts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (orgLoading || ambiguous) return;
    load();
  }, [orgLoading, ambiguous, orgId, load]);

  const groups = useMemo(() => {
    const m = new Map<string, MatrixAccount[]>();
    for (const a of accounts) {
      const list = m.get(a.groupName) ?? [];
      list.push(a);
      m.set(a.groupName, list);
    }
    return [...m.entries()];
  }, [accounts]);

  async function handleCreate() {
    if (!fHandle.trim() || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await apiFetch("/api/operations/matrix-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          platform: fPlatform,
          handle: fHandle.trim(),
          groupName: fGroup.trim() || "默认组",
          publishChannel: fChannel,
          externalChannelId: fChannelId.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      setFHandle("");
      setFChannelId("");
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(id: string, status: string) {
    try {
      const res = await apiFetch(`/api/operations/matrix-accounts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, status }),
      });
      if (res.ok) await load();
    } catch {
      /* 列表刷新时会重新拉取 */
    }
  }

  async function handleTierToggle(a: MatrixAccount) {
    const next = a.tier === "premium" ? "matrix" : "premium";
    const hint =
      next === "premium"
        ? `把 ${a.handle} 升为精品号？之后该账号的每条发布都会进人工审核。`
        : `把 ${a.handle} 降回矩阵号？恢复自动发布 + 抽检。`;
    if (!window.confirm(hint)) return;
    try {
      const res = await apiFetch(`/api/operations/matrix-accounts/${a.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId, tier: next }),
      });
      if (res.ok) await load();
    } catch {
      /* 列表刷新时会重新拉取 */
    }
  }

  async function handleDelete(id: string, handle: string) {
    if (!window.confirm(`删除账号 ${handle}？其发布任务记录会一并删除。`)) return;
    try {
      const res = await apiFetch(`/api/operations/matrix-accounts/${id}`, {
        method: "DELETE",
      });
      if (res.ok) await load();
    } catch {
      /* 忽略，下次刷新可重试 */
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">矩阵账号</h1>
          <p className="mt-1 text-sm text-muted">
            英文社媒（Postiz 官方 API）与小红书（PostFlow worker）的账号台账，按账号组扇出发布。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-background"
          >
            <RefreshCw size={14} className={cn(loading && "animate-spin")} />
            刷新
          </button>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus size={14} />
            登记账号
          </button>
        </div>
      </div>

      <OrgSelectBanner />

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}

      {showForm && (
        <div className="space-y-3 rounded-xl border border-border bg-card-bg p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="space-y-1 text-xs text-muted">
              平台
              <select
                value={fPlatform}
                onChange={(e) => setFPlatform(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              >
                {Object.entries(PLATFORM_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted">
              账号名（handle）
              <input
                value={fHandle}
                onChange={(e) => setFHandle(e.target.value)}
                placeholder="@sunnyshutter_to"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1 text-xs text-muted">
              账号组
              <input
                value={fGroup}
                onChange={(e) => setFGroup(e.target.value)}
                placeholder="如：EN 智能家居"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1 text-xs text-muted">
              发布通道
              <select
                value={fChannel}
                onChange={(e) => setFChannel(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              >
                {Object.entries(CHANNEL_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted">
              通道账号标识（Postiz integration id / PostFlow account 名）
              <input
                value={fChannelId}
                onChange={(e) => setFChannelId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
          </div>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-background"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={saving || !fHandle.trim()}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      )}

      {accounts.length === 0 && !loading ? (
        <div className="rounded-xl border border-border bg-card-bg px-4 py-10 text-center text-sm text-muted">
          还没有登记矩阵账号。点「登记账号」逐个录入，或之后用导入脚本批量登记。
        </div>
      ) : (
        groups.map(([groupName, list]) => (
          <div key={groupName} className="overflow-hidden rounded-xl border border-border bg-card-bg">
            <div className="border-b border-border px-4 py-2.5 text-xs font-medium text-muted">
              {groupName}（{list.length}）
            </div>
            <table className="w-full text-sm">
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-b-0">
                    <td className="px-4 py-2.5 font-medium">
                      {a.handle}
                      <span className="ml-2 text-xs text-muted">
                        {PLATFORM_LABELS[a.platform] ?? a.platform}
                      </span>
                      {a.tier === "premium" && (
                        <span className="ml-2 inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                          <Crown size={10} />
                          精品号
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">
                      {CHANNEL_LABELS[a.publishChannel] ?? a.publishChannel}
                      {a.externalChannelId && (
                        <span className="ml-1 text-[11px]">· {a.externalChannelId}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted">配额 {a.dailyQuota}/天</td>
                    <td className="px-4 py-2.5">
                      <select
                        value={a.status}
                        onChange={(e) => handleStatusChange(a.id, e.target.value)}
                        className={cn(
                          "rounded-full border-0 px-2 py-0.5 text-xs",
                          STATUS_STYLES[a.status] ?? "bg-stone-200 text-stone-600",
                        )}
                      >
                        {Object.entries(STATUS_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => handleTierToggle(a)}
                        className={cn(
                          "rounded-md p-1.5 transition-colors",
                          a.tier === "premium"
                            ? "text-amber-500 hover:bg-amber-50"
                            : "text-muted hover:bg-amber-50 hover:text-amber-600",
                        )}
                        title={a.tier === "premium" ? "降回矩阵号" : "升为精品号（发布全审）"}
                      >
                        <Crown size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(a.id, a.handle)}
                        className="rounded-md p-1.5 text-muted transition-colors hover:bg-red-50 hover:text-red-600"
                        title="删除账号"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
