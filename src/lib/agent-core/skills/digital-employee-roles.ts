/**
 * 数字员工角色 → 技能推荐分组（不新建员工表，复用 Agent）
 */

export interface DigitalEmployeeRole {
  id: string;
  name: string;
  description: string;
  /** 推荐技能 slug；运营技能仍属营销增长数字员工 */
  skillSlugs: string[];
  /** 是否包含现有 23 条运营技能（domain=operations） */
  includeOperationsSkills?: boolean;
}

export const DIGITAL_EMPLOYEE_ROLES: DigitalEmployeeRole[] = [
  {
    id: "sales-digital-employee",
    name: "销售数字员工",
    description: "获客评分、客户研究、管道预测、下一动作与方案 ROI",
    skillSlugs: [
      "sales-icp-prospect-scoring",
      "sales-account-research",
      "sales-pipeline-forecast",
      "sales-next-best-action",
      "sales-proposal-roi",
    ],
  },
  {
    id: "marketing-growth-digital-employee",
    name: "营销增长数字员工",
    description: "GEO/CRO 审计，并复用现有运营技能包",
    skillSlugs: ["marketing-geo-audit", "marketing-cro-audit"],
    includeOperationsSkills: true,
  },
  {
    id: "tender-digital-employee",
    name: "投标数字员工",
    description: "去留判断、强制条件矩阵、废标风险检查",
    skillSlugs: [
      "tender-bid-no-bid",
      "tender-mandatory-compliance-matrix",
      "tender-disqualification-check",
    ],
  },
  {
    id: "analytics-digital-employee",
    name: "数据分析数字员工",
    description: "MMM 数据准备度检查（不运行 Meridian 模型）",
    skillSlugs: ["mmm-data-readiness"],
  },
];
