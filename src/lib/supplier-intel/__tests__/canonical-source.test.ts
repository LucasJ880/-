/**
 * R2（S2 Trust-Boundary Closure）：canonical uncertain 来源的四级判定——CI 可执行纯逻辑。
 *
 * 覆盖 R2-T1/T2/T3/T4/T5（T6/T7 的「阻断点位于 Run/LLM/provider 之前」「客户端声明不解除阻断」
 * 在 supplier-intel-s2tb-db.isolated.test.ts 的真实服务 + HTTP 面验证）。
 *
 * 正常路径夹具来自**真实 writer**（deriveRisks → v2-map 形状），不是手写的「看起来合理」对象。
 *
 * 注意：只给 Prisma 一个永不连接的占位 URL，零数据库副作用。
 */
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://ci:ci@127.0.0.1:5432/ci?schema=public";
process.env.DIRECT_URL ??= process.env.DATABASE_URL;

async function main() {
  const { classifyUncertainRequirementSource, MANDATORY_UNCERTAIN_LIST_CAP } = await import(
    "../canonical-requirements"
  );
  const { buildCanonicalRisksStructuredJson, uncertainAggregateOf } = await import(
    "./fixtures/canonical-risks-writer"
  );

  console.log("R2-T3/T4：真实 writer 产出的有效来源——三值准确保留，合法 false 不被升级也不被全体阻断");
  const mixed = buildCanonicalRisksStructuredJson([
    { code: "R-001", mandatory: true },
    { code: "R-002", mandatory: true },
    { code: "R-003", mandatory: false },
    { code: "R-004", mandatory: "uncertain" },
    { code: "R-005", mandatory: "uncertain" },
  ]);
  const aggregate = uncertainAggregateOf(mixed);
  assert.ok(aggregate, "真实 writer 在 uncertain>0 时必产 MANDATORY_UNCERTAIN 聚合");
  const mixedSource = classifyUncertainRequirementSource({ structuredJson: mixed });
  assert.equal(mixedSource.status, "VALID", mixedSource.detail);
  assert.deepEqual([...mixedSource.uncertainIds].sort(), ["R-004", "R-005"], "uncertain 集合逐条保留");
  assert.equal(mixedSource.reasonCode, "UNCERTAIN_LIST_COMPLETE");

  console.log("R2-T3：真实 writer 的「完整且零 uncertain」分析正常读取（有效空集合 ≠ 无效来源）");
  const zeroUncertain = buildCanonicalRisksStructuredJson([
    { code: "R-001", mandatory: true },
    { code: "R-002", mandatory: false },
    { code: "R-003", mandatory: false },
  ]);
  assert.equal(uncertainAggregateOf(zeroUncertain), null, "零 uncertain 时 writer 不产聚合");
  const zeroSource = classifyUncertainRequirementSource({ structuredJson: zeroUncertain });
  assert.equal(zeroSource.status, "VALID", zeroSource.detail);
  assert.deepEqual(zeroSource.uncertainIds, []);
  assert.equal(zeroSource.reasonCode, "NO_UNCERTAIN_AGGREGATE");
  assert.ok(
    (zeroUncertain.risks as unknown[]).length > 0,
    "该夹具确有其它风险条目——证明「有效空集合」不是靠 risks 为空蒙混",
  );

  console.log("R2-T1：Boolean=false 需求存在但 RISKS 缺失 → MISSING（绝不静默当作零 uncertain）");
  assert.equal(classifyUncertainRequirementSource(null).status, "MISSING");
  assert.equal(classifyUncertainRequirementSource(undefined).status, "MISSING");
  assert.equal(classifyUncertainRequirementSource(null).reasonCode, "RISKS_SECTION_MISSING");
  assert.equal(
    classifyUncertainRequirementSource({ structuredJson: null }).reasonCode,
    "STRUCTURED_JSON_NULL",
  );

  console.log("R2-T2：结构非法一律 MALFORMED（逐条列出，不折叠成 []）");
  const malformed: Array<[string, unknown, string]> = [
    ["structuredJson 是数组", [], "STRUCTURED_JSON_NOT_OBJECT"],
    ["structuredJson 是字符串", "risks", "STRUCTURED_JSON_NOT_OBJECT"],
    ["legacy report.ts 形状（无 risks 数组）", { kind: "risks", inventedHistoricalAwards: false }, "RISKS_NOT_ARRAY"],
    ["risks 不是数组", { risks: { a: 1 } }, "RISKS_NOT_ARRAY"],
    [
      "workforce risks/v1 形状（带 version）",
      { version: "tender-workforce-risks/v1", risks: [{ statement: "x" }] },
      "NON_CANONICAL_WRITER_SHAPE",
    ],
    [
      "risks 条目非 canonical（缺 severity/description）",
      { risks: [{ id: "RISK-001", reasonCode: "MANDATORY_UNCERTAIN", relatedRequirementIds: ["R-1"] }] },
      "RISK_ENTRY_NOT_CANONICAL",
    ],
    [
      "聚合缺 relatedRequirementIds",
      { risks: [{ severity: "IMPORTANT", description: "d", reasonCode: "MANDATORY_UNCERTAIN" }] },
      "RELATED_IDS_NOT_ARRAY",
    ],
    [
      "relatedRequirementIds 不是数组",
      { risks: [{ severity: "IMPORTANT", description: "d", reasonCode: "MANDATORY_UNCERTAIN", relatedRequirementIds: "R-1" }] },
      "RELATED_IDS_NOT_ARRAY",
    ],
    [
      "关联 id 含非字符串成员（不过滤非法成员）",
      { risks: [{ severity: "IMPORTANT", description: "d", reasonCode: "MANDATORY_UNCERTAIN", relatedRequirementIds: ["R-1", 7] }] },
      "RELATED_IDS_MEMBER_INVALID",
    ],
    [
      "关联 id 含空字符串",
      { risks: [{ severity: "IMPORTANT", description: "d", reasonCode: "MANDATORY_UNCERTAIN", relatedRequirementIds: ["R-1", "  "] }] },
      "RELATED_IDS_MEMBER_INVALID",
    ],
    [
      "聚合存在但关联 id 为空（与 writer 契约矛盾）",
      { risks: [{ severity: "IMPORTANT", description: "d", reasonCode: "MANDATORY_UNCERTAIN", relatedRequirementIds: [] }] },
      "EMPTY_UNCERTAIN_AGGREGATE",
    ],
  ];
  for (const [name, sj, code] of malformed) {
    const got = classifyUncertainRequirementSource({ structuredJson: sj });
    assert.equal(got.status, "MALFORMED", `${name} 应判 MALFORMED，实际 ${got.status}`);
    assert.equal(got.reasonCode, code, `${name} 的 reasonCode`);
    assert.deepEqual(got.uncertainIds, [], `${name} 不得返回可用 id`);
  }

  console.log("R2-T5：截断边界仍拒绝；多条聚合不取第一条；去重不得用来缩短长度");
  const risk = (ids: string[]) => ({
    severity: "IMPORTANT",
    description: "d",
    reasonCode: "MANDATORY_UNCERTAIN",
    relatedRequirementIds: ids,
  });
  const capIds = Array.from({ length: MANDATORY_UNCERTAIN_LIST_CAP }, (_, i) => `R-${i + 1}`);
  const atCap = classifyUncertainRequirementSource({ structuredJson: { risks: [risk(capIds)] } });
  assert.equal(atCap.status, "POSSIBLY_TRUNCATED");
  assert.equal(atCap.reasonCode, "UNCERTAIN_LIST_AT_CAP");

  const underCap = capIds.slice(0, MANDATORY_UNCERTAIN_LIST_CAP - 1);
  const below = classifyUncertainRequirementSource({ structuredJson: { risks: [risk(underCap)] } });
  assert.equal(below.status, "VALID", below.detail);
  assert.equal(below.uncertainIds.length, MANDATORY_UNCERTAIN_LIST_CAP - 1);

  // 12 个成员但只有 6 个不同值：先去重就会掉到封顶以下 → 必须仍判截断
  const dupIds = Array.from({ length: MANDATORY_UNCERTAIN_LIST_CAP }, (_, i) => `R-${(i % 6) + 1}`);
  assert.equal(new Set(dupIds).size, 6, "夹具前提：去重后长度远低于封顶");
  const dup = classifyUncertainRequirementSource({ structuredJson: { risks: [risk(dupIds)] } });
  assert.equal(dup.status, "POSSIBLY_TRUNCATED", "去重不得用来把截断藏起来");

  const multi = classifyUncertainRequirementSource({
    structuredJson: { risks: [risk(["R-1"]), risk(["R-2", "R-3"])] },
  });
  assert.equal(multi.status, "MALFORMED");
  assert.equal(multi.reasonCode, "MULTIPLE_UNCERTAIN_AGGREGATES", "多条相关记录不取第一条");

  console.log("真实 writer 的封顶行为与本判定一致：13 条 uncertain → writer .slice(0,12) → 判截断");
  const thirteen = buildCanonicalRisksStructuredJson(
    Array.from({ length: 13 }, (_, i) => ({ code: `R-${String(i + 1).padStart(3, "0")}`, mandatory: "uncertain" as const })),
  );
  const agg13 = uncertainAggregateOf(thirteen);
  assert.equal(agg13?.relatedRequirementIds.length, MANDATORY_UNCERTAIN_LIST_CAP, "writer 封顶 12");
  assert.equal(
    classifyUncertainRequirementSource({ structuredJson: thirteen }).status,
    "POSSIBLY_TRUNCATED",
  );

  console.log("\ncanonical-source（R2 来源判定）全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
