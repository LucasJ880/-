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

/** 入驻时按 Pack 建的默认工作空间（Workspace.slug 在组织内唯一） */
export type IndustryPackWorkspace = {
  slug: string;
  name: string;
  type: "department" | "team" | "custom";
};

/**
 * 入驻向导「做 / 不做 / 不确定」的产品品类目录。
 * key 与 Revenue Spine business_profile.productCategories / excludedCategories 同一词表
 * （src/lib/revenue-spine/policy.ts DEFAULT_PRODUCT_KEYWORDS 的类目值）。
 * keywords：默认词表里没有的类目才带，勾选时作为企业级识别词一起发布（小写，含中英文）。
 */
export type ProductCategoryCatalogEntry = {
  key: string;
  labelZh: string;
  labelEn: string;
  keywords?: string[];
};

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
  /** 入驻时创建的默认工作空间；未配置 = 不建 */
  defaultWorkspaces?: IndustryPackWorkspace[];
  /** 入驻品类目录；未配置 = 该 Pack 不走品类勾选步骤 */
  productCategoryCatalog?: ProductCategoryCatalogEntry[];
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
    "window_covering",
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
  defaultWorkspaces: [
    { slug: "international-trade", name: "International Trade", type: "department" },
    { slug: "product-development", name: "Product Development", type: "department" },
    { slug: "supply-chain", name: "Supply Chain", type: "department" },
    { slug: "sales", name: "Sales", type: "department" },
    { slug: "content-production", name: "Content Production", type: "department" },
    { slug: "marketing", name: "Marketing", type: "department" },
  ],
  productCategoryCatalog: [
    { key: "blanket", labelZh: "毯子 / 盖毯", labelEn: "Blankets & throws" },
    { key: "bathrobe", labelZh: "浴袍 / 睡袍", labelEn: "Bathrobes" },
    { key: "towel", labelZh: "毛巾 / 浴巾", labelEn: "Towels" },
    { key: "cushion", labelZh: "抱枕 / 靠垫套", labelEn: "Cushions & covers" },
    { key: "bedding", labelZh: "床品（床单 / 被套 / 枕套）", labelEn: "Bedding" },
    { key: "slipper", labelZh: "拖鞋", labelEn: "Slippers" },
    { key: "curtain", labelZh: "窗帘", labelEn: "Curtains" },
    { key: "table_linen", labelZh: "桌布 / 桌旗", labelEn: "Table linen" },
    {
      key: "gift_set",
      labelZh: "礼盒套装",
      labelEn: "Gift sets",
      keywords: ["gift set", "gift sets", "gift box set", "gift box sets", "礼盒套装", "礼品套装"],
    },
    {
      key: "baby",
      labelZh: "婴童家纺",
      labelEn: "Baby textiles",
      keywords: [
        "baby blanket",
        "baby blankets",
        "baby towel",
        "baby towels",
        "swaddle",
        "swaddles",
        "hooded towel",
        "hooded towels",
        "婴儿毯",
        "婴儿浴巾",
        "包巾",
      ],
    },
    {
      key: "textile_accessory",
      labelZh: "纺织配件（发带 / 眼罩等）",
      labelEn: "Textile accessories",
      keywords: [
        "spa headband",
        "spa headbands",
        "headband",
        "headbands",
        "hair towel",
        "hair towels",
        "hair wrap",
        "hair wraps",
        "eye mask",
        "eye masks",
        "发带",
        "干发帽",
        "眼罩",
      ],
    },
    {
      key: "pet",
      labelZh: "宠物家纺",
      labelEn: "Pet textiles",
      keywords: [
        "pet bed",
        "pet beds",
        "pet blanket",
        "pet blankets",
        "pet mat",
        "pet mats",
        "dog bed",
        "dog beds",
        "cat bed",
        "cat beds",
        "宠物垫",
        "宠物毯",
        "宠物窝",
      ],
    },
  ],
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

/** 入驻可选的 Pack（只含正式 id，不含兼容别名） */
export function isSelectableIndustryPackId(id: string | null | undefined): id is IndustryPackId {
  return listIndustryPacks().some((p) => p.id === id);
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
