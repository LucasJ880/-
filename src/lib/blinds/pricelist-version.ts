/**
 * 价表版本写入报价表单数据（PRICE-1，design D5；零 schema）
 *
 * 新建报价时服务端把当前价表版本合并进 formDataJson.pricelistVersion；
 * formDataJson 不是 JSON 对象（历史 shell 情况 / 非法字符串）时原样返回，不报错。
 */
import { BASE_PRICE_VERSION } from "./pricing-data";

export const PRICELIST_VERSION_KEY = "pricelistVersion" as const;

export function stampPricelistVersion(
  formDataJson: string | null | undefined,
  version: string = BASE_PRICE_VERSION,
): string | null | undefined {
  if (typeof formDataJson !== "string" || formDataJson.trim() === "") return formDataJson;
  let parsed: unknown;
  try {
    parsed = JSON.parse(formDataJson);
  } catch {
    return formDataJson;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return formDataJson;
  return JSON.stringify({ ...(parsed as Record<string, unknown>), [PRICELIST_VERSION_KEY]: version });
}

/** 读回：没有或非字符串 → null */
export function readPricelistVersion(formDataJson: string | null | undefined): string | null {
  if (typeof formDataJson !== "string") return null;
  try {
    const parsed = JSON.parse(formDataJson) as Record<string, unknown>;
    const v = parsed?.[PRICELIST_VERSION_KEY];
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}
