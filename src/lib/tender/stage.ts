import type { TenderProject, TenderStage, StageInfo, StageStatus } from "./types";
import { TIMEZONE } from "@/lib/time";

const STAGES: Array<{ key: TenderStage; label: string }> = [
  { key: "initiation", label: "立项" },
  { key: "distribution", label: "项目分发" },
  { key: "interpretation", label: "项目解读" },
  { key: "supplier_quote", label: "供应商报价" },
  { key: "submission", label: "项目提交" },
];

const STATUS_TO_STAGE: Record<string, TenderStage> = {
  new: "initiation",
  under_review: "distribution",
  qualification_check: "distribution",
  pursuing: "interpretation",
  supplier_quote: "supplier_quote",
  bid_preparation: "submission",
  bid_submitted: "submission",
  won: "submission",
  lost: "submission",
  passed: "submission",
  archived: "submission",
};

/**
 * 推导当前招投标阶段。
 * 优先使用日期字段，兜底用 tenderStatus / intakeStatus。
 */
export function getProjectStage(p: TenderProject): TenderStage {
  if (p.submittedAt) return "submission";
  if (p.supplierQuotedAt) return "supplier_quote";
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
 * 生成 5 步 stepper 的状态列表。
 */
export function getStageSteps(p: TenderProject): StageInfo[] {
  const current = getProjectStage(p);
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

    return { key: stage.key, label: stage.label, status };
  });
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
