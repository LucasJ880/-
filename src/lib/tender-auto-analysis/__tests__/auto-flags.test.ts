/**
 * Phase D — 自动包分析编排开关（纯函数）
 * 运行：npx tsx src/lib/tender-auto-analysis/__tests__/auto-flags.test.ts
 */

import { isTenderAutoPackageAnalysisEnabledWithEnv } from "../auto-flags";

let pass = 0;
let fail = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("tender-auto-analysis auto-flags");

// 默认（无 env）→ OFF：保证合入 main 不改变生产行为
{
  ok(
    isTenderAutoPackageAnalysisEnabledWithEnv({}, {}) === false,
    "无 env → OFF（生产默认安全关闭）",
  );
}

// 各种真值
for (const v of ["1", "true", "on", "yes", "TRUE", "On"]) {
  ok(
    isTenderAutoPackageAnalysisEnabledWithEnv(
      {},
      { TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED: v },
    ) === true,
    `TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED=${v} → ON`,
  );
}

// 假值
for (const v of ["0", "false", "off", "", "no"]) {
  ok(
    isTenderAutoPackageAnalysisEnabledWithEnv(
      {},
      { TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED: v },
    ) === false,
    `=${v || "(空)"} → OFF`,
  );
}

// org allowlist：非空时未命中即拒绝
{
  const env = {
    TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED: "1",
    TENDER_AUTO_PACKAGE_ANALYSIS_ORG_ALLOWLIST: "org_a, org_b",
  };
  ok(
    isTenderAutoPackageAnalysisEnabledWithEnv({ orgId: "org_a" }, env) === true,
    "allowlist 命中 → ON",
  );
  ok(
    isTenderAutoPackageAnalysisEnabledWithEnv({ orgId: "org_x" }, env) === false,
    "allowlist 未命中 → OFF",
  );
  ok(
    isTenderAutoPackageAnalysisEnabledWithEnv({ orgId: null }, env) === false,
    "allowlist 非空但无 orgId → OFF",
  );
}

// allowlist 空 → 不额外限制
{
  const env = {
    TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED: "1",
    TENDER_AUTO_PACKAGE_ANALYSIS_ORG_ALLOWLIST: "",
  };
  ok(
    isTenderAutoPackageAnalysisEnabledWithEnv({ orgId: "anything" }, env) === true,
    "allowlist 空 → 任意 org 通过",
  );
}

console.log(`\nauto-flags: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
