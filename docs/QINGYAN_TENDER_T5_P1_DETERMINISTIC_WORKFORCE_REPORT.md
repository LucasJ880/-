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
