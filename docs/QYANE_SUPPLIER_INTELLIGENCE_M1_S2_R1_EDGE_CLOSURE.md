# QYANE_SUPPLIER_INTELLIGENCE_M1 — S2 R1 Edge Closure（列表一致性 + 指针对称）

> 本轮只修 R1 的两处具体遗漏，不重新全盘审计；R2 与 BL1–BL4 已接受，原样保留。
> 不动 schema/migration/生产库/生产 flag，不合并，不开 S3，不恢复 Tender V2。
> 「实跑」= 在独立 worktree（自有 `node_modules` + 自有 Prisma client）与隔离 Neon 分支上真实执行并留日志（`scratchpad/s2-r1/*`，已复核无连接串）。

---

## 0. 基线

| 项 | 值 |
|---|---|
| 仓库 / PR | `LucasJ880/-` #190（`feature/supplier-intelligence-m1-s2`），全程 **DRAFT** |
| LAST_REVIEWED_HEAD | `c789e0c84323653c38e73a0a8c2ea9f7dc164527` |
| 重新 fetch 后的实际 PR HEAD | `c789e0c8…`（一致；`rev-list c789e0c8..origin/…` = **0**，期间无他人新增提交，无需检查/避让新提交） |
| LAST_OBSERVED_MAIN / 实际 main | `5933ff7a0b17b343982cbe836ffb4931122e2e69`，漂移 **0** |
| 工作区 | 新建独立 worktree `scratchpad/s2-r1-wt`（用完移除）；用户检出 `feature/sales-quote-cost-foundation @ 9f9a43bb` 未触碰，无 reset/clean/stash 操作 |

---

## 1. A：组织管理员的列表 / 计数 / 单条权限不一致

### 1.1 根因

`assertProjectAccessForActor`（单条）与 `listAccessibleProjectIdsForActor`（批量）对 **`intakeStatus`** 的处理不对齐。单条判定树的顺序是：

```
isSuperAdmin(user.role)                 → 放行（唯一在项目查询之前返回的分支）
project 不存在 或 intakeStatus !== "dispatched"  → NOT_FOUND      ← 关键：先于下面三个分支
project.ownerId === actor.userId        → 放行
orgRole ≥ org_admin                     → 放行
projectRole（read 任一 / write 需 project_admin）→ 放行
```

批量投影却把 `org_admin` 与 `super_admin` 并成同一个 `unrestricted: true` 分支，于是列表与计数完全不施加项目集合约束。结果：**同一条信号，单条 GET 返回 NOT_FOUND，列表却把它连正文一起返回**——包括 `projectId` 为空、经 `searchRunId` 继承非 dispatched 项目的那一类。

### 1.2 修法

只改批量投影，使其逐条复刻单条判定树；canonical 权限本身一字未动：

| 角色 | 修复前 | 修复后 |
|---|---|---|
| `super_admin` | `unrestricted` | `unrestricted`（**保留既有特权**：单条里它确实在 dispatched 检查之前返回） |
| `org_admin` / `org_owner` | `unrestricted` | 本 org **全部 dispatched 项目** 的 id 集合 |
| owner / projectRole | dispatched 项目集合 | 不变 |

要点：

- `org_admin` 不再等同于 `super_admin`；它仍能访问自己有权的 dispatched 项目（A3）。
- 仍是**集合过滤**：`org_admin` 分支只多一次 `project.findMany`，没有逐行鉴权。
- `signal.projectId`、`signal.tenderId`、Run 继承的 `run.projectId` / `run.tenderId` 共用同一集合约束（`buildSignalProjectVisibilityFilter` 未改）。
- `listSignals` 与 `countSignals` 本就共用 `buildSignalListScopeFilter`，口径自动一致。
- 组织级线索（三个指针全空）不受影响。
- 未为迁就旧列表行为放宽任何 canonical 规则。

---

## 2. B：`tenderId` 与 Run 项目归属的对称校验

### 2.1 根因

`detectSubmitPointerConflicts` 只做了三条对质，缺 `tenderId` 对 `run.projectId` 的那一条：

| # | 已有 | |
|---|---|---|
| 1 | `projectId` vs `run.projectId` | ✓ |
| 2 | `projectId` vs `run.tenderId`（Run 只挂 tenderId 时） | ✓ |
| 3 | `tenderId` vs `run.tenderId` | ✓ |
| 4 | `tenderId` vs `run.projectId`（Run 只挂 projectId 时） | **缺** |

于是 `Run(projectId=A, tenderId=null)` + `Input(projectId=null, tenderId=B, searchRunId=RunA)` 返回 `[]`，混合指针静默通过。

### 2.2 修法

在共享 helper 里补上第 4 条对称检查，沿用既有 `INVALID_INPUT` 语义。因为修的是 helper 本身，三条调用路径同时生效：`createSubmittedSignal`（service）、`POST /api/supplier-intel/signals`（HTTP）、`createDiscoveredSignal`（发现落库，事务内纯函数校验，**未新增逐结果权限查询**）。

不变的部分：历史多项目归属行仍按治理集合逐项目授权（不一律拒读）；不自动重新归类、不改历史数据；同项目的合法指针与「仅继承 Run」的创建照常通过。

---

## 3. 新测试（服务 / HTTP 实路径，非 where 对象断言）

夹具做法：项目在 **dispatched 期间**由 owner 正常建 Run 与信号，随后把 `intakeStatus` 改为 `pending_dispatch`——这是真实生命周期，而不是绕过服务直接造行。

| 用例 | 断言要点 |
|---|---|
| A1 | 非 super_admin 的 `org_admin`（且非项目 owner）：非 dispatched 项目的信号单条 `NOT_FOUND`；**列表不返回**；载荷零该项目正文；`countSignals` 与列表同口径 |
| A2 | `projectId=null`、经 `searchRunId` 继承非 dispatched 项目的信号：单条与列表同样不可见 |
| A3 | dispatched 项目的单条读取、列表、写操作（review）不回归；真正的组织级线索不回归 |
| A4 | `super_admin` 既有特权保留（单条可读、列表一致）；但**不放松** org 隔离（跨 org 信号不入列表）与不可解析 Run 的保护（单条与列表都 fail-closed） |
| A-HTTP1..3 | `org_admin` 走真实路由：非 dispatched 项目单条 404、列表不含、dispatched 仍在列表内 |
| B1 | 遗漏组合（Run `projectId=A`/`tenderId=null` + Input `tenderId=B`）：用户对 A/B 都有写权限，service 与 HTTP 均拒绝（400 + `INVALID_INPUT`）；信号数与成功业务审计数前后差值均为 0 |
| B2 | 既有反向组合（Run 只挂 `tenderId=A` + Input `projectId=B`）继续拒绝 |
| B3 | 同项目指针通过；`tenderId` 指向 Run 的 `projectId` 通过（不误伤）；仅继承 Run 的创建通过 |
| B4 | `createDiscoveredSignal` 共享路径同样拒绝冲突；正常发现落库不回归（继承 Run 归属） |

**负向对照（证明断言非空）**：临时回退两处修复后重跑，S2-TB 由 118/0 变为 **108 通过 / 10 失败**——A1b、A1c、A2b、A-HTTP2 与 B1a–B1e、B4a 全部翻红（其中 HTTP 混合指针在回退态返回 **201**，即真的建成了信号），纯核 `signal-scope` 也在对称用例上失败；随后恢复修复，全绿。

---

## 4. 回归实跑（本轮，非引用上轮）

| 套件 | 结果 |
|---|---|
| S2-TB（含本轮 A1–A4 / B1–B4） | **118 通过 / 0 失败**（上轮 87 + 本轮 31） |
| Supplier Intel 纯核 12 套 | 全部 exit 0 |
| S1 审计脊柱 DB | **86 / 0** |
| S2 发现编排 DB | **32 / 0** |
| S2-FR 终审回归 DB | **38 / 0** |
| S2-REM 整改回归 DB | **42 / 0** |
| Tender Intel / Understanding 16 套 | 全部 exit 0 |
| T4 授标情报 DB（awards-db） | **18 passed / 0 failed** |

R1/R2、B4/B5/F1、BL1–BL4 的既有断言全部原样保留并通过：无删除、无跳过、未把测试用户升级成 `super_admin`（本轮新增的 `org_admin` 用户平台角色仍是普通 `user`，`super_admin` 只用于 A4 的既有特权对照），未放宽任何权限或事务约束，未扩大 lint baseline。

**测试环境稳定化**：S2-TB 现在在同一进程内跑服务层 + 路由 + 隔离库，首次并发查询会同时新建多条 Neon 连接（约 3s/条），默认 10s 池超时下偶发 `Timed out fetching a new connection`。沿用 S1 夹具的既有手段，在套件开头预热 4 条并发事务（只放宽预热事务自身的 `maxWait`，**不改生产默认值、不改任何不变量**）。

## 5. 静态门与构建

| 门 | 结果 |
|---|---|
| `tsc --noEmit --incremental false` | exit 0 |
| 改动文件 ESLint（4 个 .ts） | 0 problems |
| `npm run lint:baseline` | PASS（current 41/137 vs baseline 53/111，无新增 fingerprint） |
| `npm run build` | **exit 0**（`prisma generate` → 预览库隔离检查 → 迁移闸跳过（零 DB 连接）→ `next build --webpack`；TypeScript 92s 通过，361/361 静态页） |

## 6. 数据库与凭据

| 项 | 值 |
|---|---|
| 隔离分支 | `r1-s2-20260909`（id `br-odd-math-anldol15`，parent `br-green-boat-ann7k5yf`） |
| 生产前缀比对 | host 前缀 `ep-broad-morning-…`，`PROD_PREFIX_MATCH=false` |
| 迁移 | `prisma migrate deploy` → No pending migrations |
| 生产库 / 生产 flag | 零触碰 |
| 清理 | 已删除（`neonctl branches delete` exit 0）；复核 `branches list`：`r1-s2*` / `tb-s2*` / `rem-s2*` / `reval-s2*` 剩余 **0**，项目分支总数 15 |
| 凭据 | 连接串仅存于 0600 临时 env 文件，用后删除；日志与本报告复核无连接串 |

## 7. 提交与远端

按关注点拆 3 个提交（无 rebase、无 force、无 `git add .`）：

| sha | 提交 | 文件 |
|---|---|---|
| `f8f929ab` | fix: R1-A org_admin 的列表/计数与单条 canonical 口径对齐 | `access.ts` |
| `44a8e6b6` | fix: R1-B 补齐 tenderId 与 Run.projectId 的对称对质 | `signal-scope.ts` |
| `9b4377e5` | test: R1 Edge Closure A1–A4 / B1–B4 回归 | `signal-scope.test.ts`、`supplier-intel-s2tb-db.isolated.test.ts` |

| 项 | 值 |
|---|---|
| BASE_HEAD | `c789e0c84323653c38e73a0a8c2ea9f7dc164527` |
| CODE_HEAD_SHA | `9b4377e51051d9101aed67018f732a113ba01426` |
| FINAL_PR_HEAD_SHA | 本报告所在的 docs-only 提交（sha 与其 CI 见交付说明） |
| 推送 | 普通 push，无 rebase、无 force；远端 HEAD 已复核等于本地 |
| main 漂移 | 0 |
| CI | run `34255658644`（event=pull_request，headSha=`9b4377e5…`，completed **success** @ 2026-09-08T17:20:41Z）；步骤全部 success，含 ESLint baseline gate / Typecheck / Unit tests (CI subset) / Next.js build |
| staging | READY（`vercel ls --meta githubCommitSha=9b4377e5…` 唯一命中 `qingyan-staging-9c8onz29n-…`；`vercel inspect` → id `dpl_4dFSgAWtqLUqhtTjvAhT7ZVpNuu2`，target=preview，status ● Ready） |
| staging 运行时冒烟 | NOT_RUN（部署保护墙；未解除保护、未切生产开关制造 PASS） |

## 8. 剩余债务与未验证项

本轮只处理 A、B 两项，其余历史债务原样跟踪，**不写成「已证明无风险」**：第 4 份 Tavily（quote-engine/advisors）；`internalPoolLimit` 无上限且 `includeInternalPool:false` 时内部源停留 PLANNED；`resolutionJson` 非事务 append；`Supplier.website` 无 scheme 不参与对质；tender 三值列仍是 SCHEMA_REQUIRED 待批；`createDiscoveredSignal` 的授权仍由 `executeSupplierSearchRun` 的 run 级写断言承担（非 HTTP 入口）。

新增一条可观测项：`org_admin` 的列表过滤现在会带上本 org 全部 dispatched 项目 id 的 `in` 列表。因为 `SupplierDiscoverySignal.projectId` / `tenderId` 是无关系的裸字符串指针（schema 不可改），这是与单条口径对齐的唯一批量表达；随 org 项目数线性增长，超大 org 可在后续轮次改为关系列或物化可见性表（需 schema，故本轮不做）。

未验证项：staging 运行时行为（保护墙）；全量 `scripts/test-all.sh`（按任务书不要求）。

---

## 9. 汇报键值块

```
QYANE_SUPPLIER_INTELLIGENCE_M1_S2_R1_EDGE_CLOSURE

BASE_HEAD = c789e0c84323653c38e73a0a8c2ea9f7dc164527
CODE_HEAD_SHA = 9b4377e51051d9101aed67018f732a113ba01426
FINAL_PR_HEAD_SHA = 本报告所在的 docs-only 提交（仅本文件；sha 与其 CI 见交付说明——报告无法自述自身 sha）
REMOTE_MAIN_SHA = 5933ff7a0b17b343982cbe836ffb4931122e2e69
MAIN_DRIFT = NO（0 提交）

ORG_ADMIN_LIST_SINGLE_PARITY = PASS（非 super_admin 的 org_admin：非 dispatched 项目信号单条 NOT_FOUND，列表不返回，载荷零该项目正文；service 与 HTTP 两条路径都验证）
INHERITED_RUN_LIST_PARITY = PASS（projectId=null 且经 searchRunId 继承非 dispatched 项目 → 单条与列表同样不可见）
COUNT_VISIBILITY_PARITY = PASS（countSignals 与 listSignals 共用 buildSignalListScopeFilter，实测计数 = 列表长度）
ORG_LEVEL_SIGNAL_REGRESSION = PASS（三指针全空的组织级线索创建/读取/人审不回归）
SUPER_ADMIN_POLICY_REGRESSION = PASS（既有特权保留：单条可读且列表一致；同时不放松 org 隔离与不可解析 Run 的 fail-closed）

TENDER_POINTER_SYMMETRY = PASS（补齐 tenderId vs run.projectId 第 4 条对质；共享 helper 修复，三条调用路径同时生效）
MIXED_POINTER_HTTP_REJECTION = PASS（POST /signals 返回 400 + INVALID_INPUT，非 500/201）
MIXED_POINTER_ZERO_WRITES = PASS（信号计数与成功业务审计计数前后差值均为 0）
VALID_POINTER_REGRESSION = PASS（同项目指针、tenderId 指向 Run 的 projectId、仅继承 Run 三种合法创建均通过）

NEW_TESTS = PASS（signal-scope 纯核对称用例 + S2-TB 新增 A1–A4 / A-HTTP1–3 / B1–B4；负向对照：回退两处修复后 S2-TB 由 118/0 变 108/10，纯核同步翻红）
S1 = PASS 86/86
S2 = PASS 32/32
S2_FR = PASS 38/38
S2_REM = PASS 42/42
S2_TB = PASS 118/118
TENDER_REGRESSION = PASS（tender-intel / tender-understanding 16 套 exit 0 + awards-db 18/18）

TYPECHECK = PASS（tsc --noEmit --incremental false exit 0）
LINT_CHANGED_FILES = PASS（4 个改动 .ts：0 problems）
LINT_BASELINE = PASS（current 41/137 vs baseline 53/111；无新增 fingerprint；未扩大 baseline）
BUILD = PASS（npm run build exit 0；TypeScript 92s 通过；361/361 静态页；迁移闸跳过，零 DB 连接）
CI_HEAD_SHA = 9b4377e51051d9101aed67018f732a113ba01426（代码 HEAD；报告 docs-only 提交的 CI 见交付说明）
CI = PASS（run 34255658644，全部步骤 success，2026-09-08T17:20:41Z）
STAGING_HEAD_SHA = 9b4377e51051d9101aed67018f732a113ba01426
STAGING = READY（`vercel ls --meta githubCommitSha=9b4377e5…` 唯一命中 `qingyan-staging-9c8onz29n-…`；`vercel inspect` → id `dpl_4dFSgAWtqLUqhtTjvAhT7ZVpNuu2`，target=preview，status ● Ready）
STAGING_RUNTIME_SMOKE = NOT_RUN（部署保护墙；未解除保护、未切生产开关制造 PASS）

SCHEMA_CHANGED = NO
MIGRATION_CHANGED = NO
PRODUCTION_DB_TOUCHED = NO（仅生产 project 的临时子分支 r1-s2-20260909，PROD_PREFIX_MATCH=false）
PRODUCTION_FLAGS_CHANGED = NO
ISOLATED_DB_CLEANUP = DONE（br-odd-math-anldol15 已删；复核本轮及历史前缀剩余 0；连接串文件已删除）
ORIGINAL_WORKTREE_PRESERVED = YES（feature/sales-quote-cost-foundation @ 9f9a43bb；未提交改动与 4 个 stash 原样；未 reset/clean/stash）

BLOCKERS = NONE
UNVERIFIED_ITEMS = staging 运行时行为（部署保护墙）；全量 scripts/test-all.sh（任务书不要求）；org_admin 列表过滤随 org 项目数线性增长的 in 列表规模（记录为可观测项，改关系列/物化视图需 schema，本轮禁）
RECOMMENDATION = READY_FOR_S2_FINAL_REVIEW

PR = #190
PR_STATE = DRAFT
PR_MERGED = NO
S3_STARTED = NO
```
