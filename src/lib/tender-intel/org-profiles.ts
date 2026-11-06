/**
 * P2-0b — 组织级「竞争对手」「采购机构」画像（纯函数、确定性、只读）。
 *
 * 输入：
 * - AwardRecord 行集（canonical 授标事实，读路径已 org 隔离）；
 * - 本组织 tender 项目的精简行（调用方已按项目可见性过滤）。
 * 口径与 award-intelligence 一致：
 * - 「已确认」只算权威记录（ACTIVE + HUMAN_CONFIRMED / SYSTEM_VERIFIED）；
 *   AI 提取 / 疑似重复（NEEDS_REVIEW）只算线索，金额不进数字层（显示为 null）。
 * - 我方中标（按组织名规范化）不进竞争对手；在采购机构的中标方列表里标为「我方」。
 * - 采购周期复用 deriveBuyerCycle（只属于 买家×可比范围组；不够样本 → UNKNOWN）。
 * - 不出现任何合计金额 / 市场价 / 中标概率。
 */

import { normalizeBuyerName } from "@/lib/corporate-memory/normalize";
import type { AwardRecordRow } from "./awards";
import { normalizeVendorName, toAmountNumber } from "./awards";
import { deriveBuyerCycle, type BuyerCycleProjection } from "./award-intelligence";

const EVIDENCE_BACKED = new Set(["HUMAN_CONFIRMED", "SYSTEM_VERIFIED"]);
const RECENT_PROJECTS_PER_AGENCY = 5;

function isAuthoritative(r: AwardRecordRow): boolean {
  return r.status === "ACTIVE" && EVIDENCE_BACKED.has(r.verificationStatus);
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function byDateDesc(a: AwardRecordRow, b: AwardRecordRow): number {
  return (b.awardDate?.getTime() ?? 0) - (a.awardDate?.getTime() ?? 0);
}

function ownSet(names: Array<string | null | undefined> | undefined): Set<string> {
  return new Set(
    (names ?? [])
      .map((n) => (n ?? "").trim())
      .filter(Boolean)
      .map((n) => normalizeVendorName(n)),
  );
}

export type ProfileAward = {
  id: string;
  buyerName: string | null;
  winnerName: string;
  solicitationNumber: string | null;
  awardDate: string | null;
  /** 只有权威记录给金额；线索记录为 null */
  contractAmount: number | null;
  currency: string | null;
  scopeSummary: string | null;
  verificationStatus: string;
  recordStatus: string;
  projectId: string | null;
  isOwn: boolean;
};

function toProfileAward(r: AwardRecordRow, own: Set<string>): ProfileAward {
  return {
    id: r.id,
    buyerName: r.buyerNameRaw,
    winnerName: r.winnerName,
    solicitationNumber: r.solicitationNumber,
    awardDate: iso(r.awardDate),
    contractAmount: isAuthoritative(r) ? toAmountNumber(r.contractAmount) : null,
    currency: r.currency,
    scopeSummary: r.scopeSummary,
    verificationStatus: r.verificationStatus,
    recordStatus: r.status,
    projectId: r.projectId,
    isOwn: own.has(r.winnerNameNormalized),
  };
}

/* ------------------------------- 竞争对手 ------------------------------- */

export type CompetitorProfile = {
  key: string;
  name: string;
  /** CONFIRMED：至少一条权威记录；LEAD：只有线索 */
  status: "CONFIRMED" | "LEAD";
  confirmedAwards: number;
  leadAwards: number;
  lastAwardDate: string | null;
  /** 它在哪些采购机构中过标（全部非撤回记录，按次数降序） */
  buyers: Array<{ name: string; count: number }>;
  awards: ProfileAward[];
};

export function buildCompetitorProfiles(
  rows: AwardRecordRow[],
  opts?: { ownWinnerNames?: Array<string | null | undefined> },
): { competitors: CompetitorProfile[]; ownAwardCount: number } {
  const own = ownSet(opts?.ownWinnerNames);
  const records = rows.filter((r) => r.status !== "RETRACTED");
  const groups = new Map<string, AwardRecordRow[]>();
  let ownAwardCount = 0;
  for (const r of records) {
    if (own.has(r.winnerNameNormalized)) {
      ownAwardCount += 1;
      continue;
    }
    const list = groups.get(r.winnerNameNormalized) ?? [];
    list.push(r);
    groups.set(r.winnerNameNormalized, list);
  }

  const competitors: CompetitorProfile[] = [...groups.entries()].map(([key, list]) => {
    const sorted = [...list].sort(byDateDesc);
    const confirmed = list.filter(isAuthoritative).length;
    const buyerCounts = new Map<string, { name: string; count: number }>();
    for (const r of list) {
      const raw = r.buyerNameRaw?.trim();
      if (!raw) continue;
      const k = r.buyerNameNormalized || normalizeBuyerName(raw);
      const cur = buyerCounts.get(k) ?? { name: raw, count: 0 };
      cur.count += 1;
      buyerCounts.set(k, cur);
    }
    const dated = sorted.find((r) => r.awardDate);
    return {
      key,
      name: (sorted.find(isAuthoritative) ?? sorted[0]).winnerName,
      status: confirmed > 0 ? "CONFIRMED" : "LEAD",
      confirmedAwards: confirmed,
      leadAwards: list.length - confirmed,
      lastAwardDate: iso(dated?.awardDate ?? null),
      buyers: [...buyerCounts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      awards: sorted.map((r) => toProfileAward(r, own)),
    };
  });

  competitors.sort(
    (a, b) =>
      b.confirmedAwards - a.confirmedAwards ||
      b.leadAwards - a.leadAwards ||
      (b.lastAwardDate ?? "").localeCompare(a.lastAwardDate ?? "") ||
      a.name.localeCompare(b.name),
  );
  return { competitors, ownAwardCount };
}

/* ------------------------------- 采购机构 ------------------------------- */

export type TenderProjectLite = {
  id: string;
  name: string;
  clientOrganization: string | null;
  tenderStatus: string | null;
  status: string;
  abandonedAt: Date | null;
  solicitationNumber: string | null;
  updatedAt: Date;
};

export type OurBidOutcome = "won" | "lost" | "no_bid" | "cancelled" | "open";

/** 我方项目在某机构的结果分类：放弃且没有结果 → no_bid */
export function ourBidOutcome(p: Pick<TenderProjectLite, "tenderStatus" | "status" | "abandonedAt">): OurBidOutcome {
  const t = (p.tenderStatus ?? "").trim();
  if (t === "won" || t === "lost" || t === "no_bid" || t === "cancelled") return t;
  if (p.status === "abandoned" || p.abandonedAt != null) return "no_bid";
  return "open";
}

export type AgencyProfile = {
  key: string;
  name: string;
  awards: {
    total: number;
    authoritative: number;
    leads: number;
    lastAwardDate: string | null;
    /** 中标方（全部非撤回记录）；我方标 isOwn */
    winners: Array<{ name: string; count: number; confirmed: number; isOwn: boolean }>;
    cycle: BuyerCycleProjection;
    records: ProfileAward[];
  };
  ourBids: {
    total: number;
    won: number;
    lost: number;
    noBid: number;
    cancelled: number;
    open: number;
    recent: Array<{ id: string; name: string; outcome: OurBidOutcome; solicitationNumber: string | null }>;
  };
};

export function buildAgencyProfiles(
  rows: AwardRecordRow[],
  projects: TenderProjectLite[],
  opts?: { ownWinnerNames?: Array<string | null | undefined> },
): AgencyProfile[] {
  const own = ownSet(opts?.ownWinnerNames);
  const records = rows.filter((r) => r.status !== "RETRACTED");

  const awardsBy = new Map<string, AwardRecordRow[]>();
  for (const r of records) {
    const raw = r.buyerNameRaw?.trim();
    const key = r.buyerNameNormalized || (raw ? normalizeBuyerName(raw) : "");
    if (!key) continue;
    const list = awardsBy.get(key) ?? [];
    list.push(r);
    awardsBy.set(key, list);
  }
  const projectsBy = new Map<string, TenderProjectLite[]>();
  for (const p of projects) {
    const raw = p.clientOrganization?.trim();
    if (!raw) continue;
    const key = normalizeBuyerName(raw);
    if (!key) continue;
    const list = projectsBy.get(key) ?? [];
    list.push(p);
    projectsBy.set(key, list);
  }

  const keys = new Set([...awardsBy.keys(), ...projectsBy.keys()]);
  const profiles: AgencyProfile[] = [...keys].map((key) => {
    const list = [...(awardsBy.get(key) ?? [])].sort(byDateDesc);
    const projs = [...(projectsBy.get(key) ?? [])].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

    const winners = new Map<string, { name: string; count: number; confirmed: number; isOwn: boolean }>();
    for (const r of list) {
      const cur = winners.get(r.winnerNameNormalized) ?? {
        name: r.winnerName,
        count: 0,
        confirmed: 0,
        isOwn: own.has(r.winnerNameNormalized),
      };
      cur.count += 1;
      if (isAuthoritative(r)) cur.confirmed += 1;
      winners.set(r.winnerNameNormalized, cur);
    }

    const tally = { won: 0, lost: 0, noBid: 0, cancelled: 0, open: 0 };
    for (const p of projs) {
      const o = ourBidOutcome(p);
      if (o === "no_bid") tally.noBid += 1;
      else tally[o] += 1;
    }

    const authoritative = list.filter(isAuthoritative).length;
    const name =
      list.find((r) => r.buyerNameRaw?.trim())?.buyerNameRaw?.trim() ||
      projs.find((p) => p.clientOrganization?.trim())?.clientOrganization?.trim() ||
      key;
    return {
      key,
      name,
      awards: {
        total: list.length,
        authoritative,
        leads: list.length - authoritative,
        lastAwardDate: iso(list.find((r) => r.awardDate)?.awardDate ?? null),
        winners: [...winners.values()].sort(
          (a, b) => b.confirmed - a.confirmed || b.count - a.count || a.name.localeCompare(b.name),
        ),
        cycle: deriveBuyerCycle(list),
        records: list.map((r) => toProfileAward(r, own)),
      },
      ourBids: {
        total: projs.length,
        ...tally,
        recent: projs.slice(0, RECENT_PROJECTS_PER_AGENCY).map((p) => ({
          id: p.id,
          name: p.name,
          outcome: ourBidOutcome(p),
          solicitationNumber: p.solicitationNumber,
        })),
      },
    };
  });

  profiles.sort(
    (a, b) =>
      b.awards.total + b.ourBids.total - (a.awards.total + a.ourBids.total) ||
      b.awards.authoritative - a.awards.authoritative ||
      a.name.localeCompare(b.name),
  );
  return profiles;
}
