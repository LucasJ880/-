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
