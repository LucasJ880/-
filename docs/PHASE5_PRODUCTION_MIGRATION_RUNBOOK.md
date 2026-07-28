# Phase 3–5 生产 Migration Runbook

**适用范围：** 将 Phase 3 / 4 / 5 相关 schema 变更受控发布到 Neon **production** 主库。  
**不自动执行：** 本文仅流程；执行必须人工审批后手动跑命令。

---

## 0. 角色

| 角色 | 职责 |
|---|---|
| 执行人 | 运行受控 migrate、记录日志、跑验证脚本 |
| 批准人 | 确认 Gate、备份、回滚决策 |
| 回滚负责人 | 决定应用回滚 vs 保留 DB 结构 |

---

## 1. 发布前检查清单

1. 确认发布 commit（含 Phase 5A/5B）  
2. `git status` 干净  
3. `bash scripts/test-all.sh` 结果归档  
4. `npx tsc --noEmit` / eslint / `npm run build`（build **不含** migrate）  
5. 空库全链重放结果（见 Phase 5B 报告；**当前失败则不得宣称 READY_FOR_PRODUCTION_MIGRATION**）  
6. 隔离分支 `migration-reconciliation-phase5` deploy 结果：成功且 status 干净  
7. 生产 `npm run db:migrate:status`（只读）— 预期待应用含 Phase 4/5  
8. 创建生产备份：**Neon branch** `pre-phase5-prod-<YYYYMMDD>`（parent=production）  
9. 记录生产基线计数：Task / Project / ProjectHandoff / workDomain 分布  
10. 确认回滚负责人与批准人在线  

---

## 2. 目标环境（填写，勿写密码）

| 项 | 值 |
|---|---|
| Neon project | `polished-thunder-16018212`（青砚-AI工作助手） |
| Neon branch | `production` |
| Endpoint 主机（脱敏） | `ep-super-field-*` |
| database | `neondb` |
| 预期 migration | `20260728120000_project_work_domain`、`20260728180000_project_handoff`（若 Phase 3 已在生产则不会再次应用） |
| 执行人 | |
| 批准人 | |
| 备份 branch | |

---

## 3. 迁移执行（受控）

```bash
# 1) 指向生产 DIRECT/DATABASE（本地临时 env，勿提交）
export DATABASE_URL="..."   # 生产连接，勿写入仓库
export DIRECT_URL="..."

# 2) 状态
npm run db:migrate:status

# 3) 双确认后 deploy
export ALLOW_DATABASE_MIGRATION=true
export CONFIRM_PRODUCTION_MIGRATION=I_UNDERSTAND_PRODUCTION_MIGRATION
npm run db:migrate:deploy

# 4) 再次 status
npm run db:migrate:status
```

**禁止：** 用 `npm run build` 触发 migrate；对生产 `migrate reset`；删除 `_prisma_migrations`。

---

## 4. 迁移后验证

```bash
npx tsx scripts/verify-phase5-data-integrity.ts
# 期望：无 BLOCKER
```

手工/脚本核对：

- Phase 3 Task 列与索引  
- Phase 4 `workDomain` / 索引 / 回填分布合理  
- Phase 5 `ProjectHandoff` 表与唯一约束  
- Task / Project 数量与迁移前基线对比（允许 workDomain 回填变化，不允许无故丢行）  
- 应用健康：登录、`/ops`、`/ops/projects`、`/bids`、`/tasks`  
- 只读 handoff **preview**（禁止未经批准的生产 execute）  

如需交接冒烟：仅内部测试 tender 项目 + 批准人书面同意。

---

## 5. 回滚策略

### 应用回滚

可部署上一应用版本。新增列/表通常向前兼容，旧代码可忽略。

### 数据库回滚

**默认不 DROP。**

优先：

```text
停止新交接入口
→ 回滚应用版本
→ 保留 DB 结构
→ 调查
```

仅在数据损坏且有备份 branch 时，考虑从 Neon branch 恢复；不把 `DROP COLUMN` 作为第一动作。

---

## 6. 失败中止

任一步失败：

1. 停止继续部署新应用（若尚未部署）  
2. 保留 migrate 错误日志  
3. 批准人决定：修复前向 migration vs 自备份恢复  
4. 更新事故/发布记录  

---

## 7. Gate 引用

最终是否允许进入本节第 3 步，以 `docs/PHASE5B_PRODUCTION_RELEASE_GATE.md` 结论为准。  
即使 Gate 为 READY，也必须完成第 1 节清单后再执行。  
