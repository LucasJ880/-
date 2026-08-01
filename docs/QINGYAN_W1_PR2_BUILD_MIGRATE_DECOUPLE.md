# Wave 1 PR2 — 解除 Build 与 Migration 绑定

**分支：** `stabilization/w1-pr2-build-migrate`  
**基准：** `stabilization/qingyan-wave0` ← `main@2255f8d`  
**日期：** 2026-07-31  
**未执行生产迁移**

---

## 1. 问题描述

历史事故：`npm run build` 曾包含 `prisma migrate deploy`，导致构建环境误迁库。  
审计工作区 `feature/agent-runtime-2-phase1` 的 `package.json` **仍含**该危险绑定；生产 tip 已拆开。本 PR 在 tip 上做入口盘点、CI 加固与操作规范固化。

## 2. 根因

- 发布脚本把「编译」与「DDL」耦合  
- 多入口（raw migrate、build:with-migrations、隔离脚本）若被 CI/Vercel 误调即有风险  

## 3. 迁移入口清单（tip @ 2255f8d + Wave0）

| 入口 | 命令 / 位置 | 自动化？ | 生产可用？ |
|---|---|---|---|
| `npm run build` | `prisma generate && next build` | CI/Vercel | ✅ 安全（无 migrate） |
| `npm run qa` | lint + generate + next build | 人工 | ✅ 安全 |
| `npm run db:migrate:deploy` | `tsx scripts/safe-migrate-deploy.ts` | **禁止自动** | 仅人工 + `ALLOW_DATABASE_MIGRATION=true`；生产另需 `CONFIRM_PRODUCTION_MIGRATION` |
| `npm run db:migrate:deploy:raw` | `prisma migrate deploy` | **禁止** | 逃生舱 |
| `npm run build:with-migrations` | deploy then build | **禁止 CI/Vercel** | 仅隔离/已批准目标 |
| `npm run db:migrate:dev` | `prisma migrate dev` | 本地 | ❌ 生产 |
| `npm run db:push:dev` | `prisma db push` | 本地 | ❌ 生产 |
| `scripts/phase-c-isolated-migrate.ts` | 隔离库 | 人工脚本 | ❌ 生产（脚本拒 prod host） |
| `scripts/phase-c-greenfield-replay.ts` | 空库回放 | 人工 | ❌ 生产 |
| `scripts/smoke-product-visual-builder.ts` | branch migrate | 人工烟雾 | ❌ 生产 |
| `vercel.json` | 仅 crons | 平台 | ✅ 无 migrate |
| Docker | **无 Dockerfile** | — | — |
| GitHub Actions `.github/workflows/ci.yml` | validate/generate/lint/typecheck/test/build | CI | ✅ Guard 禁止 migrate 调用 |

## 4. 修改前后对照

| 项 | 修改前（审计分支） | tip / 本 PR 后 |
|---|---|---|
| `build` | `prisma generate && prisma migrate deploy && next build` | `prisma generate && next build`（tip 已是；保持） |
| CI | 无 | Wave0 CI + 本 PR 增加 package 脚本断言 |
| 文档 | 分散事故/runbook | 本文件为单一入口清单 |

## 5. 本 PR 代码变更

| 文件 | 变更 |
|---|---|
| `scripts/check-release-safety.test.ts` | 断言 `qa` / `test:ci` 不含 migrate；`build:with-migrations` 不得出现在 CI run 步（沿用 Wave0 allowlist） |
| `package.json` | 为 `build:with-migrations` 增加并列警告脚本说明性 `db:migrate:note`？→ **改为** 仅文档 + safety 测试扩展，避免无意义 script |
| 本文档 | 入口清单与生产 SOP |

实际最小代码：扩展 `check-release-safety.test.ts` 检查项。

## 6. 生产迁移标准操作建议（不执行）

```bash
# 1) 只读确认
export DATABASE_URL=... DIRECT_URL=...
npm run db:migrate:status

# 2) 备份 Neon branch（生产 parent）

# 3) 双确认 deploy
export ALLOW_DATABASE_MIGRATION=true
export CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION_MIGRATION
npm run db:migrate:deploy

# 4) 再 status + 应用冒烟
```

**禁止：** Vercel Build Command 写 migrate；`npm run build:with-migrations` 对生产；在 CI 注入生产 `DATABASE_URL`。

## 7. 测试

- `npm run test:release-safety` / `npm run test:ci`  
- `npm run build` 日志不得出现 `Applying migration`

## 8. 安全 / 数据库影响

- 无生产写入  
- 无 Schema 变更  

## 9. 回滚

Revert 本 PR；tip 本身 build 已无 migrate，回滚不恢复危险绑定。

## 10. 剩余风险

- Vercel 项目 UI 若被人工改写 Build Command — **需控制台人工复核（NEEDS_VERIFICATION 平台侧）**  
- 开发者误跑 `build:with-migrations` 对错误 DATABASE_URL  

## 11. P0 状态

**P0-01：在 tip 上关闭（build 已解耦）；本 PR 固化清单与回归断言。**  
审计分支仍危险 — 见漂移报告，禁止合并该 package.json。
