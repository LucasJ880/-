/**
 * Muse Bridge — `next_step` 意图（P1-8）：这个标现在最该做什么（确定性查表，零 LLM，零 DB）
 *
 * 规则顺序即优先级，命中第一条即返回（任务书 P1-8 §1.B 的表）。
 * 分析相位用 tender/workbench-state 的 analysisPhaseFromRunStatus（与工作台同一套判断，不另写一份）。
 */

import { analysisPhaseFromRunStatus } from "@/lib/tender/workbench-state";
import type { Advisory } from "./advisory";
import type { MuseUserPrefs } from "./prefs-pure";

export const DEFAULT_CHASE_AFTER_DAYS = 3;
const DEADLINE_WARN_DAYS = 3;
const DAY = 86_400_000;

export type NextStepSnapshot = {
  projectId: string;
  projectName: string;
  now: Date;
  /** resolveCloseDate(project) 的结果 */
  closeDate: Date | string | null;
  submittedAt: Date | string | null;
  /** 最新 TenderAnalysisRun.status；无 run → null */
  analysisStatus: string | null;
  /** 最新 run 的 criticalFacts 里 status = UNKNOWN 的槽位数 */
  unknownCriticalFacts: number;
  /** 最新 run 里 mandatory 且 complianceStatus = NON_COMPLIANT 的要求数 */
  mandatoryNonCompliant: number;
  /** 该用户可见、属于本项目的待批 PendingAction */
  pendingApprovals: Array<{ id: string; title: string; createdAt: Date | string }>;
  /** 最新一轮询价（无轮次 → null） */
  latestRound: {
    inquiryId: string;
    items: Array<{
      itemId: string;
      supplierName: string;
      status: string;
      sentAt: Date | string | null;
      isSelected: boolean;
      /** P1-7：有询价邮件线程（threadId）才能自动催；缺省视为能 */
      hasThread?: boolean;
      /** P1-7：已发出的催单（no_reply）时间；最后一次联系 = 最后一条催单，否则 = sentAt */
      chasedAt?: Array<Date | string>;
    }>;
  } | null;
  hasProjectQuote: boolean;
  prefs: Pick<MuseUserPrefs, "defaultSupplierIds" | "chaseAfterDays">;
};

export type NextStepRule =
  | "pending_approval"
  | "deadline_soon"
  | "no_analysis"
  | "analysis_running"
  | "unknown_facts"
  | "mandatory_gap"
  | "no_rfq"
  | "no_reply"
  | "quotes_ready"
  | "price_pending"
  | "idle";

export type NextStepDecision = { rule: NextStepRule; advisory: Advisory };

/** summaryJson.criticalFacts 里 status = UNKNOWN 的槽位数（字符串 / 无 status 的槽位视为已知） */
export function countUnknownCriticalFacts(summaryJson: unknown): number {
  const cf = (summaryJson as { criticalFacts?: unknown } | null)?.criticalFacts;
  if (!cf || typeof cf !== "object") return 0;
  return Object.values(cf as Record<string, unknown>).filter(
    (v) => !!v && typeof v === "object" && (v as { status?: unknown }).status === "UNKNOWN",
  ).length;
}

const ms = (v: Date | string) => (typeof v === "string" ? new Date(v) : v).getTime();
const short = (s: string, n = 16) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function decideNextStep(s: NextStepSnapshot): NextStepDecision {
  const pid = s.projectId;
  const status = { label: "看这个标的状态", command: { intent: "status" as const, projectId: pid } };

  // 1. 有待批
  if (s.pendingApprovals.length > 0) {
    const earliest = [...s.pendingApprovals].sort((a, b) => ms(a.createdAt) - ms(b.createdAt))[0];
    return {
      rule: "pending_approval",
      advisory: {
        conclusion: `有 ${s.pendingApprovals.length} 条等你批`,
        reasons: [`最早一条：${earliest.title}`],
        nextStep: { label: "批准最早一条", command: { intent: "approve", approvalId: earliest.id } },
        alternatives: [{ label: "先不批", command: { intent: "reject", approvalId: earliest.id, reason: "暂缓" } }],
      },
    };
  }

  // 2. 截标 ≤ 3 天且未提交
  if (s.closeDate && !s.submittedAt) {
    const days = Math.ceil((ms(s.closeDate) - s.now.getTime()) / DAY);
    if (days >= 0 && days <= DEADLINE_WARN_DAYS) {
      return {
        rule: "deadline_soon",
        advisory: {
          conclusion: days === 0 ? "今天截标，还没提交" : `${days} 天后截标，还没提交`,
          reasons: [`「${short(s.projectName, 24)}」截标 ${new Date(ms(s.closeDate)).toISOString().slice(0, 10)}`],
          nextStep: status,
          alternatives: [{ label: "提交清单差什么", command: { intent: "ask", projectId: pid, question: "提交清单还差什么？" } }],
        },
      };
    }
  }

  // 3. 无分析 / 分析失败（Muse 做不了上传）
  const phase = analysisPhaseFromRunStatus(s.analysisStatus);
  if (phase === "none" || phase === "failed") {
    return {
      rule: "no_analysis",
      advisory: {
        conclusion: "招标文件还没分析",
        reasons: [phase === "failed" ? "上次分析失败，请在青砚重新上传文件或重新发起分析" : "请在青砚上传招标文件，分析完成后再来问我"],
        nextStep: null,
      },
    };
  }

  // 3b. 分析进行中（表外补充：此时建议询价会因要求未确认而失败）
  if (phase === "processing") {
    return {
      rule: "analysis_running",
      advisory: { conclusion: "招标文件正在分析", reasons: ["分析完成后再问我下一步"], nextStep: null },
    };
  }

  // 4. 待审阅且有关键事实没证据
  if (phase === "review_required" && s.unknownCriticalFacts > 0) {
    return {
      rule: "unknown_facts",
      advisory: {
        conclusion: `分析完了，${s.unknownCriticalFacts} 个关键事实没证据`,
        reasons: ["关键事实（数量 / 交付 / 截标时间等）缺证据时，询价与报价都会受影响"],
        nextStep: { label: "哪些关键事实缺证据", command: { intent: "ask", projectId: pid, question: "哪些关键事实缺证据？" } },
      },
    };
  }

  // 5. 强制要求当前无法满足
  if (s.mandatoryNonCompliant > 0) {
    return {
      rule: "mandatory_gap",
      advisory: {
        conclusion: `${s.mandatoryNonCompliant} 条强制要求当前无法满足`,
        reasons: ["强制要求不满足通常直接废标"],
        nextStep: { label: "列出无法满足的强制要求", command: { intent: "ask", projectId: pid, question: "列出无法满足的强制要求" } },
      },
    };
  }

  // 6. 还没问过供应商
  const items = s.latestRound?.items ?? [];
  if (!s.latestRound || items.length === 0 || items.every((i) => i.status === "pending")) {
    const preferred = s.prefs.defaultSupplierIds;
    return {
      rule: "no_rfq",
      advisory: {
        conclusion: "还没问过供应商",
        reasons: [preferred.length ? `会先按你常用的 ${preferred.length} 家供应商起草询价` : "会先列出候选供应商让你选"],
        nextStep: {
          label: "起草询价",
          command: { intent: "rfq", projectId: pid, ...(preferred.length ? { supplierIds: preferred } : {}) },
        },
      },
    };
  }

  // 7. 已发、有家没回且距最后一次联系满 N 天 → 催（P1-7）；催满两次的等自动标未响应，不再建议催
  const chaseDays = s.prefs.chaseAfterDays ?? DEFAULT_CHASE_AFTER_DAYS;
  const lastContact = (i: (typeof items)[number]) => Math.max(i.sentAt ? ms(i.sentAt) : 0, ...(i.chasedAt ?? []).map(ms));
  const silent = items.filter((i) => i.status === "sent" && i.sentAt && (i.chasedAt?.length ?? 0) < 2 && s.now.getTime() - lastContact(i) >= chaseDays * DAY);
  if (silent.length > 0) {
    const chaseable = silent.filter((i) => i.hasThread !== false);
    const manual = silent.length - chaseable.length;
    return {
      rule: "no_reply",
      advisory: {
        conclusion: `${silent.length} 家没回`,
        reasons: [
          `超过 ${chaseDays} 天未回复：${silent.slice(0, 3).map((i) => short(i.supplierName, 12)).join("、")}`,
          ...(manual ? [`${manual} 家没有邮件线程，无法自动催，请手工联系`] : []),
        ],
        nextStep: chaseable.length
          ? {
              label: `催 ${chaseable.length} 家`,
              command: { intent: "chase", projectId: pid, inquiryId: s.latestRound!.inquiryId, itemIds: chaseable.map((i) => i.itemId) },
            }
          : null,
      },
    };
  }

  // 8. 报价齐了还没定
  const quoted = items.filter((i) => i.status === "quoted");
  const selected = items.find((i) => i.isSelected);
  if (quoted.length >= 2 && !selected) {
    return {
      rule: "quotes_ready",
      advisory: {
        conclusion: "报价齐了，还没定供应商",
        reasons: [`已有 ${quoted.length} 家报价入表`],
        nextStep: { label: "比价", command: { intent: "compare", projectId: pid, inquiryId: s.latestRound!.inquiryId } },
      },
    };
  }

  // 9. 定了供应商还没定投标价
  if (selected && !s.hasProjectQuote) {
    return {
      rule: "price_pending",
      advisory: {
        conclusion: "供应商定了，还没定投标价",
        reasons: [`已选定 ${short(selected.supplierName)}`],
        nextStep: { label: `按 ${short(selected.supplierName, 12)} 算定价情景`, command: { intent: "price_scenario", projectId: pid, supplierItemId: selected.itemId } },
      },
    };
  }

  // 10. 其它
  return {
    rule: "idle",
    advisory: { conclusion: "这个标当前没有待办", reasons: [], nextStep: status },
  };
}
