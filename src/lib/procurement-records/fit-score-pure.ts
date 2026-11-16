/**
 * P2-2 新标匹配度（纯函数，design D2–D5）：四项确定性规则，每项写原因；不是中标概率，不调模型。
 *
 * - 业务匹配（40）：扫描时已存的产品词 / 分类 / 服务词命中；
 * - 与该采购方的往来（25）：看的人可见的本组织招投标项目里，客户与公告采购方相同的次数（只写次数）；
 * - 过往业绩相近（20）：与已中标项目标题的最高 Jaccard，写出最相近的项目名；
 * - 准备时间（15）：距截标的多伦多日期天数。
 */

import { normalizeInstitutionKey } from "./identity";
import { localDateOf } from "./schedule";
import { jaccard, tokenize } from "@/lib/projects/text-similarity";
import { FIT_NOTE_ZH, FIT_SORT_VALUE } from "./new-notices-pure";

export { FIT_NOTE_ZH, FIT_SORT_VALUE };
export const FIT_TIMEZONE = "America/Toronto";

export type FitKey = "BUSINESS_MATCH" | "BUYER_HISTORY" | "PAST_WORK" | "PREP_TIME";

export interface FitDimension {
  key: FitKey;
  label: string;
  points: number;
  max: number;
  reasonZh: string;
}

export interface FitScore {
  score: number;
  dimensions: FitDimension[];
  noteZh: string;
}

export interface FitNotice {
  title: string | null;
  buyingInstitution: string | null;
  contractingInstitution: string | null;
  closingAt: Date | null;
  match: { productHits?: string[]; serviceHits?: string[]; categoryHits?: string[] } | null;
}

/** 已整理的项目（只带算分需要的字段；价格一律不带） */
export interface FitProject {
  id: string;
  name: string;
  clientKey: string;
  submitted: boolean;
  won: boolean;
  tokens: Set<string>;
}

export function prepareFitProjects(
  rows: Array<{ id: string; name: string; clientOrganization: string | null; tenderStatus: string | null; submittedAt: Date | null }>,
): FitProject[] {
  return rows.map((r) => {
    const status = (r.tenderStatus ?? "").toLowerCase();
    return {
      id: r.id,
      name: r.name,
      clientKey: normalizeInstitutionKey(r.clientOrganization).key,
      submitted: !!r.submittedAt || status === "won" || status === "lost",
      won: status === "won",
      tokens: tokenize(r.name),
    };
  });
}

/** 公告的采购方：使用部门优先，没有再用采购机关（design D3） */
export function noticeBuyer(n: Pick<FitNotice, "buyingInstitution" | "contractingInstitution">): { key: string; pspcOnly: boolean } {
  const buying = normalizeInstitutionKey(n.buyingInstitution).key;
  if (buying !== "UNKNOWN") return { key: buying, pspcOnly: false };
  const contracting = normalizeInstitutionKey(n.contractingInstitution).key;
  return { key: contracting, pspcOnly: contracting === "PSPC" };
}

function businessMatch(m: FitNotice["match"]): FitDimension {
  const products = m?.productHits ?? [];
  const services = m?.serviceHits ?? [];
  const categories = m?.categoryHits ?? [];
  const productPts = Math.min(30, products.length * 10);
  const categoryPts = categories.length > 0 ? 6 : 0;
  const servicePts = services.length > 0 && (products.length > 0 || categories.length > 0) ? 4 : 0;
  const points = Math.min(40, productPts + categoryPts + servicePts);
  const parts: string[] = [];
  if (products.length) parts.push(`产品词：${products.slice(0, 4).join("、")}`);
  if (categories.length) parts.push(`分类：${categories.slice(0, 3).join("、")}`);
  if (servicePts) parts.push(`含服务：${services.slice(0, 2).join("、")}`);
  return { key: "BUSINESS_MATCH", label: "业务匹配", points, max: 40, reasonZh: parts.join("；") || "没有命中产品词或分类" };
}

function buyerHistory(n: FitNotice, projects: FitProject[]): FitDimension {
  const buyer = noticeBuyer(n);
  const base = { key: "BUYER_HISTORY" as const, label: "与该采购方的往来", max: 25 };
  if (buyer.key === "UNKNOWN") return { ...base, points: 0, reasonZh: "公告没有写采购方" };
  const same = projects.filter((p) => p.clientKey === buyer.key);
  if (!same.length) return { ...base, points: 0, reasonZh: "没有同一采购方的投标项目" };
  const submitted = same.filter((p) => p.submitted).length;
  const won = same.filter((p) => p.won).length;
  const counts = `与该采购方有 ${same.length} 个投标项目，交过标 ${submitted} 次，中标 ${won} 次`;
  // PSPC 代各部门采购：只知道是 PSPC 时只给基础分（design D3）
  if (buyer.pspcOnly) return { ...base, points: 5, reasonZh: `${counts}；采购方只知道是 PSPC（代各部门采购），往来仅供参考` };
  const points = 5 + (submitted > 0 ? 10 : 0) + (won > 0 ? 10 : 0);
  return { ...base, points, reasonZh: counts };
}

function pastWork(n: FitNotice, projects: FitProject[]): FitDimension {
  const base = { key: "PAST_WORK" as const, label: "过往业绩相近", max: 20 };
  const won = projects.filter((p) => p.won);
  if (!won.length) return { ...base, points: 0, reasonZh: "没有已中标项目可比" };
  const t = tokenize(n.title ?? "");
  let best: { p: FitProject; sim: number } | null = null;
  for (const p of won) {
    const sim = jaccard(t, p.tokens);
    if (!best || sim > best.sim) best = { p, sim };
  }
  const sim = best?.sim ?? 0;
  const points = sim >= 0.5 ? 20 : sim >= 0.3 ? 12 : sim >= 0.15 ? 6 : 0;
  if (!points || !best) return { ...base, points: 0, reasonZh: "标题与已中标项目都不相近" };
  return { ...base, points, reasonZh: `与已中标项目「${best.p.name}」标题相近（相似度 ${sim.toFixed(2)}）` };
}

/** 两个 YYYY-MM-DD 之间的天数 */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000);
}

function prepTime(n: FitNotice, now: Date): FitDimension {
  const base = { key: "PREP_TIME" as const, label: "准备时间", max: 15 };
  if (!n.closingAt) return { ...base, points: 5, reasonZh: "截标时间未知" };
  const closeDay = localDateOf(n.closingAt, FIT_TIMEZONE);
  const days = daysBetween(localDateOf(now, FIT_TIMEZONE), closeDay);
  const points = days >= 14 ? 15 : days >= 7 ? 10 : days >= 3 ? 5 : 0;
  return { ...base, points, reasonZh: `截标 ${closeDay}，还有 ${Math.max(0, days)} 天${points === 0 ? "（时间很紧）" : ""}` };
}

export function computeFitScore(n: FitNotice, projects: FitProject[], now: Date): FitScore {
  const dimensions = [businessMatch(n.match), buyerHistory(n, projects), pastWork(n, projects), prepTime(n, now)];
  return { score: dimensions.reduce((s, d) => s + d.points, 0), dimensions, noteZh: FIT_NOTE_ZH };
}

/** 按匹配度排序：分高的在前；同分按发布日期新到旧（没有发布日期的在后），再按首次发现新到旧（design D5） */
export function compareByFit(
  a: { fit: FitScore | null; publishedAt: string | null; firstSeenAt: string | null },
  b: { fit: FitScore | null; publishedAt: string | null; firstSeenAt: string | null },
): number {
  const s = (b.fit?.score ?? -1) - (a.fit?.score ?? -1);
  if (s) return s;
  if (a.publishedAt !== b.publishedAt) {
    if (!a.publishedAt) return 1;
    if (!b.publishedAt) return -1;
    return a.publishedAt < b.publishedAt ? 1 : -1;
  }
  return (b.firstSeenAt ?? "").localeCompare(a.firstSeenAt ?? "");
}
