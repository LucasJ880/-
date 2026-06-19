"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Loader2,
  RefreshCw,
  Upload,
  Wand2,
  Send,
  ImageIcon,
  AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { apiFetch } from "@/lib/api-fetch";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";

interface Asset {
  id: string;
  kind: string;
  fileUrl: string;
  fileName: string;
  mimeType: string | null;
  createdAt: string;
}

interface ServiceRequest {
  id: string;
  title: string;
  requestType: string;
  description: string | null;
  status: string;
  priority: string;
  structuredSpec: Record<string, unknown> | null;
  sourceChannel: string | null;
  externalUserId: string | null;
  createdAt: string;
  assets?: Asset[];
}

const STATUS_LABELS: Record<string, string> = {
  new: "新建",
  accepted: "已受理",
  in_progress: "处理中",
  delivered: "已交付",
  closed: "已关闭",
  cancelled: "已取消",
};

const TYPE_LABELS: Record<string, string> = {
  design_image: "美工出图",
  doc_summary: "文档总结",
  meeting_minutes: "会议纪要",
  group_summary: "群聊总结",
  other: "其它",
};

export default function FulfillmentConsolePage() {
  const { orgId, ambiguous, loading: orgLoading } = useCurrentOrgId();

  const [rows, setRows] = useState<ServiceRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ServiceRequest | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(
        `/api/trade/service-requests?view=fulfillment&orgId=${encodeURIComponent(orgId)}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "加载失败");
      setRows(data.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  const loadDetail = useCallback(
    async (id: string) => {
      if (!orgId) return;
      setDetailLoading(true);
      try {
        const res = await apiFetch(
          `/api/trade/service-requests/${id}?orgId=${encodeURIComponent(orgId)}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "加载详情失败");
        setDetail(data.request);
      } catch (e) {
        setToast(e instanceof Error ? e.message : "加载详情失败");
      } finally {
        setDetailLoading(false);
      }
    },
    [orgId],
  );

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  };

  const uploadInput = async (file: File) => {
    if (!detail || !orgId) return;
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "input");
      const res = await apiFetch(
        `/api/trade/service-requests/${detail.id}/assets?orgId=${encodeURIComponent(orgId)}`,
        { method: "POST", body: fd },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "上传失败");
      showToast("输入图已上传");
      await loadDetail(detail.id);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "上传失败");
    } finally {
      setBusy(null);
    }
  };

  const runImage = async (inputAssetId: string) => {
    if (!detail || !orgId) return;
    if (!prompt.trim()) {
      showToast("请先填写出图提示词");
      return;
    }
    setBusy(`process:${inputAssetId}`);
    try {
      const res = await apiFetch(
        `/api/trade/service-requests/${detail.id}/process?orgId=${encodeURIComponent(orgId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ inputAssetId, prompt: prompt.trim() }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "出图失败");
      showToast("出图完成，已生成交付物");
      await loadDetail(detail.id);
      void loadList();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "出图失败");
    } finally {
      setBusy(null);
    }
  };

  const deliver = async () => {
    if (!detail || !orgId) return;
    setBusy("deliver");
    try {
      const res = await apiFetch(
        `/api/trade/service-requests/${detail.id}/deliver?orgId=${encodeURIComponent(orgId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "交付失败");
      showToast(
        data.sent
          ? "已交付并回传客户微信"
          : `已标记交付，但回传失败：${data.sendError || "未知"}`,
      );
      await loadDetail(detail.id);
      void loadList();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "交付失败");
    } finally {
      setBusy(null);
    }
  };

  const inputs = (detail?.assets ?? []).filter((a) => a.kind === "input");
  const deliverables = (detail?.assets ?? []).filter((a) => a.kind === "deliverable");

  return (
    <div className="space-y-6">
      <PageHeader
        title="履约控制台"
        description="加拿大团队视角：处理被指派的外贸客户工单 — 上传输入图、gpt-image-2 出图、交付回传客户微信。"
        actions={
          <button
            onClick={() => loadList()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-muted/10"
          >
            <RefreshCw className="h-4 w-4" /> 刷新
          </button>
        }
      />

      {ambiguous ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4" /> 当前账号属于多个组织，请在顶部切换到处理方组织。
        </div>
      ) : null}

      {toast ? (
        <div className="rounded-md border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm">
          {toast}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        {/* 工单列表 */}
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3 text-sm font-medium text-foreground">
            被指派工单 {rows.length ? `(${rows.length})` : ""}
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {orgLoading || loading ? (
              <div className="flex items-center justify-center py-10 text-muted">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : error ? (
              <div className="px-4 py-6 text-sm text-red-600">{error}</div>
            ) : rows.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted">暂无被指派的工单</div>
            ) : (
              rows.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`flex w-full flex-col items-start gap-1 border-b border-border px-4 py-3 text-left hover:bg-muted/10 ${
                    selectedId === r.id ? "bg-muted/15" : ""
                  }`}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-foreground">
                      {r.title}
                    </span>
                    <span className="shrink-0 rounded-full bg-muted/20 px-2 py-0.5 text-[11px] text-muted">
                      {STATUS_LABELS[r.status] ?? r.status}
                    </span>
                  </div>
                  <span className="text-[12px] text-muted">
                    {TYPE_LABELS[r.requestType] ?? r.requestType} ·{" "}
                    {new Date(r.createdAt).toLocaleString("zh-CN")}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 工单详情 + 操作 */}
        <div className="rounded-lg border border-border bg-card">
          {!detail ? (
            <div className="flex h-full min-h-[40vh] items-center justify-center text-sm text-muted">
              {detailLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                "从左侧选择一个工单"
              )}
            </div>
          ) : (
            <div className="space-y-5 p-5">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">{detail.title}</h2>
                  <span className="rounded-full bg-muted/20 px-2 py-0.5 text-[11px] text-muted">
                    {STATUS_LABELS[detail.status] ?? detail.status}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-muted">
                  {TYPE_LABELS[detail.requestType] ?? detail.requestType} · 优先级 {detail.priority}
                  {detail.sourceChannel ? ` · 来源 ${detail.sourceChannel}` : ""}
                </p>
                {detail.description ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                    {detail.description}
                  </p>
                ) : null}
                {detail.structuredSpec && Object.keys(detail.structuredSpec).length > 0 ? (
                  <pre className="mt-2 overflow-x-auto rounded-md bg-muted/10 p-3 text-[12px] text-foreground">
                    {JSON.stringify(detail.structuredSpec, null, 2)}
                  </pre>
                ) : null}
              </div>

              {/* 输入图 */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">输入素材</h3>
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[13px] text-foreground hover:bg-muted/10">
                    {busy === "upload" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    上传输入图
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      disabled={busy === "upload"}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadInput(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                {inputs.length === 0 ? (
                  <p className="text-[13px] text-muted">暂无输入图，请上传客户产品图。</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {inputs.map((a) => (
                      <div key={a.id} className="rounded-md border border-border p-2">
                        {a.mimeType?.startsWith("image/") ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={a.fileUrl}
                            alt={a.fileName}
                            className="h-28 w-full rounded object-cover"
                          />
                        ) : (
                          <div className="flex h-28 items-center justify-center text-muted">
                            <ImageIcon className="h-6 w-6" />
                          </div>
                        )}
                        <button
                          onClick={() => runImage(a.id)}
                          disabled={busy === `process:${a.id}`}
                          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-foreground px-2 py-1 text-[12px] font-medium text-background hover:opacity-90 disabled:opacity-50"
                        >
                          {busy === `process:${a.id}` ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Wand2 className="h-3.5 w-3.5" />
                          )}
                          出图
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="出图提示词（如：纯白背景电商主图，柔和投影，高级质感，突出产品细节）"
                  rows={3}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </section>

              {/* 交付物 */}
              <section className="space-y-2">
                <h3 className="text-sm font-medium text-foreground">交付物</h3>
                {deliverables.length === 0 ? (
                  <p className="text-[13px] text-muted">暂无交付物。出图后会出现在这里。</p>
                ) : (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {deliverables.map((a) => (
                      <a
                        key={a.id}
                        href={a.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-border p-2 hover:bg-muted/10"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={a.fileUrl}
                          alt={a.fileName}
                          className="h-28 w-full rounded object-cover"
                        />
                        <span className="mt-1 block truncate text-[12px] text-muted">
                          {a.fileName}
                        </span>
                      </a>
                    ))}
                  </div>
                )}
              </section>

              {/* 交付回传 */}
              <div className="flex items-center justify-end border-t border-border pt-4">
                <button
                  onClick={deliver}
                  disabled={busy === "deliver" || deliverables.length === 0}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {busy === "deliver" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  交付并回传客户微信
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
