/**
 * BL-2（S2 Final Remediation）：身份宇宙扫描完整性贯穿全部解析分支 + 持久快照契约（纯核）
 *
 * 表驱动：六类解析分支 × {完整, 不完整} ——
 *   完整：保留既有有效行为（MATCHED / 冲突 NEEDS / 归一名 0.72 / 模糊 0.55 / NEW）；
 *   不完整：一律 NEEDS_HUMAN_REVIEW + supplierId=undefined + IDENTITY_SCAN_INCOMPLETE，
 *          且已发现的强键命中 / F1 冲突元数据 / 候选证据不因新增标记而丢失。
 * 另：历史 resolutionJson 条目缺 scan 字段 → recorded:false（不默认 COMPLETE）。
 */
import assert from "node:assert/strict";
import {
  IDENTITY_SCAN_INCOMPLETE,
  IDENTITY_SCAN_PAGINATION,
  identityScanStatusOf,
  inMemoryIdentityScanStatus,
  readIdentityScanFromResolutionEntry,
  resolveSupplierEntityPure,
  type ExtractedEntityHints,
  type IdentityScanStatus,
  type PriorLinkedIdentities,
  type SupplierRowForResolution,
} from "../entity-resolution";

const suppliers: SupplierRowForResolution[] = [
  { id: "sup_a", name: "佛山市XX家具有限公司", website: "https://xxfurniture.cn", contactPhone: "13800138000" },
  { id: "sup_b", name: "东莞YY金属制品厂", website: "https://yy-metal.example", contactPhone: null },
  { id: "sup_c", name: "深圳ZZ电子有限公司", website: null, contactPhone: null },
];

const emptyHints: ExtractedEntityHints = {
  companyNameCandidates: [],
  unifiedSocialCreditCode: null,
  phones: [],
  observedWebDomains: [],
  platformAccounts: [],
};

const paging = { pageSize: 500, maxPages: 40 };
const pass = (complete: boolean, rows: number) =>
  complete
    ? { complete: true, pages: 1, rows, capped: false }
    : { complete: false, pages: 40, rows, capped: true };

const COMPLETE = identityScanStatusOf(pass(true, 3), pass(true, 4), paging);
const SUPPLIERS_INCOMPLETE = identityScanStatusOf(pass(false, 20000), pass(true, 4), paging);
const LINKED_INCOMPLETE = identityScanStatusOf(pass(true, 3), pass(false, 20000), paging);
const BOTH_INCOMPLETE = identityScanStatusOf(pass(false, 20000), pass(false, 20000), paging);

interface Scenario {
  name: string;
  hints: ExtractedEntityHints;
  prior: PriorLinkedIdentities;
  /** 完整扫描下的既有有效行为 */
  complete: {
    decision: string;
    supplierId: string | undefined;
    confidence: number;
    conflictIncludes?: string[];
    matchedKinds?: string[];
  };
  /** 不完整扫描下仍必须保留的证据 */
  preserved: { matchedKinds: string[]; conflictIncludes: string[] };
}

const scenarios: Scenario[] = [
  {
    name: "单一强身份命中（官网域名）",
    hints: { ...emptyHints, observedWebDomains: ["xxfurniture.cn"] },
    prior: { ownedDomains: new Map(), platformAccounts: new Map() },
    complete: { decision: "MATCHED_EXISTING", supplierId: "sup_a", confidence: 0.92, matchedKinds: ["supplier_owned_domain"] },
    preserved: { matchedKinds: ["supplier_owned_domain"], conflictIncludes: [] },
  },
  {
    name: "同一强身份关联多个供应商（F1 冲突）",
    hints: { ...emptyHints, platformAccounts: [{ platform: "DOUYIN", accountKey: "DOUYIN:user:shared" }] },
    prior: { ownedDomains: new Map(), platformAccounts: new Map([["DOUYIN:user:shared", new Set(["sup_b", "sup_a"])]]) },
    complete: {
      decision: "NEEDS_HUMAN_REVIEW",
      supplierId: undefined,
      confidence: 0.6,
      conflictIncludes: ["强身份冲突", "supplierIds=[sup_a,sup_b]", "不得自动挑选"],
      matchedKinds: ["platform_account"],
    },
    preserved: { matchedKinds: ["platform_account"], conflictIncludes: ["强身份冲突", "supplierIds=[sup_a,sup_b]"] },
  },
  {
    name: "跨强身份键分裂（域名→A，账号→B）",
    hints: {
      ...emptyHints,
      observedWebDomains: ["yy-metal.example"],
      platformAccounts: [{ platform: "DOUYIN", accountKey: "DOUYIN:user:acc_a" }],
    },
    prior: { ownedDomains: new Map(), platformAccounts: new Map([["DOUYIN:user:acc_a", new Set(["sup_a"])]]) },
    complete: {
      decision: "NEEDS_HUMAN_REVIEW",
      supplierId: undefined,
      confidence: 0.6,
      conflictIncludes: ["不得自动挑选"],
      matchedKinds: ["supplier_owned_domain", "platform_account"],
    },
    preserved: { matchedKinds: ["supplier_owned_domain", "platform_account"], conflictIncludes: [] },
  },
  {
    name: "名称等值（非强键）",
    hints: { ...emptyHints, companyNameCandidates: ["东莞YY金属制品厂"] },
    prior: { ownedDomains: new Map(), platformAccounts: new Map() },
    complete: { decision: "NEEDS_HUMAN_REVIEW", supplierId: "sup_b", confidence: 0.72, matchedKinds: ["normalized_name"] },
    preserved: { matchedKinds: ["normalized_name"], conflictIncludes: [] },
  },
  {
    name: "模糊候选",
    hints: { ...emptyHints, companyNameCandidates: ["XX家具源头工厂"] },
    prior: { ownedDomains: new Map(), platformAccounts: new Map() },
    complete: { decision: "NEEDS_HUMAN_REVIEW", supplierId: "sup_a", confidence: 0.55, matchedKinds: ["fuzzy_name"] },
    preserved: { matchedKinds: ["fuzzy_name"], conflictIncludes: [] },
  },
  {
    name: "无匹配线索",
    hints: { ...emptyHints, companyNameCandidates: ["毫不相关的词条组合体"] },
    prior: { ownedDomains: new Map(), platformAccounts: new Map() },
    complete: { decision: "NEW_SUPPLIER_CANDIDATE", supplierId: undefined, confidence: 0.2, matchedKinds: [] },
    preserved: { matchedKinds: [], conflictIncludes: [] },
  },
];

function kinds(r: { matchedSources: Array<{ kind: string }> }): string[] {
  return [...new Set(r.matchedSources.map((m) => m.kind))].sort();
}

function assertIncompleteContract(name: string, scan: IdentityScanStatus, sc: Scenario) {
  const r = resolveSupplierEntityPure(sc.hints, suppliers, sc.prior, { scan });
  assert.equal(r.decision, "NEEDS_HUMAN_REVIEW", `${name}: 不完整扫描必须转人工`);
  assert.equal(r.supplierId, undefined, `${name}: 不完整扫描不得给出 supplierId`);
  assert.equal(r.legalName, undefined, `${name}: 不完整扫描不得给出 legalName`);
  assert.ok(r.confidence < 0.9, `${name}: 不完整扫描不得高置信`);
  assert.deepEqual(r.scan, scan, `${name}: 返回结果携带与输入一致的扫描状态`);
  assert.equal(r.scan.complete, false);
  assert.equal(r.scan.reasonCode, IDENTITY_SCAN_INCOMPLETE);
  assert.ok(
    r.conflicts.some((c) => c.startsWith(`${IDENTITY_SCAN_INCOMPLETE}：`)),
    `${name}: conflicts 必须显式记录 IDENTITY_SCAN_INCOMPLETE：${JSON.stringify(r.conflicts)}`,
  );
  const suppliersWord = scan.suppliers.complete ? "suppliers=complete" : "suppliers=incomplete";
  const linkedWord = scan.linkedHistory.complete ? "linkedHistory=complete" : "linkedHistory=incomplete";
  assert.ok(
    r.conflicts.some((c) => c.includes(suppliersWord) && c.includes(linkedWord)),
    `${name}: 标记须分别说明两类扫描状态`,
  );
  // 证据保留：强键命中 / 冲突元数据 / 候选不因新增标记而丢失
  for (const k of sc.preserved.matchedKinds) {
    assert.ok(kinds(r).includes(k), `${name}: 不完整扫描仍保留命中证据 kind=${k}：${kinds(r)}`);
  }
  for (const frag of sc.preserved.conflictIncludes) {
    assert.ok(r.conflicts.some((c) => c.includes(frag)), `${name}: 不完整扫描仍保留冲突元数据「${frag}」`);
  }
  if (sc.complete.decision === "NEW_SUPPLIER_CANDIDATE") {
    assert.notEqual(r.decision, "NEW_SUPPLIER_CANDIDATE", `${name}: 不完整扫描不得显示为「已确认 NEW」`);
  }
}

async function main() {
  console.log("BL-2 表驱动：六类分支 × 完整扫描 = 既有有效行为不变");
  for (const sc of scenarios) {
    const r = resolveSupplierEntityPure(sc.hints, suppliers, sc.prior, { scan: COMPLETE });
    assert.equal(r.decision, sc.complete.decision, `${sc.name}: decision`);
    assert.equal(r.supplierId, sc.complete.supplierId, `${sc.name}: supplierId`);
    assert.equal(r.confidence, sc.complete.confidence, `${sc.name}: confidence`);
    assert.deepEqual(r.scan, COMPLETE, `${sc.name}: 完整扫描状态原样携带`);
    assert.equal(r.scan.reasonCode, null);
    assert.ok(!r.conflicts.some((c) => c.includes(IDENTITY_SCAN_INCOMPLETE)), `${sc.name}: 完整扫描不得出现 INCOMPLETE 标记`);
    if (sc.complete.matchedKinds) assert.deepEqual(kinds(r), [...sc.complete.matchedKinds].sort(), `${sc.name}: matched kinds`);
    for (const frag of sc.complete.conflictIncludes ?? []) {
      assert.ok(r.conflicts.some((c) => c.includes(frag)), `${sc.name}: 冲突元数据「${frag}」`);
    }
    console.log(`  ✓ ${sc.name}`);
  }

  console.log("BL-2 表驱动：六类分支 × {供应商扫描触顶 / LINKED 史触顶 / 双触顶} = 统一转人工 + 证据保留");
  for (const sc of scenarios) {
    assertIncompleteContract(`${sc.name}（供应商扫描触顶，LINKED 史完整）`, SUPPLIERS_INCOMPLETE, sc);
    assertIncompleteContract(`${sc.name}（LINKED 史触顶，供应商扫描完整）`, LINKED_INCOMPLETE, sc);
    assertIncompleteContract(`${sc.name}（双触顶）`, BOTH_INCOMPLETE, sc);
    console.log(`  ✓ ${sc.name}`);
  }

  console.log("BL-2：纯核省略 scan = 内存全集按构造完整，rows 如实取自传入集合（不伪造覆盖率）");
  const defaults = resolveSupplierEntityPure(scenarios[0].hints, suppliers, scenarios[1].prior);
  assert.equal(defaults.scan.complete, true);
  assert.equal(defaults.scan.suppliers.rows, suppliers.length);
  assert.equal(defaults.scan.linkedHistory.rows, 2, "prior 中两条 LINKED 身份关联");
  assert.equal(defaults.scan.pageSize, IDENTITY_SCAN_PAGINATION.PAGE_SIZE);
  assert.equal(defaults.scan.maxPages, IDENTITY_SCAN_PAGINATION.MAX_PAGES);
  assert.deepEqual(inMemoryIdentityScanStatus({ suppliers: 3, linkedHistory: 2 }).reasonCode, null);

  console.log("BL-2：identityScanStatusOf 语义——任一类不完整即整体不完整，reasonCode 固定");
  assert.equal(SUPPLIERS_INCOMPLETE.complete, false);
  assert.equal(LINKED_INCOMPLETE.complete, false);
  assert.equal(COMPLETE.complete, true);
  assert.equal(SUPPLIERS_INCOMPLETE.reasonCode, IDENTITY_SCAN_INCOMPLETE);
  assert.equal(COMPLETE.reasonCode, null);

  console.log("BL-2：历史条目缺 scan 字段 → recorded:false（不默认 COMPLETE；不回填）");
  const legacyEntry = { phase: "AUTO_PREFILL", result: { decision: "MATCHED_EXISTING" }, hints: {}, at: "2026-09-01T00:00:00.000Z" };
  assert.deepEqual(readIdentityScanFromResolutionEntry(legacyEntry), { recorded: false, reason: "MISSING" });
  assert.deepEqual(readIdentityScanFromResolutionEntry(null), { recorded: false, reason: "MISSING" });
  assert.deepEqual(readIdentityScanFromResolutionEntry({ scan: "complete" }), { recorded: false, reason: "MALFORMED" });
  assert.deepEqual(readIdentityScanFromResolutionEntry({ scan: { complete: true } }), { recorded: false, reason: "MALFORMED" });
  const recorded = readIdentityScanFromResolutionEntry({ phase: "AUTO_PREFILL", scan: SUPPLIERS_INCOMPLETE });
  assert.equal(recorded.recorded, true);
  if (recorded.recorded) assert.deepEqual(recorded.scan, SUPPLIERS_INCOMPLETE);

  console.log("\nidentity-scan（BL-2 纯核）全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
