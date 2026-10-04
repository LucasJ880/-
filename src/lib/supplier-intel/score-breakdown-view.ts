/**
 * FR3：评分快照的**对外读投影**（数据最小化；白名单）。
 *
 * `SupplierCandidate.scoreBreakdownJson` 是内部审计快照：为了可复算，Reliability 里记着**别项目**的
 * InquiryItem id / 项目 id / 状态，`provenance.historyItemIds` 也是。一个能读当前项目、却读不到那些历史
 * 项目的人，不该从当前项目的评估视图里拿到它们。所以：
 *
 *   - 评分**计算**范围（org 内别项目全部历史）≠ **读**范围（actor 的项目 ACL）。评分保持 actor 无关
 *     （公式 / 应答率 / 入选率 / 最少 2 条历史 都不动）；这里只做读投影，不碰分数。
 *   - 白名单：只复制明确列出的字段，未知键一律丢弃——新加字段必须在这里显式放行才会出现在读面上。
 *   - reliability → 只留聚合 `rule / score / contacted / replied / selected / sub / reasonCodes`；**没有 history**。
 *   - provenance → 去掉 `historyItemIds`，改给 `historicalInteractionCount`（计数，不泄露 id）；
 *     当前项目的 `projectId / supplierId / offeringId / originSource / inquiryId / capabilityIds` 保留
 *     （FR1 绑定与 FR2 当前项目能力本来就在当前项目可读范围内）。
 *   - technical / commercial / importRisk / contract 只含当前项目数据（FR1 / FR2 已保证），按字段白名单透传；
 *     `offeringPriceEvidence.sourceSignalId` 不透出（供应商级报盘的来源线索可能属于别项目；界面用 platform / url）。
 *
 * 读面必须一律经过这里：`loadEvaluationView`、项目排名 / 赛马 read-model。内部快照本身不改、不删。
 * 纯函数：无 IO / 无时钟 / 无随机。
 */

type Dict = Record<string, unknown>;

export interface ReliabilityBreakdownView {
  rule: string | null;
  score: number | null;
  contacted: number;
  replied: number;
  selected: number;
  sub: { responseRate: number | null; priorSelection: number | null };
  reasonCodes: string[];
}

export interface ScoreProvenanceView {
  projectId: string | null;
  supplierId: string | null;
  offeringId: string | null;
  originSource: string | null;
  inquiryId: string | null;
  capabilityIds: string[];
  /** 别项目历史互动条数（只给计数；id / 项目 / 状态不出当前项目） */
  historicalInteractionCount: number;
}

export interface TechnicalBreakdownView {
  rule: string | null;
  score: number | null;
  scorableCount: number;
  items: Array<{ key: string; category: string | null; verdict: string; evaluatedBy: string | null; points: number; reason: string | null }>;
  excluded: Array<{ key: string; category: string | null }>;
  unmapped: Array<{ key: string; category: string | null }>;
  reasonCodes: string[];
}

export interface CommercialBreakdownView {
  rule: string | null;
  score: number | null;
  priceEvidenceTier: string;
  round: { inquiryId: string; roundNumber: number; scope: string | null } | null;
  priceBasis: string | null;
  currency: string | null;
  candidate: { itemId: string; price: number | null; deliveryDays: number | null; validUntil: string | null } | null;
  comparableGroup: Array<{ supplierId: string; itemId: string; price: number; deliveryDays: number | null }>;
  sub: { price: number | null; delivery: number; completeness: number | null };
  reasonCodes: string[];
  binding: { inquiryId: string; inquiryItemId: string; supplierId: string; offeringId: string; roundNumber: number; scope: string | null; confirmedByUserId: string; status: string } | null;
  offeringPriceEvidence: { tier: string; listedPrice: string | null; currency: string | null; priceStatus: string | null; sourceKind: string | null; sourceUrl: string | null; sourceSignalPlatform: string | null } | null;
}

export interface ImportRiskBreakdownView {
  rule: string | null;
  score: number | null;
  verified: Array<{ id: string; type: string; discoverySignalId: string | null; projectScope: string }>;
  unverified: Array<{ id: string; type: string; evidenceStatus: string; discoverySignalId: string | null }>;
  sub: { readiness: number | null; packaging: number; incoterm: number; leadTime: number };
  offering: { incoterm: string | null; leadTimeDays: number | null };
  reasonCodes: string[];
}

export interface ScoreContractView {
  version: string | null;
  components: Record<string, unknown>;
  knownWeightShare: number | null;
  totalScore: number | null;
  unknownComponents: string[];
}

export interface EvaluationScoreBreakdownView {
  scoreVersion: string | null;
  recommendationContractVersion: string | null;
  componentRuleVersions: Record<string, string>;
  computedAt: string | null;
  capturedAt: string | null;
  gateResult: string | null;
  technical: TechnicalBreakdownView | null;
  commercial: CommercialBreakdownView | null;
  reliability: ReliabilityBreakdownView | null;
  importRisk: ImportRiskBreakdownView | null;
  contract: ScoreContractView | null;
  knownWeightShare: number | null;
  unknownComponents: string[];
  normalizedKnownScore: number | null;
  officialTotalScore: number | null;
  recommendation: string | null;
  rankable: boolean;
  reasonCodes: string[];
  provenance: ScoreProvenanceView | null;
}

const isDict = (v: unknown): v is Dict => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const dictArr = (v: unknown): Dict[] => (Array.isArray(v) ? v.filter(isDict) : []);
const strMap = (v: unknown): Record<string, string> => {
  if (!isDict(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x;
  return out;
};

function reliabilityView(v: unknown): ReliabilityBreakdownView | null {
  if (!isDict(v)) return null;
  const sub = isDict(v.sub) ? v.sub : {};
  // 刻意不读 v.history：那是别项目的 InquiryItem / 项目 / 状态明细，只留在内部审计快照里
  return {
    rule: str(v.rule), score: num(v.score),
    contacted: int(v.contacted), replied: int(v.replied), selected: int(v.selected),
    sub: { responseRate: num(sub.responseRate), priorSelection: num(sub.priorSelection) },
    reasonCodes: strArr(v.reasonCodes),
  };
}

function technicalView(v: unknown): TechnicalBreakdownView | null {
  if (!isDict(v)) return null;
  return {
    rule: str(v.rule), score: num(v.score), scorableCount: int(v.scorableCount),
    items: dictArr(v.items).map((i) => ({ key: str(i.key) ?? "", category: str(i.category), verdict: str(i.verdict) ?? "", evaluatedBy: str(i.evaluatedBy), points: int(i.points), reason: str(i.reason) })),
    excluded: dictArr(v.excluded).map((i) => ({ key: str(i.key) ?? "", category: str(i.category) })),
    unmapped: dictArr(v.unmapped).map((i) => ({ key: str(i.key) ?? "", category: str(i.category) })),
    reasonCodes: strArr(v.reasonCodes),
  };
}

function commercialView(v: unknown): CommercialBreakdownView | null {
  if (!isDict(v)) return null;
  const round = isDict(v.round) ? v.round : null;
  const cand = isDict(v.candidate) ? v.candidate : null;
  const sub = isDict(v.sub) ? v.sub : {};
  const b = isDict(v.binding) ? v.binding : null;
  const pe = isDict(v.offeringPriceEvidence) ? v.offeringPriceEvidence : null;
  return {
    rule: str(v.rule), score: num(v.score), priceEvidenceTier: str(v.priceEvidenceTier) ?? "NONE",
    round: round ? { inquiryId: str(round.inquiryId) ?? "", roundNumber: int(round.roundNumber), scope: str(round.scope) } : null,
    priceBasis: str(v.priceBasis), currency: str(v.currency),
    candidate: cand ? { itemId: str(cand.itemId) ?? "", price: num(cand.price), deliveryDays: num(cand.deliveryDays), validUntil: str(cand.validUntil) } : null,
    comparableGroup: dictArr(v.comparableGroup).map((g) => ({ supplierId: str(g.supplierId) ?? "", itemId: str(g.itemId) ?? "", price: num(g.price) ?? 0, deliveryDays: num(g.deliveryDays) })),
    sub: { price: num(sub.price), delivery: int(sub.delivery), completeness: num(sub.completeness) },
    reasonCodes: strArr(v.reasonCodes),
    binding: b ? {
      inquiryId: str(b.inquiryId) ?? "", inquiryItemId: str(b.inquiryItemId) ?? "", supplierId: str(b.supplierId) ?? "", offeringId: str(b.offeringId) ?? "",
      roundNumber: int(b.roundNumber), scope: str(b.scope), confirmedByUserId: str(b.confirmedByUserId) ?? "", status: str(b.status) ?? "NONE",
    } : null,
    offeringPriceEvidence: pe ? {
      tier: str(pe.tier) ?? "NONE", listedPrice: str(pe.listedPrice), currency: str(pe.currency), priceStatus: str(pe.priceStatus),
      sourceKind: str(pe.sourceKind), sourceUrl: str(pe.sourceUrl), sourceSignalPlatform: str(pe.sourceSignalPlatform),
    } : null,
  };
}

function importRiskView(v: unknown): ImportRiskBreakdownView | null {
  if (!isDict(v)) return null;
  const sub = isDict(v.sub) ? v.sub : {};
  const off = isDict(v.offering) ? v.offering : {};
  return {
    rule: str(v.rule), score: num(v.score),
    verified: dictArr(v.verified).map((e) => ({ id: str(e.id) ?? "", type: str(e.type) ?? "", discoverySignalId: str(e.discoverySignalId), projectScope: str(e.projectScope) ?? "CURRENT_PROJECT" })),
    unverified: dictArr(v.unverified).map((e) => ({ id: str(e.id) ?? "", type: str(e.type) ?? "", evidenceStatus: str(e.evidenceStatus) ?? "", discoverySignalId: str(e.discoverySignalId) })),
    sub: { readiness: num(sub.readiness), packaging: int(sub.packaging), incoterm: int(sub.incoterm), leadTime: int(sub.leadTime) },
    offering: { incoterm: str(off.incoterm), leadTimeDays: num(off.leadTimeDays) },
    reasonCodes: strArr(v.reasonCodes),
  };
}

function contractView(v: unknown): ScoreContractView | null {
  if (!isDict(v)) return null;
  // components 是 score-contract 的聚合（每维 score / weight / status），不含任何 id
  return { version: str(v.version), components: isDict(v.components) ? v.components : {}, knownWeightShare: num(v.knownWeightShare), totalScore: num(v.totalScore), unknownComponents: strArr(v.unknownComponents) };
}

function provenanceView(v: unknown): ScoreProvenanceView | null {
  if (!isDict(v)) return null;
  // 刻意不读 v.historyItemIds 的内容，只数个数
  return {
    projectId: str(v.projectId), supplierId: str(v.supplierId), offeringId: str(v.offeringId), originSource: str(v.originSource), inquiryId: str(v.inquiryId),
    capabilityIds: strArr(v.capabilityIds),
    historicalInteractionCount: Array.isArray(v.historyItemIds) ? v.historyItemIds.length : 0,
  };
}

/**
 * 内部评分快照 → 对外读视图。输入接受任何 JSON（DB 里的 Json 列）；不是对象就返回 null。
 * 对同一份快照、任何 actor 都返回同样的结果——投影不按 actor 分叉，数据最小化是契约不是权限分支。
 */
export function toEvaluationScoreBreakdownView(internal: unknown): EvaluationScoreBreakdownView | null {
  if (!isDict(internal)) return null;
  const s = internal;
  return {
    scoreVersion: str(s.scoreVersion), recommendationContractVersion: str(s.recommendationContractVersion),
    componentRuleVersions: strMap(s.componentRuleVersions),
    computedAt: str(s.computedAt), capturedAt: str(s.capturedAt), gateResult: str(s.gateResult),
    technical: technicalView(s.technical),
    commercial: commercialView(s.commercial),
    reliability: reliabilityView(s.reliability),
    importRisk: importRiskView(s.importRisk),
    contract: contractView(s.contract),
    knownWeightShare: num(s.knownWeightShare), unknownComponents: strArr(s.unknownComponents),
    normalizedKnownScore: num(s.normalizedKnownScore), officialTotalScore: num(s.officialTotalScore),
    recommendation: str(s.recommendation), rankable: s.rankable === true, reasonCodes: strArr(s.reasonCodes),
    provenance: provenanceView(s.provenance),
  };
}
