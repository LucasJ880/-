"use client";

/**
 * S3-A「供应商线索」——系统发现结果与人工提交线索统一处理。
 *
 * 安全与诚实纪律：
 *   - 社媒文案/供应商文本一律按**不可信数据**渲染：只做纯文本输出，不解释 HTML，
 *     不执行其中的任何指令，外链一律 rel="noopener noreferrer nofollow" 且不自动打开；
 *   - 前端不因用户提交 URL 发起任何抓取或后台请求；
 *   - 来源能力如实展示（公开搜索结果 ≠ 直连平台；视频号需手动提交）；
 *   - 身份关联 ≠ 采购批准：状态文案不出现「合格 / 首选 / 可下单」。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, Plus, RefreshCw } from "lucide-react";
import { Drawer } from "@/components/ui/drawer";
import {
  platformDisplay,
  resolutionDecisionDisplay,
  scanCompletenessDisplay,
  signalStatusDisplay,
  sourceOriginDisplay,
} from "@/lib/supplier-intel/workspace-labels";
import {
  WorkspaceApiError,
  workspaceFetch,
  type ResolutionResult,
  type SignalPagePayload,
  type SignalRow,
  type SupplierOption,
} from "./types";

const TONE_CLASS: Record<string, string> = {
  neutral: "bg-[var(--background)] text-[var(--muted)] border-[var(--border)]",
  info: "bg-[var(--info-bg)] text-[var(--info)] border-transparent",
  success: "bg-[var(--success-bg)] text-[var(--success)] border-transparent",
  warning: "bg-[var(--warning-bg)] text-[var(--warning)] border-transparent",
  danger: "bg-[var(--danger-bg)] text-[var(--danger)] border-transparent",
};

const STATUS_FILTERS = [
  { key: "", label: "全部" },
  { key: "NEW", label: "待查看" },
  { key: "REVIEWED", label: "已查看待处理" },
  { key: "LINKED", label: "已关联" },
  { key: "REJECTED", label: "不采用" },
] as const;

export function SignalsPanel({
  orgId,
  projectId,
  runFilterId,
  canWrite,
  onClearRunFilter,
}: {
  orgId: string;
  projectId: string;
  runFilterId: string | null;
  canWrite: boolean;
  onClearRunFilter: () => void;
}) {
  const [page, setPage] = useState<SignalPagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [cursorStack, setCursorStack] = useState<string[]>([]);
  const [selected, setSelected] = useState<SignalRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const cursor = cursorStack.length > 0 ? cursorStack[cursorStack.length - 1] : null;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ orgId, projectId });
    if (status) qs.set("status", status);
    if (runFilterId) qs.set("searchRunId", runFilterId);
    if (cursor) qs.set("cursor", cursor);
    try {
      const data = await workspaceFetch<SignalPagePayload>(
        `/api/supplier-intel/signals?${qs.toString()}`,
        { signal: ctrl.signal },
      );
      if (!ctrl.signal.aborted) setPage(data);
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : "加载失败");
      setPage(null);
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [orgId, projectId, status, runFilterId, cursor]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  // 切换筛选/项目时回到第一页，避免游标串页
  useEffect(() => {
    setCursorStack([]);
  }, [status, runFilterId, projectId, orgId]);

  const refreshAfterWrite = useCallback(
    async (signalId: string) => {
      await load();
      try {
        const fresh = await workspaceFetch<{ signal: SignalRow }>(
          `/api/supplier-intel/signals/${signalId}?orgId=${encodeURIComponent(orgId)}`,
        );
        setSelected(fresh.signal);
      } catch {
        setSelected(null);
      }
    },
    [load, orgId],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="线索状态筛选">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key || "all"}
              type="button"
              aria-pressed={status === f.key}
              onClick={() => setStatus(f.key)}
              className={`rounded-full border px-3 py-1 text-xs ${
                status === f.key
                  ? "border-transparent bg-[var(--accent)] text-[color:var(--on-accent)]"
                  : "border-[var(--border)]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {runFilterId ? (
          <button
            type="button"
            onClick={onClearRunFilter}
            className="rounded-full border border-[var(--accent)] px-3 py-1 text-xs text-[var(--accent)]"
          >
            仅看某次搜索 · 点此取消
          </button>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] px-3 py-1 text-xs"
          >
            <RefreshCw size={12} /> 刷新
          </button>
          {canWrite ? (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-3 py-1 text-xs text-[color:var(--on-accent)]"
            >
              <Plus size={12} /> 添加厂家线索
            </button>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--muted)]">
          <Loader2 size={16} className="animate-spin" /> 加载中
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[var(--danger)] bg-[var(--danger-bg)] p-4 text-sm text-[var(--danger)]">
          {error}
        </div>
      ) : !page || page.signals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
          {status || runFilterId ? "当前筛选下没有线索" : "还没有线索。可以先「开始找供应商」，也可以手动添加你已经发现的厂家。"}
        </div>
      ) : (
        <>
          <p className="text-xs text-[var(--muted)]">
            共 {page.total} 条{page.total > page.pageSize ? `（每页 ${page.pageSize} 条）` : ""}
          </p>
          <ul className="space-y-2">
            {page.signals.map((s) => {
              const st = signalStatusDisplay(s.status);
              const pf = platformDisplay(s.platform);
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(s)}
                    className="w-full rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-3 text-left hover:border-[var(--accent)]"
                  >
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className={`rounded border px-1.5 py-0.5 ${TONE_CLASS[st.tone]}`}>{st.label}</span>
                      <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--muted)]">
                        {pf.label}
                      </span>
                      <span className="text-[var(--muted)]">
                        {new Date(s.discoveredAt).toLocaleString("zh-CN")}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm">
                      {s.title || s.accountName || s.contentUrl || s.rawText?.slice(0, 60) || "（无标题）"}
                    </p>
                    {s.description ? (
                      <p className="mt-0.5 line-clamp-2 text-xs text-[var(--muted)]">{s.description}</p>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              disabled={cursorStack.length === 0}
              onClick={() => setCursorStack((st) => st.slice(0, -1))}
              className="rounded-full border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-40"
            >
              上一页
            </button>
            <button
              type="button"
              disabled={!page.nextCursor}
              onClick={() => page.nextCursor && setCursorStack((st) => [...st, page.nextCursor as string])}
              className="rounded-full border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </>
      )}

      <SignalDetailDrawer
        orgId={orgId}
        signal={selected}
        canWrite={canWrite}
        onClose={() => setSelected(null)}
        onChanged={refreshAfterWrite}
      />

      {showAdd ? (
        <AddSignalDialog
          orgId={orgId}
          projectId={projectId}
          onClose={() => setShowAdd(false)}
          onCreated={async () => {
            setShowAdd(false);
            setCursorStack([]);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

/* ───────────────── 线索详情 + 人工确认 ───────────────── */

function SignalDetailDrawer({
  orgId,
  signal,
  canWrite,
  onClose,
  onChanged,
}: {
  orgId: string;
  signal: SignalRow | null;
  canWrite: boolean;
  onClose: () => void;
  onChanged: (signalId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [resolution, setResolution] = useState<ResolutionResult | null>(null);
  const [candidates, setCandidates] = useState<SupplierOption[] | null>(null);

  useEffect(() => {
    setResolution(null);
    setCandidates(null);
    setMsg(null);
  }, [signal?.id]);

  if (!signal) return null;
  const st = signalStatusDisplay(signal.status);
  const pf = platformDisplay(signal.platform);
  const origin = sourceOriginDisplay(signal.sourceOrigin);

  async function act(action: string, body: Record<string, unknown>) {
    if (!signal) return;
    setBusy(action);
    setMsg(null);
    try {
      await workspaceFetch(`/api/supplier-intel/signals/${signal.id}?orgId=${encodeURIComponent(orgId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      setMsg({ tone: "ok", text: "已保存" });
      await onChanged(signal.id);
    } catch (e) {
      const conflict = e instanceof WorkspaceApiError && e.status === 409;
      setMsg({
        tone: "err",
        text: conflict
          ? "该线索已被其他同事更新，请刷新后再操作（本次未覆盖对方的结果）"
          : e instanceof Error
            ? e.message
            : "操作失败",
      });
    } finally {
      setBusy(null);
    }
  }

  async function checkIdentity() {
    if (!signal) return;
    setBusy("resolve");
    setMsg(null);
    try {
      const r = await workspaceFetch<{ result: ResolutionResult }>(
        `/api/supplier-intel/signals/${signal.id}/resolve?orgId=${encodeURIComponent(orgId)}`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
      );
      setResolution(r.result);

      // 候选来源有两路，合并去重后交给人工选择（系统永不自动关联）：
      //   1) 解析命中的那家供应商——必须直接可选，否则「已匹配却无法关联」；
      //   2) 按名称检索的相近记录——帮助发现重复建档。
      const picked: SupplierOption[] = [];
      if (r.result.supplierId) {
        try {
          const one = await workspaceFetch<SupplierOption>(
            `/api/suppliers/${r.result.supplierId}?orgId=${encodeURIComponent(orgId)}`,
          );
          if (one?.id) picked.push(one);
        } catch {
          if (r.result.legalName) {
            picked.push({ id: r.result.supplierId, name: r.result.legalName });
          }
        }
      }
      const namesQuery = r.result.legalName ?? r.result.candidateNames[0] ?? signal.accountName ?? "";
      if (namesQuery) {
        try {
          const list = await workspaceFetch<{ data: SupplierOption[] }>(
            `/api/suppliers?orgId=${encodeURIComponent(orgId)}&search=${encodeURIComponent(namesQuery)}&pageSize=10`,
          );
          for (const c of list.data ?? []) {
            if (!picked.some((p) => p.id === c.id)) picked.push(c);
          }
        } catch {
          /* 检索失败不影响已命中的那家 */
        }
      }
      setCandidates(picked);
    } catch (e) {
      setMsg({ tone: "err", text: e instanceof Error ? e.message : "核对失败" });
    } finally {
      setBusy(null);
    }
  }

  const decision = resolution ? resolutionDecisionDisplay(resolution.decision) : null;
  const scan = resolution ? scanCompletenessDisplay(resolution.scan.complete) : null;

  return (
    <Drawer open={Boolean(signal)} onClose={onClose} title="线索详情" width="w-[520px]">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded border px-1.5 py-0.5 ${TONE_CLASS[st.tone]}`}>{st.label}</span>
          <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--muted)]">
            {pf.label}
          </span>
          <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--muted)]">
            {origin.label}
          </span>
        </div>
        {st.hint ? <p className="text-xs text-[var(--muted)]">{st.hint}</p> : null}
        {pf.hint ? <p className="text-xs text-[var(--muted)]">来源说明：{pf.hint}</p> : null}
        {origin.hint ? <p className="text-xs text-[var(--muted)]">{origin.hint}</p> : null}

        <div className="space-y-1">
          <p className="font-medium">{signal.title || signal.accountName || "（无标题）"}</p>
          {/* 不可信文本：纯文本渲染，不解释 HTML/指令 */}
          {signal.description ? (
            <p className="whitespace-pre-wrap text-xs text-[var(--muted)]">{signal.description}</p>
          ) : null}
          {signal.rawText ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-[var(--accent)]">查看原始文字</summary>
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-[var(--background)] p-2 text-[var(--text-secondary)]">
                {signal.rawText}
              </p>
            </details>
          ) : null}
        </div>

        {signal.contentUrl || signal.accountUrl ? (
          <div className="space-y-1 text-xs">
            {signal.accountUrl ? (
              <p className="break-all">
                账号链接：
                <a
                  href={signal.accountUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1 text-[var(--accent)] underline"
                >
                  {signal.accountUrl} <ExternalLink size={11} />
                </a>
              </p>
            ) : null}
            {signal.contentUrl ? (
              <p className="break-all">
                内容链接：
                <a
                  href={signal.contentUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1 text-[var(--accent)] underline"
                >
                  {signal.contentUrl} <ExternalLink size={11} />
                </a>
              </p>
            ) : null}
            <p className="text-[var(--muted)]">
              链接仅供人工打开核实；系统不会自动抓取页面内容，也不会把内容链接当作该供应商官网。
            </p>
          </div>
        ) : null}

        {msg ? (
          <p
            className={`rounded-lg px-2 py-1.5 text-xs ${
              msg.tone === "ok"
                ? "bg-[var(--success-bg)] text-[var(--success)]"
                : "bg-[var(--danger-bg)] text-[var(--danger)]"
            }`}
            role="status"
          >
            {msg.text}
          </p>
        ) : null}

        {canWrite ? (
          <div className="space-y-3 border-t border-[var(--border)] pt-3">
            <div className="flex flex-wrap gap-2">
              {signal.status === "NEW" ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act("review", { action: "review" })}
                  className="rounded-full border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
                >
                  {busy === "review" ? "处理中…" : "标记已查看"}
                </button>
              ) : null}
              {signal.status !== "LINKED" && signal.status !== "REJECTED" ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act("reject", { action: "reject" })}
                  className="rounded-full border border-[var(--border)] px-3 py-1 text-xs disabled:opacity-50"
                >
                  {busy === "reject" ? "处理中…" : "不采用"}
                </button>
              ) : null}
              {signal.status !== "LINKED" && signal.status !== "REJECTED" ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void checkIdentity()}
                  className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs text-[color:var(--on-accent)] disabled:opacity-50"
                >
                  {busy === "resolve" ? "核对中…" : "核对是否已有供应商"}
                </button>
              ) : null}
            </div>

            {resolution && decision && scan ? (
              <div className="space-y-2 rounded-xl border border-[var(--border)] p-3">
                <p className={`rounded px-2 py-1 text-xs ${TONE_CLASS[decision.tone]}`}>{decision.label}</p>
                {decision.hint ? <p className="text-[11px] text-[var(--muted)]">{decision.hint}</p> : null}
                <p className={`rounded px-2 py-1 text-xs ${TONE_CLASS[scan.tone]}`}>{scan.label}</p>
                {scan.hint ? <p className="text-[11px] text-[var(--muted)]">{scan.hint}</p> : null}

                {resolution.matchedSignals.length > 0 ? (
                  <div className="text-[11px]">
                    <p className="text-[var(--muted)]">命中依据：</p>
                    <ul className="ml-4 list-disc">
                      {resolution.matchedSignals.map((m) => (
                        <li key={m} className="break-all">{m}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {resolution.conflicts.length > 0 ? (
                  <div className="rounded bg-[var(--warning-bg)] p-2 text-[11px] text-[var(--warning)]">
                    <p className="font-medium">存在冲突，需人工裁决：</p>
                    <ul className="ml-4 list-disc">
                      {resolution.conflicts.map((c) => (
                        <li key={c} className="break-all">{c}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="space-y-1">
                  <p className="text-[11px] text-[var(--muted)]">
                    选择要关联的供应商（关联只表示身份归属，不代表通过采购审核）：
                  </p>
                  {candidates === null ? (
                    <p className="text-[11px] text-[var(--muted)]">未查询到候选</p>
                  ) : candidates.length === 0 ? (
                    <p className="text-[11px] text-[var(--muted)]">
                      供应商库里没有相近的记录。如确需新建，请到「供应商」页用既有建档流程创建后再回来关联。
                    </p>
                  ) : (
                    <ul className="space-y-1">
                      {candidates.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2 rounded border border-[var(--border)] px-2 py-1">
                          <span className="min-w-0 truncate text-xs" title={c.name}>
                            {c.name}
                            {resolution.supplierId === c.id ? (
                              <span className="ml-1 rounded bg-[var(--info-bg)] px-1 text-[10px] text-[var(--info)]">
                                系统命中
                              </span>
                            ) : null}
                          </span>
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => void act("link", { action: "link", supplierId: c.id })}
                            className="shrink-0 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] text-[color:var(--on-accent)] disabled:opacity-50"
                          >
                            关联这家供应商
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
            你对该项目只有查看权限，无法修改线索。
          </p>
        )}
      </div>
    </Drawer>
  );
}

/* ───────────────── 添加厂家线索 ───────────────── */

function AddSignalDialog({
  orgId,
  projectId,
  onClose,
  onCreated,
}: {
  orgId: string;
  projectId: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [url, setUrl] = useState("");
  const [rawText, setRawText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await workspaceFetch(`/api/supplier-intel/signals?orgId=${encodeURIComponent(orgId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: url.trim() || null,
          rawText: rawText.trim() || null,
          manualEntry: true,
          projectId,
        }),
      });
      await onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="添加厂家线索">
      <div className="w-full max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-4">
        <h3 className="text-sm font-medium">添加厂家线索</h3>
        <p className="text-xs text-[var(--muted)]">
          粘贴分享链接或直接写下你了解到的信息。系统只解析链接文本，不会打开或抓取页面。
        </p>
        <div className="space-y-1">
          <label htmlFor="s3a-url" className="text-xs text-[var(--muted)]">
            链接（可选）
          </label>
          <input
            id="s3a-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="s3a-text" className="text-xs text-[var(--muted)]">
            说明文字（可选）
          </label>
          <textarea
            id="s3a-text"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            rows={4}
            placeholder="例如：佛山某家具厂，做过 BIFMA 认证的办公椅，联系人…"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-2 py-1.5 text-sm"
          />
        </div>
        {err ? <p className="rounded bg-[var(--danger-bg)] px-2 py-1 text-xs text-[var(--danger)]">{err}</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full border border-[var(--border)] px-3 py-1 text-xs">
            取消
          </button>
          <button
            type="button"
            disabled={busy || (!url.trim() && !rawText.trim())}
            onClick={() => void submit()}
            className="rounded-full bg-[var(--accent)] px-3 py-1 text-xs text-[color:var(--on-accent)] disabled:opacity-50"
          >
            {busy ? "提交中…" : "提交线索"}
          </button>
        </div>
      </div>
    </div>
  );
}
