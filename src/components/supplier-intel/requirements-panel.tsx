"use client";

/**
 * S3-A「采购要求」——中文采购阅读视图。
 *
 * 只呈现服务端已有事实：缺失字段显示「未提取 / 待确认」，不按品类或常识补齐。
 * 三值 mandatory 逐条如实显示；uncertain 显示「强制性待确认」，绝不显示成「可选」。
 * 每条保留 requirement code / 英文原文 / 来源定位；来源无法定位时明说，不编造页码。
 */

import { useMemo, useState } from "react";
import { AlertTriangle, FileText, Info } from "lucide-react";
import { PROCUREMENT_GROUPS, mandatoryDisplay } from "@/lib/supplier-intel/procurement-display";
import { canonicalBlockReasonText } from "@/lib/supplier-intel/workspace-labels";
import type { ProcurementViewPayload, RequirementView, SourceRefView } from "./types";

const TONE_CLASS: Record<string, string> = {
  mandatory: "bg-[var(--danger-bg)] text-[var(--danger)]",
  uncertain: "bg-[var(--warning-bg)] text-[var(--warning)]",
  optional: "bg-[var(--info-bg)] text-[var(--info)]",
};

function SourceLine({ s }: { s: SourceRefView }) {
  // 定位标签口径与既有分析面板一致：非 PDF 单元用 sectionLabel，绝不伪造 p.N
  const label =
    s.locationLabel ??
    (s.documentTitle && s.pageNumber != null
      ? `${s.documentTitle} · p.${s.pageNumber}`
      : s.documentTitle ?? (s.pageNumber != null ? `第 ${s.pageNumber} 页` : null));
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--background)] p-2">
      <p className="text-[11px] text-[var(--muted)]">
        {label ?? "来源未定位"}
        {s.methodLabel ? ` · ${s.methodLabel}` : ""}
      </p>
      {s.snippet ? (
        <p className="mt-1 whitespace-pre-wrap text-[11px] text-[var(--text-secondary)]">
          「{s.snippet}」
        </p>
      ) : null}
    </div>
  );
}

function RequirementCard({ r }: { r: RequirementView }) {
  const [showSource, setShowSource] = useState(false);
  const m = mandatoryDisplay(r.mandatory);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold">{r.code}</span>
        <span className={`rounded px-1.5 py-0.5 ${TONE_CLASS[m.tone]}`} title={m.hint}>
          {m.label}
        </span>
        {r.category ? (
          <span className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[var(--muted)]">
            {r.category}
          </span>
        ) : null}
      </div>

      {r.textZhIsChinese ? (
        <p className="text-sm leading-relaxed">{r.textZh}</p>
      ) : (
        <div className="rounded-lg bg-[var(--warning-bg)] px-2 py-1.5 text-xs text-[var(--warning)]">
          中文未生成 —— 下方为英文原文。请在「招标要求」页使用既有的翻译功能生成中文后再回到本页。
        </div>
      )}

      <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--muted)]">{r.textEn}</p>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        {r.sources.length > 0 ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[var(--accent)] underline"
            onClick={() => setShowSource((v) => !v)}
            aria-expanded={showSource}
          >
            <FileText size={12} />
            {showSource ? "收起来源" : `查看来源（${r.sources.length}）`}
          </button>
        ) : (
          <span className="text-[var(--muted)]">来源未定位</span>
        )}
      </div>

      {showSource ? (
        <div className="space-y-2">
          {r.sources.map((s) => (
            <SourceLine key={s.id} s={s} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function RequirementsPanel({ view }: { view: ProcurementViewPayload }) {
  const [group, setGroup] = useState<string>("all");

  const grouped = useMemo(() => {
    const map = new Map<string, RequirementView[]>();
    for (const r of view.requirements) {
      const arr = map.get(r.group) ?? [];
      arr.push(r);
      map.set(r.group, arr);
    }
    return map;
  }, [view.requirements]);

  const visible = useMemo(
    () => (group === "all" ? view.requirements : (grouped.get(group) ?? [])),
    [group, grouped, view.requirements],
  );

  if (view.canonical.state === "UNAVAILABLE") {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-sm space-y-2">
        <p className="flex items-center gap-2 font-medium">
          <AlertTriangle size={16} className="text-[var(--warning)]" />
          暂时无法生成采购要求视图
        </p>
        <p className="text-[var(--muted)]">{view.canonical.message}</p>
        <p className="text-xs text-[var(--muted)]">
          请先在该项目完成招标分析并提交复核，本页会自动使用最新的可用版本。
        </p>
      </div>
    );
  }

  if (view.canonical.state === "BLOCKED") {
    return (
      <div className="rounded-xl border border-[var(--warning)] bg-[var(--warning-bg)] p-6 text-sm space-y-2">
        <p className="flex items-center gap-2 font-medium text-[var(--warning)]">
          <AlertTriangle size={16} />
          招标要求来源无法证明完整，已停止解读
        </p>
        <p>{canonicalBlockReasonText(view.canonical.reasonCode)}</p>
        <p className="text-xs opacity-80">技术原因：{view.canonical.message}</p>
        <p className="text-xs">
          为避免把「疑似强制」误读成「可选」，本页不展示逐条要求，也不能开始找供应商。
          请到该项目的「招标要求」页复核需求后重试。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 关键事实：缺失即「未提取」，不推断 */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card-bg)] p-3">
        <p className="mb-2 text-xs font-medium text-[var(--muted)]">关键信息</p>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {view.facts.map((f) => (
            <div key={f.key} className="min-w-0">
              <dt className="text-[11px] text-[var(--muted)]">{f.label}</dt>
              <dd className={`truncate text-xs ${f.status === "KNOWN" ? "" : "text-[var(--muted)]"}`} title={f.text ?? "未提取"}>
                {f.status === "KNOWN" ? f.text : "未提取"}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 flex items-start gap-1 text-[11px] text-[var(--muted)]">
          <Info size={12} className="mt-0.5 shrink-0" />
          逐条要求不含数量/单位字段（分析管线未落库），这里只呈现有据可查的关键槽位；未提取的项请人工查阅原文。
        </p>
      </div>

      {/* 统计 + 分组筛选 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-[var(--muted)]">
          共 {view.counts.total} 条 · 强制 {view.counts.mandatory} · 待确认 {view.counts.uncertain} · 非强制{" "}
          {view.counts.optional}
        </span>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="要求分组">
        <button
          type="button"
          role="tab"
          aria-selected={group === "all"}
          onClick={() => setGroup("all")}
          className={`rounded-full border px-3 py-1 text-xs ${
            group === "all"
              ? "border-transparent bg-[var(--accent)] text-[color:var(--on-accent)]"
              : "border-[var(--border)]"
          }`}
        >
          全部
        </button>
        {PROCUREMENT_GROUPS.map((g) => {
          const n = grouped.get(g.key)?.length ?? 0;
          if (n === 0) return null;
          return (
            <button
              key={g.key}
              type="button"
              role="tab"
              aria-selected={group === g.key}
              onClick={() => setGroup(g.key)}
              className={`rounded-full border px-3 py-1 text-xs ${
                group === g.key
                  ? "border-transparent bg-[var(--accent)] text-[color:var(--on-accent)]"
                  : "border-[var(--border)]"
              }`}
            >
              {g.label} {n}
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
          该分组下没有要求
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((r) => (
            <RequirementCard key={r.id} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
