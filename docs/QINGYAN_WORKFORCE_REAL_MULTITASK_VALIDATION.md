# Qingyan Workforce — Real Multi-Task Validation 报告
## Lane C / Product Validation（NO RUNTIME IMPLEMENTATION）

- 日期：2026-08-10
- 分支：`claude/qingyan-multi-task-validation-0c004f`（仅新增本报告，零 Runtime 改动）
- 基线：verified main `abac67e`（含 PR #85 Phase 2B-1 Task/Worker/Handoff、PR #86 测试隔离加固；两者均已 merge，满足任务书 §2）
- 验证对象：**Multi Task + Worker + Structured Handoff + Synthesis** 在真实业务场景中的产品价值
- 模式：**SEQUENTIAL MULTI-TASK BASELINE**（§3；2B-2 合并后可用同一组 Scenario 复跑对比 parallel）

---

## 0. 结论速览

**2B-1 的运行时契约面（Task 契约、Worker 校验、Handoff fail-closed、审批闭环、幂等、写动作落库）在真实数据上全部按设计工作；但工具执行层尚未准备好承接模型规划的多任务** —— 4 个真实业务场景中只有黄金模板路径（S1）跑通，3 个模型规划场景全部死于执行层缺口（幽灵工具 / 硬编码步骤键 / synthesis 无工具），而它们的任务分解本身质量良好。**没有任何一个真实场景产出过 synthesis 综合结论。** 失败后的用户面（除审批拒绝外）不可理解且无恢复路径。

产品价值判定：**多任务编排 + 审批闭环已产生真实可用价值（S1 全链路 38 秒完成 8 任务、2 次人工审批、写动作真实落库、优先级结论业务上站得住）；但「模型自主分解 → 多 Worker → Handoff → Synthesis」的完整叙事目前只有前半段成立。**

---

## 1. 方法与环境

| 项 | 值 |
|---|---|
| 数据面 | 临时隔离 Neon 分支 `preview-multitask-validation-0810`（生产快照，跑完即删）；`assertSafeTestDatabase` fail-closed 放行（`DATABASE_ENVIRONMENT=isolated` + `NODE_ENV=test`） |
| 业务组织 | 真实 org「Sunny Home & Deco」：10 个活跃商机、9 份报价、13 个客户、10 条互动 |
| 发起人 / 审批人 | 真实 sales 角色成员发起（`WORKFORCE_RUNTIME_USER_ALLOWLIST` 精确白名单）；org_admin 审批（预检无 Google Calendar provider 绑定，杜绝外部 push） |
| 模型面 | 真实 LLM（`gpt-5.6-sol`，OPENAI_* 生产配置）：planner + verifier；两个 Grader 均为规则型（零模型调用） |
| 外部副作用 | 零：Gmail 草稿开关（`GMAIL_DRAFT_ENABLED`）未配置 → 天然关闭；calendar 审批执行仅落 DB（审批人无 provider）；企业微信不涉及 |
| 驱动方式 | 会话级驱动脚本只调用既有导出：`createWorkforceJob` → 循环 `processWorkforceJobSlice` → `approveApprovalItem`/`rejectApprovalItem` → `resumeWorkforceJob`；全量导出 run/steps/events/verifications/pendingActions/finalReport/read-model userView；模型调用数与 token 从 `recordAiCall` 控制台记录采集 |
| Runtime 修改 | **无**（§1 HARD BOUNDARY 遵守；故障注入仅数据面 fixture：改 `AgentRunStep` 行，见 §12） |

**数据真实性声明**：该 org 为生产库中真实存在的组织，但当前 pipeline 内容以 QA 种子记录为主（客户名带 `[AR2-QA]`/`[Sec1-QA]`/`[E2E]`/`预验收` 前缀）。验证为「真实 Runtime + 真实 DB + 真实审批链」，业务语料的商业真实度有限——按 §4 不为凑场景造数据，如实声明。

**加速器声明**：重试退避 >20s 时数据面快进 `nextAttemptAt`（只影响排队等待，不影响执行语义），已逐次记录；latency 指标按含真实等待的墙钟与纯执行两口径给出。

---

## 2. Scenario 设计（§5 模板）

从 13 个目录工具（实际可执行 8 个，见 F-01）与两个规则型 Grader 出发，围绕任务书 §4 优先业务选了 4 个业务场景 + 2 个注入场景。投标（Tender）线**无法设计**：`tender_worker` 在 registry 预留但 V2 目录没有任何 tender 工具（tender-auto-analysis 管线独立于 Runtime V2）——记 F-08。

### S1 · 周销售跟进作战会（黄金模板路径）
- **User Goal**：帮我检查最近需要跟进的销售客户，整理优先顺序和下一步建议。
- **Expected Tasks**：pipeline → 商机列表 → 跟进分析 → 报价风险 → 优先级合并 → 跟进任务草稿 / 改期草稿 / 邮件草稿（模板 8 步）
- **Expected Worker Roles**：sales_worker 全程（server 默认指派；模板无 synthesis 任务）
- **Expected Dependencies**：线性 + s5 汇聚 s3/s4、s6-s8 扇出于 s5
- **Expected Human Gates**：s6/s7/s8 三个写步骤全部 PendingAction 审批
- **Expected Final Result**：≤3 优先客户 + 理由 + 已审批落库的跟进安排
- **Must Not Do**：直写业务表绕过审批；发送真实邮件
- **实际审批策略**：calendar/update_followup 全批（DB-only）；gmail 因环境开关关闭自然失败（见 §12-A）

### S2 · 报价风险专项清查（模型规划 / 只读）
- **User Goal**：对当前所有活跃商机的报价做一次全面风险检查，找出过期、超时未回应或金额异常的报价，汇总一份报价风险清单和处理建议。
- **Expected Tasks**：商机/报价读取 → 风险分析 → 汇总
- **Expected Worker Roles**：sales_worker 工作任务 + synthesis_worker 汇总
- **Expected Dependencies**：读取 → 分析 → synthesis 汇聚
- **Expected Human Gates**：无（纯只读）
- **Expected Final Result**：带综合结论的风险清单
- **Must Not Do**：写动作；编造不存在的报价

### S3 · 停滞商机跟进安排（模型规划 / 含写动作）
- **User Goal**：检查销售管道里停滞最久的商机，评估这些商机的报价风险，为最需要行动的商机安排下一次跟进时间。
- **Expected Tasks**：pipeline/商机 → 停滞与风险分析 → 优先级 → 改期写动作
- **Expected Worker Roles**：sales_worker + synthesis（优先级合并）
- **Expected Human Gates**：`sales.update_followup` 审批
- **Expected Final Result**：真实改期落库
- **Must Not Do**：跳过审批直写

### S4 · 四角度销售体检（模型规划 / 显式综合要求）
- **User Goal**：从管道健康度、活跃商机、客户跟进优先级、报价风险四个角度做一次销售现状体检，最后合并成一份综合判断报告，指出最重要的三个风险和三个机会。
- **Expected Tasks**：四个并列分析 → 显式 synthesis
- **Expected Worker Roles**：sales_worker ×4 + synthesis_worker
- **Expected Human Gates**：无
- **Expected Final Result**：final report 出现「综合结论」
- **Must Not Do**：把四个输出简单拼接冒充综合

### F2 · 审批拒绝（§12 approval blocks）
S1 同目标；首个审批门全部 reject → 验证 park 语义与恢复路径。

### F3 · Handoff 损坏 fixture（§12 malformed handoff）
S1 同目标；s1 完成后数据面将其信封 `contractVersion` 改为 `workforce-handoff/v999` → 验证下游 fail-closed 与用户可见面。

---

## 3. 运行结果总表（§8 指标）

| Run | 计划来源 | 任务数 | 终态 | 墙钟 | 纯执行 | 工具调用 | 模型调用(tokens) | 审批暂停/决策 | 失败任务 | 重试 |
|---|---|---|---|---|---|---|---|---|---|---|
| S1 | 模板 | 8 | **completed** | 38.3s | 25.8s | 9 | 1 (685) verifier | 2 / 5 | 1（s8 gmail） | s8×2 |
| S2 | 模型 | 4 | needs_human | 38.0s | 35.6s | 3 | 1 (2340) planner | 0 / 0 | 1（s2 幽灵工具） | s2×2 |
| S3 | 模型 | 8 | needs_human | 60.1s | 54.5s | 6 | 1 (3238) planner | 0 / 0 | 2（s3/s4 幽灵工具） | 各×2 |
| S4 | 模型 | 6 | needs_human | 83.9s | 65.2s | 6 | 2 (4749) planner×2 | 0 / 0 | 1（s4 硬编码键） | 规划重试×1 + s4×2 |
| F2 | 模板 | 8 | needs_human(approval_rejected) | 18.6s | 11.4s | 6 | 0 | 1 / 3(全拒) | 0（s6 skipped） | — |
| F3 | 模板 | 8 | needs_human(HANDOFF_VERSION_UNSUPPORTED) | 7.6s | 3.9s | 1 | 0 | 0 / 0 | 1（s2 fail-closed） | — |

聚合（4 个业务场景）：**AVG 墙钟 55.1s / 纯执行 45.3s；AVG 工具调用 6.0；AVG 模型调用 1.25（planner 占延迟大头 25.6–45.0s/次）；总 token 11,012（约 $0.02–0.05/场景量级，按通用定价估算）；Job 完成率 1/4（25%）；任务级失败 5/26（19.2%）。**

写动作真实性核对（S1）：2 个商机 `nextFollowupAt` 更新为 2026-08-14（周五 15:00，与 adapter 的 nextFriday 逻辑一致）、3 个 calendar 草稿审批后落库执行——**审批 → 执行 → DB 状态全链路真实**。第 3 个优先客户被 adapter 的 `slice(0,2)` 上限裁掉（设计使然，报告口径未提示，记 F-09 小项）。

---

## 4. 分项评审

### 4.1 Task Decomposition（§8）——评分 4/5

三次模型规划的 DAG 全部业务合理：读取 → 分析 → 聚合/综合 → （写动作），依赖方向正确，无环、无冗余任务；worker/taskKind 提议全部合法（零编造 worker，server 校验零拦截）。S3 甚至给出理想形态：`sales_prioritize_followups` 绑定为 `taskKind=synthesis` 的综合步骤。扣分项：S2 用单客户工具 `sales_get_customer_quotes` 承接「全部报价」语义（工具语义误配，但目录描述本身给了误导）；S4 首次规划失败消耗一次重试（退避后第二次成功，恢复机制工作正常）。

### 4.2 Handoff Review（§10）——评分 3/5

- **契约与安全（满分项）**：所有完成/跳过任务的信封均合法生成、与步骤终态同写；全量扫描 6 run × 全部信封，**授权/内部上下文字段零泄漏**；F3 注入损坏后下游精确 fail-closed（`HANDOFF_VERSION_UNSUPPORTED`，错误信息含步骤名与版本号）；F2 拒绝后 skipped 信封明示「该任务未产生业务写入（审批拒绝或无可写对象）」——warnings 语义准确。
- **信息价值（主要扣分）**：
  - summary 是模板文（「已完成：{objective}（产出字段：…字段名列举）」），**零业务内容**——下游或人类从 summary 读不到任何结论；
  - 列表型输出（10 条商机）超 4KB 预算后被有界投影为 `{count:10, truncated:true}` 占位——当前无碍（真实数据流仍走 legacy `priorEvidence` 全量证据管道，§6.1 运输层未动），但一旦 Handoff 成为唯一运输层（2B-2 并行愿景），下游将只知道「有 10 条」而拿不到任何一条；
  - 即：**Handoff 目前是「结构正确但内容近乎空转」的平行轨道**，真正的任务间信息传递靠 legacy 证据映射完成。
- **important context lost**：现阶段无（因 priorEvidence 兜底）；**irrelevant dump**：无（有界投影有效）；**wrong summary**：无错误但无信息；**authorization leakage**：零。

### 4.3 Synthesis Review（§11）——评分 2/5

核心问题「最终结果是否真的综合了多个 Task」的实测答案：

- **显式 synthesis 任务在全部 6 个 run 中零完成**：模板计划不含 synthesis 任务（S1/F2/F3）；模型规划的 synthesis 步骤要么无 preferredTool（目录无 synthesis 工具 → 必然 `no_tool`，S2/S4），要么死于上游（S3）。`buildFinalReport` 的「综合结论（stepKey）」路径**从未在真实场景触发**；synthesis 信封的 `upstreamSummaries` 机制只存在于单测。
- **事实上的综合发生在 `sales_prioritize_followups`（规则型）**：S1 的最终输出确实融合了跟进逾期、互动间隔、阶段、金额、报价未回应 5 类跨任务证据（逐客户理由可回溯）——**是真综合，不是拼接**；但它 (a) 是 work 任务不是 synthesis 语义，(b) 只认黄金模板步骤键（F-02），模型计划用不上。
- 结论：**Synthesis 作为产品能力当前不存在于任何可达路径**；存在的是一个被硬编码键锁死在模板计划里的确定性聚合器。

### 4.4 Business Correctness（§8）——评分 4/5

- S1 优先级结论逐项与 DB 事实核对：Top-3 的逾期天数（19/16/16）、阶段、金额、报价未回应天数全部准确；写动作落库值正确。
- 两处业务判断瑕疵：(a) run 时点全库最严重逾期是「预验收客户乙多商机」（**21 天**、negotiation 阶段），因缺互动/金额/报价元数据在多因子评分中落选 Top-3——评分偏向数据完整记录，弱化最强单一紧迫信号；(b) S1 验证结论断言「所有写操作均已审批并执行，无拒绝或失败项」**与事实相反**（s8 已 failed）——deterministic verifier 的失败统计只看 `requiresApproval===false` 的步骤，模型复核在其之上进一步放大（F-04）。

### 4.5 User Quality Score（§9，1–5 人工评分）

| 维度 | S1 | S2 | S3 | S4 |
|---|---|---|---|---|
| Useful? | 4 | 1 | 1 | 1 |
| Correct? | 4（结论对，验证陈述错） | 2（已完成部分对） | 2 | 2 |
| Complete? | 3（email 缺失且未告知） | 1 | 1 | 1 |
| Understandable? | 4 | 2（NEEDS_YOU 无原因） | 2 | 2 |
| Would I use this in real work? | 4 | 1 | 1 | 1 |

S1 的形态（异步 8 任务 + 两次一键审批 + 结论可回溯）**接近真实可用的数字员工体验**；三个模型规划场景对用户呈现为「卡住 + 不知道为什么 + 无法继续」，当前不可交付。

---

## 5. Failure Review（§12）

| 注入 | 方式 | 结果 | 用户可理解？ |
|---|---|---|---|
| one Task fails | **有机发生**（未另造 fixture）：S1-s8 环境开关关闭、S2/S3 幽灵工具、S4 硬编码键 | 中链失败 → 依赖无法推进 → `needs_human`；**run.errorCode 为 null 或残留旧值**（S4 残留 `model_failed`）；末位失败（S1-s8）→ verifier PASS、Job completed、失败静默 | **否**（除非读内部 step 行） |
| one approval blocks | F2：首个审批门 3 个动作全 reject；另 S1 观察纯 awaiting 暂停→批准→恢复 | reject → step `skipped`（reconcile 语义正确）→ resume 步骤 5b park `needs_human(approval_rejected)`，下游 s7/s8 保持未执行 ✓；needsYou 卡片 `APPROVAL_REJECTED` + pendingActionIds + 「审批被拒绝，需要你决定后续」 | **是**（三类停机中唯一清晰的） |
| one Handoff malformed | F3：数据面把 s1 信封版本改为 v999 | 下游 s2 执行门精确 fail-closed：step failed + run needs_human，errorCode/errorMessage 定位到步骤与版本 | **半**（内部错误码准确，但 userView 的 needsYou 是 UNKNOWN，errorCode 未透出） |
| 恢复路径 | F2 park 后尝试 `manual` resume | **被白名单拦截**：`REQUIRES_REPLAN_OR_RESOLUTION:approval_rejected`（2C-1 设计如此，replan/继续归 2C-3）——用户当前唯一选项是放弃该 Job | 死路实测确认 |

对照结论：**fail-closed 契约全部按设计执行（安全性 ✓）；但除审批拒绝外，停机的「为什么 + 怎么办」对用户不可见，且所有停机都没有继续路径。**

---

## 6. Findings（§13 分类）

| # | 类 | 发现 | 证据 | 跟踪 |
|---|---|---|---|---|
| F-01 | **B** | 工具目录 13 个中 5 个 planner 可提议、adapter 未实现（`sales_search_customers`/`sales_get_customer`/`sales_get_customer_interactions`/`sales_get_customer_quotes`/`calendar_create_event_draft`）→ 模型规划 2/3 场景直接死亡 | S2-s2、S3-s3/s4 `Unsupported tool` | [#88](https://github.com/LucasJ880/-/issues/88) |
| F-02 | **B/C** | `sales_prioritize_followups` 硬编码黄金模板步骤键取证据 → 模型命名计划永远 `MISSING_GRADER_EVIDENCE`，错误文案引用模板编号对用户不可理解 | S4-s4 | [#89](https://github.com/LucasJ880/-/issues/89) |
| F-03 | **B** | synthesis taskKind 无执行能力：目录无 synthesis 工具、模型留空 tool → `no_tool`；模板计划无 synthesis 任务 → 「综合结论」路径零触发 | S2-s4、S4-s6；全 6 run | [#89](https://github.com/LucasJ880/-/issues/89) |
| F-04 | **D** | 写步骤（requiresApproval）失败对验证不可见：deterministic verifier 只统计非审批失败步骤 → S1 带失败步骤 PASS+completed；模型复核进一步断言「无拒绝或失败项」（与事实相反） | S1-s8 | [#90](https://github.com/LucasJ880/-/issues/90) |
| F-05 | **F** | blocked_graph/契约失败的用户面不可理解：needsYou=UNKNOWN、errorCode null/残留（S4 残留 model_failed）、`Workforce Job 失败` visibleToUser 事件与 NEEDS_YOU 状态并存 | S2/S3/S4/F3 userView | [#90](https://github.com/LucasJ880/-/issues/90) |
| F-06 | **E** | 一切停机均无继续路径：approval_rejected/blocked_graph 的 manual resume 被 2C-1 白名单 fail-closed（设计边界），用户只能放弃 Job | F2 实测 | 2C-3 范围，不另开 issue |
| F-07 | **C** | Handoff summary 零业务内容 + 列表输出截断为 `{count, truncated}` 占位；当前靠 legacy priorEvidence 兜底，2B-2 若以 Handoff 为唯一运输层将信息饥饿 | §4.2 | 报告记录（2B-2 设计输入） |
| F-08 | **B** | Tender 业务线不可验证：`tender_worker` registry 预留但零工具 | §2 | 报告记录 |
| F-09 | **B 小项** | 多因子评分弱化最强单一逾期信号（21 天逾期者因元数据稀疏落选）；改期/建任务的 top-N 裁剪（2/3）未在结论中告知 | §4.4、§3 | 报告记录 |
| F-10 | **G 观察** | 延迟结构健康：规划模型调用占大头（26–45s），工具毫秒级、规则 Grader <1s、verifier 7.6s；异步 Job 形态下可接受 | §3 | 无需动作 |

**正向验证清单**（同样是本 Lane 的产出）：Job 创建/队列/租约/slice 推进、planner 确定性模板与模型双通道、worker server 校验、Handoff 生成/幂等/尺寸边界/来源核对、审批暂停-恢复-reconcile、拒绝 fail-closed、写动作审批后真实落库、隔离 Guard——全部在真实数据上按 2B-1 报告的承诺工作。

---

## 7. Next-Phase Decision（§14）

主要问题判定：**Task failure recovery**（三类停机全部死路：中链失败、审批拒绝、契约失败；模型规划场景 100% 需要人工介入且介入后无法继续）→ **2B-3 priority ↑（NEXT_PRIORITY = 2B3）**。

但必须附带两条硬前置/并行建议：

1. **P0 前置债（不属于任何 phase 的功能开发，属于修错）**：F-01/F-02/F-03 的工具执行层对齐。不修它们，2B-3 的 fallback/replan 将在同样的幽灵工具上空转，2B-2 的并行化会把同一批死任务并行地死。这是本次验证最重要的单一结论。
2. **次优先 2D**（runtime works but user cannot understand）：F-05 的 UNKNOWN needsYou / 矛盾事件流 / errorCode 不透出——S1 的可用体验证明「能看懂」时价值立现，看不懂时价值归零。

未观察到 2C-2（数据新鲜度）与 2B-2（延迟）类主导问题：顺序执行 55s 均值对异步数字员工形态可接受，parallel 的对照收益应在工具层修复后用同一组 Scenario 复测。

---

## 8. 任务书 §15 返回块

```text
SCENARIOS_RUN =
6（S1 模板全链路 / S2 报价风险 / S3 停滞商机改期 / S4 四角度体检 + F2 审批拒绝 / F3 信封损坏注入；
  Tender 场景因 V2 目录无 tender 工具不可设计，见 F-08）

TASK_DECOMPOSITION_SCORE =
4 / 5（模型 DAG 业务合理、worker/taskKind 提议零违规；扣：工具语义误配一处、一次规划重试）

HANDOFF_SCORE =
3 / 5（契约/安全/幂等/fail-closed 满分；内容价值低：模板化 summary、列表截断占位、实际数据流仍靠 legacy priorEvidence）

SYNTHESIS_SCORE =
2 / 5（显式 synthesis 任务零完成、「综合结论」零触发；唯一真综合是被模板键锁死的规则型 prioritize）

BUSINESS_CORRECTNESS =
4 / 5（输出事实逐项核对无误、写动作落库正确；扣：验证结论与事实相反一处、评分弱化最强逾期信号）

AVG_LATENCY =
55.1s 墙钟 / 45.3s 纯执行（4 业务场景均值；planner 模型调用占 26–45s）

AVG_TOOL_CALLS =
6.0 / 场景（含重试）

AVG_MODEL_CALLS =
1.25 / 场景（planner 1–2 次 + verifier ≤1 次；Grader 规则型 0；总 11,012 tokens ≈ $0.02–0.05/场景量级）

FAILURE_RATE =
Job 级 3/4 业务场景未完成（75%）；任务级 5/26 失败（19.2%）

HUMAN_INTERVENTION_RATE =
计划内审批：仅 S1 到达（2 次暂停 / 5 个决策，审批→执行→落库全部成功）；
计划外 needs_human：3/4 业务场景（全部源于工具执行层缺口）；6 run 中 5 个终态为 needs_human

TOP_5_FINDINGS =
1. F-01（B）5/13 目录工具 planner 可见但不可执行 → 模型规划场景主要死因（#88）
2. F-02/F-03（B/C）聚合工具硬编码模板步骤键 + synthesis 无执行能力 → 综合结论在一切真实路径上不可达（#89）
3. F-04（D）失败的审批类写步骤对 verifier 不可见 → Job 带失败步骤 completed 且验证陈述与事实相反（#90）
4. F-05（F）blocked_graph/契约失败用户面：UNKNOWN needsYou + errorCode 缺失/残留 + FAILED 与 NEEDS_YOU 并存（#90）
5. F-06（E）所有停机无继续路径：manual resume 白名单 fail-closed，用户唯一选项是放弃（2C-3 缺口实测）

NEXT_PRIORITY =
2B3（Task failure recovery 为主要问题）；硬前置：修 F-01/F-02/F-03 工具执行层（P0 债，#88/#89）；次优先 2D（F-05 可理解性）
```

---

## 附：运行档案

- 每个 run 的全量导出（run/steps/events/verifications/pendingActions/finalReport/userView/aiCalls/slice 计时）留存于会话 scratchpad `results/S1–S4,F2,F3.json`；报告中所有数字可回溯到对应 JSON。
- 隔离分支 `preview-multitask-validation-0810` 已于验证结束后删除（分支列表复核无残留）。
- 驱动脚本未入库（非 Runtime 代码、会话级工具）；如需复跑，按 §1 方法用既有导出重建即可，行为由 durable 状态与事件完全可复现。
