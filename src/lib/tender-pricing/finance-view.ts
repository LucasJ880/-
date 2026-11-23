/**
 * CHAIN-2b 报价表助手的我方成本只给有财务查看权的人（纯函数）
 *
 * 财务查看权与成本核算接口、寻源建议卡同一个判定（resolveFinancePrivilege(...).canReadAll），由路由取好传进来。
 * 没有财务查看权的人：
 * - 读取：我方成本为 null、带 costHidden；不带比价矩阵的成本建议（开关开着时只带 compareCostHidden）；
 *   情景表按「没有成本」算（毛利为空、没有成本底价情景——那两种情景的价格可以直接反推成本）；
 *   假设说明里「未填我方成本」那句换成「需要财务查看权……」（不论填没填都是同一句，不泄露填没填）。
 * - 保存：带了我方成本或成本来源 → 路由返回 403；不带时照常保存，返回同样裁剪、不带成本来源。
 * 有财务查看权的人：原样返回，与本功能之前相同。
 *
 * 房间 JSON（项目列表、调查室读取接口原样返回的 summaryJson）对所有人去掉 pricingInputs 里的成本与来源，
 * 以及投标策略备忘 bidStrategyMemo（它由含成本与毛利的情景写成，可能转述成本；这两个接口的界面都不读它）。
 */
import { buildScenarios, type PricingInputs, type PricingResult, type ScoringModel } from "./calc";
import type { CompareCostView } from "./compare-cost-source";

/** 情景计算没有成本时 calc.ts 写的那句（逐字相同；测试核对） */
export const NO_COST_ASSUMPTION_ZH = "未填我方成本——毛利列为空；成本底价情景未生成";
/** 没有财务查看权时假设说明里的那句（卡片显示在情景表上方） */
export const COST_HIDDEN_NOTE_ZH = "需要财务查看权才能看我方成本；毛利一栏和「成本 + 目标毛利」「成本价」两种情景也不显示。";
/** 卡片上代替「我方成本」输入框的那句 */
export const COST_HIDDEN_FIELD_ZH = "需要财务查看权才能看我方成本。";
/** 卡片上那句下面：谁能看、找谁（权限键在岗位设置里叫「查看项目结算」） */
export const COST_ACCESS_HINT_ZH = "只给项目负责人和有全企业「查看项目结算」权限的人看；需要的话请找项目负责人。";
/** 没有财务查看权时目标毛利下面那句（没有成本时目标毛利不影响情景表） */
export const COST_TARGET_MARGIN_NOTE_ZH = "目标毛利只用于按成本算的底价情景；你这里改了，情景表不会变。";
/** 没有财务查看权的人带成本保存 → 403 */
export const COST_WRITE_FORBIDDEN_ZH = "没有保存：需要财务查看权才能修改我方成本。请刷新页面，重新填写后再保存。";

/**
 * 对本项目有没有财务查看权：项目有组织时用注入的判定（resolveFinancePrivilege(...).canReadAll）；
 * 项目没有组织、或判定抛错时，按「不持组织键」算：只剩平台超级管理员与项目负责人（他们的判定不依赖授权查询）。
 */
export async function resolvePricingCostVisibility(
  input: { isPlatformSuperAdmin: boolean; isProjectOwner: boolean; orgId: string | null },
  resolveCanReadAll: (orgId: string) => Promise<boolean>,
): Promise<boolean> {
  const withoutOrgKeys = input.isPlatformSuperAdmin || input.isProjectOwner;
  if (!input.orgId) return withoutOrgKeys;
  try {
    return await resolveCanReadAll(input.orgId);
  } catch (err) {
    console.warn("[pricing-helper] finance privilege", err instanceof Error ? err.message : err);
    return withoutOrgKeys;
  }
}

export type PricingHelperFinanceView = {
  inputs: PricingInputs;
  result: PricingResult | null;
  compareCost?: CompareCostView;
  costHidden?: true;
  compareCostHidden?: true;
};

/** 读取：按财务查看权算情景并裁剪。有权限时结果与直接 buildScenarios 相同。 */
export function buildPricingHelperView(input: {
  model: ScoringModel | null;
  inputs: PricingInputs;
  canSeeCost: boolean;
  /** 比价矩阵成本来源开关对项目的组织开着 */
  compareEnabled: boolean;
  /** 有财务查看权且开关开着时路由取好的成本建议视图；否则 null */
  compareCost: CompareCostView | null;
}): PricingHelperFinanceView {
  if (input.canSeeCost) {
    return {
      inputs: input.inputs,
      result: input.model ? buildScenarios(input.model, input.inputs) : null,
      ...(input.compareCost ? { compareCost: input.compareCost } : {}),
    };
  }
  const inputs: PricingInputs = { ...input.inputs, ourCostCad: null };
  const raw = input.model ? buildScenarios(input.model, inputs) : null;
  const result = raw
    ? { ...raw, assumptionsZh: [...raw.assumptionsZh.filter((s) => s !== NO_COST_ASSUMPTION_ZH), COST_HIDDEN_NOTE_ZH] }
    : null;
  return { inputs, result, costHidden: true, ...(input.compareEnabled ? { compareCostHidden: true as const } : {}) };
}

const asRec = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** 这次保存碰了我方成本：inputs（按对象读）里有 ourCostCad 这个键，或请求顶层有 ourCostSource 这个键（含 null） */
export function touchesCost(body: unknown): boolean {
  const b = asRec(body);
  return Object.prototype.hasOwnProperty.call(asRec(b.inputs), "ourCostCad") || Object.prototype.hasOwnProperty.call(b, "ourCostSource");
}

/** 保存的返回：没有财务查看权时我方成本为 null、带 costHidden、去掉成本来源；有权限时原样 */
export function buildSavedInputsView<T extends { inputs: PricingInputs; ourCostSource?: unknown }>(
  response: T,
  canSeeCost: boolean,
): T | (Omit<T, "ourCostSource"> & { costHidden: true }) {
  if (canSeeCost) return response;
  const { ourCostSource: _dropped, ...rest } = response;
  void _dropped;
  return { ...rest, inputs: { ...response.inputs, ourCostCad: null }, costHidden: true as const };
}

/** 房间 JSON：去掉 pricingInputs 里的我方成本与成本来源、去掉投标策略备忘，其余原样（返回副本，不改入参） */
export function redactRoomSummaryCost<T>(summaryJson: T): T {
  if (!summaryJson || typeof summaryJson !== "object" || Array.isArray(summaryJson)) return summaryJson;
  const sj = summaryJson as Record<string, unknown>;
  const pi = sj.pricingInputs;
  const piRec = pi && typeof pi === "object" && !Array.isArray(pi) ? (pi as Record<string, unknown>) : null;
  const piHasCost = !!piRec && ("ourCostCad" in piRec || "ourCostSource" in piRec);
  const hasMemo = "bidStrategyMemo" in sj;
  if (!piHasCost && !hasMemo) return summaryJson;
  const { bidStrategyMemo: _m, ...rest } = sj;
  void _m;
  if (!piHasCost) return rest as T;
  const { ourCostCad: _c, ourCostSource: _s, ...restPi } = piRec!;
  void _c;
  void _s;
  return { ...rest, pricingInputs: restPi } as T;
}
