/**
 * T2-P1.6 汇率来源适配层（FX PROVIDER ADAPTER）
 *
 * 审计结论（见 docs/QINGYAN_TENDER_T2_P16_EXISTING_MODEL_AUDIT.md §3）：
 *   仓库**此前不存在任何汇率服务 / 汇率模型 / FX provider** → FX_PROVIDER_GAP。
 *
 * 因此本阶段刻意**不引入任何付费 FX SaaS**（未经授权），只建立干净接口：
 *   - MANUAL           ：人工输入 / 确认（P0 必须支持，且是唯一默认可用来源）
 *   - BANK_SETTLEMENT  ：银行实际成交汇率（最终结算时由 Finance 录入）
 *   - SYSTEM_REFERENCE ：系统参考汇率 —— 预留槽位；未注册 provider 时**fail-closed 抛错**，
 *                        绝不静默回落到某个硬编码常数（硬编码汇率 = 伪造财务事实）。
 *   - BASE_CURRENCY    ：原始币种即 CAD，rate 恒 1（不走 provider）
 *
 * 未来接入自动 FX API 时，只需 registerSystemReferenceRateProvider()，本文件以外零改动。
 */
import { Prisma } from "@prisma/client";
import {
  assertFxRate,
  BASE_CURRENCY,
  convertToCad,
  dec,
  FxContractError,
  isBaseCurrency,
  normalizeCurrency,
  ONE,
  roundFxRate,
  type DecimalInput,
  type FxRateSource,
} from "./money";

/** 一次换算的完整留痕快照（RULE 5：写入后即为历史，绝不因当日汇率变动而重算）。 */
export interface FxSnapshot {
  originalAmount: Prisma.Decimal;
  originalCurrency: string;
  /** 1 单位 originalCurrency = X CAD */
  fxRateCadPerOriginalUnit: Prisma.Decimal;
  fxRateDate: Date;
  fxRateSource: FxRateSource;
  estimatedCadAmount: Prisma.Decimal;
}

/** 系统参考汇率 provider 接口（当前无实现）。 */
export interface SystemReferenceRateProvider {
  /** 返回 1 单位 fromCurrency 折合多少 CAD；无法提供时抛错（禁止返回猜测值）。 */
  getCadPerUnit(fromCurrency: string, onDate: Date): Promise<Prisma.Decimal>;
}

let systemReferenceProvider: SystemReferenceRateProvider | null = null;

/** 注册系统参考汇率 provider（未来接入自动 FX API 的唯一入口）。 */
export function registerSystemReferenceRateProvider(
  provider: SystemReferenceRateProvider | null,
): void {
  systemReferenceProvider = provider;
}

export function hasSystemReferenceRateProvider(): boolean {
  return systemReferenceProvider !== null;
}

export interface ResolveFxRateInput {
  originalCurrency: string;
  /** MANUAL / BANK_SETTLEMENT 必填；BASE_CURRENCY 忽略；SYSTEM_REFERENCE 忽略（由 provider 提供） */
  fxRateCadPerOriginalUnit?: DecimalInput | null;
  fxRateDate: Date;
  /** 缺省按币种自动判定：CAD → BASE_CURRENCY，其余 → MANUAL */
  fxRateSource?: FxRateSource | null;
}

export interface ResolvedFxRate {
  fxRateCadPerOriginalUnit: Prisma.Decimal;
  fxRateDate: Date;
  fxRateSource: FxRateSource;
}

/**
 * 解析并校验一条汇率（含方向与 CAD 短路）。
 * 任何来源都必须落到「1 单位 original = X CAD」这一唯一方向上。
 */
export async function resolveFxRate(input: ResolveFxRateInput): Promise<ResolvedFxRate> {
  const currency = normalizeCurrency(input.originalCurrency);
  if (!currency) throw new FxContractError("原始币种必填");
  if (!(input.fxRateDate instanceof Date) || Number.isNaN(input.fxRateDate.getTime())) {
    throw new FxContractError("汇率日期必填且必须合法");
  }

  // §6.2：CAD 费用不走 FX 流程
  if (isBaseCurrency(currency)) {
    return {
      fxRateCadPerOriginalUnit: ONE,
      fxRateDate: input.fxRateDate,
      fxRateSource: "BASE_CURRENCY",
    };
  }

  const source: FxRateSource = input.fxRateSource ?? "MANUAL";
  if (source === "BASE_CURRENCY") {
    throw new FxContractError(
      `fxRateSource=BASE_CURRENCY 仅适用于 ${BASE_CURRENCY} 原始币种；收到 ${currency}`,
    );
  }

  if (source === "SYSTEM_REFERENCE") {
    if (!systemReferenceProvider) {
      // fail-closed：绝不硬编码 / 猜测汇率
      throw new FxContractError(
        "系统参考汇率不可用（未注册 FX provider）。请由财务手动输入汇率（fxRateSource=MANUAL）。",
        503,
      );
    }
    const rate = await systemReferenceProvider.getCadPerUnit(currency, input.fxRateDate);
    return {
      fxRateCadPerOriginalUnit: assertFxRate(rate, currency),
      fxRateDate: input.fxRateDate,
      fxRateSource: "SYSTEM_REFERENCE",
    };
  }

  // MANUAL / BANK_SETTLEMENT：必须显式给出汇率
  if (input.fxRateCadPerOriginalUnit == null) {
    throw new FxContractError(
      `非 ${BASE_CURRENCY} 费用必须提供汇率 fxRateCadPerOriginalUnit（1 ${currency} = ? ${BASE_CURRENCY}）`,
    );
  }
  return {
    fxRateCadPerOriginalUnit: assertFxRate(input.fxRateCadPerOriginalUnit, currency),
    fxRateDate: input.fxRateDate,
    fxRateSource: source,
  };
}

/** 解析汇率并产出完整快照（服务层写库前的唯一构造入口）。 */
export async function buildFxSnapshot(input: {
  originalAmount: DecimalInput;
  originalCurrency: string;
  fxRateCadPerOriginalUnit?: DecimalInput | null;
  fxRateDate: Date;
  fxRateSource?: FxRateSource | null;
}): Promise<FxSnapshot> {
  const currency = normalizeCurrency(input.originalCurrency);
  if (!currency) throw new FxContractError("原始币种必填");
  const amount = dec(input.originalAmount);
  if (!amount.isFinite() || amount.lte(0)) {
    throw new FxContractError("原始金额必须为正");
  }
  const resolved = await resolveFxRate({
    originalCurrency: currency,
    fxRateCadPerOriginalUnit: input.fxRateCadPerOriginalUnit,
    fxRateDate: input.fxRateDate,
    fxRateSource: input.fxRateSource,
  });
  return {
    originalAmount: amount,
    originalCurrency: currency,
    fxRateCadPerOriginalUnit: roundFxRate(resolved.fxRateCadPerOriginalUnit),
    fxRateDate: resolved.fxRateDate,
    fxRateSource: resolved.fxRateSource,
    estimatedCadAmount: convertToCad({
      originalAmount: amount,
      originalCurrency: currency,
      fxRateCadPerOriginalUnit: resolved.fxRateCadPerOriginalUnit,
    }),
  };
}
