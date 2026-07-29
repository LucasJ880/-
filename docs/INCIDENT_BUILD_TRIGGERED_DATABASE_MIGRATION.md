# 事故记录：Build 触发共享库 Database Migration

**事故 ID：** INC-20260728-BUILD-MIGRATE  
**发现日期：** 2026-07-28  
**严重级别：** High（发布安全 / 共享库完整性）  
**状态：** 已遏制（build 已拆分）；生产主库未在本事故中被 migrate；发布仍阻塞至 Phase 5A 验收完成  

---

## 1. 发生了什么

Phase 5 验收过程中执行了 `npm run build`。当时 `package.json` 的 `build` 脚本为：

```text
prisma generate && prisma migrate deploy && next build
```

`prisma migrate deploy` 因此对当前环境变量 `DATABASE_URL` 指向的 Neon 数据库执行了迁移，将 Phase 5 migration `20260728180000_project_handoff`（及此前未在该库登记的 Phase 4 相关变更，视当时 status 而定）应用到了**共享开发库**：

| 项 | 值 |
|---|---|
| Neon project | `polished-thunder-16018212`（青砚-AI工作助手） |
| 受影响 endpoint（脱敏） | `ep-raspy-credit-anx2k4wx`（pooler / 直连） |
| 数据库名 | `neondb` |
| 约略时间 | 2026-07-28T19:22:49Z（Phase 5 汇报记载） |
| 触发命令 | `npm run build`（非受控发布流水线） |

**未受本事故 migrate 的库：** Neon 主分支 `production`（endpoint `ep-super-field-antfibsl`）。Phase 5A 隔离验证确认：截至分支创建时刻，production 快照**尚未**登记 Phase 4/5 migration。

---

## 2. 根因

1. **通用 build 绑定了 `prisma migrate deploy`**，使「编译应用」与「变更数据库」不可分离。  
2. Preview / 本地验收默认连接**共享 Neon**，无「禁止对共享库 migrate」的硬闸门。  
3. 本地 `prisma/migrations` 曾缺失 10 条已在 DB 登记的历史 migration，加剧「status 看起来干净 / 实际历史分叉」的误判风险。  
4. 文档（如旧版 `DEPLOY_VERCEL.md`）曾指引「每次 build 自动 migrate」，强化了错误习惯。

---

## 3. 影响范围

| 范围 | 结论 |
|---|---|
| 共享库 `ep-raspy-credit-*` schema | 已包含 Phase 4/5 结构（`workDomain`、`ProjectHandoff`、Task 来源字段等） |
| 生产主库 `ep-super-field-*` | **未**被本次 build migrate；Phase 4/5 仍待受控发布 |
| Task 数据 | 共享库 Task=138；状态分布保持可读（todo/done/in_progress） |
| Project 数据 | 共享库 workDomain：tender=13 / general=4；无异常清空 |
| ProjectHandoff | 共享库行数=0（无业务交接被半写入） |
| 并发应用实例 | 未发现因本 migration 导致的持续性锁表报告；无用户可见交接失败工单（当时交接功能刚上线） |
| 数据写入失败 | 核验未见部分 migration / 重复约束异常 |
| 历史分叉 | 曾缺失 10 条本地 migration 文件；Phase 5A 已从真实历史恢复且 checksum 一致 |

---

## 4. 数据验证（共享库，事故后）

- `prisma migrate status`：本地恢复 85 条后显示 **Database schema is up to date**  
- `_prisma_migrations`：85 个唯一名称；额外发现 `20260416120000_baseline_before_launch` **重复登记 2 行**（历史异常，已记录，未擅自删除）  
- 全部本地 migration 文件 checksum 与 DB 记录一致（0 mismatch）  
- Phase 3 列 `blockedReason` / `waitingOn` / `waitingUntil` + `Task_waitingUntil_idx` 存在  
- Phase 4/5 列、唯一约束、外键存在；Handoff=0  

---

## 5. 已采取措施

1. **拆分 build / migrate**  
   - `build` = `prisma generate && next build`  
   - `db:migrate:deploy` = `scripts/safe-migrate-deploy.ts`  
   - `build:with-migrations` 仅作显式组合，不作为默认 build  
2. **迁移保护脚本**：要求 `ALLOW_DATABASE_MIGRATION=true`；对 `ep-raspy-credit` / `ep-super-field` / 名称含 prod|main 的目标额外要求 `CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION_MIGRATION`；脱敏日志  
3. **恢复缺失 10 条 migration 原始 SQL**（checksum 对齐）  
4. **Neon 隔离分支** `migration-reconciliation-phase5`（`br-jolly-fog-an3eiw4v`）上受控 deploy Phase 4/5 成功  
5. **事故独立成文**（本文件）；更新 `DEPLOY_VERCEL.md` / `QA_P0_CHECKLIST.md`  
6. **静态检查** `npm run test:release-safety`  

---

## 6. 防止再次发生

| 措施 | 状态 |
|---|---|
| 普通 `npm run build` 禁止 migrate | 已落地 |
| postinstall 仅 `prisma generate` | 已确认 |
| Preview / PR 不得对生产或共享库 migrate | 流程要求；本仓无 Actions migrate |
| CI 需要 migrate 时必须临时/隔离库 | 文档约定 |
| 生产 migrate 需双重确认变量 | 已落地 |
| 发布顺序：备份/分支 → status → deploy → smoke → build → 应用 | 文档约定 |

---

## 7. 明确未做（禁止项）

- 未对生产主库执行 `migrate deploy`  
- 未执行 `migrate reset`  
- 未删除/重建 `_prisma_migrations`  
- 未编造缺失 migration  
- 未将未核验 migration 标记为 applied  

---

## 8. 后续

- 生产发布仍需独立审批后，在备份/分支上受控 migrate  
- 空库完整重放尚未执行（本机无 Docker/psql）；建议在下一发布窗口用 Neon 空分支或 CI ephemeral DB 补做  
- `_prisma_migrations` 中 baseline 重复行需单独治理方案（不得直接 delete）  
