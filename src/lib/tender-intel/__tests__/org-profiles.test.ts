/**
 * P2-0b — 组织级竞争对手 / 采购机构画像（纯函数）
 * 运行：npx tsx src/lib/tender-intel/__tests__/org-profiles.test.ts
 *
 * 锁定：
 * - 竞争对手：我方排除、已确认与线索分开、线索不给金额、撤回不计、排序确定
 * - 采购机构：授标与我方项目按同一规范化合并；我方在中标方里标出；结果分类；周期复用 deriveBuyerCycle
 */
import { normalizeBuyerName } from "@/lib/corporate-memory/normalize";
import { normalizeVendorName, type AwardRecordRow } from "../awards";
import {
  buildAgencyProfiles,
  buildCompetitorProfiles,
  ourBidOutcome,
  type TenderProjectLite,
} from "../org-profiles";

let pass = 0;
let fail = 0;
const ok = (c: boolean, n: string, detail?: unknown) => {
  if (c) {
    pass++;
    console.log("  ✓ " + n);
  } else {
    fail++;
    console.error("  ✗ " + n, detail !== undefined ? JSON.stringify(detail).slice(0, 600) : "");
  }
};

let seq = 0;
function award(winner: string, buyer: string | null, over: Partial<AwardRecordRow> = {}): AwardRecordRow {
  seq += 1;
  return {
    id: `a${seq}`,
    orgId: "orgA",
    buyerId: null,
    buyerNameRaw: buyer,
    buyerNameNormalized: buyer ? normalizeBuyerName(buyer) : null,
    projectId: null,
    winnerName: winner,
    winnerNameNormalized: normalizeVendorName(winner),
    solicitationNumber: `SOL-${seq}`,
    awardDate: null,
    contractAmount: null,
    currency: null,
    scopeSummary: null,
    confidence: "HIGH",
    verificationStatus: "HUMAN_CONFIRMED",
    status: "ACTIVE",
    possibleDuplicateOfId: null,
    confirmedById: null,
    confirmedAt: null,
    createdByType: "user",
    createdById: null,
    metadata: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...over,
  } as AwardRecordRow;
}

let pseq = 0;
function project(client: string | null, over: Partial<TenderProjectLite> = {}): TenderProjectLite {
  pseq += 1;
  return {
    id: `p${pseq}`,
    name: `Project ${pseq}`,
    clientOrganization: client,
    tenderStatus: null,
    status: "active",
    abandonedAt: null,
    solicitationNumber: null,
    updatedAt: new Date(Date.UTC(2026, 0, pseq)),
    ...over,
  };
}

const OWN = "Sunny Shutter Inc.";
const d = (s: string) => new Date(`${s}T00:00:00Z`);

console.log("tender-intel org-profiles（P2-0b）");

/* ------------------------------ 竞争对手 ------------------------------ */
console.log("\n[竞争对手]");
{
  const rows = [
    award("ABC Blinds Ltd", "City of Toronto", { awardDate: d("2026-03-01"), contractAmount: 120000, currency: "CAD" }),
    award("abc blinds ltd.", "Toronto, City of", { awardDate: d("2025-03-01"), contractAmount: "99000", currency: "CAD" }),
    award("ABC Blinds Ltd", "PSPC", { verificationStatus: "AI_EXTRACTED", contractAmount: 5000, currency: "CAD" }),
    award("XYZ Coverings", "PSPC", { verificationStatus: "AI_EXTRACTED", awardDate: d("2026-05-01"), contractAmount: 7000 }),
    award("Dup Window Co", "PSPC", { status: "NEEDS_REVIEW", awardDate: d("2026-06-01") }),
    award("Gone Corp", "PSPC", { status: "RETRACTED" }),
    award("SUNNY SHUTTER INC", "City of Toronto", { awardDate: d("2026-04-01") }),
    award("Sunny Shutter Inc.", "PSPC", { verificationStatus: "AI_EXTRACTED" }),
  ];
  const { competitors, ownAwardCount } = buildCompetitorProfiles(rows, { ownWinnerNames: [OWN, null, ""] });
  const names = competitors.map((c) => c.name);

  ok(ownAwardCount === 2, "我方两条（权威 + 线索、大小写不同）被排除并计数", ownAwardCount);
  ok(!names.some((n) => normalizeVendorName(n) === normalizeVendorName(OWN)), "我方不在竞争对手里", names);
  ok(!names.includes("Gone Corp"), "撤回记录不计", names);

  const abc = competitors.find((c) => c.key === normalizeVendorName("ABC Blinds Ltd"));
  ok(!!abc && abc.status === "CONFIRMED" && abc.confirmedAwards === 2 && abc.leadAwards === 1, "同一对手合并：已确认 2 + 线索 1", abc);
  ok(abc?.name === "ABC Blinds Ltd" && abc.lastAwardDate === "2026-03-01", "显示名取最近的权威记录；最近中标日期", abc);
  ok(
    abc?.buyers.length === 2 && abc.buyers[0].name === "City of Toronto" && abc.buyers[0].count === 2,
    "机构按规范化合并（Toronto, City of = City of Toronto）并按次数排序",
    abc?.buyers,
  );
  const leadAmount = abc?.awards.find((a) => a.verificationStatus === "AI_EXTRACTED")?.contractAmount;
  const confirmedAmounts = abc?.awards.filter((a) => a.verificationStatus === "HUMAN_CONFIRMED").map((a) => a.contractAmount);
  ok(leadAmount === null && confirmedAmounts?.join() === "120000,99000", "线索不给金额；权威金额转数字", { leadAmount, confirmedAmounts });

  const xyz = competitors.find((c) => c.name === "XYZ Coverings");
  const dup = competitors.find((c) => c.name === "Dup Window Co");
  ok(xyz?.status === "LEAD" && xyz.confirmedAwards === 0 && xyz.leadAwards === 1, "只有 AI 提取 → 线索", xyz);
  ok(dup?.status === "LEAD", "疑似重复（NEEDS_REVIEW）即使人工确认也只算线索", dup);
  ok(names[0] === "ABC Blinds Ltd" && names.indexOf("Dup Window Co") < names.indexOf("XYZ Coverings"), "排序：已确认次数 → 线索数 → 最近日期", names);

  const again = buildCompetitorProfiles([...rows].reverse(), { ownWinnerNames: [OWN] });
  ok(JSON.stringify(again.competitors.map((c) => c.name)) === JSON.stringify(names), "输入顺序不影响输出（确定性）");

  const noOwn = buildCompetitorProfiles(rows);
  ok(noOwn.ownAwardCount === 0 && noOwn.competitors.some((c) => c.key === normalizeVendorName(OWN)), "不传组织名：我方按普通中标方出现");
  ok(buildCompetitorProfiles([]).competitors.length === 0, "空输入 → 空列表");
}

/* ------------------------------ 采购机构 ------------------------------ */
console.log("\n[采购机构]");
{
  ok(ourBidOutcome({ tenderStatus: "won", status: "completed", abandonedAt: null }) === "won", "won → 中标");
  ok(ourBidOutcome({ tenderStatus: null, status: "abandoned", abandonedAt: null }) === "no_bid", "放弃且没有结果 → 未投");
  ok(ourBidOutcome({ tenderStatus: null, status: "active", abandonedAt: d("2026-01-01") }) === "no_bid", "abandonedAt 有值 → 未投");
  ok(ourBidOutcome({ tenderStatus: "lost", status: "abandoned", abandonedAt: d("2026-01-01") }) === "lost", "已有结果优先于放弃");
  ok(ourBidOutcome({ tenderStatus: "awarded", status: "active", abandonedAt: null }) === "open", "未知结果 → 进行中");

  const scope = "Supply and install window blinds";
  const rows = [
    award("ABC Blinds Ltd", "City of Toronto", { awardDate: d("2023-03-01"), scopeSummary: scope }),
    award("ABC Blinds Ltd", "City of Toronto", { awardDate: d("2024-03-01"), scopeSummary: scope }),
    award("Sunny Shutter Inc", "Toronto, City of", { awardDate: d("2025-03-01"), scopeSummary: scope }),
    award("XYZ Coverings", "City of Toronto", { verificationStatus: "AI_EXTRACTED", awardDate: d("2025-09-01") }),
    award("Only Award Buyer Co", "Region of Peel", { awardDate: d("2025-01-01") }),
    award("Nameless", null),
  ];
  const projects = [
    project("CITY OF TORONTO", { tenderStatus: "won" }),
    project("City of Toronto", { tenderStatus: "lost" }),
    project("City of Toronto", { status: "abandoned" }),
    project("City of Toronto"),
    project("City of Toronto", { tenderStatus: "cancelled" }),
    project("City of Toronto", { tenderStatus: "no_bid" }),
    project("Halton Region", { tenderStatus: "lost" }),
    project(null),
    project("   "),
  ];
  const agencies = buildAgencyProfiles(rows, projects, { ownWinnerNames: [OWN] });
  const keys = agencies.map((a) => a.key);

  ok(agencies.length === 3, "三个机构：多伦多（授标 + 项目）、皮尔（只有授标）、霍尔顿（只有项目）；无名记录与空白采购方跳过", keys);
  const to = agencies.find((a) => a.key === normalizeBuyerName("City of Toronto"));
  ok(!!to && to.awards.total === 4 && to.awards.authoritative === 3 && to.awards.leads === 1, "多伦多：授标 4 条（已确认 3 · 线索 1）", to?.awards);
  ok(
    to?.ourBids.total === 6 && to.ourBids.won === 1 && to.ourBids.lost === 1 && to.ourBids.noBid === 2 && to.ourBids.cancelled === 1 && to.ourBids.open === 1,
    "我方项目 6 个：中 1 · 未中 1 · 未投 2 · 取消 1 · 进行中 1（大小写不同合并）",
    to?.ourBids,
  );
  ok(to?.ourBids.recent.length === 5 && to.ourBids.recent[0].id === "p6", "最近项目最多 5 个，按更新时间倒序", to?.ourBids.recent.map((p) => p.id));
  const own = to?.awards.winners.find((w) => w.isOwn);
  ok(!!own && own.count === 1 && own.name === "Sunny Shutter Inc", "我方在中标方里标出（不排除）", to?.awards.winners);
  ok(
    to?.awards.winners[0].name === "ABC Blinds Ltd" && to.awards.winners[0].confirmed === 2 && to.awards.winners.at(-1)?.name === "XYZ Coverings",
    "中标方按已确认次数排序，线索在后",
    to?.awards.winners,
  );
  ok(
    to?.awards.cycle.status === "LOW_CONFIDENCE" && to.awards.cycle.sampleSize === 3 && to.awards.cycle.medianIntervalDays === 365.5,
    "周期：同范围 3 条 → 间隔中位 365.5 天（366/365，低置信）",
    to?.awards.cycle,
  );
  ok(to?.name === "City of Toronto" && to.awards.lastAwardDate === "2025-09-01", "显示名取最近授标记录；最近授标日期", { name: to?.name, last: to?.awards.lastAwardDate });

  const peel = agencies.find((a) => a.key === normalizeBuyerName("Region of Peel"));
  ok(peel?.ourBids.total === 0 && peel.awards.cycle.status === "UNKNOWN", "只有一条授标：没有我方项目，周期 UNKNOWN", peel);
  const halton = agencies.find((a) => a.key === normalizeBuyerName("Halton Region"));
  ok(halton?.awards.total === 0 && halton.name === "Halton Region" && halton.ourBids.lost === 1, "只有我方项目：名称取项目采购方", halton);
  ok(keys[0] === to?.key, "排序：授标 + 项目总数多的在前", keys);

  const offline = buildAgencyProfiles([], projects, { ownWinnerNames: [OWN] });
  ok(offline.length === 2 && offline.every((a) => a.awards.total === 0), "授标情报关闭（无授标行）时只按我方项目建机构");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
