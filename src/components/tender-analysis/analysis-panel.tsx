"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { TenderAnalysisAgentCard } from "@/components/tender-analysis/agent-card";
import { StatementKindBadge } from "./statement-kind-badge";
import { SourceSnippetDialog } from "./source-snippet-dialog";

type TabKey =
  | "report"
  | "requirements"
  | "risks"
  | "clarifications"
  | "deliverables"
  | "tasks"
  | "sources";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "report", label: "中文分析" },
  { key: "requirements", label: "Requirement" },
  { key: "risks", label: "风险" },
  { key: "clarifications", label: "澄清问题" },
  { key: "deliverables", label: "交付物" },
  { key: "tasks", label: "任务" },
  { key: "sources", label: "来源" },
];

type Source = {
  id: string;
  documentId: string;
  documentTitle?: string | null;
  pageNumber: number | null;
  locationLabel?: string | null;
  sectionLabel: string | null;
  snippet: string;
  methodLabel?: string;
};

type PackageDocument = {
  documentId: string;
  role: string;
  roleLabel: string;
  title: string;
  pageCount: number | null;
};

type ReportPayload = {
  run: {
    id: string;
    status: string;
    statusLabel: string;
    statusLabelShort: string;
    runKind: string;
    runKindLabel: string;
    pendingChangeCount: number;
    approvedAt: string | null;
  };
  documents?: PackageDocument[];
  summary: {
    text: string | null;
    recommendation: string | null;
    majorBlockers: string[];
    nextActions: string[];
  };
  chapters: Array<{
    order: number;
    key: string;
    titleZh: string;
    section: {
      id: string;
      contentZh: string;
      reviewStatusLabel: string;
    } | null;
  }>;
  facts: Array<{
    id: string;
    statementKind: string;
    contentZh: string;
    manuallyConfirmed: boolean;
    sources: Source[];
  }>;
  requirements: Array<{
    id: string;
    requirementCode: string;
    chineseTranslation: string;
    originalRequirement: string;
    mandatory: boolean;
    reviewStatus: string;
    reviewStatusLabel: string;
    sources: Source[];
  }>;
  clarifications: Array<{
    id: string;
    question: string;
    reason: string;
    priorityLabel: string;
    statusLabel: string;
  }>;
  deliverables: Array<{
    id: string;
    title: string;
    mandatory: boolean;
    statusLabel: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    description: string | null;
    statusLabel: string;
  }>;
  sources: Source[];
  changeCandidates: Array<{
    id: string;
    summaryZh: string;
    status: string;
    statusLabel: string;
  }>;
};

type Props = {
  projectId: string;
  /**
   * T1A 5-tab 拆分：只显示指定的内部分区（顺序即渲染顺序）。
   * 招标要求 tab 用 requirements/risks/clarifications/report/sources，
   * 提交 tab 用 deliverables/tasks。缺省 = 全部（旧行为）。
   */
  sections?: TabKey[];
  /** 是否显示运行头部（状态/来源文件/批准/重新分析）与变更确认横幅；缺省 true */
  showRunControls?: boolean;
  /** 初始选中的分区；必须包含在 sections 内，否则取第一个可见分区 */
  initialTab?: TabKey;
  /** 无分析记录时安静降级（不渲染发起分析 CTA），用于提交 tab 等次要挂载点 */
  quietEmpty?: boolean;
};

export function TenderAnalysisPanel({
  projectId,
  sections,
  showRunControls = true,
  initialTab,
  quietEmpty = false,
}: Props) {
  const visibleTabs =
    sections && sections.length > 0
      ? sections
          .map((key) => TABS.find((t) => t.key === key))
          .filter((t): t is (typeof TABS)[number] => Boolean(t))
      : TABS;
  const fallbackTab = visibleTabs[0]?.key ?? "report";
  const [tab, setTab] = useState<TabKey>(
    initialTab && visibleTabs.some((t) => t.key === initialTab)
      ? initialTab
      : fallbackTab,
  );
  const [data, setData] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    try {
      const listRes = await apiFetch(
        `/api/projects/${projectId}/tender-analysis/runs?latest=1`,
      );
      const list = await listRes.json();
      if (!list.run) {
        setData(null);
        setError(null);
        return;
      }
      const res = await apiFetch(
        `/api/projects/${projectId}/tender-analysis/runs/${list.run.id}`,
      );
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "加载失败");
      setData(body);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      const res = await apiFetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "操作失败");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveSection = async (sectionId: string) => {
    if (!data) return;
    setBusy(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/tender-analysis/runs/${data.run.id}/sections/${sectionId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentZh: editText }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "保存失败");
      setEditingSectionId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const enqueuePackage = async (action: "enqueue" | "reanalyze" = "enqueue") => {
    setBusy(true);
    try {
      const res = await apiFetch(
        `/api/projects/${projectId}/tender-analysis/package`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "操作失败");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!data) {
    if (quietEmpty) {
      return (
        <p className="text-sm text-[var(--muted)]">
          暂无分析数据。请先在「招标要求」完成招标文件分析，交付物与任务将自动生成。
        </p>
      );
    }
    return (
      <section
        id="tender-analysis"
        className="rounded-xl border border-[var(--border)] p-4 space-y-3"
      >
        {/* T1B：一键 AI 分析（Workforce）。仅主挂载点渲染；flag 关闭时组件自渲染 null */}
        {showRunControls ? (
          <TenderAnalysisAgentCard
            projectId={projectId}
            onAnalysisFinished={load}
          />
        ) : null}
        <h2 className="text-lg font-semibold">招标文件自动分析</h2>
        <p className="text-sm text-[var(--muted)]">
          {error
            ? error
            : "暂无分析记录。可对当前项目已上传的投标 PDF 包发起分析（无需重新上传）。"}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void enqueuePackage("enqueue")}
          className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
        >
          分析投标文件
        </button>
      </section>
    );
  }

  const packageDocs = data.documents ?? [];

  const riskFacts = data.facts.filter(
    (f) =>
      f.statementKind === "AI_INFERENCE" ||
      /风险|risk/i.test(f.contentZh),
  );
  const riskChapter = data.chapters.find((c) => c.key === "performance_risks" || c.key === "pricing_risks");

  return (
    <section id="tender-analysis" className="space-y-4">
      {/* T1B：一键 AI 分析（Workforce）。仅主挂载点（showRunControls）渲染，
          避免 T1A 5-Tab 的次要挂载点（如提交 tab）重复出现；flag 关闭时组件自渲染 null */}
      {showRunControls ? (
        <TenderAnalysisAgentCard projectId={projectId} onAnalysisFinished={load} />
      ) : null}
      {showRunControls ? (
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border)] pb-3">
        <div>
          <h2 className="text-lg font-semibold">招标文件自动分析</h2>
          <p className="text-sm text-[var(--muted)] mt-1">
            {data.run.statusLabelShort} · {data.run.runKindLabel}
            {data.summary.recommendation
              ? ` · 建议倾向：${data.summary.recommendation}`
              : ""}
          </p>
          {packageDocs.length > 0 ? (
            <div className="mt-2 text-xs text-[var(--muted)] space-y-1">
              <p>来源文件：{packageDocs.length}</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {packageDocs.map((d) => (
                  <li key={d.documentId}>
                    {d.title}
                    {d.roleLabel ? ` · ${d.roleLabel}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {data.run.status === "REVIEW_REQUIRED" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void post(
                  `/api/projects/${projectId}/tender-analysis/runs/${data.run.id}/approve`,
                  { confirmAllRequirements: false },
                )
              }
              className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              批准分析
            </button>
          ) : null}
          {data.run.status !== "SUPERSEDED" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void enqueuePackage("reanalyze")}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs disabled:opacity-50"
            >
              重新分析当前投标文件包
            </button>
          ) : null}
        </div>
      </div>
      ) : null}

      {showRunControls &&
      data.run.runKind === "INCREMENTAL" &&
      data.run.pendingChangeCount > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          增量分析：发现 {data.run.pendingChangeCount} 项变更待确认
          <ul className="mt-2 space-y-1">
            {data.changeCandidates.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-2 text-xs"
              >
                <span>{c.summaryZh}</span>
                {c.status === "PENDING_REVIEW" ? (
                  <span className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      className="underline"
                      onClick={() =>
                        void post(
                          `/api/projects/${projectId}/tender-analysis/runs/${data.run.id}/change-candidates/${c.id}/apply`,
                        )
                      }
                    >
                      接受
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      className="underline"
                      onClick={() =>
                        void post(
                          `/api/projects/${projectId}/tender-analysis/runs/${data.run.id}/change-candidates/${c.id}/reject`,
                        )
                      }
                    >
                      忽略
                    </button>
                  </span>
                ) : (
                  <span>{c.statusLabel}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? (
        <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
          {error}
        </p>
      ) : null}

      {visibleTabs.length > 1 ? (
        <nav className="flex flex-wrap gap-2">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3 py-1 text-xs border ${
                tab === t.key
                  ? "bg-[var(--accent)] text-white border-transparent"
                  : "border-[var(--border)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      ) : null}

      {tab === "report" && (
        <div className="space-y-4">
          {data.summary.text ? (
            <p className="text-sm rounded-lg border border-[var(--border)] p-3">
              {data.summary.text}
            </p>
          ) : (
            <p className="text-sm text-[var(--muted)]">摘要尚未生成。</p>
          )}
          {data.chapters.map((ch) => (
            <article
              key={ch.key}
              className="rounded-xl border border-[var(--border)] p-4 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  {ch.order}. {ch.titleZh}
                </h3>
                {ch.section ? (
                  <span className="text-[10px] text-[var(--muted)]">
                    {ch.section.reviewStatusLabel}
                  </span>
                ) : null}
              </div>
              {!ch.section ? (
                <p className="text-sm text-[var(--muted)]">本节暂无内容。</p>
              ) : editingSectionId === ch.section.id ? (
                <div className="space-y-2">
                  <textarea
                    className="w-full min-h-[120px] rounded border border-[var(--border)] px-2 py-1.5 text-sm"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      className="text-xs underline"
                      onClick={() => void saveSection(ch.section!.id)}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      className="text-xs underline text-[var(--muted)]"
                      onClick={() => setEditingSectionId(null)}
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">
                    {ch.section.contentZh}
                  </p>
                  {data.run.status !== "APPROVED" &&
                  data.run.status !== "SUPERSEDED" ? (
                    <button
                      type="button"
                      className="text-xs underline"
                      onClick={() => {
                        setEditingSectionId(ch.section!.id);
                        setEditText(ch.section!.contentZh);
                      }}
                    >
                      编辑
                    </button>
                  ) : null}
                </>
              )}
            </article>
          ))}

          <div className="space-y-2">
            <h3 className="text-sm font-semibold">陈述要点</h3>
            {data.facts.length === 0 ? (
              <p className="text-sm text-[var(--muted)]">暂无抽取事实。</p>
            ) : (
              <ul className="space-y-2">
                {data.facts.map((f) => (
                  <li
                    key={f.id}
                    className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm space-y-1"
                  >
                    <div className="flex flex-wrap gap-2 items-center">
                      <StatementKindBadge kind={f.statementKind} />
                      {f.manuallyConfirmed ? (
                        <span className="text-[10px] text-emerald-700">
                          已确认
                        </span>
                      ) : null}
                    </div>
                    <p>{f.contentZh}</p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {f.sources[0] ? (
                        <button
                          type="button"
                          className="underline"
                          onClick={() => setSource(f.sources[0])}
                        >
                          查看来源
                          {f.sources[0].locationLabel
                            ? `（${f.sources[0].locationLabel}）`
                            : f.sources[0].documentTitle &&
                                f.sources[0].pageNumber != null
                              ? `（${f.sources[0].documentTitle} · p.${f.sources[0].pageNumber}）`
                            : f.sources[0].pageNumber != null
                              ? `（p.${f.sources[0].pageNumber}）`
                              : ""}
                        </button>
                      ) : null}
                      {!f.manuallyConfirmed &&
                      data.run.status === "REVIEW_REQUIRED" ? (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            className="underline"
                            onClick={() =>
                              void post(
                                `/api/projects/${projectId}/tender-analysis/runs/${data.run.id}/facts/${f.id}/confirm`,
                              )
                            }
                          >
                            确认
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className="underline text-[var(--muted)]"
                            onClick={() =>
                              void post(
                                `/api/projects/${projectId}/tender-analysis/runs/${data.run.id}/facts/${f.id}/reject`,
                              )
                            }
                          >
                            驳回
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {tab === "requirements" && (
        <div className="space-y-2">
          {data.requirements.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              暂无要求。抽取完成后将显示于此。
            </p>
          ) : (
            data.requirements.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border border-[var(--border)] p-3 space-y-1"
              >
                <div className="flex flex-wrap gap-2 items-center text-xs">
                  <span className="font-semibold">{r.requirementCode}</span>
                  <span className="rounded border px-1.5 py-0.5">
                    {r.reviewStatusLabel}
                  </span>
                  {r.mandatory ? (
                    <span className="text-amber-800">强制</span>
                  ) : null}
                </div>
                <p className="text-sm">{r.chineseTranslation}</p>
                <p className="text-xs text-[var(--muted)] whitespace-pre-wrap">
                  {r.originalRequirement}
                </p>
                <div className="flex gap-2 text-xs">
                  {r.sources[0] ? (
                    <button
                      type="button"
                      className="underline"
                      onClick={() => setSource(r.sources[0])}
                    >
                      来源
                    </button>
                  ) : null}
                  {r.reviewStatus === "AI_EXTRACTED" &&
                  data.run.status !== "APPROVED" ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        className="underline"
                        onClick={() =>
                          void post(
                            `/api/projects/${projectId}/tender-analysis/runs/${data.run.id}/requirements/${r.id}/confirm`,
                          )
                        }
                      >
                        确认
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        className="underline text-[var(--muted)]"
                        onClick={() =>
                          void post(
                            `/api/projects/${projectId}/tender-analysis/runs/${data.run.id}/requirements/${r.id}/reject`,
                          )
                        }
                      >
                        驳回
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "risks" && (
        <div className="space-y-3">
          {riskChapter?.section ? (
            <p className="text-sm whitespace-pre-wrap rounded-xl border border-[var(--border)] p-3">
              {riskChapter.section.contentZh}
            </p>
          ) : null}
          {data.chapters
            .filter((c) => c.key.includes("risk"))
            .map((c) =>
              c.section ? (
                <article
                  key={c.key}
                  className="rounded-xl border border-[var(--border)] p-3"
                >
                  <h3 className="text-sm font-semibold mb-1">{c.titleZh}</h3>
                  <p className="text-sm whitespace-pre-wrap">
                    {c.section.contentZh}
                  </p>
                </article>
              ) : null,
            )}
          {riskFacts.length === 0 &&
          !data.chapters.some((c) => c.key.includes("risk") && c.section) ? (
            <p className="text-sm text-[var(--muted)]">暂无风险条目。</p>
          ) : (
            <ul className="space-y-2">
              {riskFacts.map((f) => (
                <li
                  key={f.id}
                  className="rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2 text-sm"
                >
                  <StatementKindBadge kind={f.statementKind} />
                  <p className="mt-1">{f.contentZh}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "clarifications" && (
        <div className="space-y-2">
          {data.clarifications.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">暂无澄清问题。</p>
          ) : (
            data.clarifications.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-[var(--border)] p-3 space-y-1"
              >
                <div className="flex gap-2 text-xs">
                  <span className="font-medium">{c.priorityLabel}</span>
                  <span className="text-[var(--muted)]">{c.statusLabel}</span>
                </div>
                <p className="text-sm font-medium">{c.question}</p>
                <p className="text-xs text-[var(--muted)]">{c.reason}</p>
              </div>
            ))
          )}
        </div>
      )}

      {tab === "deliverables" && (
        <div className="space-y-2">
          {data.deliverables.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">暂无交付物清单。</p>
          ) : (
            <ul className="space-y-2">
              {data.deliverables.map((d) => (
                <li
                  key={d.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
                >
                  <span>
                    {d.title}
                    {d.mandatory ? (
                      <span className="ml-2 text-[10px] text-amber-800">
                        必需
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {d.statusLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === "tasks" && (
        <div className="space-y-2">
          {data.tasks.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">
              暂无跟进任务（分析完成后自动创建）。
            </p>
          ) : (
            data.tasks.map((t) => (
              <div
                key={t.id}
                className="rounded-xl border border-[var(--border)] p-3"
              >
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-medium">{t.title}</span>
                  <span className="text-xs text-[var(--muted)]">
                    {t.statusLabel}
                  </span>
                </div>
                {t.description ? (
                  <p className="text-xs text-[var(--muted)] mt-1">
                    {t.description}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
      )}

      {tab === "sources" && (
        <div className="space-y-2">
          {data.sources.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">暂无来源引用。</p>
          ) : (
            data.sources.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSource(s)}
                className="block w-full text-left rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-stone-50"
              >
                <span className="text-xs text-[var(--muted)]">
                  {s.locationLabel
                    ? s.locationLabel
                    : s.documentTitle && s.pageNumber != null
                      ? `${s.documentTitle} · p.${s.pageNumber}`
                      : s.documentTitle
                        ? s.documentTitle
                        : s.pageNumber != null
                          ? `第 ${s.pageNumber} 页`
                          : "页码未知"}
                  {s.sectionLabel ? ` · ${s.sectionLabel}` : ""}
                </span>
                <p className="mt-1 line-clamp-2">{s.snippet}</p>
              </button>
            ))
          )}
        </div>
      )}

      <SourceSnippetDialog
        open={!!source}
        source={source}
        onClose={() => setSource(null)}
      />
    </section>
  );
}
