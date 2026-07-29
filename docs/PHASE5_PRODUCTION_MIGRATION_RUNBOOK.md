# Phase 3–5 生产 Migration Runbook（Phase 5C 更新）

**适用范围：** 在 **Greenfield baseline 主链** 下，将 Phase 4 / 5 受控发布到 Neon **production**。  
**不自动执行：** 须 Gate=`READY_FOR_PRODUCTION_MIGRATION` + 单独批准。

Active migrations：

```text
00000000000000_greenfield_baseline_pre_phase4
20260728120000_project_work_domain
20260728180000_project_handoff
```

Legacy 审计副本：`prisma/migrations_legacy_pre_greenfield_baseline/`（不执行）。

---

## 0. 角色

| 角色 | 职责 |
|---|---|
| 执行人 | 备份、resolve baseline、受控 deploy、验证 |
| 批准人 | 确认 Gate、Schema diff、回滚决策 |
| 回滚负责人 | 应用回滚 vs 保留 DB |

---

## 1. 发布前

1. 确认发布 commit（含 Phase 5C）  
2. 工作区干净；`npm run verify:migration-history` 通过  
3. `bash scripts/test-all.sh` → 145+ 通过  
4. tsc / eslint / `npm run build`（**不含** migrate）  
5. 空库三轨记录有效（`docs/PHASE5C_THREE_TRACK_VALIDATION.md`）  
6. 创建生产备份 Neon branch：`pre-phase5-prod-<YYYYMMDD>`（parent=production）  
7. 生产只读：`npm run db:migrate:status`  
8. **Schema 等价确认：** 生产结构 ≈ pre-Phase-4 baseline（无 workDomain / 无 ProjectHandoff；有 Phase3 Task 与 Bid Data）  
9. 记录计数：Task / Project / User / Organization / BidDataRevision  
10. 回滚负责人与批准人在线  

---

## 2. 目标环境（填写，勿写密码）

| 项 | 值 |
|---|---|
| Neon project | `polished-thunder-16018212` |
| Neon branch | `production` |
| Endpoint（脱敏） | `ep-super-field-*` |
| database | `neondb` |
| 预期 | resolve greenfield baseline → deploy Phase4+Phase5 |
| 执行人 / 批准人 / 备份 branch | |

---

## 3. 迁移执行（受控）

```bash
export DATABASE_URL="..."   # 生产，勿提交
export DIRECT_URL="..."

npm run db:migrate:status

# A) 仅登记 baseline（不执行 baseline DDL）— 再次确认结构等价后
npx prisma migrate resolve --applied 00000000000000_greenfield_baseline_pre_phase4

npm run db:migrate:status
# 预期：待应用仅为 Phase4 + Phase5

# B) 双确认 deploy
export ALLOW_DATABASE_MIGRATION=true
export CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION_MIGRATION
npm run db:migrate:deploy

npm run db:migrate:status
# 预期：up to date
```

**禁止：**

- `npm run build` 触发 migrate  
- `migrate reset` / 删除 `_prisma_migrations`  
- 修改 Phase4/5 或 baseline SQL  
- 删除旧 baseline 重复行  
- 在结构不等价时 resolve baseline  

---

## 4. 迁移后验证

```bash
npx tsx scripts/verify-phase5-data-integrity.ts   # 无 BLOCKER
```

核对：Task/Project 计数；workDomain 分布；ProjectHandoff 表与约束；Bid Data 仍在；  
应用：登录、`/ops`、`/ops/projects`、`/bids`、`/tasks`；只读 handoff preview。  
**禁止**未经批准的生产 execute 交接。

---

## 5. 回滚

### resolve 后、deploy 前发现问题

停止；不继续 deploy；调查 `_prisma_migrations` 新 baseline 行；**不直接 DELETE**；形成修复方案。

### Phase 4/5 deploy 后应用问题

```text
停止新交接 → 回滚应用版本 → 保留向前兼容 DB 结构 → 调查
```

不默认 DROP Phase 4/5 列/表。

---

## 6. 旧历史共存

生产 `_prisma_migrations` 将同时包含旧 legacy 名、旧重复 baseline、以及新 greenfield baseline + Phase4/5。  
**允许共存。** 不以「表干净」为由删除旧行。
