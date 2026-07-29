# Baseline Migration 重复登记评估

**日期：** 2026-07-28  
**Migration：** `20260416120000_baseline_before_launch`  
**原则：** 只读调查；禁止 DELETE / 改 checksum / reset / 清空 `_prisma_migrations`

---

## 1. 记录明细（三库一致）

共享库 `ep-raspy-credit-*`、生产 `ep-super-field-*`、隔离分支 `ep-orange-smoke-*` 均存在相同两条记录（隔离分支自 production 快照继承）：

| 字段 | 记录 A（失败/回滚） | 记录 B（成功登记） |
|---|---|---|
| id | `1783c169-e6b8-453c-a128-490a4936c8cd` | `c0b94920-7af7-41f9-b0f3-29678df93b88` |
| checksum | `7e3991b2b2692bc5ca402cf91f2800bb42f448e36980324569c44107f3d0f059`（相同） | 同左 |
| started_at | 2026-04-17T18:54:11.524Z | 2026-04-17T18:58:58.416Z |
| finished_at | null | 2026-04-17T18:58:58.416Z |
| rolled_back_at | 2026-04-17T18:58:58.347Z | null |
| applied_steps_count | 0 | 0 |
| logs | 含 Prisma “migration failed… resolve” 提示 | 空 |

**解读：** 先有一次失败并标记 rolled back，约 4 分钟后以 `migrate resolve` / 等效方式写入第二条成功登记（`applied_steps_count=0` 符合 baseline/resolve 特征）。属**历史修复痕迹**，非近期双写。

---

## 2. 对 Prisma 状态的影响

| 环境 | `_prisma_migrations` 行数 / 唯一名 | `migrate status` | 后续 deploy |
|---|---|---|---|
| 共享 | 86 / 85 | up to date（Phase 5A 后） | 不受阻 |
| 生产 | 84 / 83 | 待应用 Phase 4/5（隔离验证已证明可 deploy） | 不受阻 |
| 隔离分支 | 86 / 85 | up to date（Phase 5A 已 deploy 4/5） | 不受阻 |

**结论分类：情况 B** — 生产也存在重复，但 Prisma 状态稳定，**不阻塞**后续 migration 应用。

---

## 3. 禁止项（再次确认）

- 不在普通发布中 DELETE 任一行  
- 不修改 checksum  
- 不 `migrate reset`  
- 不重建 `_prisma_migrations`  

---

## 4. 治理建议（独立维护窗口）

1. 备份生产 `_prisma_migrations` 全表导出  
2. 与 Prisma 支持/文档核对「rolled_back + 同名 finished」是否可长期保留  
3. 若需清理：仅在维护窗口、双人复核下删除**已 rolled_back** 的那一行（保留 finished），并立即 `migrate status` 验证  
4. 此清理**不得**与 Phase 4/5 发布捆绑  

---

## 5. 发布影响

- **不构成** Phase 5B 的 Prisma 阻塞项  
- 仍记为剩余风险 / 技术债，见 Phase 5B 报告  
