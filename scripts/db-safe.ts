#!/usr/bin/env tsx
/**
 * B0 — 受守卫的数据库命令入口（2026-08-24 生产 db push 事故防复发）。
 * 用法：
 *   npm run db:target:check
 *   npm run db:push:safe [-- --accept-data-loss]   # 仅本地/隔离分支；生产/staging 永远阻断
 *   npm run db:migrate:dev  [-- --name xxx]
 * 原始 `npx prisma db push` / `prisma migrate dev` 不再是受支持的开发流程。
 */
import { spawnSync } from "node:child_process";
import { runDbSafeCli } from "../src/lib/db-safety/safe-cli";

const result = runDbSafeCli({
  argv: process.argv.slice(2),
  env: process.env,
  spawnImpl: (cmd, args, opts) => spawnSync(cmd, args, opts),
});
process.exit(result.exitCode);
