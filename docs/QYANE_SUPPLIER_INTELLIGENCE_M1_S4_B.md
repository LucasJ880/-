# QYANE Supplier Intelligence M1 — S4-B：供应商评分 + 找厂优先级 + 项目推荐

> 状态：Draft PR，等待终审。基线 main `36ccc1a2583968fa9eca05c1f72cecced06273b6`（S4-A merge commit）。
> 无 schema / migration；score-contract（40 / 25 / 20 / 15，`supplier-score-v1`）未改；生产 Supplier Intelligence 仍 404-dark。

## 0. 一句话

「找到供应商」≠「判断供应商是否符合 Tender」≠「最终决定优先联系 / 推荐哪家」。S4-B 把这三件事落成四个互不混用的层：

| 层 | 回答的问题 | 落点 | 输入 | 输出 |
| --- | --- | --- | --- | --- |
| **A. Discovery Priority（找厂优先级）** | 采购今天应该优先看 / 联系谁？ | read-model（`discovery-priority.ts`，不落库） | Brief 词 + 线索**已有**字段 | P1 / P2 / P3 + 命中原因 |
| **Mandatory Gate（S4-A）** | 这家能不能进推荐候选？ | `SupplierCandidate.mandatoryGateResult` | 冻结 Match + 可采信证据 | PASS / FAIL / INCOMPLETE |
| **C. Official Supplier Score** | 门 PASS 之后，四维各多少分？ | `SupplierCandidate.*Score` + `scoreBreakdownJson`（收口时冻结） | 冻结快照 + 本项目 RFQ + 内部历史 + VERIFIED 出口证据 | 四维 0–100 或 UNKNOWN；官方总分只在四维齐全时存在 |
| **B. Current Project Ranking（当前项目推荐）** | 完成证据核验后，谁更适合这个 Tender？ | read-model（`project-supplier-ranking.ts`，不写候选） | 每个 Supplier × Offering 最新 COMPLETED 评估 | PRIMARY / BACKUP / NEEDS VERIFICATION / HIGH RISK / NOT ELIGIBLE |

铁律：**A 与 B 绝对禁止混用**。1688 / 抖音 / 小红书 / 视频号是 A 的重要输入；只有经过 Supplier → Offering → Evidence → Requirement Match → Mandatory Gate → RFQ / history / import evidence 之后才能进入 B。

## 1. 复用（不重建）

- `score-contract.ts`：唯一的加权实现 `computeSupplierScore()`；S4-B 没有手写 `technical × 0.4 + …`（纯核测试用正则守卫）。
- S4-A 的评估运行（EVALUATION_ONLY）、RequirementMatch、Mandatory Gate、`completeEvaluationRun` 收口路径——评分被**放进**收口事务，不建平行 completion path。
- 既有 `ProjectInquiry / InquiryItem` = canonical 商务事实源与内部交互历史。
- 既有 `SupplierCapabilitySignal`（CANADA_EXPORT / OVERSEAS_EXPORT / EXPORT_PACKAGING）与 offering 快照（incoterm / leadTimeDays）。
- `SupplierCandidate` 既有列：technicalScore / commercialScore / reliabilityScore / importRiskScore / totalScore / scoreBreakdownJson / recommendation → **SCHEMA_CHANGED = NO**。

## 2. 1688 现状：不伪造集成

- `SIGNAL_PLATFORM = ONE688` 已存在；`SUPPLIER_1688_ADAPTER_STATUS = DEFERRED` 不变。搜索引擎合法索引命中的 1688 页面按 host 归 ONE688 线索。
- 本 PR **没有**：登录 1688、模拟浏览器批量爬取、绕 robots / anti-bot、私人 cookie、抓店铺后台、伪造交易量 / 工厂年限 / 销量、把搜索 snippet 当结构化 API。专用 1688 Adapter 属于后续独立任务 China Marketplace Discovery Adapter。

## 3. Discovery Priority V1（`discovery-priority-v1`，0–100，UI 叫「找厂优先级」）

| 分项 | 分 | 规则 |
| --- | --- | --- |
| Requirement / Product Relevance | 0–50 | Brief 的 productKeywords / productCategory（30）与 commercial / capability / en 检索词（20）对线索 title / description / rawText / accountName / rawMetadata.sourceQuery 做**归一化精确 token / 短语重叠**（中文子串、英文词边界）。不用 LLM 产生数字，不做模糊相似 |
| Factory / OEM Signal | 0–20 | 文本明确出现 厂家 / 工厂 / 源头工厂 / 生产厂家 / OEM / ODM / manufacturer / factory 等才加；**discovery signal，不是 verified capability** |
| Export / North-America Signal | 0–15 | 出口 / 外贸 / 北美 / 加拿大 / 美国 / export / North America / Canada / overseas；只是 CLAIMED / DISCOVERY，**不能产生 CANADA_EXPORT VERIFIED** |
| Source Actionability | 0–10 | ONE688 10 · WEBSITE 8 · OPEN_WEB 6 · MANUAL 6 · DOUYIN / XIAOHONGSHU / WECHAT 4——是「联系 / 采购可操作性」，**不是可靠性**（UI 明说） |
| Data Completeness | 0–5 | URL / title / 正文 / account 四个已有字段，不推断 |

桶：P1 ≥ 70 · P2 50–69.99 · P3 < 50。UI 恒显示「找厂优先级只用于安排采购调研顺序，不代表供应商符合本 Tender」。Brief 词源 = 本项目最近一次发现 Run 的 briefSnapshotJson，没有发现 Run 时用 canonical 需求快照现算确定性 Brief；canonical 不可用 → 优先级不可用（null），不静默给 0。

线索列表（带 projectId 的 GET）逐条标注；抽屉里逐项列出命中原因。1688 线索标「1688 / 国内采购平台」，不显示「推荐供应商 / 已合格 / 已认证」。

## 4. 1688 Trust Boundary（单独写）

| 事实 | 边界 |
| --- | --- |
| **ONE688 presence ≠ verified supplier** | 1688 上有店 ≠ 身份已确认 ≠ 采购批准；仍要人工 Entity Resolution → Canonical Supplier |
| **listing price ≠ confirmed quote** | 页面 ¥1 / ¥9.9 / ¥80 一律 `PLATFORM_LISTED`（平台挂牌价 / 待询价确认），不能作最终采购价、最终报价、Commercial Score 正式价格；即使是全场最低也 `commercial = null` → NEEDS_VERIFICATION |
| **platform metrics ≠ official reliability** | 「经营 10 年 / 成交很多 / 回头率高 / 实力工厂 / 超级工厂」= DISCOVERY ONLY；无审核过的 Adapter 无法证明字段定义 / 抓取时刻 / 真实性 / 完整性 / 稳定性，不进 `reliability-score-v1` |
| **cert claim ≠ verified certification** | 标题里的 UL / ETL / CSA 只是 discovery text；不能 Certification VERIFIED、不能 Gate PASS、不能 Technical bonus（沿用 S3-B / S4-A 信任边界） |
| **export text ≠ export capability** | 「出口加拿大」文案最多是 CLAIMED capability；Import Readiness 只认 VERIFIED（人工 + 档案） |

## 5. 价格证据层（逻辑层，冻结在 `scoreBreakdownJson.commercial.priceEvidenceTier`）

`RFQ_CONFIRMED`（本项目 InquiryItem：repliedAt ≠ null 且价格 > 0）> `INQUIRY_CONFIRMED`（Offering sourceKind=INQUIRY + KNOWN）> `PLATFORM_LISTED`（报盘来自 ONE688 线索或 URL host 1688.com）> `HUMAN_ENTERED` > `ESTIMATED` > `UNKNOWN`。全部服务端推导（`derivePriceEvidenceTier`），客户端没有入口。正式报价覆盖挂牌价作为评分依据，但挂牌证据（listedPrice / 来源平台）保留在快照里。

## 6. Score-and-Complete（§15 / §55 / §56）

`completeEvaluationRun()` 在同一个 Run 行锁事务里：断言 RUNNING + EVALUATION_ONLY → 候选门 ≠ PENDING → **FAIL：保持 NOT_ELIGIBLE、四维与总分全 null、连组件都不算** → **INCOMPLETE：保持 NEEDS_VERIFICATION、无官方总分** → **PASS：构建评分证据快照 → 四组件 → `computeSupplierScore` → 落已知组件列 + 官方总分（只在 knownWeightShare == 1 时）→ 推荐态（`recommendation-contract-v1`）** → Run COMPLETED → 审计 `score.computed` / `evaluation.finalized`。

- 事务内 network / LLM / provider / 1688 / FX / customs 调用 = 0（DB 套件把 `fetch` 换成炸弹全程验证）。
- 并发：Match 写入 / 门计算 / 收口共享 Run 锁。Match 先 → 门回 PENDING → 收口 409 GATE_PENDING；收口先 → Match 因终态被拒。不存在「按陈旧门评分」。
- COMPLETED 之后评分列不可变；改报价 / 能力 / 报盘 / 1688 页面 / Supplier.rating 都不改历史；重评估 = 新 Run。

## 7. 四个组件

### 7.1 Technical Fit — 40（`technical-fit-v1`）
只来自 canonical 需求快照 + `SupplierRequirementMatch`（不读 aiClassification / 营销文案 / 1688 评分）。`TECHNICAL_SCORABLE_CATEGORIES` = product / model / technical / safety / certification / dimensions / performance / material / quality / capability（repo 真实词表 + OFFERING_SCOPED）；installation / samples / shop_drawings / training / insurance / bonding / warranty / reporting / pricing / commercial / delivery / packaging / administrative / submission / schedule / site_visit / mandatory / other 明确非技术，不进分母；词表外 → `UNMAPPED_REQUIREMENT_CATEGORY`（列出，不静默计分）。PASS 100 / PARTIAL 50 / FAIL 0 / UNKNOWN 0 / 缺 0；AI_ASSISTED 未确认 → 0。**分母 = 全部可计分技术项**（资料越少不能分越高）。0 条可计分 → null。

### 7.2 Commercial — 25（`commercial-score-v1`）
只用**本项目**最近一个含该供应商已确认报价的询价轮；可比组 = 同轮 ≥ 2 家已确认、同币种、同价格口径（≥2 家都有 totalPrice 用 totalPrice，否则 unitPrice；不混）。`price = min / candidate × 100`（最便宜 100，两倍 50）。子权重 Price 70 / Delivery 20（同轮 ≥2 家已知交期才比，缺 → 0 + DELIVERY_UNKNOWN）/ Quote Completeness 10（price / deliveryDays / validUntil）。混币种 → null（不查汇率）；单家 → null；只有平台挂牌价 → null + `COMMERCIAL_PLATFORM_LISTED_ONLY`。别项目报价永不进入可比组。

### 7.3 Reliability — 20（`reliability-score-v1`）
只用 Qyane 内部真实交互（别项目的 InquiryItem；当前项目排除）。已联系 = 已发送或之后的状态；< 2 条 → null（不虚构 50）。Response Rate 70%（replied / contacted）+ Prior Selection 30%（0 → 0 / 1 → 50 / ≥2 → 100；曾入选 ≠ 成功交付）。**不用** `Supplier.rating / ratingDetail`、不用 HISTORICAL_SUCCESS originSource 加分、不用 1688 店铺指标。快照只记 itemId / 项目 / 状态，不复制别项目报价。

### 7.4 Import / Delivery Readiness — 15（`import-risk-v1`，UI「进口与交付准备度」，分高 = 风险低）
只接受 VERIFIED 的 CANADA_EXPORT / OVERSEAS_EXPORT / EXPORT_PACKAGING；OBSERVED / CLAIMED / AI_ASSISTED / 1688 文案 / 抖音视频只显示「待核实」。没有 VERIFIED 出口能力 → null + `EXPORT_READINESS_UNVERIFIED`（没证据 ≠ 已证明不会出口，不打 0）。Export Readiness 50%（CANADA 100 / OVERSEAS 75，取高）+ Packaging 20% + Incoterm Known 15%（只判是否为公认术语，不判 DDP > FOB）+ Lead Time Known 15%。HS / 关税 / 反倾销 / CARM / 运费 / landed cost 全部 defer（S4-C）。

**新增的能力 VERIFIED 写路径**：repo 里 social / discovery 写路径永远产不出 VERIFIED，而此前并没有任何人工核验能力证据的路径——没有它进口准备度永远 null、没有任何供应商能进入排名。S4-B 镜像 `verifyCertification` 加了 `verifyCapabilitySignal()` + `PATCH /suppliers/[id]/capability-signals/[capabilityId] {action:"verify", archiveItemId}`：必须带本 org 可读项目的档案证据、挂靠线索需项目写权限、CLAIMED/OBSERVED/UNKNOWN → VERIFIED、事务内审计 `capability.verified`。无 schema。

## 8. 官方总分 / 推荐态 / 当前排名

- `computeSupplierScore` 的 `knownWeightShare < 1` 归一化分只作分析值存 `normalizedKnownScore`；**`Candidate.totalScore` 只在四维齐全时写**，否则 null + NEEDS_VERIFICATION（避免「只知道技术 100 → 总分 100」）。
- `recommendation-contract-v1`（阈值集中）：FAIL → NOT_ELIGIBLE；INCOMPLETE → NEEDS_VERIFICATION；PASS 缺维 → NEEDS_VERIFICATION；PASS 四维齐全且 importRisk < 50 或 reliability < 40 → HIGH_RISK；否则候选 recommendation = null（可排名）。**PRIMARY / BACKUP 永远不落列**。
- 当前排名（read-model）：每个 Supplier × Offering 取最新 COMPLETED 评估；资格 = 门 PASS + 四维与总分齐全 + 非 HIGH_RISK / NEEDS_VERIFICATION / NOT_ELIGIBLE；排序 total ↓ technical ↓ commercial ↓ reliability ↓ importRisk ↓ candidateId ↑；#1 PRIMARY，其余 BACKUP（带 #2 / #3）。文案：「当前项目推荐根据各供应商最新完成的评估动态计算；历史评估记录本身不会被改写」。
- 供应商赛马（read-model，不建状态表）：FOUND / LINKED / OFFERING_READY / EVIDENCE_READY / GATE_PASS / RFQ_CONFIRMED / SCORED / NEEDS_VERIFICATION / NOT_ELIGIBLE / HIGH_RISK 由既有事实派生；表里「找厂优先级」列与「Current Rank」列分开，P1 永不显示成 PRIMARY。
- Next Action（确定性，不用 LLM）：关联供应商 / 登记具体型号 / 开始项目评估 / 补齐强制项证据 / 核验证书 / 向厂家正式询价（或等待回复）/ 等待同轮可比报价 / 新供应商需要更多交互 / 核实出口加拿大能力 / 已进入当前项目排名。只给建议：无自动发邮件 / 微信 / 1688 聊天 / 下单；评分完成不自动写入 Corporate Memory。

## 9. 两个 1688 例子（§51 / §52，均有 DB + 浏览器测试）

- Supplier A：ONE688 · 挂牌价 ¥80 · 找厂优先级 P1 · 门 PASS · 无正式 RFQ → Commercial UNKNOWN（PLATFORM_LISTED）→ NEEDS_VERIFICATION → **不可 PRIMARY**。Supplier B：历史供应商 · 正式 RFQ ¥110000 · 门 PASS · 四维齐全 → 进入 PRIMARY / BACKUP 排名。绝不会因为 80 < 110000 让 A PRIMARY。
- A 之后正式回复 RFQ（InquiryItem repliedAt + totalPrice）→ **新** Evaluation Run 才得到 `RFQ_CONFIRMED` 与 Commercial Score；旧 Run 保持 NEEDS_VERIFICATION，不回写。A 仍缺可靠性 / 出口核验 → 仍不进排名。

## 10. 验证

| 项 | 结果 |
| --- | --- |
| 纯核 discovery-priority（D1–D6 + 纯度守卫） | PASS（D1 P1 / D2 ONE688 低相关 P3 / D3 抖音高相关 > 1688 低相关 / D4 「UL认证」不产生 VERIFIED / D5 确定性 / D6 不猜店龄销量；桶阈值与可操作性表冻结；模块零 import、零 IO） |
| 纯核 score-components（T1–T4 / C1–C6 / R1–R5 / I1–I5 / P1–P3 / 价格层 / 推荐契约） | PASS（T1 100/50/0、T2 缺失进分母、T3 AI_ASSISTED 归 0、T4 无技术项 null + UNMAPPED；C1–C6 含混币种 / 单家 / 挂牌价 / 口径不混；R1 <2 null、R2 70/30、当前项目不算历史、R3–R5 类型层不接受 rating / origin / 店铺指标；I1 无证据 null（不打 0）、I2 公式、I3 CLAIMED 仍 null；价格层六级；P1 官方总分 == computeSupplierScore、P2 缺维 null、P3 40/25/20/15；推荐契约阈值） |
| 纯核 project-ranking-model（Q1–Q7 / §70 §71 / §51 / 赛马态 / 下一步） | PASS（Q1–Q7、§70 最低价门 FAIL、§71 历史门 FAIL、§51 1688 例子、赛马态 / 下一步动作；输入对象不被改写） |
| S4-B DB 套件（隔离库） | **65 通过 / 0 失败**（隔离分支 br-fancy-queen-an60hl31，第二遍；第一遍 58/4 全是测试自身的期望错误：V2 权限顺序、R2 把无关项目的真实历史漏数、D 供应商史料不足以可排名、赛马 A 因夹具无发现 Run 的 Brief 而 P3——均修正测试 / 夹具，产品代码未改） |
| 浏览器验收 FLOW A–I + 只读 + 三视口（隔离库 + dev） | **70 通过 / 0 失败**（第四遍，10 张截图；隔离分支 br-cool-frost-anbe4h2g，dev :3218）。前三遍全是验收脚本自身：A6 把页面必须写的「不代表已认证」当违规（剥否定句）；D3 读折叠 <details> 的 innerText 为空（先展开）；F2 夹具产品缺贸易术语 / 交期（补齐）；开始评估的「新运行」检测在运行列表异步加载完成前取基线，会把旧运行误当新建（改为服务端列表为基线 + 视图首载失败时重点运行行）；脚本自己的直写模拟在空闲十几分钟后遇 P2024 连接回收（重连重试一次）。产品代码零改动 |
| 回归 S4-A / S3-B / S3-A / S2-TB / S2 / S1 | **S4-A 116 / S3-B 87 / S3-A 131 / S2-TB 118 / S2 32 / S1 86，全部 0 失败**（分支 br-summer-night-anaivy7g / br-purple-brook-an5c72k5 / br-lively-dream-andca1pm）。S4-A T26d 按 S4-B 收口契约对齐：PASS 但评分证据不完整的候选在收口时写 NEEDS_VERIFICATION（此前 S4-A 收口不写推荐），live 数据变化仍不改写、永不 PRIMARY / BACKUP；第一遍 115/1 即此一处 |
| typecheck / 改动文件 lint / lint baseline / build | typecheck PASS / 改动 28 个 ts(x) 文件 lint 0 problems / lint baseline PASS（相对基线减少 12 处 error 出现，无新增 fingerprint）/ build PASS（362/362 页，代码头 `569530a3`） |
| CI / staging（最终 PR HEAD） | 以 PR #215 最终 PR HEAD 的 checks 与 qingyan-staging 部署为准，结果写在交付收据里（不为写入自身结果再加提交） |

过程记录：
- 隔离分支：br-fancy-queen-an60hl31（S4-B DB ×2）、br-summer-night-anaivy7g（S4-A ×2 / S3-B）、br-purple-brook-an5c72k5（S3-A / S2-TB）、br-lively-dream-andca1pm（S2 / S1）、br-cool-frost-anbe4h2g（夹具 + dev + 浏览器 ×4）。全部为 br-green-boat-ann7k5yf 子分支，创建脚本用位置参数形式 + 主机前缀守卫，用后删除并复核。
- 浏览器验收把 dev + 远程隔离库的现实写进脚本：评估视图一次 15–25s，脚本用服务端状态轮询与 UI 重选代替固定 sleep；没有 `|| true`。
- 一处 zsh 非 UTF-8 locale 陷阱：后台命令用含中文的 `grep -q` 当门会永远不匹配（ugrep）→ 改用 ASCII 标记。
- `.env.local`（gitignored）只在 scratchpad worktree 内存在，验收后删除；dev server 用后停止；`next build` 与 `next dev` 不并行（共用 .next）。

## 11. Deferred（明确写下，不静默假装完成）

Dedicated 1688 Adapter / API · 1688 authenticated crawling · HS code · tariff · anti-dumping · CBM / freight · landed cost · FX normalization · CVA · Canadian-goods restriction engine · sample scoring · automated RFQ · Supplier Memory auto-save · `explainSupplierScore()`（LLM 只解释既有 deterministic breakdown，本轮不实现）· Award-time Recommendation Snapshot（持久化审计阶段另做）· platform-reliability-evidence-v2（有正式 1688 provider 后才可能）。

## 12. Neon DB safety rule（持续）

禁止 `neonctl connection-string --branch-id <branch>`（CLI 会静默回落 primary = 生产 endpoint）；统一位置参数形式；取得连接串后在任何 .env 写入 / Prisma 导入 / 测试 / dev server / migration 之前 parse hostname 并断言 ≠ 生产主机，否则 ABORT。本轮所有隔离分支的创建脚本、seed、DB 套件、dev 启动、浏览器验收脚本均内置该守卫。

## 13. Git

| 提交 | 说明 |
| --- | --- |
| `42a0af9e` | feat(supplier-intel/s4b): M1 纯核——找厂优先级 v1、推荐契约 v1、四个评分组件、项目排名 read-model |
| `1649a494` | feat(supplier-intel/s4b): M2 服务层——score-and-complete、项目级当前推荐 / 赛马 read-model、找厂优先级标注、能力核验路径 |
| `d295171c` | feat(supplier-intel/s4b): M3 UI——供应商评分分解、1688 挂牌价 vs 正式报价、找厂优先级徽章、供应商赛马 / 当前推荐页签 |
| `4dae527e` | test(supplier-intel/s4b): 隔离库套件——评分收口 / 排名 / 1688 例子 / 不变性 / 并发 / ACL / 零网络 / 能力核验 |
| `b7083715` | test(supplier-intel/s4b): 浏览器夹具——1688 挂牌价供应商 / 便宜但门 FAIL / 第二家四维齐全 / 询价轮 / 历史交互 / 已核验出口能力 |
| `88f67543` | test(supplier-intel/s4b): 浏览器验收脚本 FLOW A–I + 只读成员 + 三视口；V2 改为「有写权限但档案项目不可见」 |
| `5d38a6a9` | test(supplier-intel/s4b): 夹具补发现 Run 的 Brief 快照（找厂优先级词源）；修正 R2 历史计数与 D 可排名断言 |
| `4116e16c` | docs(supplier-intel/s4b): 交付报告草稿——四层分离、1688 Trust Boundary、价格证据层、score-and-complete、组件公式、推荐 / 排名 / 赛马、deferred、Neon 安全规则 |
| `6c4b6516` | test(supplier-intel): S4-A T26d 对齐 S4-B 收口契约（推荐态由评分契约决定，live 变化不改写、永不 PRIMARY/BACKUP）；浏览器验收 A6 剥否定句 / D3 展开分解 / 运行行重选；夹具补 incoterm 交期 |
| `deec8740` | test(supplier-intel/s4b): 浏览器验收——开始评估以服务端列表为基线（运行列表异步加载会把旧运行误认成新建）；人工判定按钮缺失时输出诊断 |
| `569530a3` | test(supplier-intel/s4b): 浏览器验收脚本的直写模拟对隔离库连接回收（P2024/P1001）重连重试一次 |
| CODE_HEAD_SHA | `569530a3`（本报告提交之前的最后一次代码 / 测试提交） |
| FINAL_PR_HEAD_SHA | 本报告所在的 docs 提交（见 PR #215） |
| BASE_MAIN_SHA / REMOTE_MAIN_SHA | `36ccc1a2583968fa9eca05c1f72cecced06273b6`（S4-A merge commit）/ 见收据 |
