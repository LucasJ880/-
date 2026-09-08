/**
 * T8（目录 fail-closed）+ 状态机矩阵（B.1 §7）+ 需求快照三值（§10）+ flag 组合语义
 */
import assert from "node:assert/strict";
import {
  CAPABILITY_TYPES,
  CERTIFICATION_TRANSITIONS,
  CERTIFICATION_TYPES,
  RUN_STATUSES,
  RUN_TERMINAL_STATUSES,
  RUN_TRANSITIONS,
  SIGNAL_TRANSITIONS,
  SOCIAL_WRITE_EVIDENCE_STATUSES,
  canTransitionRun,
  isRunTerminal,
  resolveRegistryProvider,
} from "../constants";
import { isSupplierIntelError } from "../errors";
import {
  describeSupplierIntelFlags,
  isSupplierIntelEnabledForOrgWithEnv,
  isSupplierIntelEnabledWithEnv,
} from "../flags";
import {
  collapseMandatoryForMatch,
  isRequirementMandatoryForGate,
  validateRequirementSnapshot,
} from "../requirement-snapshot";

function expectCode(code: string, fn: () => unknown) {
  try {
    fn();
    assert.fail(`期望抛 ${code}，实际成功`);
  } catch (e) {
    if (!isSupplierIntelError(e, code as never)) throw e;
  }
}

async function main() {
  console.log("Run 状态机：转移矩阵 + 终态不可重入");
  assert.ok(canTransitionRun("PLANNED", "RUNNING"));
  assert.ok(canTransitionRun("PLANNED", "CANCELLED"));
  assert.ok(canTransitionRun("RUNNING", "COMPLETED"));
  assert.ok(canTransitionRun("RUNNING", "FAILED"));
  assert.ok(canTransitionRun("RUNNING", "CANCELLED"));
  assert.ok(!canTransitionRun("PLANNED", "COMPLETED"));
  for (const terminal of RUN_TERMINAL_STATUSES) {
    assert.ok(isRunTerminal(terminal));
    for (const to of RUN_STATUSES) {
      assert.ok(!canTransitionRun(terminal, to), `${terminal} → ${to} 必须被拒`);
    }
    assert.equal(RUN_TRANSITIONS[terminal].length, 0);
  }

  console.log("信号状态机：LINKED/REJECTED 终态");
  assert.equal(SIGNAL_TRANSITIONS.LINKED.length, 0);
  assert.equal(SIGNAL_TRANSITIONS.REJECTED.length, 0);
  assert.ok(SIGNAL_TRANSITIONS.NEW.includes("REVIEWED"));

  console.log("认证状态机：VERIFIED 只能从 CLAIMED 来；终态封闭；无回环");
  assert.deepEqual([...CERTIFICATION_TRANSITIONS.CLAIMED], ["VERIFIED", "REJECTED"]);
  assert.deepEqual([...CERTIFICATION_TRANSITIONS.VERIFIED], ["EXPIRED", "REJECTED"]);
  assert.equal(CERTIFICATION_TRANSITIONS.REJECTED.length, 0);
  assert.equal(CERTIFICATION_TRANSITIONS.EXPIRED.length, 0);

  console.log("信任边界：social 写路径值域不含 VERIFIED");
  assert.ok(!(SOCIAL_WRITE_EVIDENCE_STATUSES as readonly string[]).includes("VERIFIED"));

  console.log("目录 fail-closed：capability / certification 目录含起始集");
  for (const t of ["CNC_CAPABILITY", "CANADA_EXPORT", "OEM_SUPPORT", "CERTIFICATION"]) {
    assert.ok((CAPABILITY_TYPES as readonly string[]).includes(t), `capability 目录缺 ${t}`);
  }
  for (const t of ["UL", "ETL", "CSA", "BIFMA", "GREENGUARD", "OTHER"]) {
    assert.ok((CERTIFICATION_TYPES as readonly string[]).includes(t), `certification 目录缺 ${t}`);
  }

  console.log("需求快照：三值 mandatory 严格校验（§10）");
  const entries = validateRequirementSnapshot([
    { id: "1", code: "R-1", text: "must have UL", category: "MANDATORY", mandatory: true, mandatorySignal: "must" },
    { id: "2", code: "R-2", text: "nice to have", category: null, mandatory: false, mandatorySignal: null },
    { id: "3", code: "R-3", text: "unclear", category: "OTHER", mandatory: "uncertain", mandatorySignal: null },
  ]);
  assert.equal(entries[2].mandatory, "uncertain");
  assert.ok(isRequirementMandatoryForGate(entries[0]));
  assert.ok(!isRequirementMandatoryForGate(entries[1]));
  assert.ok(isRequirementMandatoryForGate(entries[2]), "uncertain 必须按 mandatory 处理（fail-closed）");
  assert.deepEqual(collapseMandatoryForMatch(entries[2]), { mandatory: true, mandatoryUncertain: true });
  assert.deepEqual(collapseMandatoryForMatch(entries[1]), { mandatory: false, mandatoryUncertain: false });
  expectCode("INVALID_REQUIREMENT_SNAPSHOT", () =>
    validateRequirementSnapshot([{ id: "1", code: "R-1", text: "x", mandatory: "true" }]));
  expectCode("INVALID_REQUIREMENT_SNAPSHOT", () =>
    validateRequirementSnapshot([
      { id: "1", code: "R-1", text: "x", mandatory: true, mandatorySignal: null },
      { id: "2", code: "R-1", text: "dup", mandatory: false, mandatorySignal: null },
    ]));
  expectCode("INVALID_REQUIREMENT_SNAPSHOT", () => validateRequirementSnapshot("not-array"));

  console.log("F1.6 registry fail-closed：只认白名单官方登记库（https），任意 URL 标 REGISTRY 无效");
  assert.equal(resolveRegistryProvider("https://www.gsxt.gov.cn/corp-query-xyz")?.id, "GSXT");
  assert.equal(resolveRegistryProvider("https://productiq.ul.com/database/xxx")?.id, "UL_PRODUCT_IQ");
  assert.equal(resolveRegistryProvider("https://www.ul.com/about"), null, "宽域企业页不算登记库（F4 语义对抗项）");
  assert.equal(resolveRegistryProvider("https://some-random-site.example/cert"), null);
  // §43 收窄核实（S2）：Intertek/CSA=宽域稳定路径契约；BIFMA=专用主机
  assert.equal(resolveRegistryProvider("https://www.intertek.com/directories/etl-listed-mark/")?.id, "INTERTEK_DIRECTORY");
  assert.equal(resolveRegistryProvider("https://www.intertek.com/about-us/"), null, "Intertek 一般企业页不算登记库");
  assert.equal(resolveRegistryProvider("https://www.csagroup.org/testing-certification/product-listing/")?.id, "CSA_GROUP");
  assert.equal(resolveRegistryProvider("https://www.csagroup.org/news/"), null, "CSA 一般企业页不算登记库");
  assert.equal(resolveRegistryProvider("https://compliant.bifma.org/products/123")?.id, "BIFMA_REGISTRY");
  assert.equal(resolveRegistryProvider("https://level.bifma.org/x")?.id, "BIFMA_REGISTRY");
  assert.equal(resolveRegistryProvider("https://www.bifma.org/mpage/bifmacompliantregistry"), null, "BIFMA 宽域弃用（专用主机才算）");

  // B1/B3 结构守卫（S2 Final Remediation BL-3）：改用 TypeScript AST 检查真实函数签名 /
  // 输入结构 / 调用顺序（不再靠注释或 import 首次出现切片、不再靠字符串存在性、不再让 indexOf=-1 制造假阳性）
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { checkCanonicalRequirementBoundary, violationCodes } = await import("./canonical-boundary-guard");
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");
  const real = checkCanonicalRequirementBoundary({
    runsRoute: read("src/app/api/supplier-intel/runs/route.ts"),
    projectRunService: read("src/lib/supplier-intel/project-run-service.ts"),
    discoveryService: read("src/lib/supplier-intel/discovery-service.ts"),
    resolveRoute: read("src/app/api/supplier-intel/signals/[id]/resolve/route.ts"),
  });
  assert.deepEqual(
    violationCodes(real),
    [],
    `B1/B3 边界违规：${JSON.stringify(real, null, 2)}`,
  );

  console.log("BL-3 负向有效性：对故意违规的 fixture，同一守卫必须报出对应违规（证明断言非空）");
  const fixture = (name: string) =>
    read(`src/lib/supplier-intel/__tests__/fixtures/canonical-boundary-negative/${name}`);
  const negative = checkCanonicalRequirementBoundary({
    runsRoute: fixture("runs-route.bad.ts.txt"),
    projectRunService: fixture("project-run-service.bad.ts.txt"),
    discoveryService: fixture("discovery-service.bad.ts.txt"),
    resolveRoute: fixture("resolve-route.bad.ts.txt"),
  });
  const negCodes = violationCodes(negative);
  for (const expected of [
    "HINTS_HAS_REQUIREMENTS",
    "CREATE_INPUT_HAS_REQUIREMENTS",
    "ORDER_ACL_AFTER_CANONICAL",
    "SNAPSHOT_NOT_FROM_CANONICAL",
    "ROUTE_READS_BODY_REQUIREMENTS",
    "ROUTE_PASSES_UNKNOWN_KEY:requirements",
    "ROUTE_MISSING_WRITE_GATE",
    "ORDER_ACL_AFTER_PLAN",
    "ORDER_ACL_AFTER_EGRESS",
    "RESOLVE_ROUTE_USES_PAGINATION_INJECTION",
    "RESOLVE_ROUTE_MISSING_CANONICAL_CALL",
  ]) {
    assert.ok(negCodes.includes(expected), `负向 fixture 应报 ${expected}，实际：${negCodes.join(", ")}`);
  }
  // 负向 fixture 里的每个文件都至少触发一条违规（守卫对四个面都不是空断言）
  assert.ok(negCodes.some((c) => c.startsWith("HINTS_") || c.startsWith("CREATE_") || c.startsWith("SNAPSHOT_")), "project-run-service 面");
  assert.ok(negCodes.some((c) => c.startsWith("ROUTE_")), "runs route 面");
  assert.ok(negCodes.some((c) => c.startsWith("ORDER_ACL_AFTER_PLAN")), "discovery-service 面");
  assert.ok(negCodes.some((c) => c.startsWith("RESOLVE_ROUTE_")), "resolve route 面");
  assert.equal(resolveRegistryProvider("http://www.gsxt.gov.cn/x"), null, "非 https 不认");
  assert.equal(resolveRegistryProvider("https://gsxt.gov.cn.evil.com/x"), null, "host 仿冒不认");
  assert.equal(resolveRegistryProvider(""), null);
  assert.equal(resolveRegistryProvider("not a url"), null);

  console.log("flag 组合语义：default OFF；主开关关→allowlist 无效；allowlist 收窄");
  assert.equal(isSupplierIntelEnabledWithEnv({}), false);
  assert.equal(isSupplierIntelEnabledForOrgWithEnv("org1", { SUPPLIER_INTEL_ORG_ALLOWLIST: "org1" }), false);
  assert.equal(isSupplierIntelEnabledWithEnv({ SUPPLIER_INTEL_ENABLED: "1" }), true);
  assert.equal(isSupplierIntelEnabledForOrgWithEnv("org1", { SUPPLIER_INTEL_ENABLED: "1" }), true);
  assert.equal(
    isSupplierIntelEnabledForOrgWithEnv("org2", { SUPPLIER_INTEL_ENABLED: "1", SUPPLIER_INTEL_ORG_ALLOWLIST: "org1, org3" }),
    false,
  );
  assert.equal(
    isSupplierIntelEnabledForOrgWithEnv("org3", { SUPPLIER_INTEL_ENABLED: "1", SUPPLIER_INTEL_ORG_ALLOWLIST: "org1, org3" }),
    true,
  );
  const described = describeSupplierIntelFlags({ SUPPLIER_INTEL_ENABLED: "1", SUPPLIER_INTEL_ORG_ALLOWLIST: "a,b" });
  assert.deepEqual(described, { SUPPLIER_INTEL_ENABLED: true, SUPPLIER_INTEL_ORG_ALLOWLIST: ["a", "b"] });

  console.log("\ngovernance T8/状态机/快照/flag 全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
