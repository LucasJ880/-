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

**状态：`READY_FOR_REVIEW`**
（未推送、未合并、未跑生产迁移；Staging 接入前需隔离库 migrate。）

---

## 2. 本轮自动化测试

| 套件 | 结果 |
|---|---|
| `src/lib/scope/__tests__/scope-context.test.ts` | PASS |
| `src/lib/scope/__tests__/tenant-isolation.test.ts` | PASS |
| `src/lib/agent-harness/__tests__/harness.test.ts` | PASS |
| `src/lib/agent-core/skills/__tests__/scoped-registry.test.ts` | PASS |
| `src/lib/qm-phase1/__tests__/project-daily-brief.test.ts` | PASS |
| `npm run test:ci`（含上述） | PASS |
| `npm run typecheck` | PASS |

覆盖要点：

- ORG / USER / PROJECT / THREAD scope
- 缺 org / 无效 project / org-project 不匹配
- 伪造 org / user
- Org A ↛ Org B 项目/线程/Memory
- Tool 参数不得覆盖 Scope
- 后台无 service principal 不得跳过租户
- Harness allowlist / PendingAction 提案 / 超时与 provider 错误分类
- Skill SYSTEM/ORG/PROJECT/USER、未批准、跨项目、工具交集、suspended
- PoC Flag / allowlist / Kill Switch / Shadow / 幂等 / 不重复 PA

---

## 3. 明确未覆盖（诚实）

- 未跑完整 `test-all.sh` 回归（基线已有 9 预存失败）
- 未跑需 COOKIE 的 API / 核心 E2E 分类
- 未在真实 Postgres 上执行 additive migration
- 主聊天 `/api/ai/threads/...` 尚未强制走 Harness（兼容期；属 Phase 2）

---

## 4. 隔离库 Migration 验证

**`BLOCKED_PENDING_ISOLATED_STAGING_DATABASE`**

- 无安全一次性/隔离 Postgres 可用（环境变量未设置；无 Docker/psql）。
- **未**连接生产库，**未**连接共享测试业务库。
- 因此未能验证：migrate status 前后差、旧代码兼容新列默认值、新代码写 scope 字段、跨租户拒绝在真实 DB 上的行为。
- 应用层 QM 纯逻辑测试仍为 PASS；**不足以**将状态提升为 `READY_FOR_MERGE`。

---

## 5. 禁止项复核

未引入：QM Web UI、Slack、第二身份、第二审批表、第二 Runtime、Shell、浏览器自动操作、生产凭证沙箱、公开 Skill Marketplace、Coze 数字员工。

**合并判定：`READY_FOR_REVIEW`（Draft）≠ `READY_FOR_MERGE`。**
