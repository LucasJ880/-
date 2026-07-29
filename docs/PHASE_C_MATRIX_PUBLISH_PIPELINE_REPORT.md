# Phase C：内容上下文 / 差异化发布 / PublishJob / Postiz 回写 — 完成报告

**日期：** 2026-07-29  
**仓库：** `青砚-visualizer-templates`  
**分支：** `feat/ops-bids-workspace-phase1`  
**结论：** `PARTIAL`

---

## 1. 结论

```text
PARTIAL
```

### 已达成（隔离/Staging 数据层）

| 项 | 结果 |
|---|---|
| Staging Neon Branch migration | **PASS** |
| isolated/staging postcheck | **PASS**（29/29） |
| Greenfield 空库完整重放 | **PASS**（5/5 migrations） |
| 状态机 / 幂等 / Postiz classify 验证 | **PASS**（staging-verify 27/27） |
| prisma validate / generate | **PASS** |
| typecheck (`tsc --noEmit`) | **PASS**（0 errors） |
| playbook tests | **PASS**（24/24） |
| pipeline tests | **PASS**（22/22） |
| content-rules | **PASS**（12/12） |
| Postiz unit | **PASS**（6/6） |
| migration history | **PASS**（27/27） |
| release-safety | **PASS**（24/24） |
| `npm run build` | **PASS** |
| 生产 migration | **未执行** |
| 真实社媒发布 | **未执行** |

### 未完成（故保持 PARTIAL）

1. **Vercel Staging/Preview 应用部署与手工验收**（本机无 `vercel` CLI / `VERCEL_TOKEN`；Phase C 代码仍大量未提交）  
2. **生产数据库密码轮换**（按指令：除非另行确认，本轮不执行）  
3. Staging 手工：登录权限 / Playbook UI / 扇出端到端 / 审计页（需已部署应用）  
4. 未跑完整 `npm test`（test-all 全量；本轮已跑 operations/playbook/pipeline/postiz/migration/release-safety + build）

---

## 2. 凭据与安全

### 扫描（不输出 Secret）

| 范围 | 结果 |
|---|---|
| `.env*.local` | gitignored（含 `.env.staging.local` / `.env.greenfield.local`） |
| Git 历史 `npg_*` 密码模式 | **0** 命中文件 |
| 工作区 `docs/scripts` | 仅占位符式 `postgresql://...`（如 `DEPLOY_VERCEL.md`、smoke 说明）；**未发现可登录密码串** |
| 报告/聊天 | **禁止**写入完整连接串 |

### 生产密码轮换

```text
PENDING（用户确认前不执行）
```

终端曾暴露过连接串的风险仍在：正式 Production 上线前务必完成轮换。

---

## 3. Staging / 隔离数据库（脱敏）

| 用途 | Neon 标识（脱敏） | 环境 |
|---|---|---|
| Staging migration（自 production 分支克隆） | Branch `phase-c-migration-validation` / host `ep-tiny-heart-…` | staging |
| Greenfield 空库重放 | 新项目 `qingyan-phase-c-greenfield-*` / host `ep-gentle-leaf-…` | isolated |
| 生产对照 | host `ep-super-field-…` | **未写入、未 migrate** |

本地 Secret 文件（未提交）：

- `.env.staging.local`
- `.env.greenfield.local`

---

## 4. Migration 执行

### Staging（克隆库升级）

命令（连接串占位）：

```bash
DATABASE_ENVIRONMENT=staging \
ALLOW_DATABASE_MIGRATION=true \
ISOLATED_DATABASE_URL="$ISOLATED_DATABASE_URL" \
ISOLATED_DIRECT_URL="$ISOLATED_DIRECT_URL" \
npx tsx scripts/phase-c-isolated-migrate.ts
```

结果：

```text
Applied:
  20260729120000_matrix_account_playbook
  20260729180000_phase_c_publish_job_pipeline
All migrations have been successfully applied.
```

### Greenfield（空库 5 条全量）

```text
GREENFIELD_REPLAY = PASS
Applied: baseline → workDomain → handoff → playbook → phase_c_publish_job_pipeline
```

### 生产

```text
NOT EXECUTED（PAUSED）
```

---

## 5. Postcheck

脚本：`scripts/phase-c-isolated-postcheck.ts`

```text
[phase-c-postcheck] 结果: 29 passed, 0 failed
[phase-c-postcheck] PASS
```

覆盖：migration 登记、Playbook 表、PublishJob 快照/幂等列、`PublishJobStatusEvent`、`AuditLog`（复用，无独立 `PublishJobAuditLog` 表）、旧数据可读、非生产 host。

**说明：** Staging 克隆上 `MatrixAccount`/`PublishJob` 计数为 0（库内尚无运营矩阵业务行）；兼容检查以「可读 + groupId 可空 + 无多生效 Playbook」为准。

---

## 6. 状态机 / 幂等 / Postiz Mock

脚本：`scripts/phase-c-staging-pipeline-verify.ts`

```text
[staging-verify] 27 passed, 0 failed
[staging-verify] PASS
```

- 非法跳转拒绝：`draft→queued/published`、`blocked→queued`、`pending→published`、`failed→published`、`canceled→queued`
- 合法路径断言通过
- Postiz：`SCHEDULED/null`→保持 queued；`published` 证据→published；失败→failed
- DB fixture：queued→published（Mock），**无真实社媒调用**，fixture 已清理

---

## 7. 代码与脚本清单（本阶段）

新增/关键：

- `scripts/phase-c-isolated-migrate.ts`（安全门禁已落盘）
- `scripts/phase-c-isolated-postcheck.ts`
- `scripts/phase-c-greenfield-replay.ts`
- `scripts/phase-c-staging-pipeline-verify.ts`
- Phase B/C 业务与 migration（见仓库未提交变更）

---

## 8. Vercel Staging 部署

```text
STATUS = NOT DEPLOYED
```

原因：本机无 `vercel`/`gh` CLI、无 `VERCEL_TOKEN`；Phase C 变更尚未 commit/push。

### Production 上线前 / Staging 应用验收待办

1. Commit + push Phase B/C 到专用分支（勿直接无审查推 main）  
2. 创建独立 Vercel Staging Project 或 Preview，环境变量仅指向 `ep-tiny-heart-…`（或新 Staging Branch）  
3. 设置：`AUTO`/`matrixAutoApproveEnabled=false`、`PLAYBOOK_ENFORCEMENT_MODE=warn`、关闭真实 Postiz 发布 cron  
4. 手工验收：权限、Playbook、扇出差异化、门禁、状态机 UI、审计  
5. 检查 Vercel Logs：无完整 URL/密码/Token、无误连 `ep-super-field`  
6. 确认后轮换生产 DB 密码并更新 Vercel Production Secrets  
7. 单独批准生产 migration  

---

## 9. 测试与 Build 明细

| 命令 | 结果 |
|---|---|
| `npx prisma validate` | PASS |
| `npx prisma generate` | PASS（随 greenfield） |
| `npx tsc --noEmit` | PASS（0 errors） |
| playbook.test.ts | 24/24 |
| publish-pipeline.test.ts | 22/22 |
| content-rules.test.ts | 12/12 |
| postiz.test.ts | 6/6 |
| verify-migration-history | 27/27 |
| check-release-safety | 24/24 |
| staging-pipeline-verify | 27/27 |
| postcheck (staging) | 29/29 |
| greenfield-replay | PASS |
| `npm run build` | PASS |
| 完整 `npm test` (test-all) | **未在本轮跑满** |

---

## 10. Phase C → PASS 门槛对照

| 条件 | 状态 |
|---|---|
| 生产密码已轮换 | ❌ PENDING |
| 完整凭据扫描 | ✅（无密码串入库；占位符除外） |
| 隔离/Staging migration | ✅ |
| postcheck | ✅ |
| 空库 greenfield replay | ✅ |
| 旧数据兼容 | ✅（空业务表场景） |
| 状态机 | ✅ |
| 幂等 | ✅ |
| Postiz 回写（Mock） | ✅ |
| 全量 test-all | ⚠ 部分 |
| typecheck / build | ✅ |
| Staging 应用手工验收 | ❌ |
| 未执行生产 migration | ✅ |
| 未真实社媒发布 | ✅ |

---

## 11. 全局状态

```text
Phase B = PASS
Phase C = PARTIAL
Phase D = NOT STARTED
Production Migration = PAUSED
```

**本轮暂停。不进入 Phase D，不执行生产 migration，不轮换生产密码（除非你另行确认）。**
