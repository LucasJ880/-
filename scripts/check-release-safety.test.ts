/**
 * Phase 5A：发布安全静态检查
 * - npm run build 不得执行 migrate deploy
 * - postinstall / prepare 不得隐藏 migration
 * - vercel / CI 配置不得绑定生产 migrate
 *
 * npx tsx scripts/check-release-safety.test.ts
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
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

function read(path: string): string {
  return readFileSync(join(root, path), "utf8");
}

console.log("\npackage.json scripts");
const pkg = JSON.parse(read("package.json")) as {
  scripts?: Record<string, string>;
};
const scripts = pkg.scripts || {};

ok(
  typeof scripts.build === "string" &&
    !/\bmigrate\s+deploy\b/.test(scripts.build) &&
    !/\bdb:migrate:deploy\b/.test(scripts.build),
  "build 不含 migrate deploy",
);
ok(
  typeof scripts.build === "string" &&
    /\bprisma\s+generate\b/.test(scripts.build) &&
    /\bnext\s+build\b/.test(scripts.build),
  "build 仅 generate + next build",
);
ok(
  typeof scripts["db:migrate:deploy"] === "string" &&
    scripts["db:migrate:deploy"].includes("safe-migrate-deploy"),
  "db:migrate:deploy 走 safe-migrate-deploy",
);
ok(
  typeof scripts.postinstall === "string" &&
    !/\bmigrate\s+deploy\b/.test(scripts.postinstall) &&
    !/\bmigrate\s+dev\b/.test(scripts.postinstall),
  "postinstall 不含 migration",
);
ok(
  !scripts.prepare ||
    (!/\bmigrate\s+deploy\b/.test(scripts.prepare) &&
      !/\bmigrate\s+dev\b/.test(scripts.prepare)),
  "prepare 不含 migration（或不存在）",
);

console.log("\nmigration files");
const migrationsDir = join(root, "prisma/migrations");
const migrationNames = readdirSync(migrationsDir).filter((name) => {
  const p = join(migrationsDir, name);
  return statSync(p).isDirectory() && /^\d{14}_/.test(name);
});
const unique = new Set(migrationNames);
ok(unique.size === migrationNames.length, "migration 名称唯一");
const sorted = [...migrationNames].sort();
let ordered = true;
for (let i = 1; i < sorted.length; i++) {
  if (sorted[i]! <= sorted[i - 1]!) ordered = false;
}
ok(ordered, "migration 时间戳严格递增");
ok(migrationNames.length >= 85, `migration 数量 >= 85（实际 ${migrationNames.length}）`);

const requiredRestored = [
  "20260318200000_add_project_discussion",
  "20260319230000_init_postgresql",
  "20260320120000_add_auth_provider_and_indexes",
  "20260724160000_project_fact_memory_phase2",
  "20260724170000_project_orchestrator_task_lease",
  "20260724190000_project_orchestrator_3i_persistence",
  "20260724200000_agent_task_cancel_requested_at",
  "20260725010000_phase4_bid_data_layer",
  "20260725020000_phase4a2_bid_data_review",
  "20260725030000_phase4a2_pricing_line_reviewer_note",
];
for (const name of requiredRestored) {
  ok(
    existsSync(join(migrationsDir, name, "migration.sql")),
    `已恢复 ${name}`,
  );
}

console.log("\ndeploy configs");
if (existsSync(join(root, "vercel.json"))) {
  const vercel = read("vercel.json");
  ok(
    !/\bmigrate\s+deploy\b/.test(vercel) &&
      !/\bdb:migrate:deploy\b/.test(vercel),
    "vercel.json 不含 migrate deploy",
  );
} else {
  ok(true, "无 vercel.json（跳过）");
}

const ghDir = join(root, ".github/workflows");
if (existsSync(ghDir)) {
  const files = readdirSync(ghDir).filter((f) => /\.ya?ml$/i.test(f));
  let clean = true;
  for (const f of files) {
    const body = readFileSync(join(ghDir, f), "utf8");
    // PR 检查不得 migrate deploy；允许注释提及
    if (
      /prisma\s+migrate\s+deploy|db:migrate:deploy|build:with-migrations/.test(
        body,
      ) &&
      !/temporary|isolated|ephemeral|test.?db/i.test(body)
    ) {
      clean = false;
      console.log(`    可疑 workflow: ${f}`);
    }
  }
  ok(clean, "GitHub Actions 无未隔离的 migrate deploy");
} else {
  ok(true, "无 .github/workflows（跳过）");
}

console.log("\nsafe-migrate-deploy");
ok(
  existsSync(join(root, "scripts/safe-migrate-deploy.ts")),
  "存在 safe-migrate-deploy.ts",
);
const safe = read("scripts/safe-migrate-deploy.ts");
ok(
  safe.includes("ALLOW_DATABASE_MIGRATION"),
  "要求 ALLOW_DATABASE_MIGRATION",
);
ok(
  safe.includes("CONFIRM_PRODUCTION_MIGRATION"),
  "生产要求 CONFIRM_PRODUCTION_MIGRATION",
);
ok(!/console\.log\([^)]*DATABASE_URL/.test(safe), "不打印完整 DATABASE_URL");

console.log(`\n结果: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
