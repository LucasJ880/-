import type {
  ConditionalTaskFlags,
  HandoffTaskPlanItem,
} from "./types";

export const BASE_HANDOFF_TASKS: HandoffTaskPlanItem[] = [
  {
    templateKey: "contract_review",
    title: "复核合同与最终承诺范围",
    description: "核对中标/合同范围、规格与承诺条款，确认与投标最终版本一致。",
    conditional: false,
    reason: "基础交接任务",
  },
  {
    templateKey: "confirm_delivery_date",
    title: "确认项目负责人、关键联系人和计划完成日期",
    description: "确认运营负责人、客户关键联系人及合同交付日期。",
    conditional: false,
    reason: "基础交接任务",
  },
  {
    templateKey: "internal_kickoff",
    title: "召开或安排内部项目交接",
    description: "组织内部交接，对齐范围、风险与下一步。",
    conditional: false,
    reason: "基础交接任务",
  },
  {
    templateKey: "first_milestone",
    title: "确认下一阶段及首个执行里程碑",
    description: "明确下一交付阶段与首个可执行里程碑。",
    conditional: false,
    reason: "基础交接任务",
  },
];

const CONDITIONAL_CATALOG: Record<
  keyof ConditionalTaskFlags,
  HandoffTaskPlanItem[]
> = {
  insuranceOrBond: [
    {
      templateKey: "insurance_review",
      title: "核对保险要求",
      description: "根据合同/招标要求核对保险条款。",
      conditional: true,
      reason: "存在保险或 Bond 要求",
    },
    {
      templateKey: "performance_bond",
      title: "提交或确认 Performance Bond",
      description: "按要求提交或确认履约保函。",
      conditional: true,
      reason: "存在保险或 Bond 要求",
    },
    {
      templateKey: "labour_material_bond",
      title: "提交或确认 Labour and Material Payment Bond",
      description: "按要求提交或确认劳工与材料支付保函。",
      conditional: true,
      reason: "存在保险或 Bond 要求",
    },
  ],
  securityOrSiteAccess: [
    {
      templateKey: "security_clearance_org",
      title: "确认组织安全资质",
      description: "确认企业侧安全资质是否满足现场要求。",
      conditional: true,
      reason: "存在安全或现场准入要求",
    },
    {
      templateKey: "security_clearance_people",
      title: "确认现场人员 clearance",
      description: "确认进场人员安全 clearance。",
      conditional: true,
      reason: "存在安全或现场准入要求",
    },
    {
      templateKey: "site_access_submit",
      title: "提交人员姓名和准入信息",
      description: "向客户/场地方提交进场人员名单与准入资料。",
      conditional: true,
      reason: "存在安全或现场准入要求",
    },
    {
      templateKey: "site_visit_requirements",
      title: "安排现场访问要求",
      description: "确认并安排现场访问流程与限制。",
      conditional: true,
      reason: "存在安全或现场准入要求",
    },
  ],
  siteMeasurement: [
    {
      templateKey: "site_measurement",
      title: "安排现场测量",
      description: "安排并完成现场测量。",
      conditional: true,
      reason: "需要现场测量",
    },
    {
      templateKey: "site_conditions",
      title: "确认现场条件",
      description: "记录现场条件与限制。",
      conditional: true,
      reason: "需要现场测量",
    },
    {
      templateKey: "site_constraints",
      title: "记录电源、搬运、升降设备和施工限制",
      description: "记录施工相关现场约束。",
      conditional: true,
      reason: "需要现场测量",
    },
  ],
  shopDrawing: [
    {
      templateKey: "shop_drawing",
      title: "准备 Shop Drawing",
      description: "准备 Shop Drawing / 深化图纸。",
      conditional: true,
      reason: "需要 Shop Drawing / 客户审批",
    },
    {
      templateKey: "client_approval_submit",
      title: "提交客户审批",
      description: "提交图纸或方案供客户审批。",
      conditional: true,
      reason: "需要 Shop Drawing / 客户审批",
    },
    {
      templateKey: "client_approval_track",
      title: "跟踪审批结果",
      description: "跟踪客户审批反馈与版本。",
      conditional: true,
      reason: "需要 Shop Drawing / 客户审批",
    },
  ],
  procurement: [
    {
      templateKey: "confirm_products",
      title: "确认最终产品和规格",
      description: "确认最终产品清单与规格。",
      conditional: true,
      reason: "需要采购或定制生产",
    },
    {
      templateKey: "procurement_plan",
      title: "建立采购计划",
      description: "建立采购计划与供应商跟进。",
      conditional: true,
      reason: "需要采购或定制生产",
    },
    {
      templateKey: "vendor_lead_time",
      title: "确认厂家交期",
      description: "确认厂家生产与交期。",
      conditional: true,
      reason: "需要采购或定制生产",
    },
    {
      templateKey: "production_followup",
      title: "建立生产跟进",
      description: "建立生产进度跟进。",
      conditional: true,
      reason: "需要采购或定制生产",
    },
  ],
  installation: [
    {
      templateKey: "installation_window",
      title: "确认安装窗口",
      description: "确认安装时间窗口。",
      conditional: true,
      reason: "包含安装范围",
    },
    {
      templateKey: "installation_crew",
      title: "确认人员和设备",
      description: "确认安装人员与设备。",
      conditional: true,
      reason: "包含安装范围",
    },
    {
      templateKey: "ready_for_install",
      title: "确认现场 ready for installation 条件",
      description: "确认现场具备安装条件。",
      conditional: true,
      reason: "包含安装范围",
    },
  ],
};

/** 仅从明确 projectTypes / 用户确认 flags 推导，不用名称猜测 */
export function inferConditionalFlagsFromProjectTypes(
  projectTypes: unknown,
): ConditionalTaskFlags {
  const flags: ConditionalTaskFlags = {
    insuranceOrBond: false,
    securityOrSiteAccess: false,
    siteMeasurement: false,
    shopDrawing: false,
    procurement: false,
    installation: false,
  };
  const list = Array.isArray(projectTypes)
    ? projectTypes.map((x) => String(x).toLowerCase())
    : [];

  for (const t of list) {
    if (t.includes("install")) flags.installation = true;
    if (t.includes("measure") || t.includes("site_measure")) {
      flags.siteMeasurement = true;
    }
    if (t.includes("shop_drawing") || t.includes("drawing")) {
      flags.shopDrawing = true;
    }
    if (
      t.includes("china_sourcing") ||
      t.includes("procure") ||
      t.includes("production")
    ) {
      flags.procurement = true;
    }
    if (t.includes("bond") || t.includes("insurance")) {
      flags.insuranceOrBond = true;
    }
    if (t.includes("security") || t.includes("clearance")) {
      flags.securityOrSiteAccess = true;
    }
  }
  return flags;
}

export function mergeConditionalFlags(
  inferred: ConditionalTaskFlags,
  user?: Partial<ConditionalTaskFlags> | null,
): ConditionalTaskFlags {
  return {
    insuranceOrBond: Boolean(user?.insuranceOrBond ?? inferred.insuranceOrBond),
    securityOrSiteAccess: Boolean(
      user?.securityOrSiteAccess ?? inferred.securityOrSiteAccess,
    ),
    siteMeasurement: Boolean(user?.siteMeasurement ?? inferred.siteMeasurement),
    shopDrawing: Boolean(user?.shopDrawing ?? inferred.shopDrawing),
    procurement: Boolean(user?.procurement ?? inferred.procurement),
    installation: Boolean(user?.installation ?? inferred.installation),
  };
}

export function buildHandoffTaskPlan(
  flags: ConditionalTaskFlags,
  opts?: { amountUnconfirmed?: boolean; dateMissing?: boolean },
): { baseTasks: HandoffTaskPlanItem[]; conditionalTasks: HandoffTaskPlanItem[] } {
  const baseTasks = [...BASE_HANDOFF_TASKS];
  if (opts?.amountUnconfirmed) {
    baseTasks.push({
      templateKey: "confirm_contract_amount",
      title: "确认合同金额",
      description: "来源无可靠中标/合同金额，需人工确认后写入执行项目。",
      conditional: false,
      reason: "合同金额尚未确认",
    });
  }
  if (opts?.dateMissing) {
    // confirm_delivery_date 已覆盖；补充更明确任务
    baseTasks.push({
      templateKey: "confirm_contract_delivery_date",
      title: "确认合同交付日期",
      description: "来源无可靠合同交付日期，请确认后更新计划完成日期。",
      conditional: false,
      reason: "计划完成日期缺失",
    });
  }

  const conditionalTasks: HandoffTaskPlanItem[] = [];
  (Object.keys(flags) as Array<keyof ConditionalTaskFlags>).forEach((key) => {
    if (!flags[key]) return;
    conditionalTasks.push(...CONDITIONAL_CATALOG[key]);
  });

  return { baseTasks, conditionalTasks };
}
