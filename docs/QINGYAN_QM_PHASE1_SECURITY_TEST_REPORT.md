# Qingyan × QM Phase 1 — 安全与测试报告

**分支：** `feature/qm-scope-runtime-phase1`
**基线：** `3ddad4e`
**日期：** 2026-08-03

---

## 1. 安全门槛对照

| 门槛 | 结果 |
|---|---|
| 原有构建不退化 | PASS（`npm run build` 基线已绿；本轮 typecheck/test:ci 绿） |
| 跨组织/跨项目越权测试全过 | PASS（`scope/__tests__/tenant-isolation.test.ts`） |
| ScopeContext 由服务端构造 | PASS |
| 新 Tool 路径带有效 scope/principal | PASS（Harness 强制从 ScopeContext 投影） |
| 高风险动作经现有 PendingAction | PASS（Harness 不直写；PoC 仅建议） |
| 无第二套权限/审批/Runtime | PASS |
| Memory 不跨 scope 污染 | PASS（`assertSameOrg` / `assertSameProject`） |
| PoC 默认关闭 + allowlist | PASS |
| 幂等与重试 | PASS |
| Kill Switch 有效 | PASS |
| 有审计事件钩子 | PASS（`writeQmAuditEvent`） |
| 有回滚方案 | PASS（见 ROLLBACK.md） |
| migrate 未绑 build | PASS |
| 无 Shell/浏览器/生产凭证沙箱 | PASS（未引入） |

**状态：`NOT_READY_FOR_MERGE`**
（审查阻塞项已在代码侧修复并推 Draft #52；隔离库 migrate 仍未验证；未 Ready for Review。）

---

## 2. 本轮自动化测试

| 套件 | 结果 |
|---|---|
| `src/lib/scope/__tests__/scope-context.test.ts` | PASS |
| `src/lib/scope/__tests__/tenant-isolation.test.ts` | PASS |
| `src/lib/scope/__tests__/service-audit.test.ts` | PASS |
| `src/lib/agent-harness/__tests__/harness.test.ts` | PASS |
| `src/lib/agent-core/skills/__tests__/scoped-registry.test.ts` | PASS |
| `src/lib/agent-core/__tests__/pre-execute-guard.test.ts` | PASS |
| `src/lib/qm-phase1/__tests__/project-daily-brief.test.ts` | PASS |
| `src/lib/qm-phase1/__tests__/brief-claim.test.ts` | PASS |
| `src/lib/qm-phase1/__tests__/skill-migration-semantics.test.ts` | PASS |
| `src/lib/qm-phase1/__tests__/project-snapshot-isolation.test.ts` | PASS |
| `npm run test:ci` | PASS |
| `npm run typecheck` / `lint:baseline` / `verify:migration-history` / `build` | PASS |

覆盖要点（审查要求 1–15）：

1. 空 allowlist = 零工具（Registry 集成）
2. allowlist 仅暴露指定工具
3–5. Scope 冲突 / 参数覆盖在 executor 前拒绝；流式与非流式共用 `executeToolUnified`
6. forceApproval 不直执；不支持映射 → `APPROVAL_REQUIRED_UNSUPPORTED`
7. PendingAction 幂等不重复（brief + draft key）
8–9. 并发 claim 仅一胜；stale/FAILED 可安全重试
10. Builtin → SYSTEM migration fixture
11. service principal 无 userId 仍审计（不 skip）
12. timeout/provider failure 不返回 `ok=true/completed`（真实 result 形状）
13–14. Flag / Kill Switch / Shadow / allowlist
15. Org A ↛ Org B 项目快照

---

## 3. 明确未覆盖（诚实）

- 未跑完整 `test-all.sh` 回归（基线已有 9 预存失败）
- 未跑需 COOKIE 的 API / 核心 E2E 分类
- **未在真实 Postgres 上执行 additive migration**（含 brief claim 表）
- Prisma 并发 claim 的 DB 级 P2002 竞态：内存 store 已测；真实 DB 待隔离库
- 主聊天尚未强制走 Harness（Phase 2）

---

## 4. 隔离库 Migration 验证

**`BLOCKED_PENDING_ISOLATED_STAGING_DATABASE`**

- 无安全一次性/隔离 Postgres 可用。
- **未**连接生产库，**未**连接共享测试业务库。
- Preview / 普通 build **不能**替代 migrate 验证。
- 应用层测试 PASS **不足以** `READY_FOR_MERGE`。

---

## 5. 禁止项复核

未引入：第二审批表/route/executor、第二 Runtime/Registry、Shell/浏览器沙箱、生产迁移、Phase 2 主聊天强制切换。

**合并判定：`NOT_READY_FOR_MERGE`（Draft 保持；未经确认不得 Ready for Review）。**
