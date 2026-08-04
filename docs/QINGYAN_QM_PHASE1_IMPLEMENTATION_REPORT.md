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

- 权限：用户权限 ∩ Scope ∩ Skill tools ∩ org 政策（Skill 取交集）；工具执行前 guard
- 审批：复用现有 PendingAction `createDraft`；不新增审批表/route/executor
- 原子幂等：`ProjectDailyBriefRun` 唯一键 `(orgId, projectId, briefType, localDate)`；模型前 claim
- PendingAction 幂等键：`qm.project_daily_brief:{org}:{project}:{date}:pa_suggest_note`

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
- PoC 已挂 cron，但 Flag 默认关 + 空 allowlist 时零副作用
- 隔离库 migrate 验证阻塞（见 §10；含 brief claim migration）

---

## 12. 合并建议

| 项 | 结论 |
|---|---|
| Draft PR | https://github.com/LucasJ880/-/pull/52 |
| Commit | `1108b2b`（docs 补记可能有后续 commit） |
| 是否建议进入测试环境 | **条件是**：先有隔离库完成 §10 |
| 是否 `READY_FOR_MERGE` | **否** — 正式审查修复后为 **`NOT_READY_FOR_MERGE`**（隔离 migrate 仍阻塞） |
| 完成门槛 | 见 Security Test Report；隔离 migrate 未完成前不得合并依赖新列的生产路径 |

---

## 13. 正式审查阻塞项修复（2026-08-03）

**状态：`REQUEST_CHANGES` → 代码侧已修；合并仍 `NOT_READY_FOR_MERGE`（隔离库未验证）**

| # | 根因 | 修复 |
|---|---|---|
| 1 空 allowlist | `registry.list` 用 `.length` 把 `[]` 当不过滤 | `names !== undefined`；`[]`=零工具；Harness 始终传数组 |
| 2 Scope 在执行后 | `onToolCall` 仅观测 | `pre-execute-guard` + `executeToolUnified`（流式/非流式共用） |
| 3 forceApproval 仍执行 | registry 忽略 `requiresApproval` | `approval-gate`：映射 PendingAction 或 `APPROVAL_REQUIRED_UNSUPPORTED`；executor 不调用 |
| 4 简报竞态 | `hasRun→generate→markRun` | `ProjectDailyBriefRun` 唯一键原子 claim（STARTED/COMPLETED/FAILED + stale TTL） |
| 5 Builtin migration | 全量 ORG | 修正 `20260803120000`：builtin→SYSTEM/`ownerScopeId=NULL` |
| 6 PoC 不可运行 | 仅库函数+占位 snapshot | Cron `/api/cron/qm-project-daily-brief` + 真实 project/task/document/progress 快照 |
| 补 timeout | Harness 把失败当 completed | 识别 Runtime `ok/timedOut/finishReason`；不返回成功 |
| 补 service 审计 | 无 userId 跳过 | `AuditLog.userId` 可空 + `actorType`/`servicePrincipal`；不伪造用户 |

### 本轮新增/修改要点

- `src/lib/agent-core/{pre-execute-guard,approval-gate}.ts`
- `src/lib/qm-phase1/{brief-claim,project-snapshot,adapters}.ts`
- `src/app/api/cron/qm-project-daily-brief/route.ts` + `vercel.json` cron
- migrations：`20260803120000`（语义修正）+ `20260803140000_qm_phase1_brief_claim_and_audit`
- 审计 UI/通知兼容可空 `user`

### 本地回归（本轮真实结果）

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint:baseline` | PASS |
| `npm run test:ci` | PASS |
| `npm run verify:migration-history` | PASS |
| `npm run build` | PASS |

### 仍阻塞

- **`BLOCKED_PENDING_ISOLATED_STAGING_DATABASE`**（含两则 QM migration）
- 不得 Ready for Review / 合并 / 生产 migrate / Phase 2 / 强制主聊天 Harness
