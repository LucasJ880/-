# QYANE Supplier Intelligence M1 — S4-A：需求匹配 + 强制项硬门

> Draft PR #214，base = main `85f10ab9`。零 schema / 零 migration。不进入评分与排名。
> 本报告分四块：**复用了什么**、**实现了什么**、**刻意没做什么**、**验证了什么**。

---

## 1. 复用（不重建）

| 既有 | 用法 |
| --- | --- |
| `SupplierSearchRun` | 正式评估 = 一次 Run；`runMode=EVALUATION_ONLY` 写在 `sourceConfigJson`（零 schema） |
| `SupplierCandidate` | Supplier × Offering × Evaluation Run；`mandatoryGateResult / mandatoryGateJson / recommendation / rejectionReason` 原有列 |
| `SupplierRequirementMatch` | 每候选每要求最多一条（原有 unique）；verdict 四词、evaluatedBy 三值原有 |
| `evaluation-service` | `createSupplierCandidate` / `createRequirementMatch`：快照冻结、requirementRefId 服务端推导、证书供应商 / offering scope、线索 LINKED、档案解析、非 RUNNING 拒写——**全部原样复用** |
| `requirement-snapshot` | 三值 mandatory、`collapseMandatoryForMatch`、`indexRequirementSnapshot` |
| `canonical-requirements` | `loadCanonicalSupplierRequirementSnapshot`：唯一的需求来源，fail closed |
| `certification-service` | 证书状态机；S4-A 只读它的结果 |
| `score-contract` | 存在，**本轮不执行**（`computeSupplierScore` 未被任何 S4-A 代码调用） |

没有 `SupplierRequirementMatchV2 / TenderSupplierCompliance / VendorMatch / SupplierEvaluationResult`。

## 2. 先裁决的生命周期问题

S3-A 的发现 Run 以 `finalize=true` 收口成 COMPLETED，而候选 / 匹配只能写进 RUNNING 的 Run——这是正确的历史不可变保护。
所以 S4-A **不** reopen 任何历史 Run（T3 断言 COMPLETED 不能回 RUNNING、不能追加候选、不能改工作数据）。
正式评估 = **新的** `SupplierSearchRun`（`createProjectEvaluationRun`），provenance 用 `sourceDiscoveryRunId` 指回那次发现 Run（服务端核实同 org 同项目，对不上就不记）。

评估运行**不外呼**：`POST /runs/[id]/discover` 与 `executeSupplierSearchRun` 对 EVALUATION_ONLY 一律 409；测试证明候选 / 线索计数不变（provider 调用数恒 0）。

## 3. 实现

### 3.1 创建评估运行（顺序不变量）
Auth（路由）→ 项目写权限 → `loadCanonicalSupplierRequirementSnapshot`（missing / malformed / truncated / uncertain 不可证完整一律抛错，不建 Run）→ 冻结快照 → 建 Run → RUNNING → 建候选。
候选创建失败 → Run 记 FAILED 并保留审计（§29），不删。
客户端到不了：`requirements / mandatory / evaluationVersion / scoreVersion / originSource / requirementRefId / evaluatedBy`（T2 注入全部被忽略）。

### 3.2 来源推导（服务端）
本项目历史候选 → 继承其 `originSource`（T19 断言 HISTORICAL_SUCCESS 被继承）；否则本项目已关联线索 → `NEW_DISCOVERY`；否则 `ORIGIN_SOURCE_UNRESOLVED`（422），**不随手填 SAVED / HISTORICAL_SUCCESS 让记录过关**。

### 3.3 匹配（Layer 1 确定性 + 人工；AI 建议本轮 defer）
- **人工**：`evaluatedBy` 服务端固定 HUMAN；PASS / PARTIAL / FAIL 必带证据，只有 UNKNOWN 允许空（记为资料待补）；档案必须属于本项目（T10）；线索先过项目读门再由脊柱校验 LINKED（T9）。
- **确定性**（`deterministic-match.ts`，纯函数，规则有 ID）：
  - `CERT_TYPE_V1`：要求明确点名一种认证 → 有 VERIFIED + 评估时未过期 + scope 兼容的证书才 PASS；只有 CLAIMED / 过期 / scope 不对 → UNKNOWN（不是 FAIL：没有证据证明「没有认证」）；
  - `NUMERIC_THRESHOLD_V1`：`minimum / at least / ≥ N 单位` 对 offering 快照同单位族数值 → PASS / FAIL；单位不可靠换算、多个同族值 → UNKNOWN，不猜；不四舍五入（136 kg = 299.8 lb 对 300 lb 就是 FAIL）。
  - 服务端重算后写成 DETERMINISTIC；客户端只能说「采用规则」，带不了 verdict。
- 没有为了 S4-A 强行接 LLM。

### 3.4 证据信任模型（门不只看 verdict）
| 证据 | 能否支撑 mandatory PASS |
| --- | --- |
| 证书 `statusAtEvaluation=VERIFIED` + 评估当时未过期 + scope 兼容 + 类型与要求点名的认证一致 | 能 |
| 项目档案（写入时已过归属校验） | 能 |
| 线索 / 网页 / 备注**单独** | 不能（`EVIDENCE_NOT_VERIFIED`） |
| CLAIMED 证书 | 不能（`CERT_NOT_VERIFIED`） |
| 过期证书 | 不能（`CERT_EXPIRED_AT_EVALUATION`）——**按冻结的 capturedAt 判，不随读取时的时钟漂移** |
| 其它产品的 PRODUCT / MODEL_SERIES 证书 | 不能（`CERT_SCOPE_MISMATCH`；写入时脊柱已拒） |
| 要求点名 UL 而证书是 CSA | 不能（`CERT_TYPE_MISMATCH`） |
| AI_ASSISTED PASS | 不能独立满足（`AI_ASSISTED_NOT_ADMISSIBLE`） |
| DETERMINISTIC PASS | 需带规则 note 或可采信证书；只有标签不算 |
| 产品类要求 + 候选无 Offering | 不可判定（`OFFERING_REQUIRED`） |

### 3.5 硬门（`mandatory-gate.ts`，纯函数）
只处理 `mandatory === true`（含 uncertain 折入）。FAIL 优先；缺 / UNKNOWN / PARTIAL / uncertain / 证据不可采信 → INCOMPLETE；全部 PASS 且可采信 → PASS。
输出 `mandatoryGateJson`：`gateRuleVersion=mandatory-gate-v1`、`evaluationVersion`、`computedAt`、逐条 `{requirementKey, requirementRefId, mandatoryUncertain, matchId, matchVerdict, gateVerdict, evidenceAdmissible, reasonCode}`、`summary`。
硬门自带的两个结论：FAIL → `NOT_ELIGIBLE` + `rejectionReason`（确定性原因码串）；INCOMPLETE → `NEEDS_VERIFICATION`；PASS → `recommendation=null`（不提前 PRIMARY / BACKUP / HIGH_RISK）。

服务层 `computeCandidateMandatoryGate`：同一事务锁 Run → 必须 RUNNING → 读快照与全部 Match → 计算 → 写候选；终态拒绝重算；幂等（候选只有一份门快照）。锁序沿用「Run 先行」。并发测试（5 个并发写 / 算）证明存下来的门从不比最终 Match 集算出的门更乐观。

### 3.6 收口
`completeEvaluationRun`：有候选且全部门已算才 COMPLETED；与门计算共用 Run 锁；之后候选 / Match / 门不可变（T24 / T25）；改判 = 新建评估运行。本轮采用 **commit once**：不提供 RUNNING 期间的改判编辑（避免 delete-recreate 偷丢历史）。

### 3.7 UI
既有供应商证据页有项目上下文时多一个「项目匹配」页签（不建第二套供应商页）：选产品 → 开始评估 → 逐条（英文原文 / 中文说明 / 来源引用 / 强制要求 · 强制性待确认 · 非强制要求）→ 人工判定或采用规则 → 计算强制项 → 完成。证据选择器只列本供应商证书（标 scope / 对应产品 / 到期 / 声称或已核验）、本人读得到的已关联线索、本项目档案。硬门与推荐用文字表达并逐条给中文原因；谁判的可见（人工确认 / AI 辅助判断 / 规则判断）。「开始项目评估」只对有项目写权限者显示（`projectContext.canWrite` 服务端裁决）。搜索记录里评估运行有自己的卡片，不会显示成「搜索已结束，外部来源成功」；进行中的评估不阻断「开始找供应商」。

## 4. 刻意没做（留给 S4-B 及之后）
数值评分（technical / commercial / reliability / importRisk / total 全部保持 null）、`computeSupplierScore` 调用、PRIMARY / BACKUP / HIGH_RISK、排名、landed cost、Supplier Memory 写入、RFQ / PO / 付款、AI 建议层、RUNNING 期间改判编辑、批量候选。score-contract 未改（40/25/20/15 不动，无 v1.1）。

## 5. 审计
新增三个动作（复用既有 AuditLog，不另造表）：`supplier_intel.evaluation.run.created`、`supplier_intel.requirement_match.created`、`supplier_intel.mandatory_gate.computed`；收口复用 `run.completed`。S3-B 已知 deferred 的 Supplier 写审计本轮未动。

## 6. 一处需要写进 PR 的脊柱改动
`RUN_WRITE_TX_OPTIONS = { maxWait: 10s, timeout: 20s }`：Prisma 默认 5s 的事务预算**包含**等 FOR UPDATE 行锁的时间，并发写串行排队时排在后面的会在等锁阶段耗光预算（并发测试实测 P2028，5237ms）。串行本身正确，只是预算要覆盖排队；S1 的候选 / 匹配事务与 S4-A 的门 / 收口事务共用此预算，语义不变。

## 7. 验证

| 项 | 结果 |
| --- | --- |
| S4-A 纯核：mandatory-gate（G1–G9、T11–T17、T20–T23、类型 / 过期回放 / 幂等） | «PURE_GATE» |
| S4-A 纯核：deterministic-match（G6 / G7 / 单位不猜 / 认证识别） | «PURE_DET» |
| S4-A 服务 + HTTP（隔离库；T1–T28、§5.3 不外呼、§45 并发、ACL、审计） | «S4A_DB» |
| 负向控制 N1（UNKNOWN → PASS） | «N1» |
| 负向控制 N2（CLAIMED 证书可采信） | «N2» |
| 负向控制 N3（已收口 Run 追加 Match） | «N3» |
| 浏览器验收（Playwright，FLOW A–J + 搜索记录卡片 + 3 视口） | «BROWSER» |
| 回归：S3-B / S3-A / S2-TB / S2 / S1 | «REG» |
| test:ci（纯核子集） | «TESTCI» |
| typecheck / 改动文件 lint / lint baseline / build | «GATES» |
| GitHub CI / Vercel staging（最终 head） | «CI» |
| 本地运行时冒烟（dev + 隔离库 + 真实浏览器） | RUN（= 浏览器验收） |
| staging 运行时冒烟 / 真实 provider / 真实采购 UAT | NOT_RUN |

### 7.1 负向控制记录
«NC_NOTES»

### 7.2 环境与过程
隔离 Neon 分支 `br-mute-night-an2y0ebt`（父 `br-green-boat-ann7k5yf`），用后删除并复核。生产库、生产 flag 未触碰。
过程记录：第一版 M3（测试 / 事务预算 / 门类型规则 / 夹具 / 验收 / 报告）在等待 DB 套件与负向控制全绿期间未提交，scratchpad worktree 被临时目录清理器删除后丢失，按对话中的原文重建并**先提交再跑**。

## 8. Git

| 项 | 值 |
| --- | --- |
| BASE_MAIN_SHA | `85f10ab99d9e402a9e3c33bfeb975bbbb0940c62` |
| M1 纯核 | `cf8db695` |
| M2 服务 + HTTP | `139a6b21` |
| M4 UI | `c23dd372` |
| M3 测试 / 负向控制 / 夹具 / 验收 / 脊柱事务预算 / 门类型规则 | «M3_SHA» |
| CODE_HEAD_SHA | «CODE_HEAD» |
| FINAL_PR_HEAD_SHA | 本报告所在的 docs 提交（见 PR #214） |
| REMOTE_MAIN_SHA / MAIN_DRIFT | «MAIN» |
