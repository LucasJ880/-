"use client";

/**
 * PROC-1 采购监控与候选（/projects/intelligence/monitor）。
 * 「配置已启用」与「最近一次实际成功运行」分开显示；立即扫描在后台执行、这里轮询进度。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useCurrentOrgId } from "@/lib/hooks/use-current-org-id";
import { JURISDICTION_LABELS } from "@/lib/procurement-records/identity";
import { RUN_STATUS_LABELS, SOURCE_STATUS_LABELS, SOURCE_TYPE_LABELS, TRIAGE_LABELS, type SourceStatus } from "@/lib/procurement-records/labels";
import { Btn, Chip, Field, inputCls, Note, NotEnabled, Section, toneForStatus, Unknown, useApiCall, when } from "./primitives";

type Json = Record<string, unknown>;
interface SourceRow { key: string; label: string; mode: string; descriptionZh: string; officialUrl: string; enabled: boolean | null; lastResult: Json | null }
interface WatchView {
  configured: boolean;
  config: { name: string; timezone: string; schedule: { weekdays: number[]; hour: number; minute: number }; filters: Record<string, unknown>; limits: Record<string, number>; sources: Record<string, boolean> };
  scheduleText: string;
  enabled: boolean;
  enabledAt: string | null;
  enabledBy: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastSuccessAt: string | null;
  activeRun: Json | null;
  recentRuns: Json[];
  sources: SourceRow[];
  costControls: { aiCallsPerRun: number; aiNote: string; limits: Record<string, number> };
  mailIntake: { enabled: boolean; note: string };
}

const MODE_LABELS: Record<string, string> = { AUTO_DISCOVERY: "自动发现新候选", AUTO_REFRESH: "只刷新已关注", AUTO_SEARCH: "自动检索既有披露", MANUAL: "仅人工导入" };
const lines = (v: unknown) => (Array.isArray(v) ? (v as string[]).join("\n") : "");
const parseLines = (s: string) => s.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

export function ProcurementMonitor() {
  const { orgId, ambiguous, loading } = useCurrentOrgId();
  const [view, setView] = useState<WatchView | null>(null);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [candidates, setCandidates] = useState<Json[]>([]);
  const [triage, setTriage] = useState("ALL");
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<Json | null>(null);
  const [form, setForm] = useState({ keywords: "", excludeKeywords: "", institutions: "", regions: "", lookbackDays: 120, maxNewCandidates: 5, maxNewDraftCards: 3, maxPagesPerSource: 5 });
  const [showConfig, setShowConfig] = useState(false);
  const [imp, setImp] = useState({ jurisdiction: "CA-ON", instrumentClass: "SOLICITATION", officialNumber: "", title: "", contractingInstitution: "", sourceUrl: "", platform: "" });
  const api = useApiCall();
  const q = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";

  const load = useCallback(async () => {
    if (!orgId) return;
    const r = await api.call("load", `/api/procurement/watch${q}`);
    if (r.body.available === false) {
      setAvailable(false);
      return;
    }
    setAvailable(true);
    if (!r.ok) return;
    const w = r.body.watch as WatchView;
    setView(w);
    setCanManage(Boolean(r.body.canManage));
    const f = w.config.filters;
    setForm({
      keywords: lines(f.keywords),
      excludeKeywords: lines(f.excludeKeywords),
      institutions: lines(f.institutions),
      regions: lines(f.regions),
      lookbackDays: Number(f.lookbackDays ?? 120),
      maxNewCandidates: w.config.limits.maxNewCandidates,
      maxNewDraftCards: w.config.limits.maxNewDraftCards,
      maxPagesPerSource: w.config.limits.maxPagesPerSource,
    });
    if (w.activeRun) setRunId(String(w.activeRun.id));
    const c = await api.call("cands", `/api/procurement/candidates${q}${triage !== "ALL" ? `&triage=${triage}` : ""}`);
    if (c.ok) setCandidates((c.body.items as Json[]) ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, q, triage]);

  useEffect(() => {
    void load();
  }, [load]);

  // 轮询运行进度
  useEffect(() => {
    if (!runId || !orgId) return;
    let stop = false;
    const tick = async () => {
      const r = await fetch(`/api/procurement/runs/${runId}${q}`, { credentials: "include" }).then((x) => x.json()).catch(() => null);
      if (stop || !r?.run) return;
      setRun(r.run);
      if (["QUEUED", "RUNNING"].includes(String(r.run.status))) setTimeout(tick, 3000);
      else {
        setRunId(null);
        void load();
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [runId, orgId, q, load]);

  const save = async (enableAfter: boolean) => {
    const r = await api.call("save", `/api/procurement/watch${q}`, {
      method: "PUT",
      json: {
        filters: { keywords: parseLines(form.keywords), excludeKeywords: parseLines(form.excludeKeywords), institutions: parseLines(form.institutions), regions: parseLines(form.regions), lookbackDays: Number(form.lookbackDays) },
        limits: { maxNewCandidates: Number(form.maxNewCandidates), maxNewDraftCards: Number(form.maxNewDraftCards), maxPagesPerSource: Number(form.maxPagesPerSource) },
      },
    });
    if (r.ok && enableAfter) await api.call("enable", `/api/procurement/watch/enable${q}`, { method: "POST" });
    if (r.ok) api.setNote({ tone: "good", text: enableAfter ? "已保存并启用：只授权配置内的只读检索、分析与内部草稿，不授权对政府发函或提交。" : "配置已保存（未改变启用状态）。" });
    await load();
  };

  const runNow = async () => {
    const r = await api.call("run", `/api/procurement/watch/run${q}`, { method: "POST" });
    if (r.ok) {
      setRunId(String(r.body.runId));
      api.setNote({ tone: "info", text: r.body.reused ? "已有扫描在运行，显示其进度。" : "扫描已在后台开始（不占用本页请求），下方显示进度。" });
    }
  };

  const doTriage = async (id: string, status: string) => {
    await api.call(`t-${id}`, `/api/procurement/instruments/${id}/triage`, { method: "POST", json: { triageStatus: status } });
    await load();
  };
  const prepare = async (id: string) => {
    const r = await api.call(`p-${id}`, `/api/procurement/requests${q}`, { method: "POST", json: { instrumentIds: [id], pathType: "NEW_FORMAL_REQUEST" } });
    if (r.ok) window.location.assign(`/projects/intelligence/records/${String(r.body.requestId)}`);
  };
  const importManual = async () => {
    const r = await api.call("import", `/api/procurement/candidates/import${q}`, { method: "POST", json: imp });
    if (r.ok) {
      api.setNote({ tone: "good", text: "已人工导入（标「人工导入」，平台不等于申请接收机关；官方性待核实）。" });
      setImp({ ...imp, officialNumber: "", title: "", sourceUrl: "" });
      await load();
    }
  };

  const sortedRuns = useMemo(() => view?.recentRuns ?? [], [view]);

  if (loading) return <p className="text-sm text-muted">加载中…</p>;
  if (ambiguous || !orgId) return <p className="text-sm text-muted">请先在顶部选择当前组织。</p>;
  if (available === false) return <NotEnabled />;
  if (!view) return <p className="text-sm text-muted">加载中…</p>;

  return (
    <div className="space-y-5" data-testid="procurement-monitor">
      <Section
        title="采购监控"
        hint={view.scheduleText}
        testId="watch-status"
        actions={
          <>
            <Btn onClick={() => setShowConfig((s) => !s)}>{showConfig ? "收起配置" : "编辑配置"}</Btn>
            <Btn variant="primary" onClick={() => void runNow()} busy={api.busy === "run"} disabled={!view.configured} testId="run-now">
              立即扫描
            </Btn>
            {canManage ? (
              view.enabled ? (
                <Btn variant="danger" onClick={() => void api.call("disable", `/api/procurement/watch/disable${q}`, { method: "POST" }).then(load)}>
                  停用
                </Btn>
              ) : (
                <Btn variant="primary" onClick={() => void save(true)} busy={api.busy === "save" || api.busy === "enable"} testId="save-enable">
                  保存并启用监控
                </Btn>
              )
            ) : null}
          </>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] text-muted">配置状态</p>
            <p className="mt-1 text-sm">{view.enabled ? <Chip tone="good">配置已启用</Chip> : <Chip tone="warn">未启用（不会定时扫描）</Chip>}</p>
            <p className="mt-1 text-[11px] text-muted">{view.enabledAt ? `${view.enabledBy ?? "成员"} 于 ${when(view.enabledAt)} 启用` : "新安装默认未启用"}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] text-muted">最近一次实际成功运行</p>
            <p className="mt-1 text-sm">{view.lastSuccessAt ? when(view.lastSuccessAt) : <Chip tone="warn">尚无成功运行</Chip>}</p>
            <p className="mt-1 text-[11px] text-muted">配置成功 ≠ 运行成功</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] text-muted">最近一次运行</p>
            <p className="mt-1 text-sm">{view.lastRunStatus ? <Chip tone={toneForStatus(view.lastRunStatus)}>{RUN_STATUS_LABELS[view.lastRunStatus] ?? view.lastRunStatus}</Chip> : "—"}</p>
            <p className="mt-1 text-[11px] text-muted">{when(view.lastRunAt)}</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] text-muted">下一次运行（多伦多时间）</p>
            <p className="mt-1 text-sm">{view.enabled ? when(view.nextRunAt) : "—"}</p>
            <p className="mt-1 text-[11px] text-muted">AI 调用：{view.costControls.aiCallsPerRun}（{view.costControls.aiNote}）</p>
          </div>
        </div>

        {run ? (
          <div className="mt-3 rounded-lg border border-border p-3 text-xs" data-testid="run-progress">
            <p>
              当前 / 最近扫描：<Chip tone={toneForStatus(String(run.status))}>{RUN_STATUS_LABELS[String(run.status)] ?? String(run.status)}</Chip>
              {run.truncated ? <Chip tone="warn">有截断（待续）</Chip> : null} 第 {String(run.attempt)} 次尝试
            </p>
          </div>
        ) : null}

        {showConfig ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2" data-testid="watch-config">
            <Field label="产品关键词（每行一个；含法语同义词，可编辑）">
              <textarea className={`${inputCls} h-40`} value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} disabled={!canManage} />
            </Field>
            <div className="space-y-3">
              <Field label="排除词">
                <textarea className={`${inputCls} h-16`} value={form.excludeKeywords} onChange={(e) => setForm({ ...form, excludeKeywords: e.target.value })} disabled={!canManage} />
              </Field>
              <Field label="机构（空 = 不限）">
                <textarea className={`${inputCls} h-12`} value={form.institutions} onChange={(e) => setForm({ ...form, institutions: e.target.value })} disabled={!canManage} />
              </Field>
              <Field label="地区（空 = 不限）">
                <textarea className={`${inputCls} h-12`} value={form.regions} onChange={(e) => setForm({ ...form, regions: e.target.value })} disabled={!canManage} />
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="公告回看天数">
                  <input type="number" className={inputCls} value={form.lookbackDays} onChange={(e) => setForm({ ...form, lookbackDays: Number(e.target.value) })} disabled={!canManage} />
                </Field>
                <Field label="每轮最多展示新候选">
                  <input type="number" className={inputCls} value={form.maxNewCandidates} onChange={(e) => setForm({ ...form, maxNewCandidates: Number(e.target.value) })} disabled={!canManage} />
                </Field>
                <Field label="每轮最多新生成申请卡">
                  <input type="number" className={inputCls} value={form.maxNewDraftCards} onChange={(e) => setForm({ ...form, maxNewDraftCards: Number(e.target.value) })} disabled={!canManage} />
                </Field>
                <Field label="每来源最多页数">
                  <input type="number" className={inputCls} value={form.maxPagesPerSource} onChange={(e) => setForm({ ...form, maxPagesPerSource: Number(e.target.value) })} disabled={!canManage} />
                </Field>
              </div>
              {canManage ? (
                <div className="flex gap-2">
                  <Btn onClick={() => void save(false)} busy={api.busy === "save"}>保存配置</Btn>
                </div>
              ) : (
                <p className="text-[11px] text-muted">需要组织管理员才能修改配置。</p>
              )}
            </div>
          </div>
        ) : null}
        <Note note={api.note} />
      </Section>

      <Section title="来源能力与最近结果" hint="「成功但零结果」与「无法获取」分开显示；任一来源失败为部分覆盖，旧数据保留。" testId="source-health">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead className="text-left text-muted">
              <tr>
                <th className="py-1 pr-2">来源</th>
                <th className="py-1 pr-2">能力</th>
                <th className="py-1 pr-2">最近结果</th>
                <th className="py-1 pr-2">获取 / 命中 / 新候选</th>
                <th className="py-1">说明</th>
              </tr>
            </thead>
            <tbody>
              {view.sources.map((s) => {
                const r = s.lastResult as { status?: SourceStatus; fetched?: number; matched?: number; newCandidates?: number; truncated?: boolean; note?: string | null } | null;
                return (
                  <tr key={s.key} className="border-t border-border align-top">
                    <td className="py-1.5 pr-2">
                      {s.officialUrl ? (
                        <a href={s.officialUrl} target="_blank" rel="noreferrer noopener" className="text-accent underline">
                          {s.label}
                        </a>
                      ) : (
                        s.label
                      )}
                      {s.enabled === false ? <span className="ml-1 text-muted">（已关闭）</span> : null}
                    </td>
                    <td className="py-1.5 pr-2">{MODE_LABELS[s.mode] ?? s.mode}</td>
                    <td className="py-1.5 pr-2">{r?.status ? <Chip tone={toneForStatus(r.status)}>{SOURCE_STATUS_LABELS[r.status] ?? r.status}</Chip> : <span className="text-muted">{s.mode === "MANUAL" ? "—" : "尚未运行"}</span>}</td>
                    <td className="py-1.5 pr-2">{r ? `${r.fetched ?? 0} / ${r.matched ?? 0} / ${r.newCandidates ?? 0}${r.truncated ? "（截断）" : ""}` : "—"}</td>
                    <td className="py-1.5 text-muted">{r?.note ?? s.descriptionZh}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted">{view.mailIntake.note}</p>
        {sortedRuns.length ? (
          <details className="mt-2 text-xs">
            <summary className="cursor-pointer text-muted">最近 {sortedRuns.length} 次运行</summary>
            <ul className="mt-1 space-y-1">
              {sortedRuns.map((r) => (
                <li key={String(r.id)}>
                  {when(String(r.queuedAt))} · {String(r.trigger) === "MANUAL" ? "手动" : "定时"} · <Chip tone={toneForStatus(String(r.status))}>{RUN_STATUS_LABELS[String(r.status)] ?? String(r.status)}</Chip>
                  {r.truncated ? " · 截断待续" : ""}
                  {r.error ? ` · ${String(r.error)}` : ""}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Section>

      <Section
        title="候选项目与已关注合同"
        hint="优先级只用于排序与解释，不是中标概率；资格、原产地、认证等以正式文件为准，未核实即未知。"
        testId="candidates"
        actions={
          <select className={`${inputCls} w-auto`} value={triage} onChange={(e) => setTriage(e.target.value)}>
            <option value="ALL">全部</option>
            <option value="CANDIDATE">候选</option>
            <option value="WATCHING">已关注</option>
            <option value="IGNORED">已忽略</option>
          </select>
        }
      >
        {candidates.length === 0 ? <p className="text-xs text-muted">暂无候选。保存配置后点「立即扫描」，或在下方人工导入。</p> : null}
        <ul className="space-y-2">
          {candidates.map((c) => {
            const p = c.priority as { score?: number; dimensions?: Array<{ key: string; label: string; points: number; max: number; reasonZh: string }> } | null;
            const ev = (c.evidenceCounts ?? {}) as Record<string, number>;
            return (
              <li key={String(c.id)} className="rounded-lg border border-border p-3" data-testid="candidate">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {String(c.title ?? c.officialNumber)} <span className="text-muted">· {String(c.officialNumber)}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {String(c.jurisdictionLabel ?? JURISDICTION_LABELS[c.jurisdiction as keyof typeof JURISDICTION_LABELS] ?? c.jurisdiction)} · 采购执行：{String(c.contractingInstitution ?? "未知")} · 购买机构：{String(c.buyingInstitution ?? "未知")} · 资料持有机关：{c.recordsHolderInstitution ? String(c.recordsHolderInstitution) : "未核实"}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      公开到期：<Unknown value={c.currentExpiryAt as string | null} /> · 剩余 options：<Unknown value={c.remainingOptions as number | null} /> · 确认重招日期：<Unknown value={c.confirmedRetenderDate as string | null} />
                      {c.contractValue !== null && c.contractValue !== undefined ? ` · 公开合同值 ${String(c.contractValue)} ${String(c.currency ?? "")}（≠ 实际支出）` : ""}
                      {Number(c.callUpCount) > 0 ? ` · 公开 call-up ${String(c.callUpCount)} 笔` : ""}
                    </p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      <Chip tone={c.triageStatus === "WATCHING" ? "info" : "neutral"}>{TRIAGE_LABELS[String(c.triageStatus)] ?? String(c.triageStatus)}</Chip>
                      {Object.entries(ev).map(([k, n]) => (
                        <Chip key={k}>{SOURCE_TYPE_LABELS[k] ?? k} × {n}</Chip>
                      ))}
                      {c.possibleDuplicateOfId ? <Chip tone="warn">可能与其他记录重复（待人工复核）</Chip> : null}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-semibold">{p?.score ?? "—"}</p>
                    <p className="text-[10px] text-muted">优先级分</p>
                  </div>
                </div>
                {p?.dimensions ? (
                  <ul className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
                    {p.dimensions.map((d) => (
                      <li key={d.key} className="text-muted">
                        <span className="text-foreground">{d.label} {d.points}/{d.max}</span>：{d.reasonZh}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.triageStatus !== "WATCHING" ? <Btn onClick={() => void doTriage(String(c.id), "WATCHING")} busy={api.busy === `t-${String(c.id)}`}>关注</Btn> : null}
                  {c.triageStatus !== "IGNORED" ? <Btn onClick={() => void doTriage(String(c.id), "IGNORED")}>忽略</Btn> : null}
                  {c.autoDraft ? (
                    <Link className="text-xs text-accent underline" href={`/projects/intelligence/records/${String((c.autoDraft as Json).id)}`}>
                      打开申请卡（{String((c.autoDraft as Json).status)}）
                    </Link>
                  ) : (
                    <Btn variant="primary" onClick={() => void prepare(String(c.id))} busy={api.busy === `p-${String(c.id)}`}>
                      准备申请
                    </Btn>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="人工链接导入" hint="省市门户（Ontario / BC / Manitoba / Saskatchewan）、MERX、Bonfire、Ariba 等只支持人工导入；平台不等于申请接收机关，未核实的省市规则不显示「已支持自动申请」。" testId="manual-import">
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="司法辖区">
            <select className={inputCls} value={imp.jurisdiction} onChange={(e) => setImp({ ...imp, jurisdiction: e.target.value })}>
              {Object.entries(JURISDICTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </Field>
          <Field label="类别">
            <select className={inputCls} value={imp.instrumentClass} onChange={(e) => setImp({ ...imp, instrumentClass: e.target.value })}>
              <option value="SOLICITATION">招标 / 征集</option>
              <option value="AWARD_INSTRUMENT">合同 / SO / SA</option>
              <option value="CALL_UP">Call-up / PO</option>
            </select>
          </Field>
          <Field label="正式编号">
            <input className={inputCls} value={imp.officialNumber} onChange={(e) => setImp({ ...imp, officialNumber: e.target.value })} />
          </Field>
          <Field label="标题">
            <input className={inputCls} value={imp.title} onChange={(e) => setImp({ ...imp, title: e.target.value })} />
          </Field>
          <Field label="采购机构">
            <input className={inputCls} value={imp.contractingInstitution} onChange={(e) => setImp({ ...imp, contractingInstitution: e.target.value })} />
          </Field>
          <Field label="发布平台（MERX / Bonfire / …）">
            <input className={inputCls} value={imp.platform} onChange={(e) => setImp({ ...imp, platform: e.target.value })} />
          </Field>
          <Field label="来源链接">
            <input className={inputCls} value={imp.sourceUrl} onChange={(e) => setImp({ ...imp, sourceUrl: e.target.value })} placeholder="https://" />
          </Field>
        </div>
        <div className="mt-2">
          <Btn onClick={() => void importManual()} busy={api.busy === "import"} disabled={!imp.officialNumber.trim()}>
            导入
          </Btn>
        </div>
      </Section>
    </div>
  );
}
