# Qingyan Production Operation Guard

> 模块：`src/lib/db-safety/production-operation-guard.ts`
> 测试：`src/lib/db-safety/__tests__/production-operation-guard.test.ts`
> 关联：PR #76 `assertSafeTestDatabase`（`src/lib/testing/assert-safe-test-database.ts`）

## 1. 两套安全机制的分工（不合并）

| | assertSafeTestDatabase (#76) | assertProductionOperationAllowed（本机制） |
|---|---|---|
| 服务对象 | TEST / FIXTURE / ACCEPTANCE / SMOKE | AUTHORIZED PRODUCTION MAINTENANCE（backfill / cleanup / repair / revoke / production seed / bulk update） |
| 对生产库 | **永远 BLOCK**，任何信号组合（含 opt-in token）不放行 | 严格流程下**允许**：VERIFY TARGET → DRY RUN → SHOW IMPACT → EXPLICIT CONFIRMATION → EXECUTE |
| 安全模型 | fail-closed 黑名单 + 隔离白名单 | 声明式目标 + 双向身份校验 + 操作级确认 |

两个 helper **不合并**：一个的存在意义是"这里永远不该是生产库"，另一个是"这里就是要动生产库，但必须走完整流程"。合并会让任一侧的规则被另一侧的例外污染。

DB 身份判定完全复用既有实现（无第三套）：

- URL host / database 解析：`inspectDbUrl`（`src/lib/testing/assert-safe-test-database.ts`，#76 引入，本任务导出复用）
- production / staging / other plane：`classifyDbPlane`（`src/lib/env/runtime-isolation.ts`）
- local host 判定：`classifyDbHost`（#76）

## 2. 契约

```ts
assertProductionOperationAllowed({
  operationName: "BACKFILL_TRADE_PROSPECT_STAGE",   // 大写蛇形
  operationType: "PRODUCTION_WRITE",                 // 见 §3 分类
  targetEnvironment: "production",                   // 操作者显式声明（--target= / 默认）
  scriptName: "scripts/backfill-trade-prospect-stage.ts",
  scope: { kind: "global", reason: "..." }           // 或 { kind: "org", orgId, orgName }
       ,
  apply: false,                                      // --apply / --write 时为 true
  dryRunCompleted: true,                             // 本次运行已先算过同口径 impact
  noSafeDryRun: false,                               // 无法安全 dry-run 时显式声明
  estimatedImpact: { kind: "known", rows: 218 },     // 或 { kind: "unknown", reason }
  // confirmationToken 缺省读 env.PRODUCTION_OPERATION_CONFIRM
});
```

返回 `ProductionOperationVerdict`（`writeAllowed` 只在 WRITE_ALLOWED 时为 true）；未获授权抛 `ProductionOperationGuardError`。密码/连接串不进 contract，也不进任何输出。

辅助入口：

- `verifyOperationDatabaseTarget()`：脚本在**任何查询之前**调用，只做目标/身份/信号校验；
- `resolveDeclaredTargetEnvironment(argv, env, fallback)`：读 `--target=` 或 `PRODUCTION_OPERATION_TARGET`；
- `buildOperationConfirmationPhrase()`：构造 apply 所需 phrase。

## 3. 规则矩阵

### 目标校验（多信号，双向）

| 声明 target | 实际 DB 身份 | 判定 |
|---|---|---|
| production | 已知生产 endpoint（`ep-super-field-antfibsl*`） | 通过 |
| production | staging / localhost | **BLOCK** `TARGET_DB_MISMATCH` |
| production / staging | 未识别远程 host | **BLOCK** `UNKNOWN_DB_IDENTITY`（endpoint rotation 后先把新 host 加入 `KNOWN_PRODUCTION_DB_ENDPOINT_PREFIXES` / `QINGYAN_PRODUCTION_DB_ENDPOINT_PREFIXES` 再操作） |
| preview / staging / local | 生产 endpoint | **BLOCK** `TARGET_DB_MISMATCH`（isolated 标记救不回） |
| preview | 未识别远程 + `DATABASE_ENVIRONMENT=isolated` | 通过（与 #76 口径一致） |
| 任意 | URL 缺失 / 无法解析 / DATABASE_URL 与 DIRECT_URL 身份不一致 | **BLOCK** `DB_IDENTITY_UNRESOLVED` |

运行时信号：`QINGYAN_RUNTIME_ENV` / `QINGYAN_EXPECTED_DB_PLANE` / `VERCEL_ENV` 与声明 target 冲突 → `RUNTIME_SIGNAL_CONFLICT`；`NODE_ENV=test` 下对生产 apply 一律阻断（该场景属 assertSafeTestDatabase 管辖）。**不靠 NODE_ENV 单一判断。**

### 写入流程

1. **默认 dry-run**：无 `--apply`（或 `--write`）→ `DRY_RUN_ONLY`，只允许 inspect / impact 计算 / 报告，`writeAllowed=false`；
2. **apply 前置**：必须已完成同口径 dry-run 计算（`dryRunCompleted`），否则 `REQUIRE_DRY_RUN_FIRST`；
3. **operation-specific confirmation**（无长期万能 secret；不做 Web approval）：
   - 已知影响：`PRODUCTION:<OPERATION_NAME>:<rows>` —— 行数编入 phrase，数据一变 phrase 即失效，天然强制重跑 dry-run；
   - 影响未知 / `NO_SAFE_DRY_RUN`：`PRODUCTION:<OPERATION_NAME>:IMPACT_UNKNOWN:I_ACCEPT_UNPREDICTABLE_IMPACT`（更强显式 override）；
   - 缺失 → `CONFIRMATION_REQUIRED`；不匹配 → `CONFIRMATION_MISMATCH`；
4. **Org scope**：租户数据操作必须显式 `{ orgId, orgName }`（报告打印 `Organization: <名称> (<id>)`），防止 WHERE 缺失全库操作；全库维护必须显式 `{ kind: "global", reason }`；
5. **事务**：批量写优先单条 `updateMany` 短事务；禁止事务中等待外部 API / LLM 长时间持锁；
6. **审计**：每次调用输出 `[production-operation-audit]` structured log（who / when / operation / script / target / host / db / scope / impact / result）。V1 以脚本输出为 artifact，不新增 DB 模型（评估过复用 capability audit —— 该模型绑定 org/tenant 语义与 HTTP 上下文，不适合 shell 维护脚本，强行复用需造假 tenant 上下文，反而破坏其审计语义）；
7. **Secrets**：输出只含 host / database 名 / operation / org / impact；不打印 DATABASE_URL、密码、API key，也不回显操作者提供的 confirmation token（只标记 provided/absent）。

### 操作报告样例（dry-run）

```text
═══════════════════════════════════════════════════════
PRODUCTION OPERATION GUARD
Operation: BACKFILL_TRADE_PROSPECT_STAGE (PRODUCTION_WRITE)
Script: scripts/backfill-trade-prospect-stage.ts
Target: production
Host: ep-super-field-antfibsl-pooler.c-6.us-east-1.aws.neon.tech
Database: neondb
DB Plane: production
GLOBAL — 跨组织 stage 字段归一化（无 org 维度）
Estimated impact: 218 rows — TradeProspect.stage updateMany（按旧值分组）
Dry Run: YES (default)
Confirmation: absent
Mode: DRY_RUN_ONLY
WRITE_ALLOWED = NO
To apply: 重跑并加 --apply，且 PRODUCTION_OPERATION_CONFIRM=PRODUCTION:BACKFILL_TRADE_PROSPECT_STAGE:218
═══════════════════════════════════════════════════════
```

## 4. 生产脚本审计与分类（2026-08，main@399dcce）

| 脚本 | 分类 | 状态 |
|---|---|---|
| `backfill-trade-prospect-stage.ts` | PRODUCTION_WRITE（backfill） | ✅ **V1 已集成** |
| `security1-revoke-trade-sales-bindings.ts` | PRODUCTION_WRITE（安全修复/revoke） | ✅ **V1 已集成**（原脚本无 dry-run，直接写；已改为 dry-run 默认 + 单 updateMany） |
| `governance-hygiene-supersede.ts` | PRODUCTION_WRITE（治理维护） | ✅ **V1 已集成**（原有 --apply 语义保留） |
| `backfill-sales-org-id.ts` / `backfill-sales-org-mapping.ts` | 归档 | @deprecated，main() 即抛错，无需集成 |
| `backup-sales-org-mapping.ts` / `backup-sales-org-not-null-phase-b.ts` | READ_ONLY / BACKUP | 只读，无需写门禁（可选接 verifyOperationDatabaseTarget） |
| `sales-org-id-audit.ts` / `trade-intelligence-audit.ts` | READ_ONLY | 静态/只读审计，无需集成 |
| `phase3b-backfill-ai-thread-org.ts` | PRODUCTION_WRITE（backfill） | ⏳ PENDING_INTEGRATION |
| `migrate-blob-private.ts` | MIGRATION（Blob 跨 store 搬迁，外部副作用） | ⏳ PENDING_INTEGRATION（候选 NO_SAFE_DRY_RUN） |
| `rotate-org-unlock-code.ts` | PRODUCTION_WRITE（org 级，一次性） | ⏳ PENDING_INTEGRATION（org scope 示例） |
| `security1-fix-alex-archived-membership.ts` | PRODUCTION_WRITE（数据修复，一次性） | ⏳ PENDING_INTEGRATION |
| `seed-company-sunny.ts` / `seed-org-sunny-home-deco.ts` / `seed-org-mengxin-home-textile.ts` / `seed-org-semantics-phase2b.ts` | PRODUCTION_WRITE（production seed，幂等 upsert） | ⏳ PENDING_INTEGRATION |
| `seed-enterprise-skills.ts` / `seed-marketing-phase2-skills.ts` / `seed-operations-skills.ts` / `seed-visualizer-catalog.ts` | PRODUCTION_WRITE（平台目录 seed，幂等） | ⏳ PENDING_INTEGRATION |
| `import-fabric-catalog.ts` / `import-visualizer-catalog.ts` | PRODUCTION_WRITE（目录导入，跳过已存在） | ⏳ PENDING_INTEGRATION |
| `regen-mengxin-amazon-styles.ts` / `trial-mint-palace-bedding.ts` | PRODUCTION_WRITE + 外部生图 API | ⏳ PENDING_INTEGRATION（候选 NO_SAFE_DRY_RUN） |
| `wave15-seed-staging.ts` | STAGING 专用 | 已有 `assertWave15SeedTargetAllowed` 专用门禁，不重复接 |
| `wechat-worker.ts` / `debug-wecom-inbound.ts` | 运行时 worker / debug | 不属于运维操作范畴 |

RESTORE 类脚本当前不存在；将来新增时必须按 `DESTRUCTIVE_PRODUCTION_WRITE` + `RESTORE` 类型接入。

## 5. 新脚本接入模板

```ts
const OPERATION_NAME = "MY_OPERATION";
const SCRIPT_NAME = "scripts/my-operation.ts";
const apply = process.argv.includes("--apply");
const target = resolveDeclaredTargetEnvironment(process.argv, process.env, "production");

verifyOperationDatabaseTarget({ operationName: OPERATION_NAME, scriptName: SCRIPT_NAME, targetEnvironment: target });

// …只读 inspect，计算 impact（rows / orgs / objects）…

const verdict = assertProductionOperationAllowed({
  operationName: OPERATION_NAME,
  operationType: "PRODUCTION_WRITE",
  targetEnvironment: target,
  scriptName: SCRIPT_NAME,
  scope: { kind: "org", orgId, orgName },  // 租户操作必须显式 org
  apply,
  dryRunCompleted: true,
  estimatedImpact: { kind: "known", rows },
});
if (!verdict.writeAllowed) return;   // dry-run 到此为止

// …短事务批量写…
```

## 6. 开发红线

开发/测试本 Guard 期间禁止连真实生产 DB 执行 mutation：所有生产场景用 pure env simulation（伪造 URL 的 host 部分）验证；集成脚本的行为验证只允许 dry-run 路径或 BLOCK 路径。
