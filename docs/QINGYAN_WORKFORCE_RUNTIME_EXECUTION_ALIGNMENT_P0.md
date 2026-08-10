# Qingyan Workforce Runtime — P0 Execution Alignment 报告

## Issues #88 / #89 / #90A — Correctness + Execution Alignment

- 日期：2026-08-10
- Lane：`fix/workforce-runtime-execution-alignment-p0`（PR #94，Draft）
- 优先级：P0（先于 2B-2；`2B2_STATUS = FROZEN_PENDING_P0`，既有 2B-2 分支
  `feature/workforce-runtime-phase2b2-controlled-parallel` 未删除、未继续）

---

## 1. Executive Summary

Real Multi-Task Validation（PR #91 报告）证明 2B-1 运行时契约面全部按设计工作，
但三个执行层缺口使模型规划的真实 Job 无法稳定完成。本 P0 修复并以真实
S1–S4 复跑验证了全部三项：

| Issue | 修复前（真实验证实测） | 修复后（同组场景复跑实测） |
|---|---|---|
| #88 幽灵工具 | 13 个目录工具 5 个无执行路径；模型规划 2/3 场景死于 `Unsupported tool` | `PLANNER_VISIBLE ⊆ EXECUTABLE` 结构性不变量 + 5 个工具全部真实实现；S2/S3 全链路执行零幽灵失败 |
| #89 聚合/综合 | `sales_prioritize_followups` 等硬编码黄金模板 stepKey；synthesis 任务必死于 `no_tool`；「综合结论」路径零触发 | 证据消费收敛为 `step.dependsOn` 声明（声明序）+ 业务语义识别；**native synthesis 一等执行语义**；S4 真实产出结构化综合结论（首次在真实场景触发「综合结论」） |
| #90A 假完成 | 失败的 requiresApproval 步骤对 verifier 不可见 → S1 带失败步骤 completed | 任何 required Task 的 terminal failure 必入 `failedRequired`；deterministic hard floor；S1 复跑正确进入 `needs_human(verification_failed)`，假完成被阻断 |

P0 成功线全部达成：Ghost Tool Failure = 0；Hardcoded Step-Key Failure = 0；
Synthesis no_tool Failure = 0；False Completed With Failed Required Task = 0；
**S4（模型规划 + 5 任务 + native synthesis）真实 COMPLETED 且产出真实结构化
综合结论（6 条结论 / 3 风险 / 3 机会 / 6 建议，跨上游交叉验证）**。

`SCHEMA_CHANGE = NONE`（零迁移；synthesis 结果落 `AgentRunStep.outputJson` +
`workforce-handoff/v1`）。

---

## 2. Base / Branch / PR / Head

| 项 | 值 |
|---|---|
| Base main | `abac67e`（含 PR #85 Phase 2B-1、PR #86 Test Isolation——HARD PREREQUISITE 已验证） |
| Branch | `fix/workforce-runtime-execution-alignment-p0` |
| PR | #94（Draft） |
| 实现提交 | `54a29b1`（runtime）→ `aa5a378`（golden tests）→ `beda1bb`（CASE B port + synthesis 预算） |
| 验证报告来源 | `docs/QINGYAN_WORKFORCE_REAL_MULTITASK_VALIDATION.md` 以 READ-ONLY 方式取自 PR #91 head（未 merge / 未 cherry-pick / 未混入 commit history） |
| ROOT_CAUSE_GATE | **PASS**——代码审计确认三个 root cause 与任务书一致；发现的延伸（写 adapter 同类 stepKey 耦合、模板依赖声明不全、审批入口 v2 reconcile 被 `result.ok` 门控）属同一 root cause 的补全，未构成 ASSUMPTION_INVALID |

---

## 3. #88 Before / After

**Before**（`abac67e`）：

- Planner-visible = `RUNTIME_V2_TOOL_CATALOG` 全量 13 个（legacy 与 workforce
  两条 planner 路径都用全量目录）。
- Executable = `adapters.ts` switch 实现的 8 个。
- Ghost = 5：`sales_search_customers` / `sales_get_customer` /
  `sales_get_customer_interactions` / `sales_get_customer_quotes` /
  `calendar_create_event_draft` → 执行期 `Unsupported tool` → 重试耗尽 →
  step failed → Job needs_human（S2-s2、S3-s3/s4 的真实死因）。
- 目录顶部注释引用的 "ToolRegistry" 不存在（stale doc）。

**After**（本 P0）：

- PLANNER_VISIBLE_TOOL_COUNT = **13**；EXECUTABLE_TOOL_COUNT = **13**；
  GHOST_TOOL_COUNT = **0**；`PLANNER_VISIBLE ⊆ EXECUTABLE` 恒成立
  （允许 EXECUTABLE ⊋ PLANNER_VISIBLE，当前两集相等；
  `workforce_synthesis` 是 runtime 执行模式标签，不属于任何一集）。
- 永久 invariant 测试（P0-G1）+ 投影 fail-closed 测试（无 handler 的目录
  条目被 planner 投影过滤）。

## 4. Single Source of Truth 策略

不再维护两份需人工同步的列表：

- **Executable 事实源** = `adapters.ts` 的 `RUNTIME_V2_TOOL_HANDLERS` handler
  map——`executeRuntimeV2Tool` 从此 map 分发，"在 map 中有 handler ⇔ 可执行"
  是机器事实而非约定；导出 `isRuntimeV2ToolExecutable()` /
  `listExecutableRuntimeV2ToolNames()`。
- **Descriptor 事实源** = `tool-catalog.ts`（风险/审批/渠道元数据不变）。
- **Planner 可见投影** = `plannerVisibleRuntimeV2Tools()` = 目录 ∩ 可执行
  （fail-closed：目录中任何没有 handler 的条目自动不可见）。planner 默认
  工具集与 legacy 显式传参均改用投影。
- 选择该方案而非"巨型 ToolDefinition 重构"：保持 adapter API 与 switch 语义
  零漂移（minimal safe change），同时 invariant 由结构保证 + 永久测试双重
  锁定（§8 允许方向之三）。

## 5. Customer Read Adapters 实现

四个 sales read tools 全部真实实现，复用兄弟 adapter 既有的
org-scope + bounded select 模式（未造第二套 access logic；执行期鉴权仍走
`canInvokeTool`，与其它工具一致）：

| 工具 | 语义 | 边界 |
|---|---|---|
| `sales_search_customers` | 组织内活跃客户检索（`archivedAt=null`、非 dormant） | orgId 强制、`take 20`、按 updatedAt desc |
| `sales_get_customer` | 客户详情 + 近 5 条商机摘要 | 目标优先从**声明依赖证据**推导（prioritized → customers → 标量 customerId → Handoff businessRefs，cap 5）；无线索回退组织内近期 5 个 |
| `sales_get_customer_interactions` | 互动历史（summary 逐条截断 300 字符） | 同上目标推导；`take 20` |
| `sales_get_customer_quotes` | 报价记录 + 状态分布 | 同上；`take 20` |

租户安全（P0-G2 实证）：所有查询强制 `orgId` scope；跨 org 客户 id 经证据
投毒注入时返回**空结果**（不报错、不泄露存在性）；无 unbounded select、
无隐藏写、无鉴权旁路。adapter 无参数通道是既有架构事实（context-driven），
"证据推导目标 + 有界组织兜底"在该约束下同时服务黄金模板与模型规划两类计划，
并消除了原目录描述对 planner 的误导（F-01/S2 工具语义误配的根因之一）。

## 6. Calendar Draft 决策

**CALENDAR_DRAFT = IMPLEMENTED**。`calendar_create_event_draft` 复用已被
S1 验证的安全路径：`createDraft(type="calendar.create_event")` →
PendingAction → 审批 → 既有 `executePendingAction` 执行外部操作。adapter
本身零外部副作用（绝不直连 Google Calendar）；无优先客户证据时合法 skip。
幂等键沿用 `buildRuntimeV2OperationKey`（runId + stepKey + actionType +
targetId）。

## 7. #89 旧字面 stepKey 耦合（全清单）

审计发现耦合面比任务书列举更广，全部移除：

| 位置 | 旧行为 |
|---|---|
| `sales_prioritize_followups` adapter | 读 `prior.s1_pipeline / s2_opportunities / s3_followup_analysis / s4_quote_risk` 字面键 |
| `grader_create_followup_task` / `sales_update_followup` / `gmail_create_draft` | 读 `prior.s5_prioritize` 字面键（S3 写路径的同类死因） |
| `buildFinalReport` / `getRuntimeV2WorkbenchView` | `steps.find(stepKey === "s5_prioritize")` |
| 错误文案 | `MISSING_GRADER_EVIDENCE: 必须先完成 s3/s4 分析步骤`（模板编号对用户不可理解，F-02） |

## 8. 新依赖驱动证据行为

- 唯一权威 = `step.dependsOn`：executor 为 workforce 契约任务构建
  `scopedEvidenceByDependsOn`（仅声明上游、按**声明序**构建 map）。
- 业务语义来自内容契约而非键名：跟进分析按 `grader` 标记
  （`customer_followup*`）、报价风险按 `quote_risk*`、商机列表按
  `opportunities` 数组（回退 pipeline `byStage+sample`）、优先客户按
  `prioritized` 数组形状识别——`s1`/`risk_review`/`abc123` 任意命名均可执行
  （P0-G3 + 真实 S3-s7 实证）。
- 黄金模板补全真实依赖声明：`s5_prioritize.dependsOn` = `[s2_opportunities,
  s3_followup_analysis, s4_quote_risk]`（声明=真实消费集；此前 s5 隐式消费
  未声明的 s2/s1——依赖成为权威后必须显式）。2B-1 既有测试中按旧声明写死的
  两处断言同步更新（`phase2b1-task-handoff` §41/§43）。
- 报告/工作台按工具语义定位 prioritize 步骤（`preferredTool ===
  "sales_prioritize_followups"`，legacy 字面键兜底）。

## 9. priorEvidence Scoping

- `runType=workforce_job` 且 step 携带 valid `workforceTask` spec →
  `ctx.priorEvidence` 仅含声明依赖证据（scoped）。
- Legacy runtime_v2 与 true-legacy workforce step（spec absent）→ 全量 map
  保持不变（§13 兼容；adapter API `ctx.priorEvidence` 形状零变化）。
- P0-G5 实证依赖范围强制：Run 内存在 SECRET_X 时，`dependsOn=[A,B,C]` 的
  synthesis 输入不含 SECRET_X 的任何内容。

## 10. Native Synthesis 架构

Synthesis 是 Workforce Runtime 一等执行语义（新模块
`src/lib/workforce-runtime/synthesis.ts`），不是业务工具（目录/注册表零
synthesis 工具，§15 遵守）：

```
taskKind === "synthesis"（无 preferredTool）
  → 2B-1 gate（spec/worker/上游 Handoff 校验，声明序）
  → buildBoundedSynthesisInput（有界、确定性截断、可审计）
  → 统一 Model Runtime（createCompletion：配额预检 + recordAiCall 遥测内建）
  → WorkforceSynthesisResultV1Schema 校验（strip + bounded）
  → 既有 executor 后处理（fence 检查点 / 重试 / 终态 / workforce-handoff/v1 / 事件）
```

- **执行优先级**：synthesis 步骤显式声明了可执行工具时仍走该工具（模型把
  确定性聚合器绑为 synthesis 的 S3 理想形态保留其结构化输出供下游写任务
  消费，与 2B-1 §44 冻结行为一致）；未声明工具 → native synthesis。
  `no_tool` 对 synthesis 不再可能（P0-G4）。
- executor 中 workforce gate 前移到工具解析之前（synthesis 无工具，必须在
  `no_tool` 判定前识别 taskKind）；synthesis 不调用业务工具、不读业务表，
  无 tool 鉴权对象（membership 已在轮次入口校验，模型配额由统一 Model
  Runtime 预检）；事件/幂等以内部标签 `workforce_synthesis` 标识（非工具，
  永不进入 Planner catalog）。
- 失败 fail-closed：模型异常 → `SYNTHESIS_MODEL_FAILED`；非 JSON / 不合
  契约 → `SYNTHESIS_INVALID_OUTPUT`；零 validated 上游 →
  `SYNTHESIS_NO_UPSTREAM`。一律走既有重试→`failed`（durable errorCode
  `synthesis_failed`），**绝无字符串拼接降级**。
- 契约校验前置（`applyWorkforceTaskSpecs`）：synthesis 必须声明 ≥1 个
  dependsOn；`requiresApproval=true` 直接 fail validation（synthesis 不产生
  PendingAction，审批语义会死锁）。
- 测试接缝 `setWorkforceSynthesisModelForTests` 仅 `NODE_ENV=test` 可用，
  生产路径无旁路。
- Kill-switch 全覆盖（P0-G10）：开关关闭 → 不 claim、零 Step mutation、
  零 synthesis 模型调用；恢复后正常执行。

## 11. Synthesis 输入/输出契约

**输入**（§18 权威）：仅 `step.dependsOn` 声明上游的 validated
`workforce-handoff/v1`，顺序严格 = 声明序（P0-G6：完成序 C,A,B 时输入仍为
A,B,C）。有界：单上游 4KB / 总 24KB（UTF-8 字节；超预算先弃 outputs 保
summary，截断记录于 `synthesisInputTruncated` 可审计）。

**输出**（§19 最低契约的实现）：

```ts
{ summary: string(≤2000), conclusions: string[](1..10, 每条 ≤500),
  risks?/opportunities?/recommendations?: string[](≤10),
  evidenceRefs?: string[](≤20) }  // .strip()，未知字段丢弃
```

serializable / handoff-compatible；`synthesisOf`（声明序上游 stepKey 列表）
随结果落库供审计。模型输出 token 预算 4000（transport 边界；内容边界由
schema 强制——初版 1400 在真实 S4 被推理模型的 reasoning tokens 全额耗尽、
四次尝试零内容，实测后调至与 planner 同量级）。

## 12. Handoff 内容质量改进（32KB 信封不变）

- 各 adapter 输出新增有界业务 `summary`（Pipeline 阶段分布 / 商机简报 /
  分析结论计数 / 优先客户名单 / 草稿数量），`deriveSummary` 自动采用——
  信封 summary 从「模板文零业务内容」（F-07）变为真实业务摘要。
- synthesis 信封 summary = 真实综合结论（非「综合 N 个上游任务」模板文），
  `extractSynthesisHandoffSummary` → `buildFinalReport` 呈现的即业务结论。
- `deriveBusinessRefs` 扩展已知列表形状（customers/opportunities/quotes/
  prioritized → `{entity}:{id}`，去重、cap 20 不变）——大体量数据继续走
  引用 + durable retrieval，不 dump 进信封；所有尺寸上限（32KB/4KB/16KB）
  与 2B-1 一致（P0-G9 回归确认 fail-closed 边界不降）。

## 13. #90A 此前 Verifier 缺陷

`deterministicVerify` 的失败统计为
`failed && requiresApproval === false`——失败的写步骤（requiresApproval=true）
完全不可见；且 s8 式失败（工具在建草稿前失败）不产生 PendingAction，
PendingAction 检查同样看不见 → S1 带失败步骤 `PASS → completed`，模型复核
在其上进一步生成与事实相反的叙述（F-04）。

审计补充的结构事实：`modelVerify` 仅在 deterministic=PASS 时运行，
"LLM 推翻确定性失败"在现代码结构上并不可达——假完成的源头是确定性引擎
自身失明；hard floor 仍显式化为第二道防线。

## 14. 新 Deterministic Hard-Floor 规则

- `failedRequired = status ∈ {failed, blocked}`，**与 requiresApproval 无关**
  （当前 Task contract 无 optional 标记 ⇒ 全部 required；optional 只能由
  未来显式契约声明，不得由 requiresApproval 推导）。
- 不可自动修复的失败（审批类步骤失败——repair 机制只重置非审批步骤）且无
  可修复失败时 → 直接 `NEEDS_HUMAN`（不空转 REPAIR 烧修复预算）；可修复
  失败仍走既有 REPAIR。
- `applyDeterministicHardFloor(deterministic, model)` 导出纯函数并在
  `verifyRuntimeV2Run` 强制：deterministic ≠ PASS 时模型 PASS 被钳制
  （模型只允许补充解释/降级，永不解除确定性失败）。P0-G7 纯逻辑 + DB 双重
  锁定。
- durable errorCode 补全（Part E 允许的 correctness 面）：verifier 转人工
  写 `verification_failed`；executor `blocked_graph` 补 errorCode。二者均非
  `MANUAL_RESUMABLE_PERMISSION_CODES` 成员 → 2C-1 manual resume 白名单行为
  逐字不变（仍 fail-closed）。#90B 的 UX/文案/needsYou 呈现零改动。

## 15. Approval Outcome ≠ Execution Outcome

- CASE A（审批拒绝）：reconcile all-rejected → step `skipped`（合法 skip）→
  `needs_human(approval_rejected)`、无下游——2C-1 冻结行为逐字保持
  （P0-G8 + 2C-1 全套回归）。
- CASE B（审批通过 → 执行失败）：PendingAction=failed → reconcile → step
  `failed` → needs_human / verifier 可见（P0-G7b）。
- **审计发现并修复的接线缺口**：`approval/port.ts` 的 v2 durable-graph
  resume 被 `result.ok` 门控——审批执行失败时 `resumeRuntimeV2AfterApproval`
  不被调用，Run 永滞留 `awaiting_approval`，真实失败被审批语义遮蔽（真实
  S1 复跑首轮实测命中）。修复：v2 reconcile 不再以执行成功为前置
  （P0-G7c 端到端锁定）。这是 §25 CASE B 语义在入口层的必要闭合，属 #90A
  correctness 范围。

## 16. 永久不变量（新增测试锁定）

1. `PLANNER_VISIBLE_TOOLS ⊆ EXECUTABLE_TOOLS`（GHOST_TOOL_COUNT=0，
   投影 fail-closed）。
2. Synthesis 契约：无 preferredTool 合法；零依赖 / requiresApproval →
   plan-time fail validation。
3. Synthesis 输入 = 声明依赖、声明序、有界（SECRET 不可见）。
4. Required Task terminal failure ⇒ verifier ≠ PASS ⇒ Job ≠ completed
   （requiresApproval 不豁免；LLM 不可解除；审批入口执行失败不滞留
   awaiting_approval）。
5. Job status = completed ⇒ 不存在 failed/blocked 的 required Task
   （由 1–4 结构保证 + P0-G7 断言）。
6. 合法 skip（审批拒绝 / 无可写对象）不因 #90A 变为 failure。

## 17. P0-G1 … P0-G10 结果

| Gate | 内容 | 结果 |
|---|---|---|
| P0-G1 | Catalog 对齐不变量（13/13 可执行、ghost=0、投影 fail-closed、synthesis 标签不入目录） | **PASS**（纯逻辑 27 项） |
| P0-G2 | 4 个客户读工具真实执行 + org A 只见 org A + 跨 org id 投毒空结果 | **PASS** |
| P0-G3 | 模型命名 DAG（read_pipeline/followup_review/risk_review/rank_customers）rank 完成、零模板编号错误 | **PASS** |
| P0-G4 | A/B/C→S native synthesis：无 preferredTool 完成、非 no_tool、结构化结果 + 真实结论入信封与最终报告、统一模型出口恰一次 | **PASS** |
| P0-G5 | S dependsOn=[A,B,C]，SECRET_X 完全不可见 | **PASS** |
| P0-G6 | 完成序 C,A,B ≠ 声明序 → 输入严格 A,B,C | **PASS** |
| P0-G7 | 失败审批任务：G7a 工具失败 / G7b 审批通过后执行失败 / G7c 审批入口接线——一律 step failed、Verifier=NEEDS_HUMAN、Job≠completed、errorCode=verification_failed；hard floor 纯函数 4 项 | **PASS** |
| P0-G8 | 审批全拒 → skipped + needs_human(approval_rejected) + 零下游（2C-1 冻结） | **PASS** |
| P0-G9 | HANDOFF_MISSING / VERSION_UNSUPPORTED 依旧 fail-closed（scoping 未削弱 2B-1 边界） | **PASS** |
| P0-G10 | Kill-switch：不 claim、queued 冻结、零 Step mutation、零 synthesis 模型调用；恢复后正常完成 | **PASS** |

DB 套件 51 项断言全绿（G1–G9 与 G10 分别在两次运行中完整通过；单次全量
重跑于共享隔离分支耗尽 AgentRun 治理配额中止属环境饱和，见 §20 债项，
换新隔离分支后全量绿）。

## 18. 真实 S1–S4 复跑（SEQUENTIAL，同一组 Scenario 零修改）

环境 = 验证报告同方法：临时隔离 Neon 分支（生产快照
`preview-p0-s1s4-rerun-0810`，跑完即删）、`assertSafeTestDatabase`
fail-closed 放行、真实 org「Sunny Home & Deco」（10 商机/13 客户/9 报价）、
真实 sales 发起人 + 无 calendar provider 的 org_admin 审批人、真实 LLM
（`gpt-5.6-sol`）、`GMAIL_DRAFT_ENABLED` 未配置（零外部副作用）、
驱动只调用既有导出、加速仅 `nextAttemptAt` 快进。

| Run | 计划来源 | 任务数 | 终态 | 墙钟 | 纯执行 | 工具调用 | 模型调用(tokens) | 审批 | 说明 |
|---|---|---|---|---|---|---|---|---|---|
| S1 | 模板 | 8 | **needs_human(verification_failed)** | 27.3s | 25.3s | 9 | 0 | 5/5 全批全执行 | s1–s7 全完成、2 商机改期 + 3 日历草稿**真实落库**；s8 gmail 环境关闭失败→#90A 正确显性化（原验证中此场景是**假 completed**，即 F-04 本体） |
| S2 | 模型 | 3 | **completed** | 52.7s | 50.9s | 3 | 4 (3,986) | 0 | 原死因幽灵工具已消除；本次模型计划未含 synthesis 步骤（计划随模型漂移） |
| S3 | 模型 | 8 | **completed** | 78.3s | 74.0s | 8 | 2 (4,265) | 0 | **两个原幽灵工具（interactions/quotes 读取）真实执行**；rank 在模型命名依赖上完成；写步骤因模型未把商机列表列入 rank 依赖 → 空排序 → 合法 skip（诚实完成，见 §20 债项） |
| S4 | 模型 | 5 | **completed** | 94.9s | 93.0s | 5 | 4 (8,641) | 0 | 模型规划理想 DAG（4 并列分析 + 显式 synthesis 无工具）；**native synthesis 真实产出结构化综合结论**（6 结论/3 风险/3 机会/6 建议，含跨 Grader 数据口径矛盾的交叉审视）；「综合结论」首次在真实场景进入最终报告 |

- S1 = NOT_COMPLETED 是 #90A 的**正确**结果：老基线的 "completed" 正是被
  修复的假完成（FALSE_COMPLETED_WITH_FAILED_REQUIRED_TASK = BLOCKED 的
  真实证据）；除 s8 外全部业务价值真实交付且审批→执行→DB 全链路核对无误
  （2 商机 `nextFollowupAt → 2026-08-14`）。
- S4 首轮曾因 synthesis 模型输出预算 1400 tokens 被推理模型 reasoning 全额
  耗尽而 `SYNTHESIS_INVALID_OUTPUT`（4 次尝试 completionTokens 恰=1400 上限；
  deterministic verifier 全程拒绝 PASS——失败面行为同样正确）。预算调至
  4000 后复跑一次通过；Scenario 本身零修改。
- 复跑期间发现并修复审批入口 CASE B 接线缺口（§15）——同属 Runtime 修复，
  非 benchmark 调整。

成功线判定：Ghost Tool Failure **0**；Step-Key Failure **0**；Synthesis
no_tool Failure **0**；False Completion **0**；模型规划+多任务+native
synthesis 场景（S4）**COMPLETED** 且产出真实结构化综合结论 →
**P0_CORRECTNESS_GATE = PASS**。

## 19. 回归结果

| 套件 | 结果 |
|---|---|
| P0 新增（纯逻辑 27 + DB 51 断言） | PASS |
| Phase 2B-1 H1–H5（契约纯函数 60 项 + Task/Handoff DB + 审批×Handoff） | PASS（§41/§43 两处依赖声明断言按 #89 模板补全同步更新） |
| Phase 2A A–L 全套 | PASS（approval-resume 终态断言按 #90A 更新：失败写任务 → needs_human，注释原文即记载着旧的 F-04 行为） |
| Phase 2C-1 M/N/R + Expiry 竞态 | PASS |
| Workforce Test Isolation RUN1/RUN2 | PASS |
| Kill-Switch | PASS（含 P0-G10 synthesis 覆盖） |
| Golden Runtime V2（planner/durable/verifier-security/golden-flow/preview-gate） | PASS |
| Tool Guard / Scope Guard / Approval Principal / Production DB Guard / Production Operation Guard | PASS |
| Phase3A-3/3A-4/3A-5 四个 smoke/acceptance | 共享 staging 隔离分支上因**数据面前置**（要求真实 Sunny/梦馨双租户组织存在）不满足而失败——非代码回归；在生产快照分支上定向复跑 **28+28+29+23 全绿** |
| tsc / eslint | PASS |
| build / CI | 见 PR #94 checks（`validate-lint-typecheck-test-build` + `Vercel – qingyan-staging` 为有效门；`Vercel – -` 恒失败为既有状况非信号） |
| test-all 总计 | 190/194 → 4 项即上述数据面前置项，定向复跑全绿；最终代码（含 port 修复）在全新隔离分支完整重跑 test-all（结果见 PR 最终状态） |

## 20. 剩余技术债

| # | 债项 | 去向 |
|---|---|---|
| P0-D1 | 模型对聚合类步骤仍可能**欠声明依赖**（S3 的 rank 未声明商机列表上游 → 空排序 → 写步骤合法 skip，Job 诚实完成但业务产出弱化）。planner prompt 已加显式规则，但依赖完整性的确定性校验（如"聚合工具声明依赖须含列表型上游"）属 planner 质量工作 | 2B-3 / planner 迭代输入 |
| P0-D2 | `FEATURE_NOT_CONFIGURED`（gmail 开关关闭）语义为 step failure → Job needs_human。业务上"功能未配置"是否应为可声明的 optional/skip 契约，属产品决策（§26：optional 必须显式契约，本 P0 不引入） | #90B / 2C-3 讨论 |
| P0-D3 | 共享隔离分支多次全量跑后触发 AgentRun 治理配额 hard limit（环境饱和，非回归）；suite 级 quota 隔离或 fixture 计数回收可改善 | 测试基建 debt |
| P0-D4 | `verifier` 对 PARTIAL 降级证据的 REPAIR 循环只能靠 maxRepairs 收敛（既有行为，未在本 P0 扩大） | 既有 debt 记录 |
| P0-D5 | 模型 verifier 偶发对确定性 PASS 的过度怀疑（S2 两轮 REPAIR 后 PASS）——hard floor 方向（禁升级）已锁死，降级噪声属模型质量面 | 观察项 |
| P0-D6 | staging 项目分支 schema 落后于 prisma/schema.prisma（本次以 `db push` 对齐隔离分支）；staging 主分支对齐属运维动作 | 运维 debt |

## 21. Next-Phase 建议

- **NEXT_PHASE_RECOMMENDATION = 2B-3**（维持 Real Validation 的
  NEXT_PRIORITY）。理由：P0 修复后模型规划场景的剩余失败模式全部收敛为
  "真实失败被正确显性化后无恢复路径"（S1 的 gmail 环境失败、假设中的模型
  瞬时失败）——failure recovery / fallback 是当前最大价值缺口；执行层
  已可承接（本 P0 的前置债已清）。次优先 2D（#90B 用户可理解性，S1/S4 的
  needs_human 用户面仍是 UNKNOWN 词面）。
- 2B-2 并行化解冻条件已具备（correctness 面清零），但 rebase 后需重新审计
  其执行假设（scoped evidence、native synthesis、verifier 新规则）。
- **NEXT_PHASE_AUTOSTART = NO**——是否进入 2B-2 / 2B-3 / 2C-3 / 2D 由人工
  Final Review 决定。

## Issues 状态声明

- `#88_RESOLVED_BY_PR = CANDIDATE`（不自行 close）
- `#89_RESOLVED_BY_PR = CANDIDATE`（不自行 close）
- `#90A_RESOLVED_BY_PR = CANDIDATE`；`#90_OVERALL_RESOLVED = NO`
  （#90B 用户态可理解性仍在，属 2D/#90B 范围）

## 附：运行档案与清理

- S1–S4 全量导出（run/steps/events/verifications/pendingActions/
  finalReport/userView/模型调用日志）留存于会话 scratchpad
  `results/S1–S4.json`；报告数字均可回溯。
- 驱动脚本为会话级工具未入库（与 Real Validation 同准则），行为由 durable
  状态与事件完全可复现。
- 隔离分支 `preview-p0-align-0810`（staging）、`preview-p0-align2-0810`
  （staging，最终回归）、`preview-p0-s1s4-rerun-0810`（生产快照）已在收尾
  时删除（分支列表复核无残留）。
