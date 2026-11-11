"use client";

/**
 * FLOW-H1 项目页「下一步」卡片
 *
 * 只显示接口给的结论、原因与位置，点了只是带人过去（切页签、滚动、开文件抽屉或进审批中心）。
 * 这里不请求任何接口，不批准、不发送、不保存——那些按钮在它们本来的位置上。
 */
import type { MouseEvent } from "react";
import { AlarmClock, ArrowRight, Compass } from "lucide-react";
import { nextStepHref, type WebNextStepTarget, type WebNextStepView } from "@/lib/tender-next-step/targets";

function closingText(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `截标 ${d.toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

export function NextStepCard({ projectId, view, onOpen }: { projectId: string; view: WebNextStepView; onOpen: (target: WebNextStepTarget) => void }) {
  // 普通点击在页内导航；带修饰键（新标签页打开）时让浏览器按 href 走
  const open = (target: WebNextStepTarget) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onOpen(target);
  };
  const closing = closingText(view.closesAt);

  return (
    <section
      className="rounded-[var(--radius-xl)] border border-accent/30 bg-accent-soft/40 p-4 sm:p-5"
      aria-labelledby="next-step-title"
      data-testid="next-step-card"
      data-rule={view.rule}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-accent">
            <Compass size={13} /> 下一步
          </p>
          <h2 id="next-step-title" className="mt-1 text-base font-semibold text-foreground" data-testid="next-step-headline">
            {view.headlineZh}
          </h2>
          {view.reasonsZh.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-xs leading-5 text-muted" data-testid="next-step-reasons">
              {view.reasonsZh.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
          {view.action && (
            <a
              href={nextStepHref(projectId, view.action.target)}
              onClick={open(view.action.target)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90"
              data-testid="next-step-action"
            >
              {view.action.labelZh} <ArrowRight size={13} />
            </a>
          )}
          {view.urgencyZh ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-[11px] font-medium text-amber-900" data-testid="next-step-urgency">
              <AlarmClock size={12} /> {view.urgencyZh}
            </span>
          ) : closing ? (
            <span className="text-[11px] text-muted" data-testid="next-step-closing">{closing}</span>
          ) : null}
        </div>
      </div>
      {view.also.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-accent/20 pt-2 text-xs text-muted" data-testid="next-step-also">
          {view.also.map((a, i) => (
            <li key={i}>
              另外：
              <a href={nextStepHref(projectId, a.target)} onClick={open(a.target)} className="text-foreground underline decoration-dotted underline-offset-2 hover:text-accent">
                {a.textZh}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
