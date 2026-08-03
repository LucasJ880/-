# Qingyan × QM Phase 1 — 实现报告

**分支：** `feature/qm-scope-runtime-phase1`
**基线：** `3ddad4e`
**工作区：** `/Users/user/Desktop/青砚-qm-phase1`
**日期：** 2026-08-03

---

## 1. 修改前基线

见 `docs/QINGYAN_QM_PHASE1_ARCHITECTURE_AUDIT.md` §1。

摘要：typecheck / lint:baseline / test:ci / build = PASS；test-all 138/147（9 项预存失败，多为无 DB）。

---

## 2. 最终采用方案

| 阶段 | 方案 |
|---|---|
| 1B ScopeContext | 新建薄层 `src/lib/scope/*`，组合 TenantContext / project access / TraceContext；服务端 `resolveScopeContext` fail-closed |
| 1C Harness | `src/lib/agent-harness/*` 包装 `agent-core.runAgent`；不新建 Runtime |
| 1D Skills | 扩展 `AgentSkill` additive 字段 + `scoped-registry.ts` 权限取交集 |
| 1E PoC | `src/lib/qm-phase1/project-daily-brief.ts`：Flag + allowlist + Kill Switch + Shadow + 幂等 |

---

## 3. 新增 / 修改文件清单

### 新增

- `docs/QINGYAN_QM_PHASE1_ARCHITECTURE_AUDIT.md`
- `docs/QINGYAN_QM_PHASE1_IMPLEMENTATION_REPORT.md`
- `docs/QINGYAN_QM_PHASE1_SECURITY_TEST_REPORT.md`
- `docs/QINGYAN_QM_PHASE1_ROLLBACK.md`
- `src/lib/scope/**`
- `src/lib/agent-harness/**`
- `src/lib/agent-core/skills/scoped-registry.ts`
- `src/lib/agent-core/skills/__tests__/scoped-registry.test.ts`
- `src/lib/qm-phase1/**`
- `prisma/migrations/20260803120000_qm_phase1_scoped_skills/migration.sql`

### 修改

- `prisma/schema.prisma`（AgentSkill additive 字段）
- `scripts/check-release-safety.test.ts`（active migration 清单）
- `scripts/verify-migration-history.ts`（EXPECTED + IMMUTABLE checksum）
- `scripts/test-ci-unit.sh` / `scripts/test-all.sh`（接入 QM 测试）
- `.env.example`（Flag 文档）

---

## 4. Schema / 迁移

**Additive only** on `AgentSkill`：

- `ownerScopeType` (default `ORG`)
- `ownerScopeId`
- `lifecycleStatus` (default `ACTIVE`)
- `riskLevel` / `approvalMode`
- `publishedBy` / `approvedBy` / `approvedAt`
- 两个索引

**未执行**任何生产/共享库迁移。`build` 仍为 `prisma generate && next build`。

---

## 5. API / 类型变化

- 无新对外 HTTP API（PoC 为可调用库函数，默认 Flag 关闭）
- 新导出：`@/lib/scope`、`@/lib/agent-harness`、`@/lib/qm-phase1`、`resolveScopedSkill`

---

## 6. Feature Flag / Kill Switch

| 开关 | 默认 |
|---|---|
| `QINGYAN_QM_SCOPE_PHASE1_ENABLED` | `false` |
| `QINGYAN_QM_PHASE1_SHADOW_MODE` | `true` |
| `QINGYAN_QM_PHASE1_ORG_ALLOWLIST` | 空（不跑） |
| `QINGYAN_QM_PHASE1_PROJECT_ALLOWLIST` | 空（不跑） |
| `modulesJson.agentAutomationEnabled=false` | 组织 Kill Switch |

---

## 7. 权限 / 审批 / 幂等

- 权限：用户权限 ∩ Scope ∩ Skill tools ∩ org 政策（Skill 取交集）
- 审批：不新增表；PoC 仅可提议 PendingAction（注入 store）
- 幂等键：`qm.project_daily_brief:{orgId}:{projectId}:{YYYY-MM-DD}`

---

## 8. 测试命令与结果（本轮）

```bash
npm run typecheck          # PASS
npm run test:ci            # PASS（含 QM 5 组新测）
npx tsx scripts/verify-migration-history.ts
```

预存 test-all 失败项不归因于本改动。

---

## 9. 对现有功能影响

- Flag 关闭时：无新自动化路径；旧 Agent / PendingAction / Grader 行为不变
- Harness 为可选包装层，未替换主聊天入口
- Schema additive：未 migrate 的环境 prisma client 已 regenerate；DB 未加列前勿在生产写新字段

---

## 10. 隔离库 Migration 验证

**状态：`BLOCKED_PENDING_ISOLATED_STAGING_DATABASE`**

| 检查 | 结果 |
|---|---|
| 尝试时间 | 2026-08-03（Draft PR #52 创建后） |
| `DATABASE_URL` / `DIRECT_URL` | UNSET（刻意未连接业务库） |
| `ISOLATED_DATABASE_URL` / `ISOLATED_DIRECT_URL` | UNSET |
| Docker / 本地 Postgres | 不可用 |
| 是否改用生产或共享测试业务库 | **否**（纪律禁止） |
| `20260803120000_qm_phase1_scoped_skills` 是否已对业务库执行 | **否** |

待提供一次性隔离库（建议从 main Schema 初始化）后补做：

1. migrate 前后 `prisma migrate status`
2. 旧代码读取带默认值的 `AgentSkill`
3. 新代码创建带 scope 字段的 skill + 权限交集 + 跨租户拒绝
4. QM 单元测试 + smoke
5. 可销毁该库；回滚以 Flag 关闭 + 保留 nullable/default 字段为主（不做 destructive down）

---

## 11. 未解决风险

- 主聊天入口尚未强制注入 ScopeContext（兼容适配，渐进接入；**Phase 2**）
- requestId 与 correlationId/traceId 仍未全库统一
- Sandbox 明确不做
- PoC 尚未挂真实 cron 路由（避免默认开启副作用）
- 隔离库 migrate 验证阻塞（见 §10）

---

## 12. 合并建议

| 项 | 结论 |
|---|---|
| Draft PR | https://github.com/LucasJ880/-/pull/52 |
| Commit | `1108b2b`（docs 补记可能有后续 commit） |
| 是否建议进入测试环境 | **条件是**：先有隔离库完成 §10 |
| 是否 `READY_FOR_MERGE` | **否** — 当前仅 **`READY_FOR_REVIEW`** |
| 完成门槛 | 见 Security Test Report；隔离 migrate 未完成前不得合并依赖新列的生产路径 |
