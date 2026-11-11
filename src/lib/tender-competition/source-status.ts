/**
 * TI-3a 数据来源的连接状态（纯函数）
 *
 * 未接通的来源返回「未接通」且不带任何记录——不造数据，也不显示成「查过了没有」。
 * 需要登录的门户恒为「按纪律禁用」（硬纪律第 5 条），不可被配置覆盖。
 */

export const SOURCE_ACCESS_KINDS = ["PUBLIC", "USER_UPLOAD", "LICENSED", "AUTHENTICATED_PORTAL"] as const;
export type SourceAccess = (typeof SOURCE_ACCESS_KINDS)[number];

export const SOURCE_STATES = ["CONNECTED", "NOT_CONNECTED", "MANUAL_ONLY", "DISABLED_BY_POLICY"] as const;
export type SourceState = (typeof SOURCE_STATES)[number];
export const SOURCE_STATE_ZH: Record<SourceState, string> = {
  CONNECTED: "已接通",
  NOT_CONNECTED: "未接通",
  MANUAL_ONLY: "仅人工",
  DISABLED_BY_POLICY: "按纪律禁用",
};

export type IntelSource = { key: string; labelZh: string; access: SourceAccess; configuredState?: SourceState | null };

/** 缺省来源清单；状态是声明，不是探测。接通一个来源 = 后续 change 显式改配置并带测试。 */
export const DEFAULT_INTEL_SOURCES: readonly IntelSource[] = [
  { key: "DOCUMENT_HOLDER_UPLOAD", labelZh: "文件领取方名单（用户上传）", access: "USER_UPLOAD" },
  { key: "OFFICIAL_AWARDS", labelZh: "官方授标与合同披露", access: "PUBLIC" },
  { key: "IMPORTERS_DATABASE", labelZh: "加拿大进口商数据库（公开）", access: "PUBLIC" },
  { key: "LICENSED_TRADE_DATA", labelZh: "授权贸易 / 提单数据", access: "LICENSED" },
  { key: "TENDER_PORTAL_LOGIN", labelZh: "需要登录的招标门户", access: "AUTHENTICATED_PORTAL" },
];

export function resolveSourceState(source: IntelSource): SourceState {
  if (source.access === "AUTHENTICATED_PORTAL") return "DISABLED_BY_POLICY";
  if (source.configuredState) return source.configuredState;
  return source.access === "LICENSED" ? "NOT_CONNECTED" : "MANUAL_ONLY";
}

export const SOURCE_RESULT_STATUSES = ["OK", "EMPTY", "NOT_CONNECTED", "MANUAL_ONLY", "DISABLED_BY_POLICY"] as const;
export type SourceResultStatus = (typeof SOURCE_RESULT_STATUSES)[number];

export type SourceResult<T> = { sourceKey: string; labelZh: string; status: SourceResultStatus; records: T[]; messageZh: string };

/**
 * 只有已接通的来源才会调用 fetch；其它状态直接返回空记录与如实的说明。
 * 「查无结果」（EMPTY）与「未接通」（NOT_CONNECTED）是两种状态。
 */
export function readSource<T>(source: IntelSource, fetch: () => T[]): SourceResult<T> {
  const state = resolveSourceState(source);
  const base = { sourceKey: source.key, labelZh: source.labelZh };
  if (state === "NOT_CONNECTED") {
    return { ...base, status: "NOT_CONNECTED", records: [], messageZh: `${source.labelZh}：未接通。这不表示没有记录，而是没有查。` };
  }
  if (state === "MANUAL_ONLY") {
    return { ...base, status: "MANUAL_ONLY", records: [], messageZh: `${source.labelZh}：仅支持人工上传或录入，系统不会自动取数。` };
  }
  if (state === "DISABLED_BY_POLICY") {
    return { ...base, status: "DISABLED_BY_POLICY", records: [], messageZh: `${source.labelZh}：按纪律禁用（不触碰需要登录的站点）。` };
  }
  const records = fetch();
  return records.length === 0
    ? { ...base, status: "EMPTY", records: [], messageZh: `${source.labelZh}：已查询，没有结果。` }
    : { ...base, status: "OK", records, messageZh: `${source.labelZh}：${records.length} 条。` };
}
