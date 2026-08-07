"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  FileText,
  History,
  ListTodo,
  MailWarning,
  PackageCheck,
  Sparkles,
  Target,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { reviewCrmRecord } from "@/lib/digital-employees/crm-review";
import type {
  CustomerDetail,
  Interaction,
  Opportunity,
  Quote,
} from "@/app/(main)/sales/customers/[id]/types";
import { STAGE_LABELS } from "@/app/(main)/sales/customers/[id]/types";
import type { SalesActionDto } from "@/app/(main)/sales/sales-action-types";

export type CustomerContextTarget =
  | "profile"
  | "timeline"
  | "quotes"
  | "orders"
  | "email";

interface CustomerContextNotice {
  label: string;
  tone: "warning" | "danger";
}

export interface CustomerCommandState {
  stageLabel: string;
  statusLabel: string;
  statusTone: "neutral" | "success" | "warning";
  missingItems: string[];
  risks: CustomerContextNotice[];
  nextAction: {
    label: string;
    reason: string;
    target: CustomerContextTarget;
  };
}

export interface CustomerContextInput {
  customer: Pick<
    CustomerDetail,
    | "status"
    | "createdAt"
    | "phone"
    | "email"
    | "address"
    | "opportunities"
    | "interactions"
    | "quotes"
    | "blindsOrders"
  >;
  emailReady: boolean | null;
  activeActionCount: number;
  nowMs?: number;
}

const ACTIVE_STAGES = new Set([
  "new_lead",
  "needs_confirmed",
  "measure_booked",
  "quoted",
  "negotiation",
  "signed",
  "producing",
  "installing",
  "on_hold",
]);

function activeOpportunity(opportunities: Opportunity[]): Opportunity | null {
  return opportunities.find((item) => ACTIVE_STAGES.has(item.stage)) ?? opportunities[0] ?? null;
}

function latestQuote(quotes: Quote[]): Quote | null {
  return quotes[0] ?? null;
}

function hasSignedDepositPending(quotes: Quote[]): boolean {
  return quotes.some(
    (quote) =>
      (quote.status === "signed" || quote.status === "accepted") &&
      !quote.depositCollectedAt,
  );
}

export function deriveCustomerCommandState(
  input: CustomerContextInput,
): CustomerCommandState {
  const { customer } = input;
  const nowMs = input.nowMs ?? Date.now();
  const opportunity = activeOpportunity(customer.opportunities);
  const quote = latestQuote(customer.quotes);
  const lastInteraction = customer.interactions[0] ?? null;
  const missingItems: string[] = [];
  const risks: CustomerContextNotice[] = [];

  if (!customer.phone && !customer.email) missingItems.push("补充电话或邮箱");
  if (!customer.address) missingItems.push("补充客户地址");
  if (!opportunity) missingItems.push("建立销售机会");
  if (opportunity && !opportunity.nextFollowupAt && !["completed", "lost"].includes(opportunity.stage)) {
    missingItems.push("设定下次跟进时间");
  }
  if (!lastInteraction) missingItems.push("记录首次客户互动");

  const review = reviewCrmRecord(
    {
      createdAt: customer.createdAt,
      updatedAt: opportunity?.updatedAt ?? customer.createdAt,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      stage: opportunity?.stage ?? "new_lead",
      nextFollowupAt: opportunity?.nextFollowupAt,
      lastContactAt: lastInteraction?.createdAt,
      quoteStatus: quote?.status,
      quoteViewedAt: quote?.viewedAt,
    },
    nowMs,
  );

  if (review.urgency !== "ready") {
    risks.push({
      label: review.summary,
      tone: review.urgency === "critical" ? "danger" : "warning",
    });
  }
  const depositPending = hasSignedDepositPending(customer.quotes);
  if (depositPending) {
    risks.push({ label: "已有签约订单尚未登记定金", tone: "warning" });
  }
  const hasSendableQuote = customer.quotes.some((item) =>
    ["draft", "sent", "viewed"].includes(item.status),
  );
  if (input.emailReady === false && hasSendableQuote) {
    risks.push({ label: "销售邮箱尚未绑定，报价无法从青砚发出", tone: "danger" });
  }
  if (input.activeActionCount > 0) {
    risks.push({
      label: `${input.activeActionCount} 项数字员工行动等待销售处理`,
      tone: "warning",
    });
  }

  let nextAction: CustomerCommandState["nextAction"];
  if (!customer.phone && !customer.email) {
    nextAction = {
      label: "完善联系方式",
      reason: "没有电话或邮箱时，销售和数字员工都无法继续跟进。",
      target: "profile",
    };
  } else if (depositPending) {
    nextAction = {
      label: "登记定金收款",
      reason: "客户已经签约，应先补齐实收金额与支付方式。",
      target: "quotes",
    };
  } else if (input.emailReady === false && hasSendableQuote) {
    nextAction = {
      label: "绑定销售邮箱",
      reason: "完成邮箱绑定后才能从青砚发送报价和跟进邮件。",
      target: "email",
    };
  } else if (customer.blindsOrders.length > 0 && !opportunity) {
    nextAction = {
      label: "查看订单进度",
      reason: "当前客户已有订单，优先确认生产和安装进度。",
      target: "orders",
    };
  } else if (!opportunity) {
    nextAction = {
      label: "记录需求并建立机会",
      reason: "先记录客户需求，再把后续报价和订单归入同一销售机会。",
      target: "timeline",
    };
  } else if (review.action === "complete_profile") {
    nextAction = {
      label: review.actionLabel,
      reason: review.summary,
      target: "profile",
    };
  } else if (review.action === "create_quote") {
    nextAction = {
      label: review.actionLabel,
      reason: review.summary,
      target: "quotes",
    };
  } else if (review.action !== "none") {
    nextAction = {
      label: review.actionLabel,
      reason: review.summary,
      target: "timeline",
    };
  } else if (input.activeActionCount > 0) {
    nextAction = {
      label: "处理数字员工行动",
      reason: "行动队列已有明确任务，处理后再继续推进商机。",
      target: "timeline",
    };
  } else {
    nextAction = {
      label: "按计划继续跟进",
      reason: opportunity?.nextFollowupAt
        ? `下一次跟进已安排在 ${new Date(opportunity.nextFollowupAt).toLocaleDateString("zh-CN")}。`
        : "客户资料和商机节奏正常，记录下一次有效互动即可。",
      target: "timeline",
    };
  }

  const statusLabel =
    customer.status === "active"
      ? "跟进中"
      : customer.status === "completed"
        ? "已完成"
        : customer.status === "dormant"
          ? "休眠"
          : customer.status;

  return {
    stageLabel: opportunity
      ? (STAGE_LABELS[opportunity.stage] ?? opportunity.stage)
      : "尚未建立商机",
    statusLabel,
    statusTone:
      customer.status === "active"
        ? "success"
        : customer.status === "dormant"
          ? "warning"
          : "neutral",
    missingItems,
    risks,
    nextAction,
  };
}

export function CustomerCommandOverview({
  command,
  activeActionCount,
  latestInteraction,
  onNavigate,
}: {
  command: CustomerCommandState;
  activeActionCount: number;
  latestInteraction: Interaction | null;
  onNavigate: (target: CustomerContextTarget) => void;
}) {
  return (
    <section
      className="rounded-[var(--radius-xl)] border border-border bg-card-bg p-4 sm:p-5"
      aria-labelledby="customer-command-title"
      data-testid="customer-command-overview"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-accent">
            客户决策摘要
          </p>
          <h2 id="customer-command-title" className="mt-1 text-base font-semibold text-foreground">
            当前处于“{command.stageLabel}”阶段
          </h2>
          <p className="mt-1 text-xs text-muted">
            {command.missingItems.length > 0
              ? `还有 ${command.missingItems.length} 项资料或销售动作尚未完成`
              : "客户资料与销售基础动作已补齐"}
          </p>
        </div>
        <Button size="sm" onClick={() => onNavigate(command.nextAction.target)}>
          {command.nextAction.label} <ArrowRight size={13} />
        </Button>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCell
          icon={AlertTriangle}
          label="主要风险"
          value={command.risks[0]?.label ?? "当前没有需要立即处理的风险"}
          tone={command.risks.length > 0 ? "warning" : "neutral"}
        />
        <SummaryCell
          icon={Target}
          label="数字员工行动"
          value={activeActionCount > 0 ? `${activeActionCount} 项待处理` : "当前行动队列为空"}
          tone={activeActionCount > 0 ? "warning" : "neutral"}
        />
        <SummaryCell
          icon={History}
          label="最近变化"
          value={latestInteraction?.summary ?? "暂无客户互动记录"}
        />
        <SummaryCell
          icon={Sparkles}
          label="推荐下一步"
          value={command.nextAction.reason}
          tone="accent"
        />
      </div>
    </section>
  );
}

function SummaryCell({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: "neutral" | "warning" | "accent";
}) {
  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border p-3",
        tone === "warning"
          ? "border-amber-200 bg-amber-50/70"
          : tone === "accent"
            ? "border-accent/20 bg-accent-soft"
            : "border-border bg-background/60",
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted">
        <Icon size={13} className={tone === "accent" ? "text-accent" : undefined} />
        {label}
      </div>
      <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-foreground">{value}</p>
    </div>
  );
}

export function CustomerContextPanel({
  command,
  opportunities,
  quotes,
  orders,
  interactions,
  emailReady,
  activeActions,
  onNavigate,
}: {
  command: CustomerCommandState;
  opportunities: Opportunity[];
  quotes: Quote[];
  orders: CustomerDetail["blindsOrders"];
  interactions: Interaction[];
  emailReady: boolean | null;
  activeActions: SalesActionDto[];
  onNavigate: (target: CustomerContextTarget) => void;
}) {
  return (
    <div className="space-y-4" data-testid="customer-context-panel">
      <section className="rounded-[var(--radius-lg)] border border-border bg-background/70 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">当前销售阶段</p>
            <p className="mt-1 text-base font-semibold text-foreground">{command.stageLabel}</p>
          </div>
          <StatusBadge
            status={command.statusLabel}
            label={command.statusLabel}
            tone={command.statusTone}
          />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Metric icon={Target} value={opportunities.length} label="商机" />
          <Metric icon={FileText} value={quotes.length} label="报价" />
          <Metric icon={PackageCheck} value={orders.length} label="订单" />
        </div>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-accent/20 bg-accent-soft p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <ArrowRight size={15} className="text-accent" />
          推荐下一步
        </div>
        <p className="mt-2 text-sm font-medium text-foreground">{command.nextAction.label}</p>
        <p className="mt-1 text-xs leading-5 text-muted">{command.nextAction.reason}</p>
        <Button
          size="sm"
          className="mt-3 w-full"
          onClick={() => onNavigate(command.nextAction.target)}
        >
          前往处理 <ArrowRight size={13} />
        </Button>
      </section>

      <ContextSection
        icon={AlertTriangle}
        title="风险"
        empty="当前没有识别到需要立即处理的风险"
        hasContent={command.risks.length > 0}
      >
        {command.risks.map((risk) => (
          <div
            key={risk.label}
            className={cn(
              "rounded-[var(--radius-sm)] border px-3 py-2 text-xs leading-5",
              risk.tone === "danger"
                ? "border-danger/20 bg-danger-bg text-danger"
                : "border-amber-200 bg-amber-50 text-amber-900",
            )}
          >
            {risk.label}
          </div>
        ))}
      </ContextSection>

      <ContextSection
        icon={ListTodo}
        title="尚未完成"
        empty="客户资料与销售基础动作已补齐"
        hasContent={command.missingItems.length > 0}
      >
        {command.missingItems.map((item) => (
          <div key={item} className="flex items-start gap-2 text-xs text-foreground">
            <CircleHelp size={13} className="mt-0.5 shrink-0 text-muted" />
            <span>{item}</span>
          </div>
        ))}
      </ContextSection>

      <ContextSection
        icon={Sparkles}
        title={`数字员工行动${activeActions.length ? ` · ${activeActions.length}` : ""}`}
        empty="当前没有等待销售处理的数字员工行动"
        hasContent={activeActions.length > 0}
      >
        {activeActions.slice(0, 3).map((action) => (
          <div key={action.id} className="rounded-[var(--radius-sm)] border border-border bg-background p-3">
            <p className="text-xs font-medium text-foreground">{action.title}</p>
            {action.description ? (
              <p className="mt-1 line-clamp-3 text-[11px] leading-4 text-muted">{action.description}</p>
            ) : null}
          </div>
        ))}
      </ContextSection>

      <ContextSection
        icon={History}
        title="最近变化"
        empty="暂无客户互动记录"
        hasContent={interactions.length > 0}
      >
        {interactions.slice(0, 3).map((interaction) => (
          <div key={interaction.id} className="border-l-2 border-border pl-3">
            <p className="line-clamp-2 text-xs text-foreground">{interaction.summary}</p>
            <p className="mt-1 text-[10px] text-muted">
              {new Date(interaction.createdAt).toLocaleDateString("zh-CN")} · {interaction.createdBy.name}
            </p>
          </div>
        ))}
      </ContextSection>

      <section className="rounded-[var(--radius-lg)] border border-border bg-background/70 p-4">
        <div className="flex items-start gap-2">
          {emailReady === false ? (
            <MailWarning size={15} className="mt-0.5 shrink-0 text-amber-600" />
          ) : (
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" />
          )}
          <div>
            <p className="text-xs font-medium text-foreground">销售邮件通道</p>
            <p className="mt-1 text-[11px] leading-4 text-muted">
              {emailReady === null
                ? "邮件状态暂时无法确认"
                : emailReady
                  ? "已绑定，可按现有审批与发送流程使用"
                  : "尚未绑定，报价邮件无法从青砚发出"}
            </p>
          </div>
        </div>
        {emailReady === false ? (
          <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => onNavigate("email")}>
            前往绑定邮箱
          </Button>
        ) : null}
      </section>
    </div>
  );
}

function Metric({ icon: Icon, value, label }: { icon: LucideIcon; value: number; label: string }) {
  return (
    <div className="rounded-[var(--radius-sm)] bg-card-bg px-2 py-2">
      <Icon size={13} className="mx-auto text-muted" />
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
      <p className="text-[10px] text-muted">{label}</p>
    </div>
  );
}

function ContextSection({
  icon: Icon,
  title,
  empty,
  hasContent,
  children,
}: {
  icon: LucideIcon;
  title: string;
  empty: string;
  hasContent: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-border bg-background/70 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Icon size={15} className="text-muted" />
        {title}
      </div>
      <div className="mt-3 space-y-2">
        {hasContent ? (
          children
        ) : (
          <div className="flex items-start gap-2 text-xs leading-5 text-muted">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-success" />
            {empty}
          </div>
        )}
      </div>
    </section>
  );
}
