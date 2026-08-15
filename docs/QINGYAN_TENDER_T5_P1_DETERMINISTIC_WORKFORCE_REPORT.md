# 青砚 Tender T5-P1 — Deterministic Tender Workforce 报告

日期：2026-08-14 ｜ 分支 `feature/tender-t5-p0-deterministic-runtime` ｜ **SCHEMA_CHANGE = NONE**

## 1. 确定性 DAG（以当前代码实证，非按旧文档凑数）

审计确认可用节点：**7 个已注册 tender 工具 + 1 个 native synthesis = 8 节点**。
`buildTenderAnalysisGoal()` 用散文向 planner 描述的正是这 8 节点 DAG——本轮把它变成代码。

```
t1 validate_input（唯一根，dependsOn=[]）
 ├→ t2 parse_documents          (t1)
 ├→ t3 extract_requirements     (t1, t2)
 ├→ t4 evidence_compliance      (t1, t3)
 ├→ t5 risk_analysis            (t1, t3, t4)
 ├→ t6 clarification_draft      (t1, t3)
 └→ t7 synthesis  [synthesis_worker, 无 preferredTool]  (t2..t6)
      └→ t8 finalize_analysis   (t1, t7)
```

**§15 未重写任何领域逻辑**：adapter 只描述 DAG。每个 task 仍调用既有 `tender_*` 工具 →
既有领域服务（V2 Grounding、Analyst、证据校验、addendum 优先级、包覆盖、风险、澄清）。
本文件没有一行解析 PDF / 抽取条款 / 生成风险的代码。

**§17 依赖语义**：每个 task 显式声明 `taskKey / workerKey / taskKind / dependsOn /
resources / input contract`。不再靠 prompt 告诉 planner「先做 A 再做 B」——这是 T5 的核心变化。

**一个必须显式写的正确性细节**：`defaultWorkerKeyForTaskKind("work")` 返回
**`sales_worker`**。因此每个分析步骤必须显式 `workerKey: "tender_worker"`，
否则投标任务会被标成销售任务（域、角色、策略全错）。测试 `T5-TENDER-04e` 锁死这一点。

**§18 资源模型**：声明 `project:{id}` / `tender:{id}`。当前 tender 工具不在 v2 catalog
且未标 `parallelSafe` → `classifyTaskExecutionPolicy` 恒 SEQUENTIAL；声明 resources 是为
`EXCLUSIVE_RESOURCE` 正确性与未来并行开启做准备。**第一版优先安全顺序执行**，
`PRODUCTION_PARALLELISM` 未改动（仍为默认 1）。

## 2. Flag 与回滚（§19–21）

`TENDER_WORKFORCE_DETERMINISTIC_PLAN_ENABLED`（+ `..._ORG_ALLOWLIST`），**default OFF**，
沿用仓库 4 符号 flag 模式（`WithEnv` 纯函数 / 薄包装 / `describe`），未新建 flag 体系。

**职责只有一个**：选择 LLM planner 还是 server 确定性计划。它**不是** T5 总闸。

| flag | 行为 |
|---|---|
| OFF | 与当前 main **完全一致**：同 trigger、同 runtime、同 UI、同产物、同 LLM planner 路径 |
| ON | 同 trigger / runtime / UI / 产物，仅计划来源变为 server-authored；planner LLM 调用 = 0 |

**§21 fail-closed**：flag ON 且确定性计划校验失败时 → 返回
`DETERMINISTIC_PLAN_INVALID:<code>:<detail>`，**绝不自动回落 LLM planner**。
理由：静默回落会掩盖确定性契约缺陷。正确回滚方式是关掉 flag。

**§19 未新建入口**：改动落在既有 `trigger-service.ts` 内部分流，没有新按钮、没有第二个 API。

## 3. 计划级影子对比（§23）

本轮**不做**双写双跑（禁止两条 pipeline 同时写 canonical Tender 行）。做的是 plan-level parity：

| 维度 | 验证 | 测试 |
|---|---|---|
| 语义阶段覆盖 | 8 个阶段全部出现 | T5-TENDER-03 |
| 依赖顺序 | 拓扑自洽（依赖恒先于自身） | SHADOW-01 |
| 起步确定性 | 唯一根 = validate_input | SHADOW-02 |
| worker 覆盖 | 恰为 tender_worker + synthesis_worker | SHADOW-03 |
| 构建确定性 | 同输入 → 逐字节相同 | SHADOW-04 |
| 禁用工具 | 销售/邮件/日历结构上不可达 | T5-TENDER-04b |
| 终结门 | finalize 为最后一步且依赖 synthesis | T5-TENDER-03c |

## 4. Legacy 队列隔离（§25/§26）

`LEGACY_QUEUE_ACTIVE = YES`。本轮**未删除**任何 legacy 资产（表 / cron / worker / lease /
status / reaper）。`TARGET = RETIRE_AFTER_PARITY`（T5-P4，需先有真实 parity + rollout + rollback 证明）。

**双认领不变量**：既有隔离已由状态词表保证 ——
`AGENT_ANALYZING` / `AGENT_FAILED` 不在 legacy 的 `CLAIMABLE_STATUSES`、
reaper 集合（EXTRACTING/ANALYZING）、候选查询（PENDING/FAILED/EXTRACTING/ANALYZING）
任何一个集合内，且 workforce run 创建时 `nextAttemptAt: null` 不进 legacy 队列。
本轮未改动该机制，也未引入新的认领路径。

## 5. 验证现状与**尚未完成**

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 0 |
| `t5-plan-seam`（36 断言） | 36/36 |
| `phase2b1-contracts` / `phase2b2-parallel-policy` / `t1b-pure` | 60 / 43 / 34 全绿 |
| **§24 隔离 Neon 真实 E2E** | **未执行** |

**诚实声明**：§24 要求在隔离 Neon 上用真实多文档 Tender、真实模型、真实 Tender 服务
跑到 `REVIEW_REQUIRED` 并与既有 fixture 做领域语义对齐验证 —— **本轮未做**。
因此以下终报字段目前不可断言为 PASS：

- `REAL_TENDER_RUN_ID` / `REAL_TENDER_STATUS`
- `PLANNER_LLM_CALLS`（代码层可证 0，运行期未实测）/ `DOMAIN_LLM_CALLS`
- `REQUIREMENTS` / `RISKS` / `CLARIFICATIONS` / `ANALYST_SYNTHESIS` / `EVIDENCE_TRACEABILITY`
- `LEGACY_QUEUE_DOUBLE_CLAIM`（结构上由状态词表保证，运行期未实测）

在完成该 E2E 之前，`T5_P1_GATE` 不应判为 PASS。

## 6. 未启动项（按任务书边界）

`AWARD_WATCH_STARTED = NO`（§34）｜ `AUTO_MEMORY_WRITE = NO`（§35，且未给 MemoryClaim 加
PROPOSED 状态）｜ `LEGACY_QUEUE_RETIRED = NO`（§36）｜ `SECOND_RUNTIME_CREATED = NO`（§2）
｜ 生产 DB / env / deploy 零改动（§37）

---

## 7. Segment 1 — 语义保全（Canonical V2 Finalize）

A2「canonical V2 收敛」的第 1 段。**只做语义保全，不做接线。**

### 7.1 缺陷（实证）

`finalizeWorkforceTenderAnalysisRun` 以 `summaryJson = TenderAnalysisResultV1`
**整体替换**已有 `summaryJson`，并覆盖 `summaryText`：

```
CURRENT_V2_SUMMARY_OVERWRITE = YES
```

Workforce 路径一旦接上 canonical V2 管线（Segment 2/3），这一步会抹掉
`submissionChecklist` / `analystSynthesis` / `brief` / `criticalFacts` /
`unknowns` / `conflicts` / `addendumChanges` / `evidenceCoverage` / `metadata`
—— canonical 语义真相被 Runtime 执行摘要覆盖。其中 `submissionChecklist` 正是
`buildGroundedDeliverables` 的唯一语义来源，丢失即交付物投影 fail-closed。

### 7.2 修复：两个语义清楚的 domain operation

| 函数 | 写入列 | 用途 |
| --- | --- | --- |
| `finalizeWorkforceTenderAnalysisRun`（既有，**行为未变**） | status / summaryJson / summaryText / completedAt / 错误字段 | V1 兼容投影（flag OFF、legacy T1B 路径） |
| `finalizeWorkforceTenderCanonicalV2Run`（新增） | status / completedAt / 错误字段 | canonical V2：**仅状态转换** |

- 模式由 **server 权威调用方显式选择**，不由客户端指定，也**不靠嗅探 summaryJson 形状猜测**。
- `V2_SUMMARY_TEXT_POLICY = PRESERVE`（canonical 路径不写 `summaryText`）。
- **不做 `{...old, ...v1}` 盲合并**：两个 contract 语义不同，同名字段会互相污染。
- ownership / fail-closed 条件两者完全一致（org + project + analysisVersion + status=running
  条件更新；`count === 0` → 报错，终态不复活）。

### 7.3 验证（真实 Postgres，隔离 Neon 分支，跑完即删）

`scripts/t5-seg1-canonical-finalize-db-validation.ts` —— **17/17 通过**。
打真库的理由：本段核心不变量是「**哪些列没有被写**」，Prisma 部分更新语义
无法用纯函数断言，只有真实 UPDATE 后回读才算证明。

> V2-CONV-05 首轮红：拿 DB 回读值与 JS 字面量比字节，被 Postgres `jsonb` 的
> key 规范化判不等。断言改为比对 **finalize 前/后两次回读**（同一规范化下），
> 这既修正了探针错误，也比原断言更强 —— 直接证明该列未被本次 UPDATE 触碰。

| 断言 | 内容 |
| --- | --- |
| V2-CONV-05 / 05b | `summaryJson` 与 finalize 前逐字节一致；字段数一个不少 |
| V2-CONV-06/07/08 | `submissionChecklist` / `analystSynthesis` / `brief` 存活 |
| FINALIZE-01..03 | `criticalFacts` / `conflicts` / `addendumChanges` / `evidenceCoverage` / `metadata` / `unknowns` 存活 |
| FINALIZE-04 | `summaryText` 保留（PRESERVE） |
| FINALIZE-05..07 | `AGENT_ANALYZING → REVIEW_REQUIRED`；`completedAt` 写入；遗留错误字段清空 |
| FINALIZE-08 / 08b | 终态 run 拒绝终态化；跨 org 拒绝且状态未变 |
| FINALIZE-09 / 10 | V1 兼容路径行为逐字段不变（仍写 V1 投影并覆盖 `summaryText`） |

回归：`t5-plan-seam` 36/36、`t5-execution-policy` 41/41、`phase2b1-contracts` 60/60、
`phase2b2-parallel-policy` 43/43、`t1b-pure` 34/34、`verifier-security` 15/15；`tsc --noEmit` 干净。

与 `scripts/pr106-v2-fence-db-validation.ts` 同纪律：DB 平面脚本放 `scripts/`，
**不注册进 test-all**（test-all 主体为无 DB 纯平面，注册会让无库 CI 变红）。

### 7.4 边界

```
CANONICAL_V2_FINALIZE_CAPABILITY      = READY
CURRENT_DAG_CANONICAL_V2_FINALIZE_ENABLED = NO
SCHEMA_CHANGE                          = NONE
```

`t9_finalize_analysis` 仍调用 V1 兼容函数 —— 当前 DAG 走的是 legacy 语义抽取，
提前切换只会造成「旧语义抽取 + V2 状态终态化」的另一种半迁移状态。切换属 Segment 3。

**`T5_P1_GATE` 仍非 PASS**：§5 的隔离 Neon 真实 E2E 未执行，本段未改变该结论。

未启动：Segment 2（`persistV2CanonicalTx` 抽取 / Workforce V2 fence / `RunFence` 进
AdapterContext / `tender_analyze_package_v2`）、Segment 3（工具投影化 + DAG + verifier 标准）、
Segment 4（双路真实 E2E + parity + LLM 计数）。

---

## 8. Segment 2 — Canonical Persistence Spine（能力就绪，未激活）

让 Workforce Runtime 具备"安全写入完整 canonical V2 结果"的能力；**当前 DAG 仍不使用它**。

### 8.1 共享写入核心

canonical V2 落库此前与 legacy Tender lease fence 焊死在 `persistV2Fenced` 一个函数里。
Workforce 用的是 AgentRun RunFence，照抄一份就会立刻出现两套 V2 真相。因此拆成
「写什么」与「凭什么能写」：

```
legacy     persistV2Fenced       → TenderAnalysisRun.leaseOwner 租约 ─┐
                                                                      ├→ persistV2CanonicalTx
workforce  persistV2ForWorkforce → AgentRun RunFence                 ─┘
```

`persistV2CanonicalTx`（[v2-persist-core.ts](src/lib/tender-auto-analysis/v2-persist-core.ts)）
不开事务、不判 lease、不判 org/project/job、不调 LLM、不改 run 状态。
封装纪律由测试机械校验：核心只允许被那两个 fenced wrapper import。

```
SHARED_CANONICAL_PERSIST_CORE = PASS
DUPLICATE_V2_PERSIST_LOGIC    = 0
LEGACY_V2_LEASE_CONTRACT_CHANGED = NO   （EXTRACTING/ANALYZING、maxWait 10s、timeout 120s 全部保留）
```

### 8.2 Workforce fence 与域归属（同一原子边界）

```
RunFence.guard(maxWait 10s / timeout 120s)
  ├─ AgentRun 行锁 + fencing token 断言        → token 变化即 LostLeaseError
  ├─ TenderAnalysisRun 条件更新（org / project / analysisVersion /
  │   status=AGENT_ANALYZING / Job 幂等键）    → 同事务取域行锁，杜绝 TOCTOU
  └─ persistV2CanonicalTx
```

`RunFence.guard` 新增**可选**事务参数：不传即 Prisma 默认，所有既有调用方逐字不变。

### 8.3 §9 长 await 租约心跳 —— 审计结论 MISSING，本段补齐

审计（实证）：processor 只在**每个 V2 round 之前**续租一次；一个 round 内部的
`executeRuntimeV2Tool()` / native synthesis 是单次长 await，canonical V2 推理
（多文档 grounding + Analyst 两遍）明显可能超过 `WORKFORCE_LEASE_MS`(180s)。
租约中途过期 → 另一 worker 可重认领 → 本 worker 返回时 fence 断言失败、整轮作废。
**写是安全的（零双写），但长任务永远跑不完。**

补齐方式：复用既有 `renewRunLease()` 的同一 lease system，新增
[lease-heartbeat.ts](src/lib/workforce-runtime/lease-heartbeat.ts)（周期 = 租约 1/3）。
不新建 Tender 专用心跳、不新建第二套 lease。

心跳带来一个**真实竞态**，必须一起解决：guard 读到 token T1 → 心跳把 DB token 推到 T2 →
guard 的条件更新命中 0 行 → 明明持有租约却抛 LostLeaseError。
解法是 `holder.runExclusive` 临界区把两者串行化（Node 单线程 + promise 链），
并在进入临界区时按 TTL 做即时续租，使长事务开始时总有完整租约窗口。
`createRunFence` 对不提供该临界区的调用方行为完全不变。

```
WORKFORCE_LONG_AWAIT_LEASE_RENEWAL = PASS（本段补齐；HB-01..06 覆盖）
```

### 8.4 canonical V2 域工具（休眠）

`tender_analyze_package_v2`：`runV2Inference()` → Workforce 防栅栏落库 → 返回计数/遥测。
不碰 legacy enqueue / cron / worker.ts / `analyzeAndPersistV2`，不创建第二个
AgentRun 或 Workforce Job。空壳分析复用同一个 `isEmptyAnalysisOutcome`，
且判定在落库**之前**（空结果不留 canonical 痕迹）。

planner 可见性与可执行集合首次显式分离：

```
TENDER_WORKFORCE_TOOL_NAMES          9   可执行（含新工具）
TENDER_WORKFORCE_PLANNER_TOOL_NAMES  8   planner 可见（不含新工具）
EXECUTABLE ⊋ PLANNER_VISIBLE，未知 descriptor 仍 fail-closed
```

### 8.5 验证

| 面 | 结果 |
| --- | --- |
| 纯平面 `t5-seg2-v2-spine`（V2-SPINE-01..20 + HB-01..06） | **44/44** |
| 真实 Postgres fence 矩阵 A–I（隔离 Neon，跑完删分支） | **12/12** |
| legacy V2 真实 DB fence 回归 `pr106-v2-fence-db-validation` | **9/9**（抽核心后零漂移） |
| `v2-persist-fence` / `v2-map` | 15/15 · 24/24 |
| `t1b-integration`（隔离 DB） | 40/40 |
| `phase2a-job-identity`（隔离 DB） | 26/26 |
| `t5-plan-seam` / `t5-execution-policy` / `phase2b1-contracts` / `phase2b2-parallel-policy` / `t1b-pure` / `verifier-security` / `golden-flow` | 36 · 41 · 60 · 43 · 35 · 15 · 14 全绿 |
| `tsc --noEmit` / `eslint` | 干净 |

真实 DB 矩阵覆盖：A 有效 legacy lease 写成功 ｜ B 过期 legacy lease 零写 ｜
C 有效 Workforce fence 写成功（状态仍 AGENT_ANALYZING、十个 V2 语义字段齐全）｜
D **真实 lease reclaim** 后旧 worker 零写且既有数据未被覆盖 ｜ E 新 token 写成功 ｜
F 错误 Job 幂等键零写 ｜ G 终态域 run 零写 ｜ H 中途异常全回滚无 partial ｜
I 非 tender workDomain 的 Job 无法执行该工具。

### 8.6 边界

```
CURRENT_DAG_CANONICAL_V2_ENABLED          = NO
CURRENT_DAG_CANONICAL_V2_FINALIZE_ENABLED = NO
CANONICAL_V2_TOOL_PLANNER_VISIBLE         = NO
SCHEMA_CHANGE = NONE ｜ 生产 DB/env/deploy 零改动
```

### 8.7 ⚠️ 本段之外发现的两个 PR 级回归（Segment 2 **未**引入）

跑 §21 要求的 lease 回归时发现 `phase2a-lease` 在 PR 上 13/16，而 `main`（399a769）
**16/16**。逐提交定位到 **T5-P0A（0a6aa11）** 即已失败——即本 PR 早期段落引入，
与 Segment 2 无关（Segment 2 前后失败断言完全相同）。根因两个，互相叠加：

**回归 1（已在本轮修复）**：`compileWorkforcePlan` 收到 `tools: scopedTools ?? []`。
`resolveWorkforcePlannerToolsForJob` 对**非 tender 域返回 undefined**
（fail-safe：planner 自己回落 `plannerVisibleRuntimeV2Tools`），于是销售线 Job
拿到空白名单，`sanitizePlannerOutput` 把每个 `preferredTool` 当越权工具剥掉，
所有步骤以 `no_tool`「步骤未指定工具」失败。改为 `scopedTools ?? plannerVisibleRuntimeV2Tools()`
后 planJson 的 8 个步骤工具全部恢复（实测）。此修复属 Segment 2 边界之外，
但它让必跑回归套件红着，且只是恢复 planner 自身的投影，因此就地修正并单独说明。

**回归 2（未修，需人工决策）**：修好回归 1 后，首个步骤改为
`org_role_denied` 失败。原因是 T5-P0C 的
`toolDomainForWorkDomain(undefined) → "system"`：历史/销售 Workforce Job
不带 `workDomain`，此前按 `sales` 域授权（allowRoles 含 sales），现在落到
`system` 域 → sales 角色被拒。这是**授权语义**变更，方向是 fail-closed，
修它等于决定"无 workDomain 的历史 Job 该按哪个域授权"。
**不在 Segment 2 内擅自放宽授权门**——留待人工裁定。

因此 `phase2a-lease` 目前仍 13/16，`LEGACY_V2_REGRESSION` 只对 V2 持久化面判 PASS。
