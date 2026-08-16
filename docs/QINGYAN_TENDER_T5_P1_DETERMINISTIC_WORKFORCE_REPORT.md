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

---

## 9. Segment 2.5 — WorkDomain 兼容闭环

关闭 §8.7 记录的 P0C 回归。**不是**靠恢复宽松默认，而是靠「新建必须显式 + 旧记录窄取证」。

### 9.1 冻结的规则

```
缺失 workDomain ≠ system
缺失 workDomain ≠ sales
system 只能来自显式 general
```

`toolDomainForWorkDomain` 此前把缺失/未知映射成 `system`，理由写的是"最小权限"。
实际后果相反：历史销售 Job（建 run 时还没有 workDomain 这个概念）在第一个工具就
`org_role_denied`，而 platform admin 反而跑得通——因为 `system` 域恰好只允许 admin。
**"不知道"被当成了一个确定答案，并且顺手给管理员留了一条静默旁路。**

现在该函数是纯映射，缺失/未知返回 `null`；"缺失怎么办"是取证层的职责。

### 9.2 有效域解析（server 权威，fail-closed）

[work-domain.ts](src/lib/workforce-runtime/work-domain.ts)：

| 优先级 | 来源 | source |
| --- | --- | --- |
| A | `metadata.workDomain` 显式（**不可被后续证据降级**） | `EXPLICIT` |
| B | `metadata.projectId` → `Project.workDomain`（canonical） | `PROJECT_CANONICAL` |
| C | 旧 run 的持久化工具证据全属销售执行集合 | `LEGACY_SALES_COMPAT` |
| D | 其余 | fail closed |

C 的证据只取 durable server facts（`AgentRunStep.preferredTool`，计划刚落库时回退
server 校验过的 `planJson`）。**不读**客户端字段、goal 自然语言、用户角色、时间戳。
工具的域归属从既有 registry 派生（`RUNTIME_V2_TOOL_CATALOG` → sales；
tender descriptor → project），零第二份工具名单。

未知工具 / 混合域 / 纯项目域但无项目归属 / 零证据 → `work_domain_ambiguous`
或 `work_domain_missing`，落 durable step errorCode。

### 9.3 新建 Job 必须显式声明域

`CreateWorkforceJobInput.workDomain` 改为**必填**，运行时再判一次
（类型挡不住 JS 调用方与未来的反序列化入口），缺失/非法 → `WORK_DOMAIN_REQUIRED`
且**零 DB 写**。`ACTIVE_CREATE_JOB_CALLS_EXPLICIT = 25/25`。

### 9.4 缓存与可观测

策略缓存键仍是 `runId:userId`，但存的是**解析后的有效域 + 来源**；歧义/缺失永不入缓存，
因此不存在"第一个工具定域、后续工具搭便车"的窗口。工具证据取自计划落库时一次性
创建的全部 step，run 级稳定。`workDomainResolutionSource` 仅服务端可观测，
executor 不读它，不参与任何授权判定。

### 9.5 验证

| 面 | 结果 |
| --- | --- |
| 纯平面 `t5-seg25-work-domain`（DOMAIN-01..16） | **30/30** |
| 真实 Postgres `t5-seg25-work-domain-db-validation`（DB-05..12b） | **14/14** |
| **`phase2a-lease`（§13 门）** | **16/16**（P0C 回归 CLOSED） |
| `phase2a-job-identity` / `phase2a-normal-slices` / `t1b-integration`（隔离 DB） | 26 · 10 · 40 全绿 |
| `t5-plan-seam` · `t5-execution-policy` · `t5-seg2-v2-spine` · `contracts` · `parallel-policy` · `t1b-pure` · `verifier-security` · `golden-flow` · `planner` · `durable-state` · `v2-persist-fence` · `v2-map` | 37 · 41 · 44 · 60 · 43 · 35 · 15 · 14 · 17 · 11 · 15 · 24 全绿 |
| `tsc --noEmit` / `eslint` | 干净 |

真实库覆盖：旧 run + 销售工具证据恢复为 sales 且策略允许 sales 角色；
旧 run + `Project.workDomain=tender` 判为 tender **而非** sales；项目不存在 → fail closed；
未知工具 / 零证据 / 混合域 → 对应错误码；显式 tender + 全销售工具证据仍为 project；
platform admin 在缺失域与歧义域下**同样**被拒。

`t5-plan-seam` 的 `AUTH-01c` 原断言「缺失 → system（最小权限）」编码的是被本段推翻的
旧规则，已改写为「缺失/未知 → null」+「system 只来自显式 general」。

### 9.6 边界

```
MISSING_WORKDOMAIN_DEFAULT = FAIL_CLOSED
ROLE_BASED_DOMAIN_INFERENCE = 0
SALES_PLANNER_TOOL_STRIPPING = 0（§8.7 回归 1 的修复保留未撤销）
DAG / V2 工具激活 / finalize 切换：均未改动
SCHEMA_CHANGE = NONE ｜ 生产 DB/env/deploy 零改动
```

---

## 10. Segment 3 — Projection + DAG Convergence

Segment 1（canonical V2 status-only finalize）与 Segment 2（Workforce-fenced canonical
V2 persistence）正式接入确定性 DAG。**代码层收敛完成；真实语义 parity 仍待 Segment 4。**

### 10.1 三层工具面

```
EXECUTABLE            9   全部可执行 tender 工具
LLM_COMPAT_VISIBLE    7   flag OFF 回滚面 = 旧 T1B 基线（无 canonical V2、无 grounded 交付物）
DETERMINISTIC_V2      8   确定性面（含 canonical V2，**不含** legacy extract）
GLOBAL_PLANNER_VISIBLE_TENDER_TOOLS  0
```

兼容面刻意去掉 grounded 交付物工具：它严格投影 `summaryJson.submissionChecklist`，
而 legacy 抽取根本不产出该字段——放进 planner 提示词只会诱导它去调一个在该路径下
必然 fail-closed 的工具。同理 `buildTenderAnalysisGoal()` 也去掉了"生成交付物"这一步
（flag ON 时 planner 不读 goal，goal 只是 Job Center 标题）。

### 10.2 新 DAG（`tender-plan/v2`）

```
t1 validate_input
     ↓
t2 parse_documents
     ↓
t3 analyze_package_v2        ← 唯一语义来源（canonical V2 包级分析 + 防栅栏落库）
     ↓
t4 证据覆盖投影 ｜ t5 风险投影 ｜ t6 澄清投影 ｜ t7 交付物物化
     ↓
t8 Workforce 执行汇总（Job 级，非 Tender 分析师）
     ↓
t9 canonical V2 状态终态化（t1 + t3 + t8）
```

`TENDER_DETERMINISTIC_PLAN_VERSION` bump 到 **tender-plan/v2**（语义来源变了）。
`workforce-plan/v1` 未动——那是编排契约，与 Tender 域计划版本不是同一层。
任务数仍为 9；`AGENT_RUNTIME_V2_MAX_STEPS < 9` 时依旧 `SERVER_PLAN_EXCEEDS_MAX_STEPS`
fail-closed，绝不截断。

### 10.3 模式判定：只认上游执行证据

`tender_analyze_package_v2` 成功时在 tool result 打 server 生成的 marker
（`tenderCanonicalV2` / `semanticEngine` / `canonicalPersisted` / `analysisRunId`）。
下游四个工具用 `findCanonicalV2Evidence(ctx.priorEvidence)` 在**声明依赖**里找它。

刻意不用的三种做法：嗅探 `summaryJson` 形状猜模式（旧 run 也可能有 V2 字段）、
全库搜索找痕迹（越过 dependsOn 证据边界）、用环境 flag 决定单个工具语义
（flag 只选编排路径）。t9 因此**直接依赖 t3**，而不是靠"summaryJson 里有没有
submissionChecklist"倒推 finalize 模式。

### 10.4 四个投影的行为边界

| 任务 | canonical V2 模式 | 兼容模式（flag OFF） |
| --- | --- | --- |
| t4 证据覆盖 | 只读聚合（本就零 LLM、零写） | 行为不变 |
| t5 风险 | 读 `TenderAnalysisSection[RISKS].structuredJson`（审计确认的 canonical 存放位置）→ 校验形状 → 投影 | 保留模型生成 + upsert |
| t6 澄清 | 读 canonical `TenderClarificationQuestion` → 投影 | 保留 `buildClarifications()` |
| t7 交付物 | 物化 `summaryJson.submissionChecklist`（1:1，空清单 → 0 条 PASS） | 该工具兼容面不可见 |
| t9 终态化 | `finalizeWorkforceTenderCanonicalV2Run()`，只转状态 | 保留 V1 投影 finalize |

风险投影会主动拒绝 `{version:"tender-workforce-risks/v1"}` 形状——读到它说明两套语义
串了，`CANONICAL_INVALID` fail-closed 而不是"凑合用"。

`t8` 正式降级为 **Job 级汇总**：不写 requirements / risks / clarifications /
submissionChecklist / summaryJson / analystSynthesis。canonical analystSynthesis
仍只来自 `runV2Inference`。t9 可以把 Job 级 summary 放进 tool result，但绝不写回 canonical。

### 10.5 完成标准（全确定性）

```
c1_canonical_v2_persisted   ← t3_analyze_package_v2
c2_deliverables_materialized ← t7_build_deliverables
c3_analysis_review_ready     ← t9_finalize_analysis
```

全部 `tool_result` → `VERIFIER_MODEL_CALLS = 0`。criteria 只绑三个证据，
但 verifier 的 required-task 底线不变：t1..t9 仍须按契约完成，
不会因为标准少就放行失败的投影任务。

影子对比按 §23 重定义：不再要求两条路径逐工具一致（它们现在**故意**语义不同），
改为 `DETERMINISTIC_V2_STAGE_COVERAGE`（九个 V2 阶段全覆盖，显式 stage→taskId 映射）
+ `FLAG_OFF_LLM_COMPATIBILITY`（回滚面 = T1B 基线七件套）。

### 10.6 验证

| 面 | 结果 |
| --- | --- |
| 纯平面 `t5-seg3-v2-convergence`（V2-CONV-01..16 + MODE + SEMANTIC + GOAL + STAGE） | **40/40** |
| 真实 Postgres `t5-seg3-projection-db-validation`（A–I） | **18/18** |
| `phase2a-lease`（隔离 DB） | **16/16** |
| `t1b-integration`（隔离 DB） | 40/40 |
| `t5-plan-seam` · `t5-execution-policy` · `t5-seg2-v2-spine` · `t5-seg25-work-domain` · `contracts` · `parallel-policy` · `t1b-pure` · `verifier-security` · `planner` · `durable-state` · `golden-flow` · `v2-persist-fence` · `v2-map` | 37 · 41 · 44 · 30 · 60 · 43 · 36 · 15 · 17 · 11 · 14 · 15 · 24 全绿 |
| Tender Understanding V2（generic / hallucination / evidence） | 10 · 6 · 11 组全过 |
| Tender Analyst | 30/30 |
| `tender-auto-analysis` 全部 25 个套件 | 全绿 |
| `tsc --noEmit` / `eslint` | 干净 |

真实库覆盖：证据覆盖投影读数正确；风险投影计数正确且 **RISKS 行前后逐字节未变**；
澄清投影正确且澄清行未变；checklist N → 物化 N、`[]` → 0 且 PASS；
canonical 终态化后 summaryJson/summaryText 逐字节一致且四个 V2 字段存活；
无 canonical 证据仍走 V1 finalize；无 marker 走兼容分支且不冒充投影；
marker 存在但 canonical 行缺失 / 指向别的 run / 形状是 Workforce 二次生成 → 三种 fail-closed。

### 10.7 边界

```
DETERMINISTIC_V2_DAG = READY        但 TENDER_WORKFORCE_DETERMINISTIC_PLAN_ENABLED 默认 OFF
REAL_E2E = NOT_RUN                  （真实多文档 LLM parity 属 Segment 4）
SCHEMA_CHANGE = NONE ｜ 生产 DB / env / deploy 零改动
```

默认产品路径仍是 flag OFF 的 LLM 兼容路径，行为与本段之前一致。

---

## 11. Segment 4 — Current-Main Sync + 真实模型 E2E + Canonical V2 Parity

### 11.1 Base sync

`merge origin/main`（0837ba9c，含 #109 Autopilot A0 与 #110 A1-P0）**零冲突**，
14 个既有提交历史保留（未 rebase）。Autopilot 的 schema / migrations / flags /
outbox / processor / instrumentation 全部保留，测试注册双方共存。

同时补上一个**本 PR 早期段落的疏漏**：Segment 2 / 2.5 / 3 新增的三个纯平面套件
当时只创建了文件、没有登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，
CI 从未真正跑过它们。本段一并登记。

post-sync 门：`prisma validate` 通过 ｜ migration history 51/51 ｜ release safety 27/27 ｜
`test:ci` 全绿 ｜ tsc 干净 ｜ eslint 错误数与 main 完全一致（既有仓库状态）。

### 11.2 真实模型 E2E（隔离生产快照分支，跑完即删）

三次真实运行，全部走真实入口 `startTenderWorkforceAnalysis`（API route 鉴权后调用的
同一函数）→ 确定性 server plan → 真实 cron slice 循环 → **真实模型** canonical V2 推理
→ 投影 → 真实 native synthesis → canonical 终态化。零 mock、零打桩、零预写结果。

`MODEL = gpt-5.6-terra`（grounding/analyst）+ `gpt-5.6-sol`（synthesis）
｜`SEMANTIC_ENGINE = tender-understanding-v2`

| 包 | 文档/页 | t3 时长 | t3 LLM | 要求 | 清单 | 交付物 | Job | 域 run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bid Contract CLZ-2026-001-A | 3 / 15 | 290s | 29（3 失败） | 82 | **42** | **42** | completed | REVIEW_REQUIRED |
| 08-28 Student Housing | 13 / 61 | 507s | 91（4 失败） | 274 | **94** | **94** | completed | REVIEW_REQUIRED |
| INTERNAL TEST 多文档 | 2 / 2 | 135s | 10（2 失败） | 8 | **5** | **5** | completed | REVIEW_REQUIRED |

每次运行：`PLAN_SOURCE = SERVER_AUTHORED`、`planTaskCount = 9`、
`plannerLlmCalls = 0`、9/9 任务 completed、verifier `PASS`、
三条确定性完成标准全部由 tool_result 证实、零 `needs_human` / `verification_failed` /
`blocked_graph` / `repairing`。

**交付物逐项核对（两个真实包）**：

```
CHECKLIST_COUNT = 42 / 94        MATERIALIZED_COUNT = 42 / 94
MATCHED = 42 / 94                MISSING = 0    EXTRA = 0    UNSUPPORTED = 0
TITLE_EXACT = 42 / 94            SOURCE_PAGE_TRACEABLE = 42/42, 94/94
STATIC_TEMPLATE_ITEMS = 0
```

### 11.3 §7 finalize 保全 —— 真实实证

在 t9 完成前快照、完成后回读，八个维度**逐字节一致**：

```
summaryJson / summaryText / submissionChecklist / analystSynthesis /
brief / criticalFacts / conflicts / evidenceCoverage   → 全部 identical
只有 AGENT_ANALYZING → REVIEW_REQUIRED 与 completedAt 发生变化
CANONICAL_SUMMARY_MUTATION_BY_FINALIZE = 0
```

### 11.4 §12 长任务租约心跳 —— 真实实证

三次运行的 t3 分别是 **290s / 507s / 135s**，而 `WORKFORCE_LEASE_MS = 180s`。
两次明显超过单个租约窗口：

```
LEASE_RENEWALS_DURING_T3 = 10（每次运行）
LOST_LEASE_FALSE_POSITIVE = 0
```

Segment 2 §9 补的心跳在这里得到真实数据验证：**没有它，507s 的 t3 必然中途丢租约、
整轮作废并无限重跑。**

### 11.5 §13 LLM 调用会计（真实计数）

以 `ai.call` 实际条数与 t3 遥测交叉核对，三次运行完全一致：

```
PLANNER_LLM_CALLS               = 0
V2_GROUNDING + V2_ANALYST       = 29 / 91 / 10（t3 内，含各自 3/4/2 次失败重试）
SECONDARY_EVIDENCE_LLM_CALLS    = 0
SECONDARY_RISK_LLM_CALLS        = 0
SECONDARY_CLARIFICATION_LLM_CALLS = 0
WORKFORCE_SYNTHESIS_LLM_CALLS   = 1
VERIFIER_MODEL_CALLS            = 0
总数校验：ai.call 总数 = t3 调用数 + 1（synthesis），30/92/11 三次全对上
```

### 11.6 §11 legacy 队列双认领 —— 真实并发实证

在 Workforce 域 run 处于 `AGENT_ANALYZING`（t3 推理中）时，反复触发 legacy
`processQueuedTenderAnalysisRuns`：

```
legacy sweeps during AGENT_ANALYZING ≥ 3
LEGACY_QUEUE_DOUBLE_CLAIM = 0
leaseOwner 保持 null ｜ workerStep / workerCursor / attemptCount 全部未被改动
冲撞期间 Workforce 仍正常跑完（job completed / 域 run REVIEW_REQUIRED）
```

### 11.7 §21 / §22 回滚与 Autopilot 回归

```
FLAG_OFF_ROLLBACK_PATH = PASS
  flag OFF → 确定性编排不启用；LLM 兼容面恰 7 个工具；
  canonical V2 与 grounded 交付物工具均不可用；legacy 抽取仍在；
  旧 T1B 8 步计划仍可构造，7 个工具零剥离；
  flag ON 但 org 未命中 → 仍走兼容路径。

AUTOPILOT_OFF_WORKFORCE_REGRESSION = PASS
  capture 默认 OFF 下 8 个纯平面套件全绿；
  durability-e2e.isolated 在隔离 DB 上 33/33；
  durability-benchmark 是基准报告器（输出 JSON，无 pass/fail 断言）。
```

### 11.8 ⚠️ Canonical V2 Parity —— BLOCKED（环境原因，非代码缺陷）

§14/§15 要求 A 路走**真正的 legacy orchestrator**。实测两次尝试：

1. `enqueueTenderPackageAnalysis` 按 package fingerprint 幂等复用，直接返回了
   **Workforce 产出的 canonical run**（`idempotent_reuse`）——本身是"同一 canonical
   真相"的一个侧证，但没有可比对的独立 A 路。
2. 改走 legacy 真实"重新分析"入口 `reanalyzeTenderPackage` → 新建独立 legacy run →
   **在 ENSURE_PAGES 步骤失败**：`Blob 下载失败：对象不存在或不可读`。

根因（源码确认，非推测）：legacy `stepEnsurePages` 对每个 run 文档**无条件**调用
`parseDocumentPagesAndStore` 并对任何失败 fail-closed；而 Workforce `t2` 先检查
已存在页再决定是否解析，且容忍部分文档解析失败（≥1 份成功即继续）。
隔离快照库里有页文本、但**没有生产 Blob 对象访问权**，因此 legacy 路径在本段
给定的隔离边界内**根本无法启动**。

我没有为了跑通它去取生产 Blob 凭据——那超出本段"仅隔离环境"的授权范围。

```
CANONICAL_V2_PARITY = BLOCKED（缺 legacy A 路运行结果）
解锁方式（二选一，需人工授权）：
  a) 授予隔离环境对生产 Blob 存储的**只读**访问；或
  b) 在已具备 Blob 访问的 Preview 环境跑 A 路，再与本段 B 路结果比对。
```

已具备的间接证据（不足以替代 parity gate，但值得记录）：三个真实包的 canonical
契约字段全部齐备（15 个 summaryJson 键、facts/requirements/sourceRefs/sections/
clarifications 全非空）、来源可追（42/42 与 94/94 交付物 100% 带来源页）、
且 legacy enqueue 主动把 Workforce 产出的 run 认作该 package 的既有分析。

### 11.9 §23 main 漂移

E2E 期间 main 从 `0837ba9c` 前进到 `ba2bdc70`（PR #104 T2-P1.5 项目财务管控合入）。
虽然未触及 tender-workforce / workforce-runtime / agent-runtime-v2 / tender-auto-analysis，
但**触及 `prisma/schema.prisma` + 新迁移 + 三个测试注册/治理脚本**，属 §23 的敏感面。

```
MAIN_DRIFT_DURING_E2E = YES
READY_FOR_HUMAN_FINAL_REVIEW = NO（需再做一轮 sync + 回归）
```

### 11.10 安全边界

```
生产 DB / ENV / DEPLOY   = 未改动
隔离分支                  = 本段自建 1 个，已删（ISOLATED_BRANCHES_LEFT = 0）
临时 env / 密钥文件        = 已删
Award Watch / Memory 自动写 / legacy 队列退休 / 第二 Runtime = 均未启动
```
