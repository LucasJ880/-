/**
 * Industry Pack Registry（轻量）
 *
 * Sunny / 梦馨共享框架，加载不同 Pack。
 * 禁止：未知 packId 静默回退到家纺语义。
 */

import type { OrgModule } from "@/lib/tenancy/modules";

export type IndustryPackId =
  | "generic_business_v1"
  | "window_covering_services_v1"
  | "home_textile_trade_v1"
  /** 兼容旧 job 字段 */
  | "home_textile";

export type IndustryPackLoadStatus =
  | "ok"
  | "missing"
  | "invalid"
  | "incompatible";

export type IndustryPack = {
  id: IndustryPackId;
  name: string;
  version: string;
  enabledModules: OrgModule[];
  businessVocabulary: Record<string, string>;
  entityTypes: string[];
  workflowDefaults: Record<string, unknown>;
  ruleSetRefs: string[];
  /** 产品内容字段包兼容 id（旧 home_textile） */
  productContentFieldPackId?: string;
};

const GENERIC_BUSINESS_V1: IndustryPack = {
  id: "generic_business_v1",
  name: "通用商务 v1",
  version: "1",
  enabledModules: ["operations", "sales"],
  businessVocabulary: {
    customer: "客户",
    quote: "报价",
    opportunity: "商机",
    project: "项目",
  },
  entityTypes: ["customer", "opportunity", "quote", "project", "task"],
  workflowDefaults: {
    quoteRequiresApproval: true,
    agentSessionMaxRisk: "l2_soft",
  },
  ruleSetRefs: ["quote_margin", "quote_auto_send", "project_risk", "agent_tool_policy"],
};

const WINDOW_COVERING_SERVICES_V1: IndustryPack = {
  id: "window_covering_services_v1",
  name: "窗饰服务商 v1",
  version: "1",
  enabledModules: [
    "sales",
    "bids",
    "projects",
    "marketing",
    "product_content",
    "operations",
  ],
  businessVocabulary: {
    customer: "客户",
    quote: "报价单",
    opportunity: "销售机会",
    project: "招标/工程",
    measure: "量尺",
    install: "安装",
    zebra: "柔纱帘",
    roller: "卷帘",
  },
  entityTypes: [
    "customer",
    "opportunity",
    "quote",
    "appointment",
    "blinds_order",
    "project",
  ],
  workflowDefaults: {
    quoteRequiresApproval: true,
    agentSessionMaxRisk: "l2_soft",
    discountSettingsRequired: true,
  },
  ruleSetRefs: [
    "quote_discounts",
    "quote_margin",
    "quote_auto_send",
    "project_risk",
    "agent_tool_policy",
  ],
};

const HOME_TEXTILE_TRADE_V1: IndustryPack = {
  id: "home_textile_trade_v1",
  name: "家纺外贸 v1",
  version: "1",
  enabledModules: [
    "trade",
    "product_content",
    "supply_chain",
    "sales",
    "marketing",
    "operations",
  ],
  businessVocabulary: {
    customer: "买家",
    quote: "外贸报价",
    opportunity: "询盘",
    prospect: "潜客",
    sku: "货号",
    moq: "起订量",
  },
  entityTypes: [
    "trade_prospect",
    "trade_quote",
    "trade_product",
    "product_content_job",
    "customer",
  ],
  workflowDefaults: {
    industryFieldPack: "home_textile",
    agentSessionMaxRisk: "l2_soft",
    productContentApprovalRequired: true,
  },
  ruleSetRefs: [
    "product_content_approval",
    "agent_tool_policy",
    "quote_auto_send",
  ],
  productContentFieldPackId: "home_textile",
};

/** 旧 id 别名 → 正式 Pack（显式映射，不是静默家纺回退） */
const ALIASES: Record<string, IndustryPackId> = {
  home_textile: "home_textile_trade_v1",
};

const REGISTRY: Record<string, IndustryPack> = {
  generic_business_v1: GENERIC_BUSINESS_V1,
  window_covering_services_v1: WINDOW_COVERING_SERVICES_V1,
  home_textile_trade_v1: HOME_TEXTILE_TRADE_V1,
  // 兼容层：旧 job.industryPack=home_textile 显式指向家纺外贸 pack
  home_textile: {
    ...HOME_TEXTILE_TRADE_V1,
    id: "home_textile",
    name: "家纺（兼容旧 id）",
  },
};

export function listIndustryPacks(): IndustryPack[] {
  return [
    GENERIC_BUSINESS_V1,
    WINDOW_COVERING_SERVICES_V1,
    HOME_TEXTILE_TRADE_V1,
  ];
}

export type ResolveIndustryPackResult =
  | { status: "ok"; pack: IndustryPack }
  | {
      status: Exclude<IndustryPackLoadStatus, "ok">;
      pack: IndustryPack | null;
      message: string;
      requestedId: string | null;
    };

/**
 * 解析 Industry Pack。
 * - missing / 空：不回退家纺；调用方可选用 generic 或中止高风险业务
 * - 未知 id：invalid，不回退
 */
export function resolveIndustryPack(
  packId: string | null | undefined,
  opts?: { fallbackGenericOnMissing?: boolean },
): ResolveIndustryPackResult {
  if (packId == null || String(packId).trim() === "") {
    if (opts?.fallbackGenericOnMissing) {
      return {
        status: "missing",
        pack: GENERIC_BUSINESS_V1,
        message: "未配置 Industry Pack，已显式使用 generic_business_v1",
        requestedId: null,
      };
    }
    return {
      status: "missing",
      pack: null,
      message: "未配置 Industry Pack（禁止静默回退到家纺）",
      requestedId: null,
    };
  }

  const raw = String(packId).trim();
  const resolvedId = ALIASES[raw] ?? raw;
  const pack = REGISTRY[resolvedId] ?? REGISTRY[raw];
  if (!pack) {
    return {
      status: "invalid",
      pack: null,
      message: `未知 Industry Pack: ${raw}（禁止静默回退）`,
      requestedId: raw,
    };
  }
  return { status: "ok", pack };
}

/** @deprecated 使用 resolveIndustryPack；保留抛错版供严格路径 */
export function getIndustryPackOrThrow(packId: string): IndustryPack {
  const r = resolveIndustryPack(packId);
  if (r.status !== "ok" || !r.pack) {
    throw new Error(
      r.status === "ok" ? "Industry Pack 解析失败" : r.message,
    );
  }
  return r.pack;
}

export function isHomeTextileSemantics(pack: IndustryPack): boolean {
  return (
    pack.id === "home_textile_trade_v1" ||
    pack.id === "home_textile" ||
    pack.productContentFieldPackId === "home_textile"
  );
}
