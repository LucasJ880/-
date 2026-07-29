# Legacy Migration 归档清单

**归档根目录：** `prisma/migrations_legacy_pre_greenfield_baseline/`  
**归档时间：** 2026-07-28  
**数量：** 85 条 `migration.sql` + 历史 `migration_lock.toml`  
**完整 checksum JSON：** `docs/_legacy_migration_checksums.json`

---

## 规则

- 归档文件视为**只读审计副本**；不得自动格式化或改写 SQL  
- Git 历史仍是最终审计来源  
- Prisma **不会**执行此目录（不在 `prisma/migrations`）

---

## 已知问题

| 问题 | 说明 |
|---|---|
| 顺序断裂 | `20260318200000_add_project_discussion` 早于 `init_postgresql`，空库失败 |
| 重复登记 | DB 中 `20260416120000_baseline_before_launch` 可能两行（rolled_back + finished）；见 `BASELINE_MIGRATION_DUPLICATE_ASSESSMENT.md` |

---

## 与 Active 的关系

| Active migration | 与 legacy 关系 |
|---|---|
| `00000000000000_greenfield_baseline_pre_phase4` | **新建**（非 legacy 拷贝） |
| `20260728120000_project_work_domain` | 与 legacy **字节级相同**（checksum 锁定） |
| `20260728180000_project_handoff` | 与 legacy **字节级相同**（checksum 锁定） |

Phase 4/5 checksum（sha256）：

```text
20260728120000_project_work_domain
194cf361ad0281cbf961a9dfe963807a9c92da656786afe03c8e3e1569b4696a

20260728180000_project_handoff
6581b9056fb1f5537e497ac204505fa71e76e2596adb0abd2ae7743940a9784b
```

---

## 抽样（完整表见 JSON）

| Migration | 归档路径 | 备注 |
|---|---|---|
| `20260318200000_add_project_discussion` | `.../20260318200000_add_project_discussion/migration.sql` | 空库顺序问题起点 |
| `20260319230000_init_postgresql` | `.../init_postgresql/...` | 创建 Project |
| `20260725010000_phase4_bid_data_layer` | `.../phase4_bid_data_layer/...` | Bid Data 来源之一 |
| `20260728010000_task_waiting_blocked_fields` | Phase 3 | 已在生产 |
| `20260728120000_project_work_domain` | Phase 4 | 亦在 active |
| `20260728180000_project_handoff` | Phase 5 | 亦在 active |
