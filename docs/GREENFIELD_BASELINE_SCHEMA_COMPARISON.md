# Greenfield Baseline Schema 比较

**生成：** 2026-07-28  
**生产源：** Neon `greenfield-baseline-source-pre-phase4`（parent=production，endpoint 脱敏 `ep-proud-meadow-*`）  
**临时 Schema：** `prisma/baseline/schema.pre-phase4.prisma`（`db pull --print`，无密码）  
**Phase 3 参考 commit：** `ecb0058398a7a63b4326895e47628377ad47a30d`

---

## 1. 切点结论

| 对象 | Phase 3 Git | 生产实际（pre-P4） | 当前正式 schema.prisma | Baseline 采用 |
|---|---|---|---|---|
| Task.blockedReason/waitingOn/waitingUntil | 有 | 有 | 有 | 有（生产） |
| Project.workDomain | 无 | **无** | 有（Phase4） | **无** |
| Project.deliveryStage / completion dates | 无 | **无** | 有 | **无** |
| Project.sourceTenderProjectId | 无 | **无** | 有（Phase5） | **无** |
| ProjectHandoff | 无 | **无** | 有 | **无** |
| BidDataRevision 等 | 无（正式 schema 仍缺） | **有** | **无完整模型** | **有**（生产 introspection） |
| extension vector | 有（正式） | 有 | 有 | 有 |
| views / triggers / RLS | — | 无业务自定义 | — | 无需补 |
| 函数 | — | 主要为 vector 扩展函数 | — | 随 CREATE EXTENSION |

**Baseline 代表生产真实 pre-Phase-4，而不是理想化 Phase 3 commit。**

---

## 2. 手工 hotfix / 漂移

| 项 | 说明 |
|---|---|
| Bid Data 层 | 库中有完整表；正式 `schema.prisma` 未建模；已纳入 baseline SQL |
| AgentTask 编排列 | 生产/baseline 含 lease/invalidation 等列；正式 schema 部分缺失 → 记为「DB 超集」，应用以正式 schema 为准、DB 多出对象文档化保留 |
| 共享库 vs 生产 | 共享库已有 Phase 4/5；生产无。发布必须以生产为准 |

未发现需单独纳入的触发器/视图/RLS hotfix。

---

## 3. Phase 4 前置

生产已具备 Phase 4 SQL 所引用的表（如 `TenderRequirement`、`ProductEvidence`、`BidDataRevision`），且无 `workDomain` 列 → 可安全 deploy Phase 4。

---

## 4. 自定义 SQL 对象清单

| 对象 | 来源 | Baseline 处理 |
|---|---|---|
| CREATE EXTENSION vector | 历史 migration / 生产 | 已在 baseline 首部 |
| vector 相关函数 | 扩展自带 | 不手工复制 |
| Bid Data DDL | `20260725010000_*` 等 legacy | 由 introspection→diff 进入 baseline |
| 历史 UPDATE 回填 | 各 legacy migration | **不**放入 baseline（空库无需） |
