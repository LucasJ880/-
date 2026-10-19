"use client";

/**
 * DURABLE_FOLLOWUP_M1：客户跟进持久任务的成果明细（只渲染服务端投影，不在前端推断状态）。
 * 区分：已生成建议 / 等待确认 / 已批准未执行 / 已创建 Gmail 草稿 / 已建立提醒 /
 * 部分完成 / 失败 / 已取消；每项附可核对的引用。
 */

import { cn } from "@/lib/utils";
import {
  FOLLOWUP_ITEM_LABEL,
  type FollowupActionItem,
  type FollowupOutcome,
} from "@/lib/assistant/followup-outcome";
import { simplifyEvidenceRefs } from "@/lib/assistant/inline-approval-model";
import { topReasons } from "@/lib/assistant/runtime-v2-ui";

const ITEM_TONE: Record<FollowupActionItem["state"], string> = {
  awaiting_approval: "text-amber-900",
  approved_not_executed: "text-amber-900",
  draft_created: "text-emerald-800",
  reminder_created: "text-emerald-800",
  executed_without_receipt: "text-danger",
  rejected: "text-muted",
  expired: "text-muted",
  failed: "text-danger",
  cancelled: "text-muted",
  skipped: "text-muted",
};

function ItemList({ items }: { items: FollowupActionItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {items.map((i) => (
        <li
          key={`${i.kind}-${i.customerId}`}
          className="flex flex-wrap items-baseline gap-x-2 text-[12px] leading-5"
          data-item-state={i.state}
        >
          <span className="font-medium text-foreground">{i.customerName}</span>
          <span className={cn(ITEM_TONE[i.state])}>{FOLLOWUP_ITEM_LABEL[i.state]}</span>
          {i.reason && i.state !== "awaiting_approval" ? (
            <span className="text-[11px] text-muted">（{i.reason}）</span>
          ) : null}
          {i.resultRef ? (
            <span className="text-[10px] text-[#9aa19e]">回执：{i.resultRef}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function FollowupOutcomePanel({ outcome }: { outcome: FollowupOutcome }) {
  const { analysis, quoteRisk, attachments, emailDrafts, reminders } = outcome;
  return (
    <div
      className="space-y-2.5 border-t border-border bg-card-bg/45 px-3 py-2.5 sm:px-3.5"
      data-testid="followup-outcome"
      data-overall={outcome.overall}
    >
      <section>
        <p className="text-[11px] font-medium text-muted">
          {analysis.state === "carried" ? "沿用上次选出的客户" : "优先跟进客户"}
          {typeof analysis.opportunityCount === "number"
            ? ` · 已分析 ${analysis.opportunityCount} 个商机`
            : ""}
          {analysis.state === "degraded" ? " · 部分证据为降级数据" : ""}
        </p>
        {analysis.customers.length > 0 ? (
          <ul className="mt-1.5 space-y-2">
            {analysis.customers.map((c) => (
              <li key={c.customerId} className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-[13px] font-semibold text-foreground">
                    {c.customerName}
                  </span>
                  {typeof c.score === "number" ? (
                    <span className="text-[12px] font-medium text-accent">{c.score} 分</span>
                  ) : null}
                  {!c.hasEmail ? (
                    <span className="text-[11px] text-muted">无邮箱</span>
                  ) : null}
                </div>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4 text-[12px] leading-5 text-[#4a524e]">
                  {topReasons(c.reasons, 3).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                {c.evidenceRefs.length > 0 ? (
                  <p className="mt-0.5 text-[10px] text-[#9aa19e]">
                    依据：{simplifyEvidenceRefs(c.evidenceRefs).join(" · ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[12px] text-[#4a524e]">
            {analysis.state === "pending" || analysis.state === "running"
              ? "正在读取商机、客户与报价数据…"
              : analysis.state === "failed"
                ? "分析未能完成"
                : "当前没有需要优先跟进的客户"}
          </p>
        )}
      </section>

      {quoteRisk.state !== "not_applicable" ? (
        <section>
          <p className="text-[11px] font-medium text-muted">报价风险</p>
          <p className="mt-1 text-[12px] leading-5 text-[#4a524e]">
            {quoteRisk.state === "pending"
              ? "分析中…"
              : quoteRisk.state === "failed"
                ? `分析失败${quoteRisk.summary ? `：${quoteRisk.summary}` : ""}`
                : (quoteRisk.summary ?? "已完成")}
            {quoteRisk.state === "degraded" ? "（降级证据）" : ""}
          </p>
          {quoteRisk.issues.length > 0 ? (
            <ul className="mt-0.5 list-disc pl-4 text-[12px] leading-5 text-[#4a524e]">
              {quoteRisk.issues.map((i) => (
                <li key={i.title}>
                  {i.title}
                  {i.severity ? `（${i.severity}）` : ""}
                </li>
              ))}
            </ul>
          ) : null}
          {quoteRisk.refs.length > 0 ? (
            <p className="mt-0.5 text-[10px] text-[#9aa19e]">
              依据：{quoteRisk.refs.slice(0, 5).join(" · ")}
            </p>
          ) : null}
        </section>
      ) : null}

      {attachments ? (
        <section>
          <p className="text-[11px] font-medium text-muted">你提供的资料</p>
          <p className="mt-1 text-[12px] leading-5 text-[#4a524e]">
            {attachments.state === "pending"
              ? "等待读取"
              : attachments.state === "failed"
                ? "读取失败（归属校验未通过或资料不可用）"
                : `已读取 ${attachments.items.length} 份${
                    attachments.matchedCustomers.length > 0
                      ? `；提及客户：${attachments.matchedCustomers
                          .map((c) => c.customerName)
                          .join("、")}`
                      : ""
                  }`}
          </p>
        </section>
      ) : null}

      {emailDrafts.requested ? (
        <section>
          <p className="text-[11px] font-medium text-muted">跟进邮件草稿（不会自动发送）</p>
          {emailDrafts.state === "unavailable" ? (
            <p className="mt-1 text-[12px] text-muted">
              暂不可用：{emailDrafts.unavailableReason}
            </p>
          ) : emailDrafts.items.length === 0 ? (
            <p className="mt-1 text-[12px] text-muted">待分析完成后准备</p>
          ) : (
            <ItemList items={emailDrafts.items} />
          )}
        </section>
      ) : null}

      {reminders.requested ? (
        <section>
          <p className="text-[11px] font-medium text-muted">
            跟进提醒
            {reminders.scheduledAt && reminders.timezone
              ? ` · ${new Date(reminders.scheduledAt).toLocaleString("zh-CN", {
                  timeZone: reminders.timezone,
                  hour12: false,
                })}（${reminders.timezone}）`
              : ""}
          </p>
          {reminders.state === "needs_input" ? (
            <p className="mt-1 text-[12px] text-amber-900">
              需要你回复提醒的
              {reminders.missing.includes("timezone") ? "日期、时间和时区" : "日期和时间"}
              （不会替你选择时间）
            </p>
          ) : reminders.state === "continued" ? (
            <p className="mt-1 text-[12px] text-muted">已在后续提醒任务中处理</p>
          ) : reminders.items.length === 0 ? (
            <p className="mt-1 text-[12px] text-muted">待分析完成后准备</p>
          ) : (
            <ItemList items={reminders.items} />
          )}
        </section>
      ) : null}

      {outcome.notPerformed.length > 0 ? (
        <section>
          <p className="text-[11px] font-medium text-muted">超出本轮边界，未执行</p>
          <ul className="mt-0.5 list-disc pl-4 text-[12px] leading-5 text-[#4a524e]">
            {outcome.notPerformed.map((n) => (
              <li key={n.code}>{n.label}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {outcome.nextActions.length > 0 ? (
        <section>
          <p className="text-[11px] font-medium text-muted">下一步</p>
          <ul className="mt-0.5 list-disc pl-4 text-[12px] leading-5 text-[#3d4541]">
            {outcome.nextActions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
