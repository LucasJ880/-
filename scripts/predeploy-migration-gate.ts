#!/usr/bin/env tsx
/**
 * 生产构建前的迁移闸（开启 main 自动部署的前置条件）
 *
 * 背景：本仓库的生产迁移是**手工受控**执行的（scripts/safe-migrate-deploy.ts 双 env 闸）。
 * 一旦开启 main 自动部署，就会出现「代码先上线、迁移还没跑」的窗口——代码会去访问
 * 不存在的表，正是 2026-08-16 事故的形态。
 *
 * 本闸把顺序钉死：**生产库没有这份代码所需的全部 migration，就不许构建生产部署**。
 * 于是自动部署安全的前提变成「先 safe-migrate，再 push」，而不是靠人记得。
 *
 * 行为：
 *   - 仅在 VERCEL_ENV=production 时执行检查（preview/本地/CI 直接放行）
 *   - 缺 DATABASE_URL → 放行并告警（不把无关环境的构建搞挂）
 *   - 生产库缺任一 EXPECTED_ACTIVE_MIGRATIONS → **exit 1**，构建失败
 *   - 生产库多出迁移（库比代码新）→ 放行 + 告警（回滚部署时的正常形态）
 */

import { PrismaClient } from "@prisma/client";
import {
  ARCHIVED_MIGRATIONS,
  EXPECTED_ACTIVE_MIGRATIONS,
} from "@/lib/release/expected-migrations";
import { diffMigrations } from "@/lib/release/drift";

async function main(): Promise<void> {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv !== "production") {
    console.log(
      `[predeploy-migration-gate] 跳过（VERCEL_ENV=${vercelEnv ?? "unset"}，仅生产部署校验）`,
    );
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.warn("[predeploy-migration-gate] 跳过：缺少 DATABASE_URL");
    return;
  }

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `select migration_name from "_prisma_migrations"
       where finished_at is not null and rolled_back_at is null`,
    );
    const drift = diffMigrations(
      EXPECTED_ACTIVE_MIGRATIONS,
      rows.map((r) => r.migration_name),
      { archived: ARCHIVED_MIGRATIONS },
    );

    if (drift.missing.length > 0) {
      console.error(
        "[predeploy-migration-gate] BLOCKED：生产库缺少本次代码所需的迁移，拒绝构建生产部署",
      );
      for (const m of drift.missing) console.error(`  - ${m}`);
      console.error(
        "  处理：先对生产库执行 scripts/safe-migrate-deploy.ts（受控迁移），再重新部署。",
      );
      process.exitCode = 1;
      return;
    }

    if (drift.unexpected.length > 0) {
      console.warn(
        `[predeploy-migration-gate] 注意：生产库比本次代码多 ${drift.unexpected.length} 条迁移（${drift.unexpected.join("、")}）——回滚部署时属正常，放行。`,
      );
    }
    console.log(
      `[predeploy-migration-gate] OK：${drift.expectedCount} 条迁移全部已应用`,
    );
  } catch (e) {
    // 检查本身出错不应无声放行：明确失败，让人看见
    console.error(
      "[predeploy-migration-gate] 检查失败（拒绝构建以免带病上线）:",
      e instanceof Error ? e.message : "unknown",
    );
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
