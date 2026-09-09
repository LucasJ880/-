# QYANE SUPPLIER INTELLIGENCE M1 — S2 FINAL REMEDIATION（BL-1～BL-4 + 可靠回归）

| 项 | 值 |
|---|---|
| 日期 | 2026-09-08（Asia/Shanghai） |
| 性质 | 定点整改（不做全盘审计）：同步 main、修 BL-2、修 BL-3 测试、补 BL-4 覆盖、稳定 S1 并发测试条件；提交并推送到原 PR #190；**PR 保持 DRAFT，未 merge，未开始 S3，未恢复 Tender V2** |
| 前置报告 | `docs/QYANE_SUPPLIER_INTELLIGENCE_M1_S2_REVALIDATION.md`（原始观察结论保留，本报告不覆盖它；本轮结果单独记录） |
| 分支 / PR | `feature/supplier-intelligence-m1-s2` / #190 |
| 执行环境 | 独立 worktree `scratchpad/s2-fix-wt`（从本地分支 ref 检出；独立 `npm ci`，Node 24.19.0）；DB 平面 = 生产 project 临时子分支 `rem-s2-20260908`（已删） |

> 约定：行号取自 FINAL_HEAD 检出的 `cat -n`；「开发者报告」= 提交信息；「实跑」= 本轮在隔离 worktree / 隔离 Neon 分支真实执行并留有日志（`scratchpad/s2-reval/rem-logs/*`，已用 `grep -v 'postgres://'` 复核无连接串）。未实跑一律 NOT_RUN / UNVERIFIED。

---

## 0. 基线核对与工作区保护

| 项 | 值 |
|---|---|
| 起始重新 fetch | `origin/main = 5933ff7a0b17b343982cbe836ffb4931122e2e69`（= LAST_OBSERVED_MAIN）；`origin/feature/supplier-intelligence-m1-s2 = 4e6cbc754fa2f525f31a8b8a55725f1e8983b823`（= LAST_REVIEWED_HEAD；`refs/pull/190/head` 同值；分支自上轮零新增提交 → 无需判断「整改是否已被他人完成」） |
| PR 起始元数据 | OPEN / isDraft=true / mergeable=CONFLICTING / mergeStateStatus=DIRTY / base `2770fae3` |
| 本机工作区（起始与结束核对） | 分支 `feature/sales-quote-cost-foundation` @ `9f9a43bb`；未提交改动 **45 条**（上轮 44 + 上轮报告 `docs/QYANE_SUPPLIER_INTELLIGENCE_M1_S2_REVALIDATION.md`）；stash **4 个**（`stash@{0..3}` 原样）——全程未 reset/clean/stash pop/覆盖 |
| worktree 处理（如实披露） | 本地分支 `feature/supplier-intelligence-m1-s2` 被一条**失效**的 worktree 记录占用（`…/d5b3f7ab…/scratchpad/s2-wt`，`git worktree list` 标注 `prunable gitdir file points to non-existent location`，目录已不存在，不属任何在用工作）。执行 `git worktree prune -v` 移除了该记录，同时移除了另一条同样目录不存在的失效记录 `…/58347b60…/scratchpad/mengxin-wt`。**未**对任何存在目录的 worktree 使用 `--force` 或做改动。随后 `git worktree add scratchpad/s2-fix-wt feature/supplier-intelligence-m1-s2`（无 force） |
| 提交纪律 | 逐文件 `git add <path>`（零 `git add .`）；不含 `.env` / 凭据 / 连接串；6 个可审查提交（1 同步 + 5 整改）；`git push` 无 force |

---

## 1. Blocker → 修改文件 → 测试 → 结果 对应表

| Blocker | 提交 | 修改文件 | 测试 | 实跑结果 |
|---|---|---|---|---|
| BL-1 同步 main（test-ci-unit.sh 冲突） | `efdd0785`（merge） | `scripts/test-ci-unit.sh`（keep-both）、`scripts/test-all.sh`（自动合并核对）+ main 带入 146 文件 | `bash -n` ×2；注册计数；重复检查；`npm run test:ci` 由 CI 执行 | 冲突 1 hunk 已解；supplier-intel 注册 10 → 本轮 14；revenue-spine 4；npx 行零重复；run_test 355 → 359 零重复 |
| BL-2 扫描完整性贯穿全分支 + 持久快照 | `a49b7b4a` | `src/lib/supplier-intel/entity-resolution.ts`；`__tests__/entity-resolution.test.ts`（B5 用例改显式扫描状态，断言不变）；`__tests__/identity-scan.test.ts`（新） | 纯核 identity-scan（6 分支 × 4 形态）；entity-resolution 既有套件；DB s2rem D1–D6 | 全部 PASS（见 §3） |
| BL-3 空断言守卫 | `26f15220` | `__tests__/canonical-boundary-guard.ts`（新，AST）；`__tests__/fixtures/canonical-boundary-negative/*.ts.txt`（4 个负向 fixture）；`__tests__/governance.test.ts` | governance（真实文件零违规 + 负向 fixture 11 条违规码）；DB s2rem E1–E4 | 全部 PASS（见 §4） |
| BL-4 CI 可执行覆盖 | `86b2452b` | `src/lib/supplier-intel/discovery-service.ts`（最小提取 `bindQueryPlan` / `decideRunFinalization`，行为不变）；`__tests__/egress-plan.test.ts`（新）；`__tests__/run-finalization.test.ts`（新） | egress-plan A1–A5；run-finalization B1–B6；DB s2rem F1–F3 | 全部 PASS（见 §5） |
| S1 三条竞态失败 | `4cd1d99b` | `__tests__/supplier-intel-db.isolated.test.ts`（仅 T20 夹具） | S1 DB 全套连续 3 次 | 86/86 ×3（见 §6） |
| DB 套件 + 注册 | `fb7f91cf` | `__tests__/supplier-intel-s2rem-db.isolated.test.ts`（新）；`scripts/test-ci-unit.sh`；`scripts/test-all.sh` | s2rem 42 项 | 42/42 |

---

## 2. BL-1：同步 main 的提交与冲突处理

| 键 | 值 |
|---|---|
| PRE_SYNC_HEAD | `4e6cbc754fa2f525f31a8b8a55725f1e8983b823` |
| SYNC_TARGET_MAIN_SHA | `5933ff7a0b17b343982cbe836ffb4931122e2e69`（fetch 后核对，与观察值一致） |
| 同步方式 | `git merge --no-ff origin/main`（main → feature 分支；非 rebase、非 force；**不是**把 PR 合进 main） |
| SYNC_COMMIT_SHA | `efdd07852948d01c7fcb952f943fdb7898ed3c98` |
| CONFLICTING_FILES | `scripts/test-ci-unit.sh`（唯一；与上轮报告一致）；`scripts/test-all.sh` 自动合并 |
| 冲突处理 | 同一锚点（S1 DB 套件行后）双方各追加：keep-both——S1 四条 → S2 六条（PR 侧）→ main 的 Revenue Spine 注释 + 四条 → `wave15-smoke-readonly`；未用 ours/theirs 单边覆盖；main 在 101–107 行追加的 7 条（tenant-context / trade×5 / trade-layout）自动合并保留；`set -euo pipefail` 与退出码纪律不变；`bash -n` 通过；`npx` 行零重复 |
| test-all.sh 语义核对 | run_test 343（base）+6（main：Revenue Spine×4、Blinds Valance、乱码文档作废）+6（S2）= 355，零重复，`bash -n` 通过；S2 六条紧接 S1 四条之后，语义位置正确 |
| SYNC_TARGET_IS_ANCESTOR | `git merge-base --is-ancestor origin/main HEAD` = YES（对 FINAL_HEAD 亦成立） |
| 同步带入 vs 本轮主动修改 | 同步带入：main 的 146 文件（#191–#205：4 个 migration、4 个新模型、window_covering 门控、Org↔Company、Trade 询盘、Revenue Spine…）——**非本轮修改**，由 `efdd0785` 单独承载；本轮主动修改：5 个后续提交共 13 个文件（见 §1），全部在 `src/lib/supplier-intel/**` 与 `scripts/test-*.sh` |
| 实质业务冲突 | 无（PR190 编译图内文件 main 零改动；上轮 D 报告结论保持） |

---

## 3. BL-2：返回值与持久快照证据

### 3.1 实现（`src/lib/supplier-intel/entity-resolution.ts` @ FINAL_HEAD）

| 要点 | 位置 |
|---|---|
| `IDENTITY_SCAN_INCOMPLETE` 常量、`IDENTITY_SCAN_PAGINATION = {500, 40}`（生产上限） | :237, :244 |
| `IdentityScanPassStatus {complete, pages, rows, capped}` ×2（suppliers / linkedHistory）+ 整体 `complete` + `reasonCode` + `pageSize/maxPages` = `IdentityScanStatus`；`identityScanStatusOf()` | :250–295 |
| 结果类型新增 `scan: IdentityScanStatus`（与 decision 分离） | :188 |
| `resolveSupplierEntityPure`：先收集全部命中 / F1 冲突 / 候选，再裁决；`if (!scan.complete)` → `NEEDS_HUMAN_REVIEW`、`supplierId=undefined`、`legalName=undefined`、conflicts 追加 `IDENTITY_SCAN_INCOMPLETE：…suppliers=…linkedHistory=…`，`matchedSources/conflicts` 原样保留；完整时六类分支行为不变 | :350–545（裁决 :466） |
| `fetchAllPages` 返回真实分页状态（页数 / 行数 / capped）；触顶 = maxPages 用尽且末页满页 | :561–582 |
| `resolveSignalEntity`（生产入口，固定 500×40）→ `resolveSignalEntityWithPagination`（内部/测试注入点；`clampPagination` 只能收窄）；每页 `orgId` 过滤；prior 仍只沉淀平台精确账号 | :548–558, :584–678 |
| 持久化：`entry = {phase:"AUTO_PREFILL", result, hints, scan, at, byUserId}` 追加进 `resolutionJson`（result.scan 与顶层 scan 同一对象） | :657–676 |
| 历史条目：`readIdentityScanFromResolutionEntry()` 缺 scan → `{recorded:false, reason:"MISSING"}`；结构不合法 → `MALFORMED`；不回填、不改写 | :327–348 |
| HTTP 面不变：`signals/[id]/resolve/route.ts` 仍只调用 `resolveSignalEntity`；governance 守卫断言路由不引用注入点 | governance.test.ts + canonical-boundary-guard.ts `checkResolveRoute` |

### 3.2 纯核（`identity-scan.test.ts`，实跑 exit 0）

六类分支（单一强命中 / 同一强身份多供应商 / 跨键分裂 / 名称等值 / 模糊 / 无线索）×
{完整、供应商触顶、LINKED 史触顶、双触顶}：完整时 decision/supplierId/confidence/matchedKinds 与既有行为逐项相同；三种不完整形态一律 `NEEDS_HUMAN_REVIEW` + `supplierId=undefined` + `IDENTITY_SCAN_INCOMPLETE`（含两类扫描状态词），并断言强键命中 kind、F1 冲突元数据（`supplierIds=[sup_a,sup_b]`）、fuzzy/normalized 候选均保留；「无线索」在不完整时**不再**返回 `NEW_SUPPLIER_CANDIDATE`。另：纯核省略 scan = 内存全集按构造完整（rows 如实取自传入集合）；历史条目缺 scan → recorded:false。

### 3.3 真实服务路径（`supplier-intel-s2rem-db.isolated.test.ts`，隔离库实跑 42/42）

| 用例 | 证据 |
|---|---|
| D1 生产分页 | `resolveSignalEntity` → `MATCHED_EXISTING`；`scan.complete=true, reasonCode=null, pageSize=500, maxPages=40, suppliers.rows=5`；`resolutionJson` 1 条；持久 `scan`（顶层 + `result.scan`）与返回值键序无关深相等；`readIdentityScanFromResolutionEntry` → recorded:true |
| D2 供应商扫描触顶 | `resolveSignalEntityWithPagination(…, {pageSize:2, maxPages:1})`（5 家供应商）→ `NEEDS_HUMAN_REVIEW`、`supplierId=undefined`；`scan.suppliers={complete:false, pages:1, rows:2, capped:true}`，`linkedHistory.complete=true`，`reasonCode=IDENTITY_SCAN_INCOMPLETE`；conflicts 含 `suppliers=incomplete` 与 `linkedHistory=complete`；`resolutionJson` 追加为 2 条，第 1 条内容不变，第 2 条 `scan`/`result` 与返回值一致 |
| D2b 页边界正常穷尽 | `{pageSize:2, maxPages:10}` → suppliers 3 页 5 行 complete → 仍 `MATCHED_EXISTING` |
| D3 LINKED 史触顶（另一类完整） | orgL：2 家供应商 + 5 条 LINKED 精确账号史，`{pageSize:4, maxPages:1}` → `suppliers.complete=true(rows 2)`、`linkedHistory={complete:false, capped:true, rows:4}` → 整体不完整 → NEEDS；`platform_account` 命中证据保留；持久 `linkedHistory.complete=false` |
| D4 跨页穷尽 | `{pageSize:2, maxPages:10}` → linkedHistory 3 页 5 行、suppliers 2 页 2 行 → 完整 → `MATCHED_EXISTING`；第二条 append，第一条（不完整）快照原样保留 |
| D5 跨 org | orgL 扫描行数只含本 org；他 org 官网域名在本 org → `NEW_SUPPLIER_CANDIDATE`（生产分页一页穷尽 → 完整） |
| D6 注入钳制 | `{pageSize:9999, maxPages:9999}` → `scan.pageSize=500, maxPages=40` |

保留项核对：B4（`ownedDomains` 仍恒空、只沉淀平台精确账号 :658–672）、F1 Set 裁决、无自动 LINK/合并（`linkedSupplierId` 唯一写点仍是 `signal-service.ts` 人工 LINK）——既有 entity-resolution / S2-FR 套件全绿。

---

## 4. BL-3：负向测试有效性证据

### 4.1 守卫（`__tests__/canonical-boundary-guard.ts`，TypeScript 编译器 API）

| 面 | 检查 | 违规码 |
|---|---|---|
| `project-run-service.ts` | `interface ProjectSearchRunHints` 无 `requirements` 成员；`createProjectSearchRun` 第二参数类型（文件内解析，解析不到即违规）无 `requirements`；ACL 语句序号 < canonical loader 语句序号；`createSearchRun({ requirements: <loaderVar>.entries })` 且 `loaderVar` 来自 `await loadCanonicalSupplierRequirementSnapshot(...)` | `HINTS_HAS_REQUIREMENTS` / `CREATE_INPUT_HAS_REQUIREMENTS` / `CREATE_INPUT_TYPE_UNRESOLVED` / `ORDER_ACL_AFTER_CANONICAL` / `SNAPSHOT_NOT_FROM_CANONICAL` |
| `runs/route.ts` | 任何 `.requirements` / `["requirements"]` 访问；传给 `createProjectSearchRun` 的对象字面量键 ⊆ {projectId, allowLlm, hints}（含 spread/computed 视为违规）；POST 写门语句序号 < 服务调用；GET 走读门 | `ROUTE_READS_BODY_REQUIREMENTS` / `ROUTE_PASSES_UNKNOWN_KEY:<k>` / `ROUTE_MISSING_WRITE_GATE` / `ROUTE_GATE_AFTER_SERVICE` / `ROUTE_MISSING_READ_GATE` |
| `discovery-service.ts` | `executeSupplierSearchRun` 顶层语句：ACL < `buildExternalQueryPlan` < `discover`；任一锚点缺失即违规（消灭 indexOf=-1 假阳性） | `ORDER_ANCHOR_MISSING:*` / `ORDER_ACL_AFTER_PLAN` / `ORDER_PLAN_AFTER_EGRESS` / `ORDER_ACL_AFTER_EGRESS` |
| `signals/[id]/resolve/route.ts` | 不得引用 `resolveSignalEntityWithPagination`；必须调用 `resolveSignalEntity` | `RESOLVE_ROUTE_USES_PAGINATION_INJECTION` / `RESOLVE_ROUTE_MISSING_CANONICAL_CALL` |

### 4.2 结果（`governance.test.ts`，实跑 exit 0）
- 真实四文件：违规码 **[]**（`assert.deepEqual(violationCodes(real), [])`）。
- 负向 fixture（`__tests__/fixtures/canonical-boundary-negative/{project-run-service,runs-route,discovery-service,resolve-route}.bad.ts.txt`，`.txt` 后缀不进 tsc/eslint）：守卫报出全部 11 条预期违规码——`HINTS_HAS_REQUIREMENTS, CREATE_INPUT_HAS_REQUIREMENTS, ORDER_ACL_AFTER_CANONICAL, SNAPSHOT_NOT_FROM_CANONICAL, ROUTE_READS_BODY_REQUIREMENTS, ROUTE_PASSES_UNKNOWN_KEY:requirements, ROUTE_MISSING_WRITE_GATE, ORDER_ACL_AFTER_PLAN, ORDER_ACL_AFTER_EGRESS, RESOLVE_ROUTE_USES_PAGINATION_INJECTION, RESOLVE_ROUTE_MISSING_CANONICAL_CALL`，且四个面各至少一条。**正常实现 = 零违规；负向 fixture = 11 违规**，分别记录，故意违规代码只存在于 fixture，未进业务代码。

### 4.3 行为面（DB s2rem，隔离库实跑）
| 用例 | 证据 |
|---|---|
| E1 伪造 requirements | `createProjectSearchRun(owner, { …, requirements:[{code:"R-001", mandatory:false, text:"forged"}] } as never)` → `requirementSnapshotJson` 4 条全量、R-001 仍 `true`、伪造条目零落地 |
| E2 mandatory=false 降级 | 同一调用：R-003 仍 `false`、R-004 仍 `"uncertain"`（RISKS 聚合） |
| E3 额外字段 | `hints.extraField` / 顶层 `unknownTopLevel` 不进 brief / sourceConfig / queries 快照（现有契约：服务层白名单拷贝；HTTP 契约未改） |
| E4 无项目权限 | `createProjectSearchRun(plain, {allowLlm:true}, {invoker})` → `PROJECT_ACCESS_DENIED`，**LLM 调用 0**；`getProjectSearchRun(plain)` 拒；`executeSupplierSearchRun(plain, …, {provider})` 拒，**provider 调用 0** |

---

## 5. BL-4：CI 实际运行证据

### 5.1 最小提取（`discovery-service.ts`，行为不变）
- `bindQueryPlan(adapter, plan)`（:134）替换 Phase B-2 的内联对象（:301）；
- `decideRunFinalization(sources)`（:161）替换内联 `allFailed`（:400）：DISABLED/PLANNED 不计入已执行源；已执行源全 FAILED → FAILED；否则 COMPLETED（含 EMPTY）。既有 S2 语义与状态机未变。

### 5.2 普通 CI 真实执行的套件（`test-ci-unit.sh` 新增 3 条；本地实跑 exit 0）
- `egress-plan.test.ts`：A1 混合输入 3 条敏感丢弃 / 2 条安全保留；A2 安全输入零丢弃；A3 全部过滤 → 每个 adapter 计划为空 → 真实 `bindQueryPlan → discover` 路径 **provider 调用 0**；A4 provider 收到的查询 = 计划、零敏感词；A5 默认 adapter 集合天花板 11（<12），合成 adapter 15 安全 + 1 敏感 → 保留 12、`budgetTrimmed=3`、`egressDropped=1`（两类计数分开）、绑定执行 provider 恰收 12 条零敏感词。断言消息不回显敏感词，仅回显计数。
- `run-finalization.test.ts`：B1 全部已执行源 FAILED → FAILED（executed=3，DISABLED/PLANNED 不计）；B2 仅 DISABLED/PLANNED → executed=0，不构成全失败（保持既有 COMPLETED 语义）；B3 SUCCESS+FAILED → COMPLETED、失败详情保留；B4 EMPTY+FAILED → COMPLETED、EMPTY 不改判；B5 键序无关确定性；B6 adapter 级 EMPTY+PROVIDER_ERROR → 源 FAILED（首个失败原因）、全 EMPTY → EMPTY。
- 两套件只给 Prisma 一个与 CI 同形的占位 URL（`127.0.0.1:5432/ci`），零连接零副作用；`DATABASE_URL` 已存在时不覆盖。

### 5.3 隔离 DB 真实持久化（s2rem F1–F3，实跑）
F1 全源 FAILED：`executeSupplierSearchRun(…, {provider: PROVIDER_ERROR, includeInternalPool:false})` → 返回 `FAILED`、DB `status=FAILED`、`completedAt` 落档；`statusDetailJson.sources`：DOUYIN/XIAOHONGSHU/OPEN_WEB = FAILED+PROVIDER_ERROR、WECHAT_CHANNELS = DISABLED、memory/historical/saved = PLANNED；审计 `supplier_intel.search.source_failed` ×3 + `supplier_intel.run.failed` ×1；再执行 → `RUN_NOT_RUNNING`。F2 XHS 查询 EMPTY、其余 PROVIDER_ERROR → COMPLETED，`XIAOHONGSHU=EMPTY`、其余 FAILED 保留。F3 CANCELLED 后 `completeSearchRun` / `failSearchRun` → `INVALID_RUN_TRANSITION`、`execute` → `RUN_NOT_RUNNING`、状态档未被覆盖（晚到 provider 结果丢弃仍由 S2-T26/T27 覆盖，本轮实跑 32/32）。

### 5.4 套件运行面
| 套件 | 普通 CI（`test:ci`） | 隔离 DB |
|---|---|---|
| identity-scan / egress-plan / run-finalization / governance（AST + 负向） | 真实执行 | — |
| supplier-intel-s2rem-db.isolated | 自跳过（exit 0） | 42/42 |
| S1 / S2 / S2-FR DB | 自跳过 | 86/86 ×3 / 32/32 / 38/38 |

---

## 6. S1 三条竞态失败：诊断、测试专用修改与重复运行

### 6.1 分阶段诊断（上轮 + 本轮）
| 阶段 | 观测 | 结论 |
|---|---|---|
| 新连接建立 | 本网络到 us-east-1 新建 Neon 连接 2.8–3.0s（上轮探针） | 慢，但非错误 |
| 获取事务等待（Prisma `maxWait`，默认 2s） | 子写在 `db.$transaction()` 开启阶段抛 `P2028 Unable to start a transaction in the given time`——holder 占用唯一热连接，子写需新连接 ≈3s > 2s | **失败根因**（上轮：S1 merge 基线同样 80/83；无 supplier-intel 代码探针复现） |
| 行锁等待 | 预热后子写在另一条连接上 BEGIN，`SELECT … FOR UPDATE` 排队 ~2s（含 700ms 持锁窗口 + RTT） | 正常 |
| 事务执行超时（`timeout` 5s） | 未触发 | — |
| 业务断言 | 预热后子写以 `RUN_NOT_RUNNING` / `RUN_IMMUTABLE` 被拒 | 不变量成立 |

### 6.2 测试专用修改（`supplier-intel-db.isolated.test.ts` :478–575；不改生产 Prisma 超时、业务锁、事务隔离、终态判定；不串行化；不 skip/放宽）
- `prewarmPool(3)`：竞态前并发 3 条空事务（各持 400ms，预热事务自身 `maxWait 30s`）→ 池内 ≥2 条已建立连接；
- `classifyChildFailure`：`BUSINESS_REJECTION` / `TX_ACQUISITION_TIMEOUT`（P2028）/ `TX_EXECUTION_TIMEOUT` / `OTHER`——只有 BUSINESS_REJECTION + 预期错误码才算通过，任意异常不再可能被当作「正确拒绝」；
- 新增时序断言：`childSettledAt ≥ holderCommittedAt`（子写确实排队到终态提交之后才被裁决），并打印子写等待与终态提交后延迟；
- 原有四条断言全部保留 → 每组 5 条，套件 83 → 86 项。

### 6.3 重复运行（同一隔离分支、同一 HEAD 代码、无并行负载）
| 次 | 结果 | 预热耗时 | candidate / signal / match：子写等待 → 终态提交后 |
|---|---|---|---|
| #1 | 86/86 exit 0（174s） | 4274ms | 2618→995ms / 2611→803ms / 2100→583ms（均 BUSINESS_REJECTION） |
| #2 | 86/86 exit 0（156s） | 3648ms | 2338→715ms / 2185→705ms / 1971→617ms |
| #3 | 86/86 exit 0（163s） | 4220ms | 2340→763ms / 2051→574ms / 1814→517ms |

判定：`S1_REGRESSION = PASS（86/86 ×3）`；上轮的 3 条失败判定为 `NOT_INTRODUCED_BY_S2`（对照证据：S1 merge 基线 `2770fae3` 同分支 80/83 完全相同，见上轮报告 E.2）。

---

## 7. 全部测试实际计数与退出码（FINAL_HEAD 代码）

| 套件 | 计数 | exit | 环境 |
|---|---|---|---|
| score-contract / submission-parser / governance / search-brief / providers-policy / adapters / entity-resolution | 各「全部通过」 | 0 ×7 | 纯 |
| identity-scan（新）/ egress-plan（新）/ run-finalization（新） | 全部通过 | 0 ×3 | 纯 |
| tender-intel：websearch 10 / canadabuys 8 / canadabuys-auto 10 / awards 20 / award-semantics 12 / obs-p5 14 / intel-slots 13 / intel-auto-flow 16 / bid-strategy-memo 12 / intel-ops 11 / analyst-memo-v1 18 / memo-v2 16 | 全绿 | 0 ×12 | 纯 |
| S1 DB（supplier-intel-db.isolated） | 86/86、86/86、86/86 | 0 ×3 | 隔离分支 |
| S2 DB | 32/32 | 0 | 隔离分支 |
| S2-FR DB | 38/38 | 0 | 隔离分支 |
| S2-REM DB（新） | 42/42（首跑 40/42：两条 jsonb 键序敏感比较——测试侧改为键序无关深比较后复跑 42/42） | 0 | 隔离分支 |
| tender-intel awards-db（T4） | 18/18 | 0 | 隔离分支 |
| DB 套件在无隔离库环境 | 4 套均 `⏭ 跳过` | 0 | 纯（CI 形态） |
| `tsc --noEmit --incremental false` | 0 错误 | 0 | — |
| `eslint <本轮改动的 10 个 .ts>` | 0 problems | 0 | — |
| `npm run lint:baseline`（CI 真实门禁） | current 41/137 vs baseline 53/111，无新增 fingerprint，PASS | 0 | — |
| `npm run lint`（全量，既有债务） | 41 error / 137 warning（与整改前完全相同；本轮 0 新增） | 1（continue-on-error） | — |
| `npm run build`（CI 等价占位 DB env，`VERCEL_ENV` 未设 → 迁移闸跳过，零 DB 连接） | exit 0（显式退出码；`next build --webpack` Compiled with warnings in 2.9min；静态页 361/361） | 0 | — |

---

## 8. 推送与集成状态

| 键 | 值 |
|---|---|
| 推送 | `git push origin feature/supplier-intelligence-m1-s2`（无 force）：`4e6cbc75..fb7f91cf`；推送后 `origin/feature/supplier-intelligence-m1-s2 = fb7f91cf865062583aca6754885b1f8b5c3401d1` = 本地 HEAD |
| FINAL_HEAD | `fb7f91cf865062583aca6754885b1f8b5c3401d1`（提交链：`efdd0785` 同步 → `a49b7b4a` BL-2 → `26f15220` BL-3 → `86b2452b` BL-4 → `4cd1d99b` S1 夹具 → `fb7f91cf` DB 套件+注册） |
| PR #190（推送后） | `state=OPEN, isDraft=true, mergeable=MERGEABLE, mergeStateStatus=UNSTABLE（CI 进行中）, baseRefOid=5933ff7a（GitHub 按 merge-base 重算）, headRefOid=fb7f91cf`；**未改 Draft 状态、未 merge** |
| 远端 main（结束时） | `5933ff7a0b17b343982cbe836ffb4931122e2e69`（= 同步目标；同步后零漂移，rev-list 5933ff7a..origin/main = 0） |
| GitHub CI（FINAL_HEAD） | run `34191526514`（event=pull_request，headSha=`fb7f91cf…`，completed **success** @ 2026-09-08T05:51:20Z）；步骤全部 success：Guard(no migrate) / Prisma validate / Prisma generate / Lint(full log) / **ESLint baseline gate** / Typecheck / **Unit tests (CI subset)**（含新增 identity-scan / egress-plan / run-finalization / 重写的 governance；DB 套件按设计跳过）/ Next.js build(no migrate) / Fail-if-any-required-failed |
| qingyan-staging（FINAL_HEAD） | `vercel ls qingyan-staging --meta githubCommitSha=fb7f91cf…` 唯一命中 `qingyan-staging-b7h3f5vz8-…vercel.app`；`vercel inspect` → id `dpl_37DkTXe5nLaEkvFfaxGvqLMGtZsF`，target=preview，**status ● Ready**，created 2026-09-08 13:40:29 CST → STAGING_HEAD_SHA = `fb7f91cf`（运行时冒烟 NOT_RUN：部署保护墙） |
| 说明 | 旧 HEAD `4e6cbc75` 的 CI/部署结果不作为新 HEAD 证据；Vercel Preview Comments 成功不等于 staging Ready，本表只认 `vercel inspect` 的 status |
| 附注（docs 提交） | 本报告以 docs-only 提交追加在 FINAL_HEAD 之后并推送（sha 见 git log 与本轮汇报）；该提交只含本文件，其 CI 在写作时 PENDING——FINAL_HEAD 的 CI/staging 证据不受影响，但 docs 提交自身的 CI 结果需另行读取 |

---

## 9. 隔离库清理

- 分支：`rem-s2-20260908`（`br-dark-bird-anftu8d3`，父 = 生产默认分支 `br-green-boat-ann7k5yf`，host `ep-curly-thunder-…`，`PROD_PREFIX_MATCH=false`）；测试前 `assertSafeTestDatabase` → `SAFE_TO_TEST = YES`（`DATABASE_ENVIRONMENT=isolated`）；`_prisma_migrations` 118 条已应用（含 `20260831120000_add_supplier_intelligence_spine` 与 main 的 `20260906120000_mengxin_fde_revenue_spine`）→ 同步后的 main 迁移在隔离库已按仓库纪律处于已应用态，本轮**零** migrate/deploy/push。
- 删除：`neonctl branches delete br-dark-bird-anftu8d3` exit 0；`branches list` 复核 `rem-s2*/reval-s2*` 剩余 0，总数回到 16。本地 `rem-db.env`（0600）与创建/删除输出已删除；日志经 `grep -v` 复核不含连接串。

---

## 10. 未完成项与剩余风险

| 项 | 状态 | 说明 |
|---|---|---|
| 信号 HTTP 面（`GET/PATCH /signals`、`POST /signals` 带 `searchRunId`、`/resolve`）仅 org 级鉴权、无项目 ACL | 未改（超出本轮 BL 范围，S1 既有） | 上轮报告已记录；建议下一轮单独授权处理 |
| canonical loader：RISKS 节缺失时 uncertain 静默读成 false（仅封顶 fail-closed） | 未改（超出范围） | 持久修法 = SCHEMA_REQUIRED（tender 三值列），本轮禁改 schema |
| `quote-engine/advisors.ts` 第 4 份 Tavily 调用 | 未改（S2 范围外） | 记录 |
| `internalPoolLimit` 客户端可控无上限；`includeInternalPool:false` 时内部源状态档停留 PLANNED | 未改 | 本轮 BL-4 测试已把「PLANNED 不计入已执行源」固定为契约 |
| `resolutionJson` append 为非事务 read-modify-write | 未改 | 并发 resolve 可能丢一条 AUTO_PREFILL；不影响 LINK 语义 |
| `Supplier.website` 无 scheme 时不参与对质（召回损失） | 未改 | 上轮 R-B4-2 |
| staging 运行时冒烟 | NOT_RUN | 部署保护墙 |
| 全量 `scripts/test-all.sh` | NOT_RUN | 本轮按任务书跑相关套件 + CI 子集 |

---

## 11. 原工作区与 stash 未被修改的确认

结束核对：`/Users/user/Desktop/青砚` 仍在 `feature/sales-quote-cost-foundation` @ `9f9a43bb`；`git status --short | wc -l` = 46（= 起始 45 + 本报告 1）；`git stash list | wc -l` = 4（内容与起始一致）。整改全部在独立 worktree 完成，worktree 已移除（本地分支 ref 随推送更新）。

---

```text
QYANE_SUPPLIER_INTELLIGENCE_M1_S2_FINAL_REMEDIATION

PRE_SYNC_HEAD = 4e6cbc754fa2f525f31a8b8a55725f1e8983b823
SYNC_TARGET_MAIN_SHA = 5933ff7a0b17b343982cbe836ffb4931122e2e69
SYNC_COMMIT_SHA = efdd07852948d01c7fcb952f943fdb7898ed3c98
FINAL_HEAD = fb7f91cf865062583aca6754885b1f8b5c3401d1（本报告以 docs-only 提交追加于其后，见 §8 附注）
REMOTE_MAIN_SHA_AT_FINISH = 5933ff7a0b17b343982cbe836ffb4931122e2e69

PR = #190
PR_STATE = DRAFT（isDraft=true，未改）
SYNC_TARGET_IS_ANCESTOR = YES
MAIN_DRIFT_AFTER_SYNC = NO（0 提交）
MERGEABILITY = MERGEABLE / mergeStateStatus=CLEAN（GitHub，CI 通过后读取；本轮未 merge）

BL1_MAIN_SYNC = DONE（merge --no-ff，1 hunk keep-both，双方注册无遗漏无重复，脚本纪律不变）
BL2_SCAN_METADATA_ALL_BRANCHES = PASS（六类分支 × 4 形态纯核 + DB D1–D6）
BL2_SCAN_METADATA_PERSISTED = PASS（resolutionJson 追加 scan + result.scan，与返回值键序无关一致；旧快照不改写；缺字段历史 = recorded:false）
BL2_INCOMPLETE_NO_STRONG_MATCH = PASS（任一类扫描不完整 → 绝不 MATCHED_EXISTING）
BL2_INCOMPLETE_NO_CONFIRMED_NEW = PASS（不完整 → NEEDS_HUMAN_REVIEW + IDENTITY_SCAN_INCOMPLETE，不返回 NEW_SUPPLIER_CANDIDATE）
BL3_NON_VACUOUS_GUARD = PASS（TypeScript AST：签名/输入结构/调用顺序/HTTP 白名单；真实文件零违规）
BL3_NEGATIVE_CONTROL = PASS（4 个负向 fixture → 11 条预期违规码全部命中；分别记录）
BL4_EGRESS_CI_COVERAGE = PASS（egress-plan.test.ts 在 test:ci 真实执行；CI run 34191526514 已跑）
BL4_ALL_FAILED_PERSISTENCE = PASS（隔离库：全源 FAILED → Run FAILED + 状态档 + 审计 3+1）

B4_REGRESSION = PASS（entity-resolution 纯核 + S2-FR 38/38：B4-T1..T5 全 ✓）
B5_REGRESSION = PASS（S2-FR B5-T1/T2/T3 + 供应商行翻页 ✓；纯核触顶降级 ✓；新增 D2/D3/D4 DB 级触顶与穷尽 ✓）
F1_REGRESSION = PASS（纯核 T10–T13 + DB T10/T14 ✓；不完整扫描下冲突元数据仍保留 ✓）
S1_REGRESSION = PASS（86/86）
S1_T20_REPEAT_RUNS = 3/3 PASS（86/86 × 3；子写失败分类全部 BUSINESS_REJECTION，裁决落在终态提交后 517–995ms；上轮 3 条失败 = NOT_INTRODUCED_BY_S2，对照证据保留）
S2_REGRESSION = 32/32 PASS
S2_FR_REGRESSION = 38/38 PASS
TENDER_INTEL_REGRESSION = PASS（纯 12 套全绿 + awards-db 18/18）

TYPECHECK = PASS（tsc --noEmit --incremental false exit 0）
LINT_BASELINE_GATE = PASS（current 41/137 vs baseline 53/111，无新增 fingerprint）
LINT_CHANGED_FILES = PASS（本轮改动 10 个 .ts：0 problems）
NEW_LINT_ERRORS = 0（全量既有 41 error / 137 warning 与整改前完全相同）
BUILD = PASS（npm run build exit 0；迁移闸跳过，零 DB 连接）

CI_HEAD_SHA = fb7f91cf865062583aca6754885b1f8b5c3401d1
CI = PASS（run 34191526514，全部步骤 success，2026-09-08T05:51:20Z）
STAGING_HEAD_SHA = fb7f91cf865062583aca6754885b1f8b5c3401d1
STAGING = READY（dpl_37DkTXe5nLaEkvFfaxGvqLMGtZsF，preview；运行时冒烟 NOT_RUN）

SCHEMA_CHANGED_BY_REMEDIATION = NO
MIGRATION_CHANGED_BY_REMEDIATION = NO
PRODUCTION_DB_TOUCHED = NO（仅生产 project 临时子分支 rem-s2-20260908；SAFE_TO_TEST=YES）
PRODUCTION_FLAGS_CHANGED = NO
ISOLATED_DB_CLEANUP = DONE（br-dark-bird-anftu8d3 已删；branches list 复核 rem-s2*/reval-s2* = 0；本地连接串文件已删除）
ORIGINAL_WORKTREE_PRESERVED = YES（feature/sales-quote-cost-foundation @ 9f9a43bb；45 条未提交改动原样 + 本报告 1 条）
ORIGINAL_STASH_PRESERVED = YES（4 个 stash 原样）

BLOCKERS = NONE（S2 终审可开始；残留项见 §10：信号 HTTP 面无项目 ACL、RISKS 缺失静默塌缩、第 4 份 Tavily、internalPoolLimit 无上限、resolutionJson 非事务 append、website 无 scheme 召回——均为已记录的范围外事项，非本轮 BL）
UNVERIFIED_ITEMS = staging 运行时行为（保护墙）；全量 scripts/test-all.sh；本报告 docs-only 提交自身的 CI（写作时 PENDING，不作为 FINAL_HEAD 证据）
RECOMMENDATION = READY_FOR_S2_FINAL_REVIEW

PR_MERGED_INTO_MAIN = NO
S3_STARTED = NO
TENDER_V2_RESUMED = NO
```
