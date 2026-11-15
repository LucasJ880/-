import type { TenderProject, TenderStage, StageInfo, StageStatus } from "./types";
import { TIMEZONE } from "@/lib/time";

const STAGES: Array<{ key: TenderStage; label: string; weight: number }> = [
  { key: "initiation", label: "立项", weight: 0 },
  { key: "distribution", label: "项目分发", weight: 10 },
  { key: "interpretation", label: "项目解读", weight: 10 },
  { key: "supplier_inquiry", label: "供应商询价", weight: 20 },
  { key: "supplier_quote", label: "供应商报价", weight: 50 },
  { key: "submission", label: "项目提交", weight: 10 },
];

const STATUS_TO_STAGE: Record<string, TenderStage> = {
  new: "initiation",
  under_review: "distribution",
  qualification_check: "distribution",
  pursuing: "interpretation",
  supplier_inquiry: "supplier_inquiry",
  supplier_quote: "supplier_quote",
  bid_preparation: "submission",
  bid_submitted: "submission",
  won: "submission",
  lost: "submission",
  passed: "submission",
  archived: "submission",
};

/** 阶段记录：推导「记录的阶段」要看的那几项（页面上的项目对象与服务端的项目记录都满足） */
export type StageRecord = {
  tenderStatus: string | null;
  intakeStatus?: string | null;
  distributedAt?: string | Date | null;
  dispatchedAt?: string | Date | null;
  interpretedAt?: string | Date | null;
  supplierInquiredAt?: string | Date | null;
  supplierQuotedAt?: string | Date | null;
  submittedAt?: string | Date | null;
};

/**
 * 推导当前招投标阶段。
 * 优先使用日期字段，兜底用 tenderStatus / intakeStatus。
 */
export function getProjectStage(p: TenderProject): TenderStage {
  return recordedStageOf(p);
}

/** 同一套推导，只要阶段记录那几项（服务端拿项目记录直接算；结果与 getProjectStage 相同） */
export function recordedStageOf(p: StageRecord): TenderStage {
  if (p.submittedAt) return "submission";
  if (p.supplierQuotedAt) return "supplier_quote";
  if (p.supplierInquiredAt) return "supplier_inquiry";
  if (p.interpretedAt) return "interpretation";
  if (p.distributedAt || p.dispatchedAt) return "distribution";

  if (p.intakeStatus === "dispatched") return "distribution";

  if (p.tenderStatus && STATUS_TO_STAGE[p.tenderStatus]) {
    return STATUS_TO_STAGE[p.tenderStatus];
  }

  return "initiation";
}

function isTerminalStatus(status: string | null): boolean {
  return ["bid_submitted", "won", "lost", "passed", "archived"].includes(
    status || ""
  );
}

/** FIX-6：招投标状态对应六段里的哪一段；认不出的状态 → null（为空 → 立项） */
export function tenderStatusStageOf(status: string | null | undefined): TenderStage | null {
  if (!status) return "initiation";
  return Object.hasOwn(STATUS_TO_STAGE, status) ? STATUS_TO_STAGE[status] : null;
}

/** 招投标状态已是终态（已提交、已中标、未中标、已放弃投标、已归档）：进度条按「已完成」画 */
export function isTerminalTenderStatus(status: string | null | undefined): boolean {
  return isTerminalStatus(status ?? null);
}

/** 六段的先后顺序 */
export const TENDER_STAGE_ORDER: readonly TenderStage[] = STAGES.map((s) => s.key);

/** 是不是六段之一；不是（接口没给、给了认不出的值）→ null */
export function asTenderStage(value: unknown): TenderStage | null {
  return typeof value === "string" && (TENDER_STAGE_ORDER as readonly string[]).includes(value) ? (value as TenderStage) : null;
}

/**
 * FLOW-H1b：两个阶段里靠后的那个——「记录的阶段」与「实际到达的阶段」中更靠后的；
 * 第二个参数没有（或认不出）时就是第一个。只用于显示，不写任何东西。
 */
export function laterStage(recorded: TenderStage, actual: TenderStage | null | undefined): TenderStage {
  const a = TENDER_STAGE_ORDER.indexOf(recorded);
  const b = actual ? TENDER_STAGE_ORDER.indexOf(actual) : -1;
  return b > a ? (actual as TenderStage) : recorded;
}

/**
 * 获取项目的整体状态标签。
 */
export function getProjectStageStatus(
  p: TenderProject
): "in_progress" | "completed" | "due_soon" | "overdue" {
  const now = new Date();
  const close = resolveCloseDate(p);

  if (isTerminalStatus(p.tenderStatus) || p.submittedAt) {
    return "completed";
  }

  if (close) {
    const msLeft = close.getTime() - now.getTime();
    if (msLeft < 0) return "overdue";
    if (msLeft < 48 * 3600_000) return "due_soon";
  }

  return "in_progress";
}

export function resolveCloseDate(p: TenderProject): Date | null {
  const raw = p.closeDate || p.dueDate;
  return raw ? new Date(raw) : null;
}

/**
 * 生成 6 步 stepper 的状态列表（含各阶段权重）。
 * stageOverride：按这个阶段算（FLOW-H1b：项目页传「显示的阶段」）；不传时与原来相同，用记录的阶段。
 */
export function getStageSteps(p: TenderProject, stageOverride?: TenderStage): StageInfo[] {
  const current = stageOverride ?? getProjectStage(p);
  const overallStatus = getProjectStageStatus(p);
  const stageIndex = STAGES.findIndex((s) => s.key === current);

  return STAGES.map((stage, i) => {
    let status: StageStatus;

    if (i < stageIndex) {
      status = "completed";
    } else if (i === stageIndex) {
      if (overallStatus === "overdue") {
        status = "overdue";
      } else if (overallStatus === "completed") {
        status = "completed";
      } else {
        status = "current";
      }
    } else {
      if (overallStatus === "overdue" && i > stageIndex) {
        const close = resolveCloseDate(p);
        if (close && close.getTime() < Date.now()) {
          status = "overdue";
        } else {
          status = "pending";
        }
      } else {
        status = "pending";
      }
    }

    return { key: stage.key, label: stage.label, status, weight: stage.weight };
  });
}

/**
 * 计算项目整体完成百分比。
 * 已完成的阶段权重累加；当前阶段视为进行中（不计入已完成比例）。
 */
export function getProjectCompletion(p: TenderProject, stageOverride?: TenderStage): number {
  const current = stageOverride ?? getProjectStage(p);
  const overallStatus = getProjectStageStatus(p);
  const stageIndex = STAGES.findIndex((s) => s.key === current);

  let pct = 0;
  for (let i = 0; i < STAGES.length; i++) {
    if (i < stageIndex) {
      pct += STAGES[i].weight;
    } else if (i === stageIndex && overallStatus === "completed") {
      pct += STAGES[i].weight;
    }
  }
  return pct;
}

/**
 * 格式化倒计时：还剩 X 天 Y 小时 / 已逾期 X 天
 */
export function formatCountdown(target: Date): {
  text: string;
  isOverdue: boolean;
  isDueSoon: boolean;
} {
  const now = Date.now();
  const diff = target.getTime() - now;
  const absDiff = Math.abs(diff);
  const days = Math.floor(absDiff / (24 * 3600_000));
  const hours = Math.floor((absDiff % (24 * 3600_000)) / 3600_000);

  if (diff < 0) {
    return {
      text: days > 0 ? `已逾期 ${days} 天 ${hours} 小时` : `已逾期 ${hours} 小时`,
      isOverdue: true,
      isDueSoon: false,
    };
  }

  if (diff < 48 * 3600_000) {
    return {
      text: days > 0 ? `还剩 ${days} 天 ${hours} 小时` : `还剩 ${hours} 小时`,
      isOverdue: false,
      isDueSoon: true,
    };
  }

  return {
    text: `还剩 ${days} 天 ${hours} 小时`,
    isOverdue: false,
    isDueSoon: false,
  };
}
