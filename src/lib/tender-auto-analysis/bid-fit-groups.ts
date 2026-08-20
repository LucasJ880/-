/**
 * 合规矩阵分组契约（矩阵可用性批次）。
 *
 * 用户痛点：40+ 条 mandatory 平铺，程序类模板条款（英文投标/签名/有效期…）
 * 淹没真正要拍板的技术/资质项。抽取层已有 category（入库为小写），这里
 * 把 category 收敛成 5 个业务组：程序类默认折叠，判断类默认展开。
 *
 * 契约：REQUIREMENT_CATEGORIES 的每个值（小写）必须恰好落一组
 * （探针全覆盖校验，枚举扩容漏配会红）；未知/历史脏值兜底进「其他」。
 */

export type BidFitGroupKey =
  | "technical"
  | "assurance"
  | "commercial"
  | "procedural"
  | "other";

export type BidFitGroup = {
  key: BidFitGroupKey;
  labelZh: string;
  categories: readonly string[];
  /** true = 常规程序条款，默认折叠成一行汇总 */
  defaultCollapsed: boolean;
};

export const BID_FIT_GROUPS: readonly BidFitGroup[] = [
  {
    key: "technical",
    labelZh: "技术与产品",
    categories: [
      "technical",
      "product",
      "performance",
      "installation",
      "samples",
      "shop_drawings",
      "training",
    ],
    defaultCollapsed: false,
  },
  {
    key: "assurance",
    labelZh: "资质与保障",
    categories: ["insurance", "bonding", "warranty", "safety", "reporting"],
    defaultCollapsed: false,
  },
  {
    key: "commercial",
    labelZh: "商务与价格",
    categories: ["pricing", "commercial", "delivery"],
    defaultCollapsed: false,
  },
  {
    key: "procedural",
    labelZh: "程序与提交",
    categories: ["administrative", "submission", "schedule", "site_visit"],
    defaultCollapsed: true,
  },
  {
    key: "other",
    labelZh: "其他要求",
    categories: ["mandatory", "other"],
    defaultCollapsed: false,
  },
] as const;

const CATEGORY_TO_GROUP: ReadonlyMap<string, BidFitGroupKey> = new Map(
  BID_FIT_GROUPS.flatMap((g) => g.categories.map((c) => [c, g.key] as const)),
);

export function bidFitGroupOf(category: string | null | undefined): BidFitGroupKey {
  return CATEGORY_TO_GROUP.get((category ?? "").toLowerCase()) ?? "other";
}
