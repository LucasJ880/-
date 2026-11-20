/**
 * CHAIN-3 进口记录的数据源接口（判断点 3 A）
 *
 * 现在只有「人工粘贴」一种实现：只解析用户贴进来的文字，不发任何请求。
 * 授权贸易 / 提单数据照旧是「未接通」（tender-competition/source-status.ts）。
 * 接一家授权 API 时加一个实现、并在来源配置里显式改为已接通（带测试），匹配与汇总不动。
 */

import type { ImportLeadSource } from "@/lib/tender-competition/import-leads";
import { DEFAULT_INTEL_SOURCES, readSource } from "@/lib/tender-competition/source-status";
import { parseImportText, type DateOrder, type ParseResult } from "./parse";

export type ImportLeadProviderInput = { text: string; sourceLabel: string | null; dateOrder: DateOrder | null; now: Date };

export interface ImportLeadProvider {
  id: string;
  sourceKind: ImportLeadSource;
  labelZh: string;
  collect(input: ImportLeadProviderInput): ParseResult;
}

export const manualPasteProvider: ImportLeadProvider = {
  id: "manual_paste",
  sourceKind: "USER_ENTRY",
  labelZh: "人工导入",
  collect: (input) => parseImportText(input.text, { sourceLabel: input.sourceLabel, dateOrder: input.dateOrder, now: input.now }),
};

export const MANUAL_SOURCE_NOTE_ZH = "人工导入：把你在别处查到的进口记录贴进来；系统不接入、也不访问任何提单库或网站。";

/** 面板上的来源情况：授权数据未接通（不造数据、不说成「查过了没有」）+ 人工导入 */
export function importLeadSourceNotesZh(): string[] {
  const licensed = DEFAULT_INTEL_SOURCES.find((s) => s.key === "LICENSED_TRADE_DATA");
  const licensedNote = licensed ? readSource(licensed, () => []).messageZh : "授权贸易 / 提单数据：未接通。这不表示没有记录，而是没有查。";
  return [licensedNote, MANUAL_SOURCE_NOTE_ZH];
}
