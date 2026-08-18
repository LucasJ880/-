"use client";

/**
 * 工作台指挥台（A 关键信息条 / B 项目摘要内联 / C 情报摘要真数据）
 *
 * 诊断（2026-08-18）：工作台 14+ 卡瀑布、AI 简报为泛文本无硬字段、
 * 情报摘要读 BidToGo 遗留空壳、30 秒看懂只在情报 tab——关键信息全在数据层，
 * 没被摆上来。本组件用一次 /workbench-summary 聚合请求解决「零跳转回答
 * 十个关键问题」。禁假数据：计数 null ≠ 0；readiness 语义沿用 30 秒看懂。
 */

import { useCallback, useEffect, useState } from "react";
import { Radar, Sparkles, RefreshCw } from "lucide-react";
import { apiJson } from "@/lib/api-fetch";

type BriefField = { state: string; value: string | null };

type Summary = {
  project: {
    name: string;
    clientOrganization: string | null;
    solicitationNumber: string | null;
    closeDate: string | null;
    estimatedValue: number | null;
    currency: string | null;
    tenderStatus: string | null;
  };
  analysis: {
    runId: string;
    status: string;
    counts: {
      requirements: number;
      mandatory: number;
      clarifications: number;
      risks: number | null;
    } | null;
  } | null;
  brief: {
    analysisStatus: string;
    stale: boolean;
    fields: Record<string, BriefField>;
    external: Record<string, BriefField>;
  } | null;
  experienceEnabled: boolean;
  intel: {
    status: { status?: string; ranAt?: string; autoObserved?: number } | null;
    candidateCount: number | null;
    strategy: {
      strategyZh: string;
      keyPoints: Array<{ pointZh: string; basedOn: string }>;
      generatedAt: string | null;
    } | null;
  };
};

const ANALYSIS_LABEL: Record<string, string> = {
  PENDING: "排队中",
  EXTRACTING: "解析中",
  ANALYZING: "AI 分析中",
  REVIEW_REQUIRED: "待人工确认",
  APPROVED: "已确认",
  FAILED: "分析失败",
};

function daysLeft(iso: string | null): { text: string; urgent: boolean } | null {
  if (!iso) return null;
  const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (Number.isNaN(d)) return null;
  if (d < 0) return { text: `已截止 ${-d} 天`, urgent: true };
  if (d === 0) return { text: "今天截止", urgent: true };
  return { text: `剩 ${d} 天`, urgent: d <= 7 };
}

function Fact({
  label,
  value,
  urgent,
}: {
  label: string;
  value: string | null;
  urgent?: boolean;
}) {
  return (
    <div className="min-w-0" data-testid={`key-fact-${label}`}>
      <p className="text-[10px] text-muted">{label}</p>
      <p
        className={`truncate text-sm font-medium ${urgent ? "text-danger" : "text-foreground"}`}
        title={value ?? undefined}
      >
        {value ?? "—"}
      </p>
    </div>
  );
}

export function WorkbenchCommandDeck({
  projectId,
  onOpenIntel,
}: {
  projectId: string;
  onOpenIntel: () => void;
}) {
  const [data, setData] = useState<Summary | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    apiJson<Summary>(`/api/projects/${projectId}/workbench-summary`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [projectId]);
  useEffect(() => {
    load();
  }, [load]);

  if (failed) {
    return (
      <section className="rounded-xl border border-border bg-card-bg p-4 text-xs text-muted">
        工作台摘要暂时不可用（加载失败），各分区卡片不受影响。
      </section>
    );
  }
  if (!data) {
    return (
      <section className="rounded-xl border border-border bg-card-bg p-4 text-xs text-muted">
        正在汇总关键信息…
      </section>
    );
  }

  const p = data.project;
  const close = daysLeft(p.closeDate);
  const counts = data.analysis?.counts ?? null;
  const num = (v: number | null | undefined) => (v == null ? "—" : String(v));
  const bf = (key: string): string | null => {
    const f = data.brief?.fields?.[key];
    return f && f.state === "READY" ? f.value : null;
  };
  const intelStatus = data.intel.status;
  const intelLine =
    intelStatus?.status === "ran"
      ? `候选 ${num(data.intel.candidateCount)} · 自动入库 ${num(
          (intelStatus.autoObserved as number | undefined) ?? null,
        )}`
      : intelStatus?.status
        ? `未获候选（${String(intelStatus.status)}）`
        : "尚未检索";

  return (
    <div className="space-y-4" data-testid="workbench-command-deck">
      {/* A. 关键信息条：零跳转硬字段 */}
      <section className="rounded-xl border border-border bg-card-bg p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
          <Fact label="采购方" value={p.clientOrganization ?? bf("buyer")} />
          <Fact label="招标编号" value={p.solicitationNumber} />
          <Fact
            label="截止"
            value={
              p.closeDate
                ? `${p.closeDate.slice(0, 10)}（${close?.text ?? ""}）`
                : null
            }
            urgent={close?.urgent}
          />
          <Fact
            label="预估金额"
            value={
              p.estimatedValue != null
                ? `${p.currency ?? "CAD"} ${p.estimatedValue.toLocaleString()}`
                : null
            }
          />
          <Fact
            label="分析状态"
            value={
              data.analysis
                ? (ANALYSIS_LABEL[data.analysis.status] ?? data.analysis.status)
                : "未开始"
            }
          />
          <Fact
            label="要求（强制）"
            value={counts ? `${counts.requirements}（${counts.mandatory} 强制）` : null}
          />
          <Fact label="风险" value={counts ? num(counts.risks) : null} />
          <Fact label="澄清问题" value={counts ? num(counts.clarifications) : null} />
          <Fact label="外部情报" value={intelLine} />
          <Fact label="投标结果" value={p.tenderStatus} />
        </div>
      </section>

      {/* B. 项目摘要内联（30 秒看懂精简版，与情报 tab 同源同语义，不再跳转） */}
      <section className="rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="workbench-brief-inline">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles size={16} className="text-accent/60" />
          项目摘要
          {data.brief?.stale ? (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
              文件有更新，摘要可能过期
            </span>
          ) : null}
        </h3>
        {bf("oneLiner") || bf("product") ? (
          <div className="mt-2 space-y-1.5 text-sm leading-6 text-foreground/85">
            {bf("oneLiner") ? <p>{bf("oneLiner")}</p> : null}
            {bf("product") ? (
              <p className="text-xs text-muted">采购内容：{bf("product")}</p>
            ) : null}
            {bf("majorBlockers") ? (
              <p className="text-xs text-danger/90">主要阻塞：{bf("majorBlockers")}</p>
            ) : null}
            {bf("nextActions") ? (
              <p className="text-xs text-muted">下一步：{bf("nextActions")}</p>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">
            {!data.experienceEnabled
              ? "包级 AI 分析体验未启用。"
              : data.brief?.analysisStatus === "PROCESSING" || data.analysis?.status === "ANALYZING"
                ? "AI 正在分析整包文件，摘要生成后自动出现。"
                : "尚无分析摘要——上传文件并完成 AI 分析后自动出现。"}
          </p>
        )}
      </section>

      {/* C. 情报摘要（真数据：AI 策略草案 + 检索状态；跳转降为次要动作） */}
      <section className="rounded-xl border border-border bg-card-bg p-4 sm:p-5" data-testid="workbench-intel-summary">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Radar size={16} className="text-accent/60" />
            情报摘要
          </h3>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={load}
              className="text-muted transition hover:text-foreground"
              title="刷新"
            >
              <RefreshCw size={13} />
            </button>
            <button
              type="button"
              onClick={onOpenIntel}
              className="text-xs text-accent underline hover:text-accent-hover"
            >
              打开情报
            </button>
          </div>
        </div>
        {data.intel.strategy ? (
          <div className="mt-2 space-y-1.5 text-sm leading-6">
            <p className="text-foreground/85">{data.intel.strategy.strategyZh}</p>
            {data.intel.strategy.keyPoints.map((k, i) => (
              <p key={i} className="text-xs text-muted">
                · {k.pointZh}
                <span className="text-muted/60">（依据：{k.basedOn}）</span>
              </p>
            ))}
            <p className="text-[10px] text-muted/70">
              AI 推断草案，仅供评审 · 外部检索：{intelLine}
              {intelStatus?.ranAt ? ` · ${String(intelStatus.ranAt).slice(0, 16).replace("T", " ")}` : ""}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">
            外部检索：{intelLine}。分析完成后自动检索并生成策略草案；也可到情报页点
            「立即检索外部情报」。
          </p>
        )}
      </section>
    </div>
  );
}
