# 青砚 Wave 0 稳定化基线

**分支：** `stabilization/qingyan-wave0`  
**基准 Commit：** `2255f8da919c883bc9e2f210209782c40ee5eaae`（`main@2255f8d`）  
**建立日期：** 2026-07-31  
**约束：** 未改变业务行为；未执行生产迁移；未合并 `feature/agent-runtime-2-phase1`

---

## 1. 工作目录与基准

| 项 | 值 |
|---|---|
| Worktree | `/Users/user/Desktop/青砚-stabilization-wave0` |
| Branch | `stabilization/qingyan-wave0` |
| Base SHA | `2255f8da919c883bc9e2f210209782c40ee5eaae` |
| 审计分支（只读参考） | `feature/agent-runtime-2-phase1` @ `80c76e4`（含未提交实验代码，**禁止整体合并**） |
| 审计报告 | 10× `docs/QINGYAN_*.md`（仅文档，无业务代码） |

建立时 worktree 自 tip 干净检出；随后仅加入 Wave 0 允许的文档/CI/脚本钉扎。

---

## 2. 运行时与依赖钉扎

| 项 | 值 | 来源 |
|---|---|---|
| Node | **20**（`.nvmrc`；本机验证时为 v20.18.1） | `.nvmrc` / `engines` |
| 包管理器 | **npm 10.x**（本机 10.8.2） | npm |
| Lockfile | `package-lock.json`（必须 `npm ci`） | 仓库根 |
| Prisma | `^6.19.2`（`prisma` + `@prisma/client`） | `package.json` |
| Next.js | `16.2.0` | `package.json` |
| React | `19.2.4` | `package.json` |

---

## 3. Package scripts 审查

| Script | 命令 | Wave 0 结论 |
|---|---|---|
| `build` | `prisma generate && next build` | ✅ **不**运行 migrate |
| `build:with-migrations` | `db:migrate:deploy && build` | ⚠ 显式受控入口；**CI/Vercel 不得调用** |
| `lint` | `eslint` | ✅ 只检查，不 `--fix` |
| `typecheck` | `tsc --noEmit` | ✅ Wave 0 新增别名（行为同 test-all 内 tsc） |
| `test` | `bash scripts/test-all.sh` | ✅ 逻辑测试；DB 集成缺省跳过 |
| `test:ci` | release-safety + nullish 检查 | ✅ CI 子集，无生产 DB |
| `db:migrate:deploy` | `safe-migrate-deploy.ts` | ✅ 需 `ALLOW_DATABASE_MIGRATION`；生产另需确认变量 |
| `db:migrate:deploy:raw` | `prisma migrate deploy` | ⚠ 逃生舱；禁止自动化 |
| `db:push:dev` | `prisma db push` | ⚠ 仅本地；禁止 CI/生产 |
| `postinstall` | `prisma generate` | ✅ 仅 generate |

`vercel.json`：仅 crons，**无** build/migrate 命令覆盖。

---

## 4. GitHub Actions

- Workflow：`.github/workflows/ci.yml`
- 步骤：install →（guard）→ prisma validate → generate → lint → typecheck → test:ci → next build
- **不**设置生产 `DATABASE_URL`；使用 `127.0.0.1` 占位串
- **不**执行 migrate / db push
- 失败步骤保留 Actions 日志；末步输出摘要

策略（流程）：

- 禁止直接 push `main`
- 禁止 auto-merge
- 每个修复独立分支 / 独立 PR

---

## 5. Wave 0 完成标准核对

| 标准 | 状态 |
|---|---|
| 基准来自 `main@2255f8d` | ✅ |
| 审计报告已保留 | ✅ 10 份 |
| build 不触发迁移 | ✅ tip 已满足；CI guard 加固 |
| GitHub Actions 已添加 | ✅ |
| 未改变业务行为 | ✅（仅 docs/CI/脚本钉扎） |
| prisma validate / typecheck / CI 运行结果 | 见本分支后续提交与 Actions 运行记录 |

---

## 6. 明确不做

- 不合并 feature 分支  
- 不执行生产迁移 / 密码轮换  
- 不进入 Wave 2/3  
- 不顺带改业务逻辑  
