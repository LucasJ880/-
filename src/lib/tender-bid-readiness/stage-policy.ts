/**
 * TI-3b 阶段策略表（纯函数，查表）
 *
 * 回答「这一类事该不该不问就做」：每个阶段事先归一类，运行时不再询问。
 * - 自动：只读、不花钱、不对外 → 材料齐备就执行
 * - 等材料：需要用户手里的东西 → 不阻塞其它阶段，写明缺什么
 * - 取决于来源：按数据来源的连接状态 → 接通就执行，没接通就标出来
 * - 要批准：对外发送、付费、提交、Owner 决定 → 只有这一类停下
 *
 * 决定的取值是封闭的六个，其中没有「询问是否执行」。
 * 本模块只回答该不该做：不执行、不调度、不排队。
 */
import { DEFAULT_INTEL_SOURCES, resolveSourceState, SOURCE_STATE_ZH, type IntelSource } from "@/lib/tender-competition/source-status";

export const STAGE_CLASSES = ["AUTO", "NEEDS_MATERIAL", "SOURCE_DEPENDENT", "APPROVAL"] as const;
export type StageClass = (typeof STAGE_CLASSES)[number];
export const STAGE_CLASS_ZH: Record<StageClass, string> = { AUTO: "自动", NEEDS_MATERIAL: "等材料", SOURCE_DEPENDENT: "取决于来源", APPROVAL: "要批准" };

export const MATERIAL_KEYS = ["TENDER_DOCUMENTS", "DOCUMENT_HOLDER_LIST", "SUPPLIER_QUOTES", "AWARD_RECORDS", "IMPORT_LEADS", "BID_RESULTS"] as const;
export type MaterialKey = (typeof MATERIAL_KEYS)[number];
export const MATERIAL_ZH: Record<MaterialKey, string> = {
  TENDER_DOCUMENTS: "招标文件（含补遗与价格表）",
  DOCUMENT_HOLDER_LIST: "文件领取方名单",
  SUPPLIER_QUOTES: "供应商报价",
  AWARD_RECORDS: "历史授标或采购记录",
  IMPORT_LEADS: "进口线索",
  BID_RESULTS: "开标或授标结果",
};

export const STAGE_DECISIONS = ["RUN", "WAIT_MATERIAL", "NOT_CONNECTED", "MANUAL_ONLY", "STOP_FOR_APPROVAL", "OFF"] as const;
export type StageDecision = (typeof STAGE_DECISIONS)[number];
export const STAGE_DECISION_ZH: Record<StageDecision, string> = {
  RUN: "执行", WAIT_MATERIAL: "等材料", NOT_CONNECTED: "未接通", MANUAL_ONLY: "仅人工", STOP_FOR_APPROVAL: "停下等批准", OFF: "已关闭",
};

export type StageDef = {
  key: string;
  labelZh: string;
  stageClass: StageClass;
  /** 执行前必须在手的材料 */
  requires: readonly MaterialKey[];
  /** 取决于来源的阶段：数据来源的 key */
  sourceKey?: string;
  /** 来源没接通时，人工提供这份材料也能执行 */
  manualMaterial?: MaterialKey;
};

export const TENDER_INTEL_STAGES: readonly StageDef[] = [
  { key: "intake", labelZh: "文件接收", stageClass: "NEEDS_MATERIAL", requires: ["TENDER_DOCUMENTS"] },
  { key: "document_holders", labelZh: "文件领取方分析", stageClass: "NEEDS_MATERIAL", requires: ["DOCUMENT_HOLDER_LIST"] },
  { key: "historical_awards", labelZh: "历史授标与采购", stageClass: "SOURCE_DEPENDENT", requires: [], sourceKey: "OFFICIAL_AWARDS", manualMaterial: "AWARD_RECORDS" },
  { key: "import_leads", labelZh: "进口线索", stageClass: "SOURCE_DEPENDENT", requires: [], sourceKey: "LICENSED_TRADE_DATA", manualMaterial: "IMPORT_LEADS" },
  { key: "supplier_matching", labelZh: "供应商匹配", stageClass: "AUTO", requires: ["TENDER_DOCUMENTS"] },
  { key: "compliance", labelZh: "合规对照", stageClass: "AUTO", requires: ["TENDER_DOCUMENTS"] },
  { key: "costing", labelZh: "成本核算", stageClass: "AUTO", requires: ["TENDER_DOCUMENTS", "SUPPLIER_QUOTES"] },
  { key: "owner_decision", labelZh: "Owner 决定", stageClass: "APPROVAL", requires: [] },
  { key: "bid_preparation", labelZh: "标书准备", stageClass: "AUTO", requires: ["TENDER_DOCUMENTS"] },
  { key: "supplier_outreach", labelZh: "供应商外联", stageClass: "APPROVAL", requires: [] },
  { key: "records_request", labelZh: "政府资料申请", stageClass: "APPROVAL", requires: [] },
  { key: "submission", labelZh: "提交", stageClass: "APPROVAL", requires: [] },
  { key: "postbid", labelZh: "截标后复盘", stageClass: "AUTO", requires: ["BID_RESULTS"] },
];

/** 组织覆盖：只能收紧。OFF = 关闭该阶段；AUTO 只对本来就不需要批准的阶段有意义。 */
export type StageOverride = "OFF" | "AUTO";

export type StageOutcome = {
  key: string;
  labelZh: string;
  stageClass: StageClass;
  decision: StageDecision;
  decisionZh: string;
  detailZh: string;
  missingMaterials: MaterialKey[];
  sourceKey: string | null;
};

export type StagePolicyResult =
  | {
      ok: true;
      stages: StageOutcome[];
      lists: {
        missingMaterials: Array<{ stageKey: string; stageZh: string; materials: string[] }>;
        notConnected: Array<{ stageKey: string; stageZh: string; sourceKey: string; sourceZh: string; stateZh: string }>;
        awaitingApproval: Array<{ stageKey: string; stageZh: string }>;
      };
    }
  | { ok: false; code: "UNKNOWN_STAGE" | "APPROVAL_STAGE_CANNOT_BE_AUTO"; stageKey: string; messageZh: string };

export function decideStages(input: {
  materials: readonly MaterialKey[];
  sources?: readonly IntelSource[];
  overrides?: Readonly<Record<string, StageOverride>>;
}): StagePolicyResult {
  const overrides = input.overrides ?? {};
  for (const [key, value] of Object.entries(overrides)) {
    const def = TENDER_INTEL_STAGES.find((s) => s.key === key);
    if (!def) return { ok: false, code: "UNKNOWN_STAGE", stageKey: key, messageZh: `没有名为「${key}」的阶段` };
    if (value === "AUTO" && def.stageClass === "APPROVAL") {
      return { ok: false, code: "APPROVAL_STAGE_CANNOT_BE_AUTO", stageKey: key, messageZh: `「${def.labelZh}」是要批准的阶段，不能改成自动` };
    }
  }
  const have = new Set(input.materials);
  const sources = input.sources ?? DEFAULT_INTEL_SOURCES;

  const stages: StageOutcome[] = TENDER_INTEL_STAGES.map((def) => {
    const out = (decision: StageDecision, detailZh: string, missingMaterials: MaterialKey[] = []): StageOutcome => ({
      key: def.key, labelZh: def.labelZh, stageClass: def.stageClass, decision, decisionZh: STAGE_DECISION_ZH[decision], detailZh, missingMaterials, sourceKey: def.sourceKey ?? null,
    });
    if (overrides[def.key] === "OFF") return out("OFF", "组织已关闭这个阶段");
    if (def.stageClass === "APPROVAL") return out("STOP_FOR_APPROVAL", "对外动作或需要 Owner 决定：准备好草稿后停下，走审批");
    const missing = def.requires.filter((m) => !have.has(m));
    if (def.stageClass === "SOURCE_DEPENDENT") {
      const source = sources.find((s) => s.key === def.sourceKey);
      const state = source ? resolveSourceState(source) : "NOT_CONNECTED";
      const sourceZh = source?.labelZh ?? def.sourceKey ?? "";
      if (state === "DISABLED_BY_POLICY") return out("OFF", `${sourceZh}按纪律禁用`);
      if (state === "CONNECTED") return out("RUN", `${sourceZh}已接通`);
      if (def.manualMaterial && have.has(def.manualMaterial)) return out("RUN", `只处理人工提供的${MATERIAL_ZH[def.manualMaterial]}`);
      return state === "MANUAL_ONLY"
        ? out("MANUAL_ONLY", `${sourceZh}仅支持人工提供；没有人工提供的材料`, def.manualMaterial ? [def.manualMaterial] : [])
        : out("NOT_CONNECTED", `${sourceZh}未接通；这不表示没有记录，而是没有查`);
    }
    if (missing.length > 0) return out("WAIT_MATERIAL", `缺：${missing.map((m) => MATERIAL_ZH[m]).join("、")}`, missing);
    return out("RUN", "只读，材料齐备，直接执行");
  });

  const sourceLabel = (key: string | null) => sources.find((s) => s.key === key)?.labelZh ?? key ?? "";
  return {
    ok: true,
    stages,
    lists: {
      missingMaterials: stages.filter((s) => s.decision === "WAIT_MATERIAL").map((s) => ({ stageKey: s.key, stageZh: s.labelZh, materials: s.missingMaterials.map((m) => MATERIAL_ZH[m]) })),
      notConnected: stages
        .filter((s) => s.decision === "NOT_CONNECTED" || s.decision === "MANUAL_ONLY")
        .map((s) => {
          const source = sources.find((x) => x.key === s.sourceKey);
          return { stageKey: s.key, stageZh: s.labelZh, sourceKey: s.sourceKey ?? "", sourceZh: sourceLabel(s.sourceKey), stateZh: source ? SOURCE_STATE_ZH[resolveSourceState(source)] : SOURCE_STATE_ZH.NOT_CONNECTED };
        }),
      awaitingApproval: stages.filter((s) => s.decision === "STOP_FOR_APPROVAL").map((s) => ({ stageKey: s.key, stageZh: s.labelZh })),
    },
  };
}
