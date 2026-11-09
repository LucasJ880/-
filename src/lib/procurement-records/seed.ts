/**
 * PROC-1 研究种子（任务书第十三节，截至 2026-11-05 的官方记录）——只作可刷新研究种子，
 * 不代表确定重招、当前申请授权或已提交案件。重复导入更新而非新增；remainingOptions / confirmedRetenderDate 保持 null。
 *
 * 历史案件 A-2026-00183 只能作为「带来源说明的待核实历史记录」导入：无附件、无回执、证据等级 user_reported，
 * 不创建伪附件 / 伪回执 / 已核实状态，不预填申请人地址。
 */

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { upsertInstrumentFromRecord } from "./instruments";
import type { NormalizedRecord } from "./sources-pure";
import { DEFAULT_FILTERS, matchKeywords } from "./watch-config";
import { ensureDefaultRules } from "./rules";
import { importHistoricalRequest, type HistoricalRequestItem } from "./requests";
import { normalizeInstrumentNumber } from "./identity";

export interface ResearchSeed {
  key: string;
  title: string;
  contractNumber: string;
  solicitationNumber: string;
  requisitionNumber: string;
  contractingInstitution: string;
  buyingInstitution: string;
  publicExpiry: string;
  sourceUrl: string;
  sourceLabel: string;
}

export const RESEARCH_SEEDS: ResearchSeed[] = [
  {
    key: "S6",
    title: "21C51-249059 Pillow Form",
    contractNumber: "CW2379109",
    solicitationNumber: "WS4856068988",
    requisitionNumber: "21C51-249059",
    contractingInstitution: "Public Services and Procurement Canada",
    buyingInstitution: "Correctional Service Canada / CORCAN",
    publicExpiry: "2027-02-26",
    sourceUrl: "https://canadabuys.canada.ca/en/tender-opportunities/contract-history/cw2379109-001",
    sourceLabel: "S6 Pillow Form 合同",
  },
  {
    key: "S7",
    title: "21C31-255912 Fleece Fabric",
    contractNumber: "CW2450151",
    solicitationNumber: "WS5370452219",
    requisitionNumber: "21C31-255912",
    contractingInstitution: "Public Services and Procurement Canada",
    buyingInstitution: "Correctional Service Canada",
    publicExpiry: "2027-04-12",
    sourceUrl: "https://canadabuys.canada.ca/en/tender-opportunities/contract-history/cw2450151-000",
    sourceLabel: "S7 Fleece Fabric 合同",
  },
  {
    key: "S8",
    title: "W3380-23FD05 Hand Towels and Bath Towels",
    contractNumber: "CW2370017",
    solicitationNumber: "WS4586333777",
    requisitionNumber: "W3380-23FD05",
    contractingInstitution: "Public Services and Procurement Canada",
    buyingInstitution: "National Defence",
    publicExpiry: "2027-07-30",
    sourceUrl: "https://canadabuys.canada.ca/en/tender-opportunities/contract-history/cw2370017-001",
    sourceLabel: "S8 Hand Towels and Bath Towels 合同",
  },
];

function seedRecord(s: ResearchSeed): NormalizedRecord {
  return {
    sourceType: "OPEN_CANADA_CONTRACTS",
    sourceKey: `taskbrief-seed:${s.key}:${s.contractNumber.toLowerCase()}`,
    sourceRecordId: s.contractNumber,
    sourceUrl: s.sourceUrl,
    jurisdiction: "CA-FED",
    instrumentClass: "AWARD_INSTRUMENT",
    instrumentSubtype: "UNKNOWN",
    officialNumber: s.contractNumber,
    aliases: [
      { value: s.solicitationNumber, kind: "PLATFORM_ALIAS" },
      { value: s.requisitionNumber, kind: "PLATFORM_ALIAS" },
    ],
    parentNumber: null,
    title: s.title,
    description: null,
    categoryCodes: [],
    categoryText: null,
    regions: [],
    contractingInstitution: s.contractingInstitution,
    buyingInstitution: s.buyingInstitution,
    vendorName: null,
    publishedAt: null,
    closingAt: null,
    awardDate: null,
    periodEnd: null,
    contractValue: null,
    originalValue: null,
    amendmentValue: null,
    currency: null,
    amendmentNumber: null,
    status: null,
    raw: { seed: s.key, asOf: "2026-11-05", publicExpiry: s.publicExpiry, label: s.sourceLabel },
  };
}

export async function seedResearchInstruments(input: { orgId: string; userId: string; now?: Date }) {
  const now = input.now ?? new Date();
  await ensureDefaultRules(input.orgId);
  const out: Array<{ key: string; instrumentId: string | null; created: boolean }> = [];
  for (const s of RESEARCH_SEEDS) {
    const r = await upsertInstrumentFromRecord({
      orgId: input.orgId,
      record: seedRecord(s),
      match: matchKeywords({ texts: [s.title] }, DEFAULT_FILTERS),
      runId: null,
      now,
      allowCreate: true,
      origin: "SEED",
      createdById: input.userId,
      initialTriage: "WATCHING",
      evidenceOverride: {
        sourceType: "TASKBRIEF_SEED",
        isOfficial: false,
        summary: `研究种子（${s.sourceLabel}，截至 2026-11-05 指令书），未在本环境复核官方页面；公开到期日 ${s.publicExpiry}；不代表确定重招`,
      },
    });
    if (r.instrumentId) {
      const inst = await db.procurementInstrument.findUnique({ where: { id: r.instrumentId }, select: { aliasesJson: true, currentExpiryAt: true } });
      const aliases = (Array.isArray(inst?.aliasesJson) ? inst!.aliasesJson : []) as Array<{ value: string; kind: string; source?: string }>;
      const withSol = aliases.some((a) => a.kind === "SOLICITATION_NUMBER" && normalizeInstrumentNumber(a.value).normalized === normalizeInstrumentNumber(s.solicitationNumber).normalized)
        ? aliases
        : [...aliases, { value: s.solicitationNumber, kind: "SOLICITATION_NUMBER", source: "TASKBRIEF_SEED" }];
      await db.procurementInstrument.update({
        where: { id: r.instrumentId },
        data: {
          aliasesJson: withSol as unknown as Prisma.InputJsonValue,
          buyingInstitution: s.buyingInstitution,
          contractingInstitution: s.contractingInstitution,
          // 只在为空时写公开到期日（不覆盖用户核实值）；剩余 options 与确认重招日期保持未知
          ...(inst?.currentExpiryAt ? {} : { currentExpiryAt: new Date(`${s.publicExpiry}T00:00:00Z`) }),
        },
      });
    }
    out.push({ key: s.key, instrumentId: r.instrumentId, created: r.created });
  }
  return out;
}

export const HISTORICAL_CASE_ITEM: HistoricalRequestItem = {
  title: "21C81-267106 Cotton Toweling 前序采购 CW2228162 / WS3250543003 / Ariba 11753631（历史复盘）",
  jurisdiction: "CA-FED",
  recipientInstitution: null,
  instrumentNumbers: ["CW2228162", "WS3250543003", "11753631"],
  startDate: "2021-11-01",
  endDate: "2025-07-04",
  legacyStatus: "RELEASE_NOTICE_RECEIVED",
  submissionReference: "EA2026_0187844",
  caseNumber: "A-2026-00183",
  submittedAt: null,
  registeredAt: "2026-08-07",
  responseLetterAt: "2026-10-28",
  expectedReleasePages: 105,
  originNote:
    "来源：2026-11-05 开发指令书第十三节复盘（[H1] 回复信需本人账户，未导入）。受理机关未在导入材料中写明，待核实；回执、受理信、回复信与 105 页附件均未导入；证据等级 user_reported；登记日至回复信 82 个日历日是本案实耗，不是法定时限；不据此预填当前申请人地址。前序采购编号与当前项目编号只是关联关系，不是同一采购工具别名。",
};

export async function seedHistoricalCase(input: { orgId: string; userId: string; asFixture?: boolean }) {
  const now = new Date();
  const predecessor = await upsertInstrumentFromRecord({
    orgId: input.orgId,
    record: {
      ...seedRecord({
        key: "H1",
        title: "Cotton Toweling（21C81-267106 的前序采购，历史复盘）",
        contractNumber: "CW2228162",
        solicitationNumber: "WS3250543003",
        requisitionNumber: "11753631",
        contractingInstitution: "",
        buyingInstitution: "",
        publicExpiry: "",
        sourceUrl: "",
        sourceLabel: "H1 历史复盘",
      }),
      sourceUrl: null,
      contractingInstitution: null,
      buyingInstitution: null,
      raw: { seed: "H1", note: "历史复盘记录；机构未核实" },
    },
    match: undefined,
    runId: null,
    now,
    allowCreate: true,
    origin: "SEED",
    createdById: input.userId,
    initialTriage: "HISTORY",
    evidenceOverride: { sourceType: "TASKBRIEF_SEED", isOfficial: false, summary: "历史复盘记录（指令书第十三节），采购机构与合同详情未核实" },
  });
  const r = await importHistoricalRequest({ orgId: input.orgId, userId: input.userId, item: { ...HISTORICAL_CASE_ITEM, isFixture: input.asFixture } });
  return { predecessorInstrumentId: predecessor.instrumentId, request: r };
}
