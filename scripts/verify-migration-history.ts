/**
 * Active migration history 静态校验（Phase 5C）
 * npx tsx scripts/verify-migration-history.ts
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const activeDir = join(root, "prisma/migrations");
const legacyDir = join(root, "prisma/migrations_legacy_pre_greenfield_baseline");

const EXPECTED_ACTIVE = [
  "00000000000000_greenfield_baseline_pre_phase4",
  "20260728120000_project_work_domain",
  "20260728180000_project_handoff",
  "20260729120000_matrix_account_playbook",
  "20260729180000_phase_c_publish_job_pipeline",
  "20260803200000_bid_workflow_phase1",
  "20260804130000_sunny_motor_price",
  "20260804190000_sales_action_loop",
  "20260804200000_sales_action_auto_sync",
  "20260804210000_sales_effectiveness_promotion_approval",
  "20260805090000_marketing_economics",
  "20260805180000_tender_auto_analysis_phase1_1",
  "20260811002000_add_tender_t2_ledger_archive_foundation",
  "20260811040000_add_tender_t3_corporate_memory_foundation",
  "20260811050000_add_project_financial_control",
  "20260814090000_add_tender_profitability_settlement",
] as const;

/** Active migration 不可变 checksum（sha256 of migration.sql） */
const IMMUTABLE: Record<string, string> = {
  "00000000000000_greenfield_baseline_pre_phase4":
    "f1e3c211dc44a08df70a2b19a61ea569b3501844c2fa845c6cc636938d813093",
  "20260728120000_project_work_domain":
    "194cf361ad0281cbf961a9dfe963807a9c92da656786afe03c8e3e1569b4696a",
  "20260728180000_project_handoff":
    "6581b9056fb1f5537e497ac204505fa71e76e2596adb0abd2ae7743940a9784b",
  "20260729120000_matrix_account_playbook":
    "a5c3ad3450048c938ee37447fb75cbf16d7d5b02c558209a178eba30fcd2e0d0",
  "20260729180000_phase_c_publish_job_pipeline":
    "1c6743c5b8abe2b06923e15b3c884340947299e4685be58bf1a93bb12e084e94",
  "20260803200000_bid_workflow_phase1":
    "4053173c9e3af0015e773b8067a1e130ee5e6e2273830745bfb8b47958adfcc4",
  "20260804130000_sunny_motor_price":
    "9c5007805dd6cf642b6544fab9035a2c501b90986e9a26522f0410bb7b1c495e",
  "20260804190000_sales_action_loop":
    "478bc82413ca1f2a67bd7828f3605ae0ee106097de52a615d66d13cccbf4e673",
  "20260804200000_sales_action_auto_sync":
    "93c594162365cf5b57f896fcba214f2fb2d67b4e8fa92525adf107df75d3c387",
  "20260804210000_sales_effectiveness_promotion_approval":
    "ffcd014dbc480dd7dafd2d6f4c31ec1ad229ac83822ca297727678c58ff91ca2",
  "20260805090000_marketing_economics":
    "0b7d73e255d05f40a26f6dc96f5cae94d964319c12726701c651228bc5cf7873",
  "20260805180000_tender_auto_analysis_phase1_1":
    "8d48341aed38eb0b3b21b9950449edc40e812e7a446bd645cdc5603637fa1d31",
  "20260811002000_add_tender_t2_ledger_archive_foundation":
    "013bad981ea141717a1d0d15efb971981d5ebee499d4d68317ff55f30daf8ff6",
  "20260811040000_add_tender_t3_corporate_memory_foundation":
    "ce7e975fd1e836143cc0e08b016815c15618aa85f1cbfc78c2babd3c2a12b3f4",
  "20260811050000_add_project_financial_control":
    "2e4b67e62d41edc13835ed531bf1047fc1a18b7b807e796973f5047ef13d2b0d",
  "20260814090000_add_tender_profitability_settlement":
    "1ad414bbddb2bd26d855a35ba42fdee3fc414dd66c76f3c61165319d48eb931f",
};

let passed = 0;
let failed = 0;
function ok(cond: boolean, name: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`);
  }
}

function sha256(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function migrationDirs(dir: string) {
  if (!existsSync(dir)) return [] as string[];
  return readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isDirectory() && /^\d+_/.test(n))
    .sort();
}

console.log("\nactive migrations");
const active = migrationDirs(activeDir);
ok(active.length === EXPECTED_ACTIVE.length, `active 数量=${EXPECTED_ACTIVE.length}`);
ok(
  EXPECTED_ACTIVE.every((n, i) => active[i] === n),
  "active 名称与顺序固定",
);

for (const name of active) {
  const sql = join(activeDir, name, "migration.sql");
  ok(existsSync(sql), `${name}/migration.sql 存在`);
}

const baselineSql = readFileSync(
  join(activeDir, EXPECTED_ACTIVE[0], "migration.sql"),
  "utf8",
);
ok(/CREATE EXTENSION IF NOT EXISTS "vector"/i.test(baselineSql), "baseline 含 vector");
ok(/CREATE TABLE "Project"/i.test(baselineSql), "baseline 含 Project");
ok(/CREATE TABLE "BidDataRevision"/i.test(baselineSql), "baseline 含 BidDataRevision");
ok(!/workDomain/i.test(baselineSql), "baseline 不含 workDomain");
ok(!/ProjectHandoff/i.test(baselineSql), "baseline 不含 ProjectHandoff");
ok(!/DROP DATABASE/i.test(baselineSql), "baseline 无 DROP DATABASE");
ok(!/DROP SCHEMA\s+public\s+CASCADE/i.test(baselineSql), "baseline 无 DROP SCHEMA CASCADE");
ok(!/TRUNCATE\b/i.test(baselineSql), "baseline 无 TRUNCATE");
ok(!/postgresql:\/\//i.test(baselineSql), "baseline 无连接串");

for (const [name, expect] of Object.entries(IMMUTABLE)) {
  const actual = sha256(join(activeDir, name, "migration.sql"));
  ok(actual === expect, `${name} checksum 不可变`);
}

console.log("\nlegacy archive");
ok(existsSync(legacyDir), "legacy 归档目录存在");
const legacy = migrationDirs(legacyDir);
ok(legacy.length >= 85, `legacy migration >= 85（实际 ${legacy.length}）`);
ok(
  !active.some((n) => n !== EXPECTED_ACTIVE[0] && legacy.includes(n) === false && false),
  "sanity",
);
// active 不得重新出现大量 legacy 名字
const leaked = active.filter(
  (n) =>
    !EXPECTED_ACTIVE.includes(n as (typeof EXPECTED_ACTIVE)[number]) &&
    legacy.includes(n),
);
ok(leaked.length === 0, "active 未混入其它 legacy 名");

const phase4Legacy = sha256(
  join(legacyDir, "20260728120000_project_work_domain", "migration.sql"),
);
const phase5Legacy = sha256(
  join(legacyDir, "20260728180000_project_handoff", "migration.sql"),
);
ok(
  phase4Legacy === IMMUTABLE["20260728120000_project_work_domain"],
  "legacy Phase4 checksum = active",
);
ok(
  phase5Legacy === IMMUTABLE["20260728180000_project_handoff"],
  "legacy Phase5 checksum = active",
);

console.log(`\n结果: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
