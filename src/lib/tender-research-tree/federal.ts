/**
 * 往期同标员（TREE-3）的联邦合同公开数据一步：检索词与给模型看的行（纯函数）。
 *
 * 检索词由 `canadabuys.ts` 的 deriveAwardQueries 从项目名、采购方与类别取（确定性），取前 2 个，逐个过外发闸；
 * 执行（先记游标、发查询、结果转记录）在 branch-run.ts 的分支循环里。设计见 design.md D10。
 */

import { deriveAwardQueries } from "@/lib/tender-intel/canadabuys";
import { openDataAmount, type OpenDataRow } from "./awards";
import { outboundBlockReason } from "./guards";
import { RESEARCH_TREE_LIMITS } from "./limits";

export type OpenDataPlanEntry = { index: number; query: string; blocked: boolean };

/** 这一支要查的联邦数据检索词（按序号；被外发闸拦下的标 blocked，不发、不记） */
export function openDataPlanFor(
  project: { name: string; clientOrganization: string | null; category: string | null },
  internalNumbers: readonly string[],
): OpenDataPlanEntry[] {
  const queries = deriveAwardQueries({
    projectName: project.name,
    buyerText: project.clientOrganization,
    productTexts: project.category ? [project.category] : [],
  }).slice(0, RESEARCH_TREE_LIMITS.OPEN_DATA_QUERIES);
  return queries.map((query, index) => ({
    index,
    query,
    blocked: outboundBlockReason(query, { internalNumbers: [...internalNumbers], maxChars: RESEARCH_TREE_LIMITS.MAX_QUERY_CHARS }) !== null,
  }));
}

const clean = (s: string | null | undefined, n: number) =>
  String(s ?? "")
    .normalize("NFKC")
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);

/** 联邦数据的行 → 给模型看的一行（中标方 · 合同额 CAD · 日期 · 采购部门 · 描述），最多 10 行 */
export function openDataLinesOf(rows: ReadonlyArray<OpenDataRow>): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const amount = openDataAmount(r.contractValue);
    const line = [clean(r.vendorName, 80), amount ? `${amount} CAD` : "", clean(r.contractDate, 10), clean(r.ownerOrg ?? r.buyerName, 80), clean(r.descriptionEn, 100)]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 220);
    if (line && !out.includes(line)) out.push(line);
    if (out.length >= RESEARCH_TREE_LIMITS.OPEN_DATA_ROWS_FOR_MODEL) break;
  }
  return out;
}
