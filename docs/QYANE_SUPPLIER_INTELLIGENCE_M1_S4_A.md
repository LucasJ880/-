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

### 3.6b 一处浏览器验收抓出的真问题
`loadEvaluationView` 与 S3-B 的 `loadSupplierCapabilityView` 用 try/catch 探测项目写权限来决定 UI 显不显示按钮，原写法把**任何**异常都映射成 `canWrite=false`。疲劳的隔离分支上一次连接超时，就让视图以 200 返回 `canWrite=false`，整页「人工判定 / 计算强制项 / 完成评估」全部消失——用户看到「没权限」，实际是数据库抖了一下（FLOW E 实测）。
新增 `access.probeProjectAccess`：只把授权类失败映射成 false，其它异常抛出（路由层 5xx，客户端可重试）。DB/HTTP 测试直接调路由永远看不见这一层。

同类第二处：`loadEvaluationView` 对 `loadProcurementView`（中文说明 + 来源引用的展示补充）的 `catch {}` 也吞掉一切异常。验收 A11 实测：dev 日志里一次 Prisma **P2024**（连接池获取超时）恰好落在首次评估视图加载（25.7s），页面就静默少掉中文说明；同一运行随后直接调用返回完整 display。改为只吞 `SupplierIntelError`。

顺带记录：dev 模式 + 远端隔离分支下，评估视图单次加载 10–25s（视图并发多路查询 + 阅读视图 + 逐档案权限探测）。功能正确但偏重；作为 S4-B 的性能项列入 DEFERRED（不在本轮扩范围）。

第三处（客户端）：`RequirementRow` 原来只按 requirementKey 作 key，切换评估运行时 React 复用行实例，上一次运行里「已展开的判定表单 + 勾选的证据」原样带到下一次——证据错跑到别的运行上（FLOW E 实测；诊断显示服务端 status=RUNNING / canWrite=true / match=none）。修法：运行详情按 run.id 重挂、行 key 带 candidate.id、判定落库后清空行内状态。

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
| S4-A 纯核：mandatory-gate（G1–G9、T11–T17、T20–T23、类型 / 过期回放 / 幂等） | PASS（test:ci 内） |
| S4-A 纯核：deterministic-match（G6 / G7 / 单位不猜 / 认证识别） | PASS（test:ci 内） |
| S4-A 服务 + HTTP（隔离库；T1–T28、§5.3 不外呼、§45 并发、ACL、审计） | **91 通过 / 0 失败**（隔离分支 br-mute-night-an2y0ebt；见 7.1 的过程记录） |
| 负向控制 N1（UNKNOWN → PASS） | 红（T13 失败）→ 恢复后绿 |
| 负向控制 N2（CLAIMED 证书可采信） | 红（G2/T21 失败）→ 恢复后绿 |
| 负向控制 N3（已收口 Run 追加 Match） | 红（T24 返回 201、T24b 有写入）→ 恢复后绿；第一版 T24 曾被 DUPLICATE_MATCH 掩盖，见 7.1 |
| 浏览器验收（Playwright，FLOW A–J + 搜索记录卡片 + 3 视口） | **76 通过 / 0 失败**，12 个区块，8 张截图（第四遍；前三遍见 7.1） |
| 回归：S3-B / S3-A / S2-TB / S2 / S1 | **87 / 131 / 118 / 32 / 86，全部 0 失败**（S1–S3-A 在第二条隔离分支 br-odd-salad-anan9are；S3-B 因权限探测修复触及能力视图，在第三条分支 br-cold-waterfall-ancoaxew 按修复后代码复跑） |
| test:ci（纯核子集） | PASS |
| typecheck / 改动文件 lint / lint baseline / build | typecheck PASS / 改动文件 lint 0 problems / baseline PASS（error 41 vs 53）/ build PASS（362/362） |
| GitHub CI / Vercel staging | 代码头 `d31214e0`：run 34932403268 success 17/17；docs 头（最终 PR HEAD）：以 PR #214 的 checks 为准，结果写在交付收据里（不为写入自身结果再加提交） |
| 本地运行时冒烟（dev + 隔离库 + 真实浏览器） | RUN（= 浏览器验收） |
| staging 运行时冒烟 / 真实 provider / 真实采购 UAT | NOT_RUN |

### 7.0 浏览器验收跑了四遍
| 遍 | 结果 | 归因 |
| --- | --- | --- |
| 1 | 43/1，FLOW E 中断 | B3 是断言把页面必须写的「这不是最终供应商排名」当成违规（剥否定句）；中断是**真 bug**：切换评估运行时行组件被复用，上一次的判定表单状态漂到下一次（§3.6b 第三处） |
| 2 | 43/1，FLOW E 中断 | A11 缺中文说明：dev 日志一次 P2024 被 `catch {}` 吞成「没有展示」（§3.6b 第二处）；FLOW E 同上一处，当时诊断输出证明服务端 status=RUNNING / canWrite=true / match=none |
| 3 | 16/0，FLOW A 超时 | 不是产品问题：重跑夹具时 `supplierCandidate.deleteMany` 撞 `SupplierRequirementMatch_candidateId_fkey`（上一遍验收留下了 Match 行），夹具半重置。修夹具删除顺序 |
| 4 | **76/0** | — |

### 7.1 负向控制记录
- **N1**（`mandatory-gate.ts` 把 UNKNOWN 改判 PASS）：纯核 T13 立刻红。
- **N2**（`classifyEvidenceForGate` 放行 CLAIMED 证书）：纯核 G2/T21 立刻红。
- **N3**（`createRequirementMatch` 去掉 `run.status !== "RUNNING"` 守卫）：**第一版 T24 没有红**——它在一个每个键都已有 Match 的已收口候选上写，409 其实来自 `(candidateId, requirementKey)` unique 的 DUPLICATE_MATCH，证明不了终态守卫。改为在「该键此前无 Match」的已收口 Run 上写并断言 code=RUN_NOT_RUNNING 后，N3 红（返回 201 且真的写入了一条 Match）。这是负向控制的价值：一条一直绿的测试原来什么都没证明。
- 三组均在恢复源码后复跑为绿；破坏版本未提交（restore 后 `git diff` 为空）。
- 过程：同一隔离分支连跑三遍 91 条断言后出现 P2028「Unable to start a transaction in the given time」（连接获取超时，发生在 T24 建评估运行时）；换到安静分支复跑 91/0 且 Prisma 错误计数 0，判为分支疲劳。回归套件因此放到第二条隔离分支上跑。

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
| M3 测试 / 负向控制 / 夹具 / 验收 / 脊柱事务预算 / 门类型规则 | `4b67cd61` |
| 权限探测修复（DB 抖动不伪装成没权限；验收诊断） | `ab9f1163` |
| 切换评估运行时重挂行组件（表单状态不跨运行漂移） | `6ef027c6` |
| 展示补充只吞领域错误（P2024 不再静默吃掉中文说明） | `b489ee9c` |
| 夹具重置先删需求匹配行再删候选（FK Restrict；scripts 内，不进 build） | `d31214e0` |
| CODE_HEAD_SHA | `d31214e0`（docs 提交在其上；build 在 `b489ee9c` 上跑，其后只改了 scripts/） |
| FINAL_PR_HEAD_SHA | 本报告所在的 docs 提交（见 PR #214） |
| REMOTE_MAIN_SHA / MAIN_DRIFT | `85f10ab99d9e402a9e3c33bfeb975bbbb0940c62` / NO |

## 9. Final Review Closure（终审三项 blocker：FR1 / FR2 / FR3）

终审在 PR HEAD `d04a20f7`（代码头 `d31214e0`）、main `85f10ab9` 上给出三项 blocker。本节只记录这三项的修复与验证；§1–§8 是原始交付历史，不改写。范围不变：无 schema / migration、无 score-contract 改动、不进 S4-B、生产 flag 未动、PR #214 仍 DRAFT。

### 9.1 FR1 — 数值确定性匹配的属性语义绑定

**缺陷**：`NUMERIC_THRESHOLD_V1` 的 `findOfferingNumeric` 拿「offering 快照里**唯一**一个同单位族的数值」去比。同单位 ≠ 同一事实：要求「最小宽度 60 in」遇到只有 `height: "72 in"` 的产品会判 PASS；「最小承重 500 lb」遇到 `productWeight: "600 lb"` 也会 PASS。

**冻结原则**：要求维度 == 属性维度，否则 UNKNOWN；绝不从「只有一个同单位字段」推断。

**实现**（`deterministic-match.ts`，规则 ID 升为 `NUMERIC_THRESHOLD_V2`；V1 退役、仅保留 ID 供历史 note 回放，`DETERMINISTIC_MATCH_RULES` 三元）：
- `NUMERIC_DIMENSION_ALIASES`：冻结、代码评审可见的最小别名契约（width / height / length / depth / thickness / load_capacity / product_weight / warranty；含 overall width、weight capacity、maximum load、rated load 等多词别名和 宽度 / 高度 / 承重 / 承载 / 重量 / 自重 / 质保 等中文别名）。不接 LLM，不做模糊相似。
- `detectRequirementDimension(text)`：收集所有别名命中，丢掉被更长命中完全覆盖的（"weight capacity" 压过其中的 "weight"），剩余维度集合必须**恰好一个**，否则 null。"Width 60 in and height 72 in" → null。
- `attributeDimension(key)`：键归一（camelCase / 下划线 / 连字符 → 小写单空格）后必须**整键等于**某别名；`widthTolerance` → null（不做包含匹配）。
- `findOfferingNumeric(attrs, family, dimension)`：只看同维度属性；0 个 → NONE；>1 个 → AMBIGUOUS；1 个但单位不在同族 → UNIT_MISMATCH；否则 FOUND。
- `suggestNumericMatch`：要求维度识别不出 / NONE / AMBIGUOUS / UNIT_MISMATCH 一律 UNKNOWN，explanation 写明原因；比较时 note 记录维度 + 属性键 + 原值。

**测试**（纯核 `deterministic-match.test.ts`）：N1 `minimum width 60 in` vs `{height:"72 in"}` → UNKNOWN；N2 `minimum load capacity 500 lb` vs `{productWeight:"600 lb"}` → UNKNOWN；N3 `{width:"72 in"}` → PASS；N4 `maximum width 60 in` vs `{width:"72 in"}` → FAIL；N5 `{width, overallWidth}` → UNKNOWN；另加「要求文本无维度 → UNKNOWN」、多词别名优先、双维度并存 → null、整键匹配四条。既有 G6 / G6b / G6c 改用 V2 断言；夹具键 `承重` 归一到 load_capacity 后，DB / 浏览器流的 R-002 判定不变。

**负向控制 FR1-NC**：临时把 `findOfferingNumeric` 的同维度过滤换回「任何同单位族属性都算」→ 纯核立刻红：`AssertionError: N1：宽度要求 vs 只有高度 → UNKNOWN（不拿唯一同单位值猜）`；`git checkout` 恢复后 `git diff` 为空，复跑绿。

### 9.2 FR2 — 证书 validFrom 的评估时有效性

**缺陷**：硬门可采信只查 `statusAtEvaluation == VERIFIED`、未过期、scope、type；`validFrom` 在评估之后（尚未生效）的证书会被采信。

**实现**：
- `mandatory-gate.ts › classifyEvidenceForGate`：评估时刻 `at = capturedAt ?? matchCreatedAt`（只有旧证据缺 capturedAt 才回落；绝不用 `Date.now()`）。`validFrom !== null && (at === null || validFrom > at)` → 新原因码 **`CERT_NOT_YET_VALID_AT_EVALUATION`**（与 CERT_NOT_VERIFIED / CERT_EXPIRED_AT_EVALUATION 区分）；过期判定同样用 `at`。可采信 = VERIFIED ∧ (validFrom == null ∨ validFrom ≤ at) ∧ (expiresAt == null ∨ expiresAt > at) ∧ scope ∧ type。
- `constants.ts` 原因码枚举 +1；`evaluation-display.ts` 中文：「证书在评估当时尚未生效（生效日晚于评估时刻）」。
- `deterministic-match.ts › suggestCertificationMatch`（CERT_TYPE_V1）：同样要求评估时已生效（`DeterministicCertInput.validFrom` 新增；`loadSupplierCertsForRules` 与视图证书数组带 `validFrom`）；说明文案「评估时尚未生效」。
- 证据选择器显示「生效于 …」，与既有「有效至 …」并列。
- 冻结证据 `evidenceJson` 早已带 `validFrom`（`buildCertificationEvidence`），无需补数据。

**测试**（纯核 `mandatory-gate.test.ts`）：C1 capturedAt 2026-09-15、validFrom 2026-10-01、expiresAt 2027-10-01、VERIFIED → INCOMPLETE + `CERT_NOT_YET_VALID_AT_EVALUATION` + NEEDS_VERIFICATION；C2 validFrom 2026-01-01 → PASS；C3 validFrom null 且未过期 → PASS；C4 缺 capturedAt 回落 Match 创建时刻 / 两者皆缺 fail-closed；C4（历史）同一冻结证据在 computedAt=2025 与 2030 下门快照逐字节相同。规则侧：VERIFIED 但 validFrom 在后 → UNKNOWN。浏览器 FLOW K：夹具新增「已核实、范围对、未过期、但 validFrom = 今天 + 60 天」的产品 A BIFMA 证书，人工 PASS 采用它 → 硬门项原因 `CERT_NOT_YET_VALID_AT_EVALUATION`、中文「尚未生效」、整体资料不足；API 读回冻结证据 `validFrom > capturedAt`。

### 9.3 FR3 — 新增 Match 使已存的硬门失效

**缺陷**：候选 `mandatoryGateJson` 是「计算当时的 Match 集」的快照；之后再写 Match（人工或规则）不会使它失效，收口只查 `!= PENDING`，于是可能拿陈旧的 PASS 收口。

**实现**（`evaluation-service.ts › createRequirementMatch`，canonical 写路径，与「锁 Run → 校验 RUNNING → 建 Match」同一事务）：建 Match 成功后 `supplierCandidate.updateMany({ mandatoryGateResult: "PENDING", mandatoryGateJson: DbNull, recommendation: null, rejectionReason: null })`。复用既有 PENDING 枚举，无新枚举、无 schema。HUMAN（`recordEvaluationMatch`）与 DETERMINISTIC（`applyDeterministicMatch`）都经此函数，逃不掉；S1 / S2 既有调用者的候选门本就 PENDING，语义无影响（S1 86 / S2 32 / S2-TB 118 回归 0 失败）。`completeEvaluationRun` 继续要求全部候选 `!= PENDING`，于是陈旧门→必须重算。审计 `REQUIREMENT_MATCH_CREATED.afterData` 增记 `previousGateResult` / `gateInvalidated`。UI：门 PENDING 且已有 Match 时提示「判定已更新，强制项需要重新计算后才能完成评估」（`gate-stale-hint`），「完成评估」按钮本就随 PENDING 禁用；服务端 409 GATE_PENDING 才是真正的门。

**并发**：门计算与 Match 写入都在 Run 行锁下串行。Match 先 → 门读到它；门先 → Match 事务随后把门置 PENDING。不存在「门 != PENDING 且不含最新 Match」的终态。

**测试**（DB `supplier-intel-s4a-db.isolated.test.ts`）：G2 人工写入：R-002 规则 PASS → 门 INCOMPLETE → 人工 R-001 PASS → 立刻 PENDING / json null / 推荐 null / 原因 null → 收口 409 GATE_PENDING → 重算 PASS、推荐 null → 收口 COMPLETED → 门保持 PASS。G1 / G3 规则写入：人工 R-001 UNKNOWN → 门 INCOMPLETE + NEEDS_VERIFICATION → 规则 R-002 FAIL（产品 B 250 lb）→ PENDING → 收口被拒 → 重算 FAIL + NOT_ELIGIBLE + `R-002:MANDATORY_MATCH_FAIL`；审计行存在。G4 门计算 vs Match 写入并发 3 轮 + G4-alt（显式 Match 先起）：终态要么 PENDING（门先）要么门含该 Match（Match 先），重算 PASS。§45「并发 b」断言相应放宽为「PENDING 或不比最终更乐观」。浏览器 FLOW L：算门（资料不足）→ 无提示 → 人工 R-001 PASS → 服务端 PENDING / 快照清空 → 界面提示 + 按钮禁用 → API 直接完成 409 GATE_PENDING → 重算已通过 → 提示消失 → 完成 COMPLETED / PASS。

### 9.4 验证

| 项 | 结果 |
| --- | --- |
| 纯核 mandatory-gate（含 C1–C4 + 历史时钟无关） | PASS |
| 纯核 deterministic-match（含 N1–N5 + 维度识别 + V2） | PASS |
| FR1 负向控制 | 红（N1）→ 恢复后绿；破坏版本未提交 |
| S4-A 服务 + HTTP + FR3 G1–G4（隔离分支 br-green-night-antmnpvg，提交 `9b57c1a1`） | **113 通过 / 0 失败**；G4-alt 增补后复跑：run2（br-green-night 第二套件）114 / 1——唯一红项是 G4-alt 第一版硬要求「Match 先起就必须 Match 先拿锁」，与事实不符（Match 进事务前还要读候选 / 校验证据 / 冻结证书，谁先拿 Run 锁不由启动顺序决定），改为断言不变量（`5e76ce15`）；run3（br-wandering-breeze，S3-B 之后第二套件、与浏览器验收并行）114 / 2——§45「并发 a/c」P2024 连接池超时（基础设施），此轮 G4 观察到 gate-first=2 / match-first=1；**run4（新分支 br-wild-star-an4wl8s8，安静、最终代码头 `55d31be0`）116 通过 / 0 失败**，G4-alt 命中 Match-first 路径（门含该 Match → PASS） |
| 浏览器验收 FLOW A–L + 搜索记录 + 3 视口（隔离分支 br-curly-mud-anskrzno，dev :3217） | 第一遍 89 / 2（A5 / A6 在与 S3-B 复跑、S4-A DB 复跑并行时，评估视图 GET 一次 500 = dev 侧 Prisma P2024 连接池超时；FLOW K 5/5、FLOW L 9/9 均绿）；重置夹具后**安静复跑 91 通过 / 0 失败**，10 张截图（含 flow-k-not-yet-valid / flow-l-stale-gate） |
| 回归 S3-A / S2-TB / S2 / S1（隔离分支 br-round-smoke-anyakyq8 / br-purple-flower-andhicko） | **131 / 118 / 32 / 86，全部 0 失败** |
| 回归 S3-B | 第一遍在分支 A 与 S3-A、S4-A DB、夹具种子并行时 P2024 连接池超时中断（基础设施，0 断言失败）；复跑（br-wandering-breeze-an26lm5q）：**87 通过 / 0 失败** |
| typecheck / 改动文件 lint | PASS / 0 problems |
| lint baseline / build | baseline PASS（相对基线减少 12 处 error 出现，无新增 fingerprint）/ build PASS（最终代码头 `55d31be0`，362/362 页） |
| CI / staging（最终 PR HEAD） | 以 PR #214 最终 PR HEAD 的 checks 与 qingyan-staging 部署为准，结果写在交付收据里（不为写入自身结果再加提交） |

过程记录：
- 隔离分支：`br-green-night-antmnpvg`（S4-A DB）、`br-round-smoke-anyakyq8`（S3-B 首遍 / S3-A）、`br-purple-flower-andhicko`（S2-TB / S2 / S1）、`br-wandering-breeze-an26lm5q`（S3-B 复跑）、`br-curly-mud-anskrzno`（夹具 + dev + 浏览器）。全部为 `br-green-boat-ann7k5yf` 的子分支，用后删除并复核。
- **一次被守卫拦下的失误**：用 `neonctl connection-string --branch-id <新分支>` 取连接串时，该 CLI 不认 `--branch-id`，静默回落到主分支（生产 endpoint `ep-super-field-…`）。脚本里的生产主机前缀守卫在写 env 文件之前 ABORT，没有任何进程连过生产库。改用位置参数 `connection-string <branch-id>` 后各分支主机均校验为非生产。
- 夹具种子第一遍在四个 DB 作业并行时 P1001「Can't reach database server」（刚建的分支 compute 冷启 + 负载），复跑成功。
- `.env.local`（gitignored）只在 scratchpad worktree 内存在，验收后删除；dev server 用后停止。

### 9.5 Git（本节）

| 项 | 值 |
| --- | --- |
| 终审基线 PR HEAD / main | `d04a20f78f86e341ed5d69b49da548eefb009893` / `85f10ab99d9e402a9e3c33bfeb975bbbb0940c62` |
| FR1 + FR2 + FR3 实现 / 纯核 / DB / 夹具 / 浏览器流 | `9b57c1a1` |
| FR3-G4-alt（显式 Match 先起的并发顺序） | `cd480e9e` |
| G4-alt 改为断言不变量 / 去掉逗号表达式 | `5e76ce15` / `55d31be0` |
| CODE_HEAD_SHA | `55d31be0` |
| FINAL_PR_HEAD_SHA | 本节所在的 docs 提交 |
