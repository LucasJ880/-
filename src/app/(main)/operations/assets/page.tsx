"use client";

/**
 * 视频资产队列 — Aivora 成片入库 + 手动登记 + 扇出派发
 * 视频文件不经过青砚，只登记外部 URL；发布任务按账号组扇出。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Plus, RefreshCw, Send } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { OrgSelectBanner } from "@/components/org-select-banner";
import { cn } from "@/lib/utils";

interface VideoAssetRow {
  id: string;
  source: string;
  title: string;
  topic: string | null;
  language: string;
  videoUrl: string;
  durationSec: number | null;
  status: string;
  createdAt: string;
  jobStats: { total: number; queued: number; held: number; published: number; failed: number };
}

interface MatrixAccountLite {
  id: string;
  groupName: string;
  status: string;
}

const STATUS_LABELS: Record<string, string> = {
  pending: "待配文案",
  ready: "可排期",
  scheduled: "已排期",
  published: "已发布",
  blocked: "已拦截",
};

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-stone-200 text-stone-600",
  ready: "bg-sky-100 text-sky-700",
  scheduled: "bg-amber-100 text-amber-700",
  published: "bg-emerald-100 text-emerald-700",
  blocked: "bg-red-100 text-red-700",
};

export default function VideoAssetsPage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();
  const [assets, setAssets] = useState<VideoAssetRow[]>([]);
  const [accounts, setAccounts] = useState<MatrixAccountLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [fTitle, setFTitle] = useState("");
  const [fUrl, setFUrl] = useState("");
  const [fTopic, setFTopic] = useState("");
  const [fLang, setFLang] = useState("en");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [fanoutAssetId, setFanoutAssetId] = useState<string | null>(null);
  const [fanoutGroup, setFanoutGroup] = useState("");
  const [fanoutCaption, setFanoutCaption] = useState("");
  const [fanoutHashtags, setFanoutHashtags] = useState("");
  const [fanoutTime, setFanoutTime] = useState("");
  const [fanoutBusy, setFanoutBusy] = useState(false);
  const [fanoutError, setFanoutError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [assetsRes, accountsRes] = await Promise.all([
        apiFetch("/api/operations/video-assets"),
        apiFetch("/api/operations/matrix-accounts"),
      ]);
      const assetsData = await assetsRes.json();
      if (!assetsRes.ok) throw new Error(assetsData.error || "加载失败");
      setAssets(assetsData.assets);
      const accountsData = await accountsRes.json();
      if (accountsRes.ok) setAccounts(accountsData.accounts);
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

  const groupNames = useMemo(
    () => [...new Set(accounts.filter((a) => a.status === "active").map((a) => a.groupName))],
    [accounts],
  );

  async function handleSync() {
    setSyncing(true);
    setNotice(null);
    setError(null);
    try {
      const res = await apiFetch("/api/operations/video-assets/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "同步失败");
      setNotice(`Aivora 同步完成：拉取 ${data.fetched} 条，新入库 ${data.created} 条`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreate() {
    if (!fTitle.trim() || !fUrl.trim() || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await apiFetch("/api/operations/video-assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          title: fTitle.trim(),
          videoUrl: fUrl.trim(),
          topic: fTopic.trim() || undefined,
          language: fLang,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "登记失败");
      setFTitle("");
      setFUrl("");
      setFTopic("");
      setShowForm(false);
      await load();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "登记失败");
    } finally {
      setSaving(false);
    }
  }

  function openFanout(assetId: string) {
    setFanoutAssetId(assetId === fanoutAssetId ? null : assetId);
    setFanoutGroup(groupNames[0] ?? "");
    setFanoutCaption("");
    setFanoutHashtags("");
    setFanoutTime("");
    setFanoutError(null);
  }

  async function handleFanout() {
    if (!fanoutAssetId || !fanoutCaption.trim() || !fanoutGroup || fanoutBusy) return;
    setFanoutBusy(true);
    setFanoutError(null);
    try {
      const res = await apiFetch(`/api/operations/video-assets/${fanoutAssetId}/fanout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          groupName: fanoutGroup,
          captionText: fanoutCaption.trim(),
          hashtags: fanoutHashtags.trim() || undefined,
          scheduledAt: fanoutTime ? new Date(fanoutTime).toISOString() : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "派发失败");
      const parts = [`新建 ${data.createdJobs} 个任务`, `入队 ${data.queued}`];
      if (data.held > 0) parts.push(`待审核 ${data.held}`);
      if (data.blocked > 0) parts.push(`规则拦截 ${data.blocked}`);
      if (data.failed > 0) parts.push(`失败 ${data.failed}`);
      if (data.variantFallback) parts.push("部分文案未差异化（AI 未配置或超时）");
      setNotice(
        `派发完成：${parts.join("，")}` +
          (data.errors.length ? `（${data.errors.slice(0, 3).join("；")}）` : ""),
      );
      setFanoutAssetId(null);
      await load();
    } catch (e) {
      setFanoutError(e instanceof Error ? e.message : "派发失败");
    } finally {
      setFanoutBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">视频资产</h1>
          <p className="mt-1 text-sm text-muted">
            Aivora 成片自动入库（每小时）+ 手动登记。配文案后按账号组扇出到 Postiz / PostFlow。
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
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-background disabled:opacity-50"
          >
            <Download size={14} className={cn(syncing && "animate-pulse")} />
            {syncing ? "同步中…" : "同步 Aivora"}
          </button>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus size={14} />
            手动登记
          </button>
        </div>
      </div>

      <OrgSelectBanner />

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      {showForm && (
        <div className="space-y-3 rounded-xl border border-border bg-card-bg p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted">
              标题
              <input
                value={fTitle}
                onChange={(e) => setFTitle(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1 text-xs text-muted">
              视频 URL（外部可访问）
              <input
                value={fUrl}
                onChange={(e) => setFUrl(e.target.value)}
                placeholder="https://…"
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1 text-xs text-muted">
              主题（用于匹配账号组）
              <input
                value={fTopic}
                onChange={(e) => setFTopic(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1 text-xs text-muted">
              语言
              <select
                value={fLang}
                onChange={(e) => setFLang(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
              >
                <option value="en">英文</option>
                <option value="zh">中文</option>
              </select>
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
              disabled={saving || !fTitle.trim() || !fUrl.trim()}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      )}

      {assets.length === 0 && !loading ? (
        <div className="rounded-xl border border-border bg-card-bg px-4 py-10 text-center text-sm text-muted">
          队列为空。配置 Aivora 后点「同步 Aivora」，或手动登记一条视频。
        </div>
      ) : (
        <div className="space-y-2">
          {assets.map((a) => (
            <div key={a.id} className="rounded-xl border border-border bg-card-bg">
              <div className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{a.title}</span>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs",
                        STATUS_STYLES[a.status] ?? "bg-stone-200 text-stone-600",
                      )}
                    >
                      {STATUS_LABELS[a.status] ?? a.status}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
                    <span>{a.source === "aivora" ? "Aivora" : a.source === "manual" ? "手动" : a.source}</span>
                    {a.topic && <span>主题：{a.topic}</span>}
                    <span>{a.language === "zh" ? "中文" : "英文"}</span>
                    {a.durationSec != null && <span>{a.durationSec}s</span>}
                    {a.jobStats.total > 0 && (
                      <span>
                        任务 {a.jobStats.total}（队列 {a.jobStats.queued} / 已发 {a.jobStats.published}
                        {a.jobStats.held > 0 && ` / 待审 ${a.jobStats.held}`}
                        {a.jobStats.failed > 0 && ` / 失败 ${a.jobStats.failed}`}）
                      </span>
                    )}
                    <a
                      href={a.videoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline"
                    >
                      预览
                    </a>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => openFanout(a.id)}
                  className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted transition-colors hover:bg-background"
                >
                  <Send size={14} />
                  扇出派发
                </button>
              </div>

              {fanoutAssetId === a.id && (
                <div className="space-y-3 border-t border-border px-4 py-3">
                  {groupNames.length === 0 ? (
                    <p className="text-sm text-muted">
                      还没有可用的矩阵账号组，先到「矩阵账号」页登记账号。
                    </p>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <label className="space-y-1 text-xs text-muted">
                          目标账号组
                          <select
                            value={fanoutGroup}
                            onChange={(e) => setFanoutGroup(e.target.value)}
                            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                          >
                            {groupNames.map((g) => (
                              <option key={g} value={g}>{g}</option>
                            ))}
                          </select>
                        </label>
                        <label className="space-y-1 text-xs text-muted">
                          话题标签（可选）
                          <input
                            value={fanoutHashtags}
                            onChange={(e) => setFanoutHashtags(e.target.value)}
                            placeholder="#smartblinds #toronto"
                            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                          />
                        </label>
                        <label className="space-y-1 text-xs text-muted">
                          定时发布（可选，留空立即）
                          <input
                            type="datetime-local"
                            value={fanoutTime}
                            onChange={(e) => setFanoutTime(e.target.value)}
                            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                          />
                        </label>
                      </div>
                      <label className="block space-y-1 text-xs text-muted">
                        发布文案
                        <textarea
                          value={fanoutCaption}
                          onChange={(e) => setFanoutCaption(e.target.value)}
                          rows={3}
                          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
                        />
                      </label>
                      {fanoutError && <p className="text-sm text-red-600">{fanoutError}</p>}
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleFanout}
                          disabled={fanoutBusy || !fanoutCaption.trim() || !fanoutGroup}
                          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                        >
                          {fanoutBusy ? "派发中…" : "派发到账号组"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
