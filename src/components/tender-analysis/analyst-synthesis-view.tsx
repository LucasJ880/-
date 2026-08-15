"use client";

/**
 * Tender Analyst Synthesis 视图（Semantic Remediation §14–§22）
 *
 * EXPERIENCE ON 且 run 带 analystSynthesis 时的主分析体验：
 *   项目解读（默认）/ 关键要求 / 风险与缺口 / 澄清·RFI —— 本组件；
 *   全部条款 / 来源 —— 由 TenderAnalysisPanel 继续用 legacy 渲染。
 * 所有关键结论提供「查看证据」→ evidenceIndex（server hydrate 的 canonical 证据）。
 * 本组件绝不自行生成事实；只投影 analystSynthesis。
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  FileSearch,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  AnalystEvidenceRef,
  AnalystKeyItem,
  TenderAnalystSynthesisV1,
} from "@/lib/tender-analyst/contract";

export type AnalystSection =
  | "analyst_overview"
  | "analyst_key"
  | "analyst_risks"
  | "analyst_clar";

/**
 * FB-2：剥离正文内嵌的实体引用码（【F-011,R-026】/ [F-011, R-026] 等）。
 * 证据可溯性由「查看证据」+ evidenceIndex 承担，正文保持干净中文。
 */
function stripEntityRefs(text: string): string {
  return text
    .replace(/【[A-Z]{1,6}-[\w-]+(?:\s*[,，、]\s*[A-Z]{1,6}-[\w-]+)*】/g, "")
    .replace(/\[[A-Z]{1,6}-[\w-]+(?:\s*[,，、]\s*[A-Z]{1,6}-[\w-]+)*\]/g, "")
    .replace(/（[A-Z]{1,6}-[\w-]+(?:\s*[,，、]\s*[A-Z]{1,6}-[\w-]+)*）/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}
const z = stripEntityRefs;

const SEVERITY_STYLE: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-900",
  HIGH: "bg-amber-100 text-amber-900",
  MEDIUM: "bg-sky-100 text-sky-900",
  LOW: "bg-neutral-100 text-neutral-700",
};

const PHASE_LABEL: Record<string, string> = {
  BID_SUBMISSION: "投标提交",
  PRE_AWARD: "定标前",
  TECHNICAL_COMPLIANCE: "技术符合",
  DELIVERY_EXECUTION: "交付执行",
  POST_AWARD: "中标后",
  GENERAL_CONTRACT: "一般合同",
};

const IMPACT_LABEL: Record<string, string> = {
  BID_FATAL: "废标风险",
  BID_REQUIRED: "投标必须",
  SCORING: "影响评分",
  COST_IMPACT: "影响成本",
  DELIVERY_IMPACT: "影响交付",
  CONTRACT_ONLY: "合同义务",
  INFORMATIONAL: "信息参考",
};

const ASSESSMENT_LABEL: Record<string, string> = {
  READY_TO_PRICE: "可进入报价",
  NEEDS_CLARIFICATION: "需要澄清后再进入报价",
  BLOCKED_BY_MISSING_SOURCE: "缺少源文件，暂不能报价",
  BLOCKED_BY_CONFLICT: "存在未解决冲突，暂不能报价",
  INSUFFICIENT_INFORMATION: "信息不足，暂不能判断",
};

/* ------------------------------ Evidence Drawer ------------------------------ */

function EvidenceDrawer({
  title,
  refs,
  onClose,
}: {
  title: string;
  refs: AnalystEvidenceRef[];
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center"
      onClick={onClose}
      data-testid="evidence-drawer"
    >
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card-bg,white)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-[var(--muted)]">证据 · 为什么 AI 这样判断</p>
            <h4 className="mt-0.5 text-sm font-semibold">{title}</h4>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded p-1 text-[var(--muted)] hover:bg-neutral-100"
          >
            <X size={16} />
          </button>
        </div>
        {refs.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">未找到关联证据。</p>
        ) : (
          <ul className="space-y-3">
            {refs.map((r) => (
              <li
                key={r.entityId}
                className="rounded-lg border border-[var(--border)] p-3 text-sm"
              >
                <p className="text-xs text-[var(--muted)]">
                  {r.kind === "requirement"
                    ? "关联条款"
                    : r.kind === "fact"
                      ? "文件事实"
                      : r.kind === "risk"
                        ? "风险依据"
                        : "澄清关联"}{" "}
                  · {r.entityId}
                </p>
                <p className="mt-1 leading-relaxed">{r.statement}</p>
                {r.evidence.map((e, i) => (
                  <div
                    key={`${r.entityId}-${i}`}
                    className="mt-2 rounded bg-neutral-50 p-2 text-xs"
                  >
                    <p className="font-medium">
                      {e.documentName ?? e.documentId}
                      {e.pageNumber != null ? ` · p.${e.pageNumber}` : ""}
                    </p>
                    {e.snippet ? (
                      <p className="mt-1 whitespace-pre-wrap text-[var(--muted)]">
                        “{e.snippet}”
                      </p>
                    ) : null}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ 小构件 ------------------------------ */

function SeverityBadge({ severity }: { severity: string }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
        SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.LOW,
      )}
    >
      {severity}
    </span>
  );
}

function supportingIdsOf(item: AnalystKeyItem): string[] {
  return [
    ...item.supportingRequirementIds,
    ...item.supportingFactIds,
    ...item.supportingRiskIds,
  ];
}

/* ------------------------------ 主组件 ------------------------------ */

export function AnalystSynthesisView({
  synthesis,
  section,
  runStatus,
  onOpenTab,
}: {
  synthesis: TenderAnalystSynthesisV1;
  section: AnalystSection;
  runStatus: string;
  /** 切换到面板内其它 tab（如 关键要求 / 全部条款） */
  onOpenTab: (key: string) => void;
}) {
  const [evidence, setEvidence] = useState<{
    title: string;
    refs: AnalystEvidenceRef[];
  } | null>(null);
  const [showMinorClar, setShowMinorClar] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    A: true,
    B: true,
    C: true,
    D: true,
  });

  const openEvidence = (title: string, ids: string[]) => {
    const refs = ids
      .map((id) => synthesis.evidenceIndex[id])
      .filter((r): r is AnalystEvidenceRef => Boolean(r));
    setEvidence({ title, refs });
  };

  const allItems = useMemo(
    () => [
      ...synthesis.keyRequirements,
      ...synthesis.technicalRequirements,
      ...synthesis.commercialAndDelivery,
    ],
    [synthesis],
  );

  // §16 分组 A–G
  const groups = useMemo(() => {
    const inKey = new Set(synthesis.keyRequirements.map((i) => i.id));
    const inTech = new Set(synthesis.technicalRequirements.map((i) => i.id));
    const g: Record<string, AnalystKeyItem[]> = { A: [], B: [], C: [], D: [], E: [], F: [], G: [] };
    for (const item of allItems) {
      if (item.impact === "BID_FATAL") g.A.push(item);
      else if (item.phase === "BID_SUBMISSION") g.B.push(item);
      else if (inTech.has(item.id) || item.phase === "TECHNICAL_COMPLIANCE") g.C.push(item);
      else if (item.phase === "PRE_AWARD" && inKey.has(item.id)) g.D.push(item);
      else if (item.phase === "POST_AWARD" || item.phase === "GENERAL_CONTRACT") g.G.push(item);
      else if (item.impact === "DELIVERY_IMPACT" || item.phase === "DELIVERY_EXECUTION") g.F.push(item);
      else g.E.push(item);
    }
    return g;
  }, [allItems, synthesis]);

  const criticalCount =
    allItems.filter((i) => i.severity === "CRITICAL").length +
    synthesis.clarifications.filter((c) => c.priority === "BLOCKING").length;

  const materialClar = synthesis.clarifications.filter(
    (c) => c.priority === "BLOCKING" || c.priority === "HIGH",
  );
  const minorClar = synthesis.clarifications.filter(
    (c) => c.priority !== "BLOCKING" && c.priority !== "HIGH",
  );

  /* ---------- §22 AI 分析工作流（各 tab 顶部常驻） ---------- */
  const workflow = (
    <div
      className="rounded-xl border border-[var(--border)] bg-[var(--accent)]/[0.04] p-4"
      data-testid="analyst-workflow"
    >
      <p className="text-xs font-semibold text-[var(--muted)]">AI 分析工作流</p>
      <ul className="mt-2 space-y-1 text-sm">
        <li className="flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-600" />
          已读取 Tender Package（{synthesis.coverage.analyzed} / {synthesis.coverage.uploaded} 个文件）
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-600" />
          已完成跨文件整合与冲突检查
        </li>
        <li className="flex items-center gap-2">
          <CheckCircle2 size={14} className="text-emerald-600" />
          已识别关键要求（{synthesis.keyRequirements.length} 项）与风险（{synthesis.risksAndGaps.length} 项）
        </li>
        <li className="flex items-center gap-2">
          {runStatus === "APPROVED" ? (
            <CheckCircle2 size={14} className="text-emerald-600" />
          ) : (
            <CircleDot size={14} className="text-[var(--accent)]" />
          )}
          {runStatus === "APPROVED"
            ? "关键事项已确认"
            : `等待你确认 ${criticalCount} 个关键事项`}
        </li>
        <li className="flex items-center gap-2 text-[var(--muted)]">
          <Circle size={13} />
          确认后进入标书与报价
        </li>
      </ul>
      <div className="mt-3">
        {runStatus === "APPROVED" ? (
          <p className="text-xs text-[var(--muted)]">
            推荐下一步：进入「标书与报价」
          </p>
        ) : (
          <button
            type="button"
            onClick={() => onOpenTab("analyst_key")}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs text-white"
          >
            查看 {criticalCount} 个关键事项
          </button>
        )}
      </div>
    </div>
  );

  /* ---------- 覆盖率（UI-SEM-08） ---------- */
  const [showExcluded, setShowExcluded] = useState(false);
  const coverage = (
    <div className="text-xs text-[var(--muted)]" data-testid="analyst-coverage">
      上传 {synthesis.coverage.uploaded} · 纳入分析 {synthesis.coverage.analyzed}
      {synthesis.coverage.excluded.length > 0 ? (
        <>
          {" · "}
          <button
            type="button"
            className="underline"
            onClick={() => setShowExcluded((v) => !v)}
          >
            排除 {synthesis.coverage.excluded.length}（原因）
          </button>
          {showExcluded ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {synthesis.coverage.excluded.map((f) => (
                <li key={f.filename}>
                  {f.filename}（{f.fileType ?? "?"}）：{f.exclusionReason}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );

  const evidenceButton = (title: string, ids: string[]) =>
    ids.length > 0 ? (
      <button
        type="button"
        onClick={() => openEvidence(title, ids)}
        className="inline-flex items-center gap-1 text-xs text-[var(--accent)] underline"
      >
        <FileSearch size={12} />
        查看证据
      </button>
    ) : null;

  const keyItemCard = (item: AnalystKeyItem) => (
    <div
      key={item.id}
      className="rounded-lg border border-[var(--border)] p-3"
      data-testid="analyst-key-item"
    >
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={item.severity} />
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-700">
          {PHASE_LABEL[item.phase] ?? item.phase}
        </span>
        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-700">
          {IMPACT_LABEL[item.impact] ?? item.impact}
        </span>
      </div>
      <h4 className="mt-1.5 text-sm font-medium">{z(item.titleZh)}</h4>
      <p className="mt-1 text-sm leading-relaxed text-[color:var(--foreground,#222)]/90">
        {z(item.explanationZh)}
      </p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        为什么重要：{z(item.whyItMattersZh)}
      </p>
      <div className="mt-2">{evidenceButton(item.titleZh, supportingIdsOf(item))}</div>
    </div>
  );

  /* =============================== 分区渲染 =============================== */

  if (section === "analyst_overview") {
    const a = synthesis.currentAssessment;
    return (
      <div className="space-y-4" data-testid="analyst-overview">
        {workflow}
        {coverage}

        {/* 30 秒看懂项目 */}
        <article className="rounded-xl border border-[var(--border)] p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <BookOpenCheck size={15} className="text-[var(--accent)]" />
            30 秒看懂项目
          </h3>
          <p className="mt-2 text-sm font-medium">{z(synthesis.executiveBrief.oneLinerZh)}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-semibold text-[var(--muted)]">客户要采购什么</p>
              <p className="mt-1 text-sm leading-relaxed">
                {z(synthesis.executiveBrief.whatIsBeingBoughtZh)}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-[var(--muted)]">我们需要准备什么</p>
              <p className="mt-1 text-sm leading-relaxed">
                {z(synthesis.executiveBrief.bidderTakeawayZh)}
              </p>
            </div>
          </div>
          {synthesis.executiveBrief.keyPoints.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs font-semibold text-[var(--muted)]">最值得关注</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">
                {synthesis.executiveBrief.keyPoints.map((p, i) => (
                  <li key={i}>{z(p)}</li>
                ))}
              </ol>
            </div>
          ) : null}
        </article>

        {/* 采购范围 */}
        <article className="rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-semibold">采购范围</h3>
          <p className="mt-2 text-sm leading-relaxed">{z(synthesis.scope.overviewZh)}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {synthesis.scope.deliverables.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-[var(--muted)]">核心采购内容</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
                  {synthesis.scope.deliverables.map((d, i) => (
                    <li key={i}>{z(d)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {synthesis.scope.quantities.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-[var(--muted)]">数量 / 规格</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
                  {synthesis.scope.quantities.map((d, i) => (
                    <li key={i}>{z(d)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {synthesis.scope.deliveryScope.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-[var(--muted)]">交付范围</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
                  {synthesis.scope.deliveryScope.map((d, i) => (
                    <li key={i}>{z(d)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {synthesis.scope.exclusionsOrUnknowns.length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-[var(--muted)]">目前不知道</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
                  {synthesis.scope.exclusionsOrUnknowns.map((d, i) => (
                    <li key={i}>{z(d)}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </article>

        {/* 投标关键要求（预览：废标 + 必须提交 top） */}
        <article className="rounded-xl border border-[var(--border)] p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">投标关键要求</h3>
            <button
              type="button"
              className="text-xs text-[var(--accent)] underline"
              onClick={() => onOpenTab("analyst_key")}
            >
              查看全部 {allItems.length} 项
            </button>
          </div>
          <div className="mt-2 space-y-2">
            {[...groups.A, ...groups.B, ...groups.C]
              .slice(0, 5)
              .map((item) => keyItemCard(item))}
            {groups.A.length === 0 ? (
              <p className="text-xs text-[var(--muted)]">
                当前文件中未发现明确的废标 / non-responsive 条件。
              </p>
            ) : null}
          </div>
        </article>

        {/* 风险与缺口（CRITICAL/HIGH 摘要） */}
        <article className="rounded-xl border border-[var(--border)] p-4">
          <div className="flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <AlertTriangle size={14} className="text-amber-600" />
              风险与缺口
            </h3>
            <button
              type="button"
              className="text-xs text-[var(--accent)] underline"
              onClick={() => onOpenTab("analyst_risks")}
            >
              查看全部
            </button>
          </div>
          <ul className="mt-2 space-y-2">
            {synthesis.risksAndGaps
              .filter((r) => r.severity === "CRITICAL" || r.severity === "HIGH")
              .slice(0, 4)
              .map((r, i) => (
                <li key={i} className="text-sm">
                  <SeverityBadge severity={r.severity} />{" "}
                  <span className="font-medium">{z(r.titleZh)}</span>
                  <span className="text-[var(--muted)]"> — {z(r.impactZh)}</span>
                </li>
              ))}
            {synthesis.risksAndGaps.length === 0 ? (
              <li className="text-sm text-[var(--muted)]">暂无重大风险。</li>
            ) : null}
          </ul>
        </article>

        {/* 当前文档判断 */}
        <article
          className="rounded-xl border border-[var(--border)] p-4"
          data-testid="analyst-assessment"
        >
          <h3 className="text-sm font-semibold">当前文档判断</h3>
          <p className="mt-2 text-sm font-medium">
            状态：{ASSESSMENT_LABEL[a.status] ?? a.status}
          </p>
          <p className="mt-1 text-sm leading-relaxed">{z(a.summaryZh)}</p>
          {a.reasons.length > 0 ? (
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">
              {a.reasons.map((r, i) => (
                <li key={i}>{z(r)}</li>
              ))}
            </ol>
          ) : null}
          {a.mustResolveBeforePricing.length > 0 ? (
            <div className="mt-2">
              <p className="text-xs font-semibold text-[var(--muted)]">报价前必须确认</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm">
                {a.mustResolveBeforePricing.map((r, i) => (
                  <li key={i}>{z(r)}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>

        {/* 下一步 */}
        <article className="rounded-xl border border-[var(--border)] p-4">
          <h3 className="text-sm font-semibold">下一步</h3>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm">
            {[...synthesis.nextActions]
              .sort((x, y) => x.order - y.order)
              .map((na, i) => (
                <li key={i}>
                  <span className="font-medium">{z(na.actionZh)}</span>
                  <span className="text-[var(--muted)]"> — {z(na.reasonZh)}</span>
                </li>
              ))}
          </ol>
        </article>

        {synthesis.qa.needsHumanReview ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
            部分结论未通过 AI 质检，需人工重点复核（详见 QA 记录 {synthesis.qa.issues.length} 条）。
          </p>
        ) : null}

        {evidence ? (
          <EvidenceDrawer
            title={evidence.title}
            refs={evidence.refs}
            onClose={() => setEvidence(null)}
          />
        ) : null}
      </div>
    );
  }

  if (section === "analyst_key") {
    const GROUP_META: Array<{ key: keyof typeof groups; label: string }> = [
      { key: "A", label: "A · 废标 / Non-responsive 风险" },
      { key: "B", label: "B · 投标时必须提交" },
      { key: "C", label: "C · 技术 / 产品符合性" },
      { key: "D", label: "D · 资格 / 保险 / 认证" },
      { key: "E", label: "E · 价格 / 商务" },
      { key: "F", label: "F · 交付" },
      { key: "G", label: "G · 中标后合同义务" },
    ];
    return (
      <div className="space-y-3" data-testid="analyst-key-requirements">
        {workflow}
        {coverage}
        {GROUP_META.map(({ key, label }) => {
          const items = groups[key];
          if (!items || items.length === 0) return null;
          const open = openGroups[key] ?? false;
          return (
            <section key={key} className="rounded-xl border border-[var(--border)]">
              <button
                type="button"
                className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold"
                onClick={() => setOpenGroups((g) => ({ ...g, [key]: !open }))}
              >
                <span>
                  {label}（{items.length}）
                </span>
                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {open ? (
                <div className="space-y-2 px-4 pb-4">{items.map(keyItemCard)}</div>
              ) : null}
            </section>
          );
        })}
        {evidence ? (
          <EvidenceDrawer
            title={evidence.title}
            refs={evidence.refs}
            onClose={() => setEvidence(null)}
          />
        ) : null}
      </div>
    );
  }

  if (section === "analyst_risks") {
    return (
      <div className="space-y-3" data-testid="analyst-risks">
        {workflow}
        {synthesis.risksAndGaps.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">当前未识别出需要立即处理的风险。</p>
        ) : (
          synthesis.risksAndGaps.map((r, i) => (
            <article key={i} className="rounded-xl border border-[var(--border)] p-4">
              <div className="flex items-center gap-2">
                <SeverityBadge severity={r.severity} />
                <h4 className="text-sm font-semibold">{z(r.titleZh)}</h4>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed">{z(r.explanationZh)}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">为什么重要：{z(r.impactZh)}</p>
              <p className="mt-1 text-xs">
                <span className="font-medium">建议：</span>
                {z(r.recommendedActionZh)}
              </p>
              <div className="mt-2">{evidenceButton(r.titleZh, r.supportingIds)}</div>
            </article>
          ))
        )}
        {evidence ? (
          <EvidenceDrawer
            title={evidence.title}
            refs={evidence.refs}
            onClose={() => setEvidence(null)}
          />
        ) : null}
      </div>
    );
  }

  // analyst_clar
  return (
    <div className="space-y-3" data-testid="analyst-clarifications">
      {workflow}
      {materialClar.length === 0 ? (
        <p className="text-sm text-[var(--muted)]">
          当前没有必须向采购方澄清的问题。
        </p>
      ) : (
        materialClar.map((c, i) => (
          <article key={i} className="rounded-xl border border-[var(--border)] p-4">
            <div className="flex items-center gap-2">
              <SeverityBadge severity={c.priority === "BLOCKING" ? "CRITICAL" : "HIGH"} />
              <h4 className="text-sm font-semibold">{z(c.questionZh)}</h4>
            </div>
            <p className="mt-1.5 text-xs text-[var(--muted)]">为什么要问：{z(c.reasonZh)}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              不问的影响：{z(c.ifNotResolvedZh)}
            </p>
            <div className="mt-2">
              {evidenceButton(c.questionZh, [...c.clarificationIds, ...c.supportingIds])}
            </div>
          </article>
        ))
      )}
      {minorClar.length > 0 ? (
        <section className="rounded-xl border border-[var(--border)]">
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-semibold"
            onClick={() => setShowMinorClar((v) => !v)}
          >
            <span>其他建议问题（{minorClar.length}）</span>
            {showMinorClar ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
          {showMinorClar ? (
            <ul className="space-y-2 px-4 pb-4 text-sm">
              {minorClar.map((c, i) => (
                <li key={i} className="rounded-lg border border-[var(--border)] p-3">
                  <p className="font-medium">{z(c.questionZh)}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{z(c.reasonZh)}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {evidence ? (
        <EvidenceDrawer
          title={evidence.title}
          refs={evidence.refs}
          onClose={() => setEvidence(null)}
        />
      ) : null}
    </div>
  );
}
