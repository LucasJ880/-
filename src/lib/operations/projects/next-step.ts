/**
 * 下一步建议：仅确定性规则，无 AI 推测
 */

import { normalizeDeliveryStage, type DeliveryStage } from "./stage";

export type NextStepTaskSignal = {
  title: string;
  status: string;
};

const STAGE_TASK_HINTS: Partial<
  Record<DeliveryStage, { keyword: RegExp; suggestion: string }>
> = {
  handoff: {
    keyword: /交接|handoff/i,
    suggestion: "建议创建交接核对任务",
  },
  contract_review: {
    keyword: /合同|复核|contract/i,
    suggestion: "建议创建合同复核任务",
  },
  site_measurement: {
    keyword: /测量|measure|现场/i,
    suggestion: "建议创建现场测量任务",
  },
  shop_drawing: {
    keyword: /shop\s*drawing|图纸|深化/i,
    suggestion: "建议创建 Shop Drawing 任务",
  },
  client_approval: {
    keyword: /审批|approval|客户确认/i,
    suggestion: "建议创建客户审批跟进任务",
  },
  procurement: {
    keyword: /采购|procure|下单/i,
    suggestion: "建议创建采购任务",
  },
  production: {
    keyword: /生产|production|制造/i,
    suggestion: "建议创建生产跟进任务",
  },
  shipping: {
    keyword: /运输|发货|shipping|物流/i,
    suggestion: "建议创建运输跟进任务",
  },
  installation: {
    keyword: /安装|install/i,
    suggestion: "建议创建安装任务",
  },
  deficiency: {
    keyword: /deficiency|整改|缺陷|punch/i,
    suggestion: "建议创建 Deficiency 整改任务",
  },
};

function isOpen(status: string): boolean {
  const s = status.trim().toLowerCase();
  return s !== "done" && s !== "cancelled" && s !== "completed";
}

export function suggestDeliveryNextStep(input: {
  deliveryStage: string | null | undefined;
  openTasks: readonly NextStepTaskSignal[];
}): string | null {
  const stage = normalizeDeliveryStage(input.deliveryStage);
  if (!stage) return "请设置交付阶段";
  if (stage === "completed") return "项目已完成，无需推进";
  if (stage === "cancelled") return "项目已取消";
  if (stage === "on_hold") return "项目已暂停，确认恢复条件后再推进";

  const hint = STAGE_TASK_HINTS[stage];
  if (!hint) return null;

  const open = input.openTasks.filter((t) => isOpen(t.status));
  const hasRelated = open.some((t) => hint.keyword.test(t.title));
  if (!hasRelated) return hint.suggestion;

  if (open.some((t) => t.status.toLowerCase() === "blocked")) {
    return "优先处理阻塞任务后再推进阶段";
  }

  return "继续跟进当前阶段开放任务";
}
