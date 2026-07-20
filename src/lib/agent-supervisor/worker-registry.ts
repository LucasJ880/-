/**
 * Worker Registry — 主管只能通过 Worker 调用白名单技能
 */

import { MARKETING_PHASE2_SKILLS } from "@/lib/agent-core/skills/marketing-phase2-seed";
import { DIGITAL_EMPLOYEE_ROLES } from "@/lib/agent-core/skills/digital-employee-roles";
import type { WorkerId } from "./types";

export type WorkerConfig = {
  id: WorkerId;
  displayName: string;
  description: string;
  allowedSkills: string[];
  allowedDomains: string[];
  maxSkillCallsPerRun: number;
};

function marketingAllowedSkills(): string[] {
  const fromRole =
    DIGITAL_EMPLOYEE_ROLES.find(
      (r) => r.id === "marketing-growth-digital-employee",
    )?.skillSlugs ?? [];
  const phase2 = MARKETING_PHASE2_SKILLS.map((s) => s.slug);
  // 主管营销 Worker：企业营销技能（不含 23 条运营长尾，避免步骤膨胀）
  const base = [
    "marketing-geo-audit",
    "marketing-cro-audit",
    ...phase2,
  ];
  return Array.from(new Set([...base, ...fromRole.filter((s) => !s.startsWith("ops-"))]));
}

export const WORKER_REGISTRY: Record<WorkerId, WorkerConfig> = {
  sales: {
    id: "sales",
    displayName: "销售数字员工",
    description: "管道、跟进、客户研究与方案 ROI",
    allowedSkills: [
      "sales-icp-prospect-scoring",
      "sales-account-research",
      "sales-pipeline-forecast",
      "sales-next-best-action",
      "sales-proposal-roi",
    ],
    allowedDomains: ["sales"],
    maxSkillCallsPerRun: 3,
  },
  tender: {
    id: "tender",
    displayName: "投标数字员工",
    description: "去留判断、强制条件与废标风险",
    allowedSkills: [
      "tender-bid-no-bid",
      "tender-mandatory-compliance-matrix",
      "tender-disqualification-check",
    ],
    allowedDomains: ["project", "tender"],
    maxSkillCallsPerRun: 3,
  },
  marketing: {
    id: "marketing",
    displayName: "营销数字员工",
    description: "产品档案、获客、文案、实验与 GEO/CRO",
    allowedSkills: marketingAllowedSkills(),
    allowedDomains: ["marketing"],
    maxSkillCallsPerRun: 3,
  },
  analytics: {
    id: "analytics",
    displayName: "数据分析数字员工",
    description: "MMM 数据准备度（不运行模型）",
    allowedSkills: ["mmm-data-readiness"],
    allowedDomains: ["analytics"],
    maxSkillCallsPerRun: 2,
  },
};

export function listWorkers(): WorkerConfig[] {
  return Object.values(WORKER_REGISTRY);
}

export function getWorker(id: WorkerId): WorkerConfig {
  return WORKER_REGISTRY[id];
}

export function findWorkerForSkill(slug: string): WorkerId | null {
  for (const w of listWorkers()) {
    if (w.allowedSkills.includes(slug)) return w.id;
  }
  return null;
}

export function isSkillAllowedForWorker(
  workerId: WorkerId,
  skillSlug: string,
): boolean {
  return WORKER_REGISTRY[workerId].allowedSkills.includes(skillSlug);
}

export function workerSummariesForPrompt(): string {
  return listWorkers()
    .map(
      (w) =>
        `- ${w.id}（${w.displayName}）：${w.description}；技能：${w.allowedSkills.join(", ")}`,
    )
    .join("\n");
}
