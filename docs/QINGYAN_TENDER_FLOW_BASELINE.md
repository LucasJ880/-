# 招投标主流程 · 现状基线（FLOW-0 三方对比的「青砚」一方）

> 用途：三方对比（青砚现状 / ChatGPT workflow / 开源项目）里青砚这一列的事实底稿。只写**核对过的事实**，不写设计。方案见 `docs/QINGYAN_TENDER_FLOW_PLAN.md`，续做入口见 `docs/QINGYAN_TENDER_FLOW_HANDOFF.md`。

| 项 | 值 |
|---|---|
| 核对日期 | 2026-11-11 |
| 核对基点 | `main` @ `f08de3f`（Merge #409） |
| 核对方式 | 第 1 轮：三个只读调研分头读代码（分析链 / 询价定价审批链 / 情报·运行时·界面），每条带 `文件:行`；第 2 轮：主会话对关键结论直接读代码复核，分歧记入 §10 |

**可信度标记**（每条事实后面的字母）：

- **A** = 主会话直接读过代码或文档原文。
- **B** = 调研读过并给出 `文件:行`，主会话未逐条复核。动手改这一块之前先复核。
- **D** = 仓库里无法确定（生产环境变量、仓库外的文档、实际使用情况），见 §11。

---

## 1. 一句话现状

青砚把「读标书」和「问供应商要价」各自做深了，但**中间没有连起来，两头是空的**：前面没有自动发现和预筛，后面的定价、提交、复盘靠人手推进；用户在页面上看不到「这个标现在该做什么」。

---

## 2. 生命周期覆盖（对比用的统一坐标 S0–S10）

三方对比全部按这 11 段对齐。

| 段 | 青砚现状 | 自动化 | 人工闸门 | 状态 |
|---|---|---|---|---|
| S0 发现 | 手工建项；外部系统 BidToGo 经 `POST /api/v1/projects` 推入（带外部给的契合分）；PROC-1 采购监控产出「候选」但不建项 | 低 | 平台管理员分发 | 部分（§7） |
| S1 预筛 / 投不投 | Go / Hold / No-Go 可记录，AI 不得代为决定 | 无 | 人工选 | 有记录、**无下游效力**（G4） |
| S2 读标书 | 上传 → 整包分析 → 关键事实 / 要求 / 澄清问题，带页码证据 | 高 | 事实确认、要求确认、整轮批准 | 已建（引擎三代并存，G9） |
| S3 合规矩阵 | Bid-fit 矩阵（HAVE / BUILD / PARTNER / RFI / NO_GO），只由人标注；标注沉淀为合规记忆 | 低 | 人工逐条 | 已建 |
| S4 澄清与补遗 | 给业主的澄清问题清单可导出（中英 PDF）；补遗 diff 产出变更候选 | 中 | 候选逐条接受 / 驳回 | 部分（G6） |
| S5 询价与比价 | 一键起草询价 → 审批 → Gmail 发出 → 回信自动入表 → 催单 → 落地成本比价矩阵 | 高 | 发送、催单各一张审批卡 | 已建（追踪页未做，G3） |
| S6 定价 | 定价助手（跟价 / 低 5·10·15% / 保本 / 成本加成情景）；报价引擎的获批报价 = 我方投标价 | 中 | 报价审批 | 已建，**成本线手填**（G2） |
| S7 写标书 | 投标草稿（英文正文 + 中文说明，PDF）；分析备忘录；策略备忘录 | 中 | 无硬闸门 | 已建（G5） |
| S8 审查 | 草稿里的 `[TO CONFIRM]` 占位；备忘录数字审计；比价解读数字校验 | 低 | 无 | 零散，**无统一的交付前检查** |
| S9 组包提交 | LLM 生成的提交清单；`submittedAt` 手工推进 | 低 | 阶段推进需人工确认 | **薄**（G7） |
| S10 结果与复盘 | 结果标记（中 / 未中 / 不投 / 取消，可填中标方）→ 授标情报、复盘草稿、盈利分析 | 中 | 管理员复核授标记录 | 已建 |

---

## 3. 四套「现在到哪了」

同一个标的进度，系统里有四种互不相通的说法。

| # | 模型 | 取值 | 怎么推进 | 谁在用 | 可信度 |
|---|---|---|---|---|---|
| 1 | 项目阶段（6 段） | 立项 → 项目分发 → 项目解读 → 供应商询价 → 供应商报价 → 项目提交（权重 0 / 10 / 10 / 20 / 50 / 10） | 由时间戳推导；前进一律要人工确认，不能后退。只有两处自动写：分析完成写 `interpretedAt`，首封询价发出写 `supplierInquiredAt` | 项目页进度条、阶段任务 | A（`src/lib/tender/stage.ts:4-11`、`stage-transition.ts:45-51`）；自动写两处为 B |
| 2 | 投标相位（12 态） | DISCOVERED … GO / HOLD / NO_GO … SUBMITTED / AWARDED / LOST / WITHDRAWN | Go 决策与情报流程写入 | 情报页、财务模块 | B（`src/lib/bid-workflow/constants.ts`） |
| 3 | 分析轮次状态 → 工作台三步 | 上传文件 → 确认招标要求 → 准备标书与报价 | 由最新分析轮次状态投影；**第 3 步没有任何完成信号**，要求确认后主按钮永远是「准备标书与报价」 | 项目工作台 | A（`src/lib/tender/workbench-state.ts:74-242`） |
| 4 | 「下一步」查表（10 条规则） | 待批 → 临近截标 → 未分析 → 分析中 → 关键事实缺证据 → 强制要求不满足 → 未询价 → 没回该催 → 报价齐了该比价 → 定了供应商该定价 → 无待办 | 确定性查表，零 LLM | **只有 Muse 通道**（`router.ts:594`）；Muse Connector 已永久冻结，Web 用不到 | A（`src/lib/muse-bridge/next-step.ts:77-228`） |

补充：阶段任务是每段固定的 2–3 条模板（如询价段「发送供应商询价单」「跟进供应商回复」），不随项目实际状态变化（B，`src/lib/tender/stage-tasks.ts:21-102`）。

---

## 4. 分析链（S2–S4、S7）

- **入口与驱动**：上传即入队一条整包分析；`tender-auto-analysis` 定时任务每 2 分钟消费，带租约与断点（B，`vercel.json:76`、`worker.ts:41-80`）。
- **十步**：CLAIMED → ENSURE_PAGES → EXTRACT_FACTS → GENERATE_SECTIONS → EXTRACT_REQUIREMENTS → BUILD_DELIVERABLES → BUILD_CLARIFICATIONS → CREATE_TASKS → PROJECT_ROOM → FINALIZE（B，`constants.ts:451-462`）。
- **引擎三代并存**，全部由环境变量切换，默认都关：
  1. V1：正则 + 模板，带 RCMP 模板兜底。旗标全关时走这条。
  2. V2：有证据约束的多轮 LLM 抽取，`TENDER_ANALYSIS_V2_ENABLED` 打开后在同一个 worker 里运行（A，`worker.ts:453`）。
  3. Workforce 路径：`TENDER_WORKFORCE_ANALYSIS_ENABLED` + 运行时开关；另有服务端固定的 9 节点计划 `TENDER_WORKFORCE_DETERMINISTIC_PLAN_ENABLED`（B）。
  - 生产到底开了哪几个：**D**（§11-1）。
- **评测**（B，`docs/tender-eval/**`、`docs/QINGYAN_TENDER_REAL_EVALUATION_V1.md`）：

  | 用例 | 强制要求召回 V1 → V2 | 关键事实准确 V1 → V2 |
  |---|---|---|
  | A-REAL（RCMP，43 页） | 44.7% → 76.3% | 77.3% → 72.7% |
  | B（DSBN 窗饰） | 0% → 54.5% | 0% → 90.9% |
  | C（HRM 媒体监测，暂定） | 4% → 68% | 0% → 80% |

  用例 C 的 V2 另有 65.8% 误报。
- **人工闸门**：事实确认、要求确认（单条 / 批量）、整轮批准、变更候选接受 / 驳回、阶段推进。
  - 询价单只取**已确认**的要求（B，`tender-rfq/build.ts:183`）——这是唯一真正起作用的下游闸门。
  - 投标草稿、分析备忘录、澄清导出在「待审阅」状态就能生成，整轮批准不拦它们（A，`tender-bid-draft/gather.ts:64`）。
- **产物**：全部是数据库行或 HTML → PDF，**没有 docx**（B）。带页码证据的：事实 / 要求 / 分析备忘录；不带页码的：策略备忘录、投标草稿、澄清导出（B）。
- **补遗**：只有明确标为补遗的文件才走增量分析，产出变更候选；「接受」只记录意图，**不改写已确认的要求**（A，`addendum-diff.ts:127-141`）。公告页监控是整页哈希比对，变了就通知，不做结构化 diff（B，`tender-intel/watch.ts`）。
- **记忆**：
  - 投标资料（公司主体、资质、团队、过往业绩、禁用说法）存在组织设置里，投标草稿会读（B）。
  - 合规记忆：人在 Bid-fit 上的标注按要求文本指纹沉淀，下次同类要求给出建议；不进提示词（B）。
  - 企业记忆（已确认的事实声明）：投标草稿读最多 40 条；**分析提示词不读任何记忆**（B）。

---

## 5. 询价 → 比价 → 定价 → 审批（S5–S6）

- **轮次**：`draft → in_progress → completed / canceled`。轮次不会自动完成，只能手工改（B，`src/lib/inquiry/status.ts:14-19`）。
- **供应商行**：`pending → sent → replied / quoted / declined / no_response`；未响应后晚到的回信会拉回（B）。「谢绝」不会自动识别，只写进备注（B）。
- **轮次锁**：有待批或已批的发送卡、或 3 天内已发过一轮，就不能开新轮（B，`round-pure.ts:62-85`）。
- **催单**：默认 3 天无回复起草催单，最多 2 次，每张卡 48 小时有效；催满两次或回复截止已过 → 自动标未响应（B，`chase-pure.ts`）。
- **回信解析**：每 10 分钟按邮件线程认领；附件 PDF / Word / Excel 转文本（图片不做 OCR）；一次 LLM 抽取，之后过**证据闸**——每个字段必须能在原文里逐字找到，找不到就丢弃并列为缺失；只填空字段，冲突写备注（B，`inbound-parse.ts:313-416`、`inbound-apply.ts`）。
- **落地成本**：按贸易条款决定加哪些费用；汇率、关税率、数量任一缺失就不出结果并写明缺什么，不用默认值（B，`landed-cost.ts:100-289`）。
- **比价矩阵**：按落地总价排序，推荐「最便宜且全合规」的一家，不自动选定；结论文字由代码生成；可选的 LLM 解读有数字校验（B）。Web 上有矩阵和解读接口（A，`api/projects/[id]/inquiries/[inquiryId]/compare/{matrix,analysis}`）。
- **定价**：
  - 定价助手的成本只读写手工保存的数字，不认比价矩阵（A，`api/projects/[id]/pricing-helper/route.ts` 无任何询价 / 落地价引用）。
  - 「按所选供应商落地价算情景」的函数只有 Muse 通道在用（A）。
- **审批**：招投标只有两种审批卡——发询价、发催单；内容哈希防篡改；发件邮箱只从组织设置读（B）。Web 上原地批准 / 驳回。
- **我方投标价**：报价引擎里获批的报价成为权威投标价；系统不向任何招标平台提交（B，`quote-engine/tender-bid.ts:1-12`）。

---

## 6. 提交与结果（S9–S10）

- 「提交」页签：提交记录（只读显示）、提交清单（LLM 生成）、结果 / 放弃、项目复盘卡（A，`submission-tab.tsx`）。
- 提交这件事在系统里只有一个时间戳 `submittedAt`，由人工推进阶段时写入（A，`stage-transition.ts:45-51`）。没有提交包清单、没有回执留存、没有交付前检查。
- 结果标记 → 复盘草稿、授标事实回填、竞争对手 / 采购机构画像、盈利分析（B；规格 `openspec/specs/tender/{result-marking,award-*}`）。

---

## 7. 发现与情报（S0–S1）

- **进系统的路**（B，除注明外）：
  1. 手工建项，须显式选招投标，否则落到通用项目。
  2. 外部系统 BidToGo 经 `POST /api/v1/projects` 推入，带建议（pursue / review_carefully / low_probability / skip）与契合分 0–100，再由平台管理员分发（A，`api/v1/projects/route.ts:186-194`）。是否还在实际使用：**D**（§11-3）。
  3. PROC-1 采购监控：每小时随 `tender-watch` 扫 CanadaBuys 公告等四个官方来源，产出候选并打 5 维优先级分（明确「不是中标概率」）。**不建项**，只能手工把候选关联到已有项目。2026-11-09 已上生产，业务验收待做（A，TASKFLOW Phase R、`docs/QINGYAN_PROC-1_REPORT.md` §8a / §8b）。
- `/bids` 首页是 5 张跳转卡，不产生任何数据，其中「需求与合规」只是跳到项目列表（A，`bids-workspace-shell.tsx:17-43`）。
- **项目内情报**：分析完成后自动跑外部情报（授标检索、网页搜索、参考标准、市场价格、策略备忘录），受 `TENDER_EXTERNAL_INTEL_ENABLED` 控制，关着时零外呼（B）。情报页签 7 个槽位。
- **未建**：每日新标拉取（P2-1）、匹配预评分（P2-2）、「跟这个标」一键建项并分析（P2-3）、公告结构化 diff（P2-4）。

---

## 8. 约束（任何方案都绕不开）

- 八条硬纪律，原文见 `openspec/config.yaml` `context:`。对本任务影响最大的四条：
  - 第 1 条零 schema：新数据只能落既有 JSON 位、通知、审计日志。
  - 第 3 条禁止第三套队列：复用 workforce 运行时与既有定时任务。
  - 第 5 条不爬登录页。
  - 第 7 条确定性优先：「下一步」是查表；不新增 LLM 调用。
- 既有的例外都是逐条由 Lucas / Evan 批准并写进 `config.yaml` 的；本任务若需要新例外，同样要逐条拍板。
- Muse Connector 永久冻结（TASKFLOW 已决定第 10 条），入口只做 Web。

---

## 9. 断点清单（方案要回答的问题）

| # | 断点 | 证据 | 可信度 |
|---|---|---|---|
| G1 | 「下一步」查表只在已冻结的 Muse 通道里；Web 工作台在要求确认之后就不再给指引 | §3 第 3、4 行 | A |
| G2 | 比价选定的供应商落地价进不了定价成本线（TASKFLOW W-3 未做） | §5 定价 | A |
| G3 | 没有跨项目的询价追踪页；`batch-followup` 仍在线；首页「供应商未回复」查的是不存在的状态 `contacted`（TASKFLOW T-2 未做） | `src/lib/proactive/scanner.ts:196-200`、`api/projects/[id]/inquiries/batch-followup/route.ts:60` | A |
| G4 | Go / No-Go 只是一条记录：No-Go 之后仍可照常询价、生成草稿 | 全仓 `grep goDecision\|bidPhaseStatus`（不含测试）27 个文件，没有一个在 `tender-rfq`、`tender-bid-draft` 或文档生成里 | A |
| G5 | 整轮批准不拦任何产物；未批准的分析也能生成投标草稿 | `tender-bid-draft/gather.ts:64` | A |
| G6 | 补遗「接受」不改要求，也不提示已发出的询价是否受影响 | `addendum-diff.ts:127-141` | A（前半）/ B（后半为推断） |
| G7 | 提交环节只有一个手工时间戳和一份 LLM 清单；没有交付前检查、没有回执留存 | §6 | A |
| G8 | 发现靠手工；PROC-1 候选与招投标项目之间没有「跟进 → 建项 → 分析」的通路 | §7 | B |
| G9 | 分析引擎三代并存，评测显示 V1 与 V2 差距很大，生产开的是哪一代不确定 | §4 | B / D |
| G10 | 轮次不会自动完成；`supplierQuotedAt`、`submittedAt` 只能手工推进，进度条与实际脱节 | §3 第 1 行、§5 | B |
| G11 | RFQ 设置没有页面，只有接口（TASKFLOW W-2 未做） | 无 UI 引用 | B |
| G12 | 「下一步」查表与催单扫描两处口径不一致：前者不看回复截止是否已过，且取提问人的催单天数；后者跳过已过截止的，取项目负责人的 | `next-step.ts` 规则 7 对 `chase-pure.ts:270`、`chase-service.ts:201` | B（调研标为推断） |

---

## 10. 交叉核对更正记录

主会话复核时与调研报告不一致的地方，以本节为准。

| # | 调研原话 | 复核结果 | 依据 |
|---|---|---|---|
| C1 | 「比价矩阵加载器只有 Muse 路由在用」 | 不对。Web 有比价矩阵与解读两个接口；只有「定价情景投影」是 Muse 独占 | `grep loadCompareMatrix`：`api/projects/[id]/inquiries/[inquiryId]/compare/{matrix,analysis}/route.ts` |
| C2 | 「PROC-1 只用测试夹具验证过，生产迁移待做」（据交接文档 §2 / §3） | 已过时。2026-11-09 真实只读核对通过，生产迁移已执行 | `docs/QINGYAN_PROC-1_REPORT.md` §8a / §8b；TASKFLOW Phase R |
| C3 | `tender-understanding/flag.ts` 注释写 V2「零生产路由接线」 | 注释已过时。V2 已接进 worker，旗标一开就走 | `src/lib/tender-auto-analysis/worker.ts:453` |

---

## 11. 未核对（需要人回答）

1. 生产环境这几个旗标的实际值：`TENDER_ANALYSIS_V2_ENABLED`、`TENDER_AUTO_PACKAGE_ANALYSIS_ENABLED`、`TENDER_PACKAGE_AI_EXPERIENCE_ENABLED`、`TENDER_WORKFORCE_ANALYSIS_ENABLED`、`TENDER_EXTERNAL_INTEL_ENABLED`。决定了「青砚读标书」这一列到底拿 V1 还是 V2 去和 GPT 比。
2. `招投标四步路径整合方案-2026-11-06.md`（TASKFLOW Phase W 的上位方案，Evan 拍板过 §6a）不在仓库里，也不在 git 历史里。四步具体是哪四步、§6b「体感原则」写了什么，本基线没有读到。
3. BidToGo 现在是否还在往青砚推标。
4. 团队今天实际怎么用 ChatGPT 做标：仓库里只有三处旁证——W-1 / T-1 任务书把「ChatGPT 查资料」「盯 Grok Bot 追踪」列为要替掉的步骤；PROC-1 的业务规则来自一个 ChatGPT Skill；批次二分类学报告曾拿 ChatGPT 深读对照出青砚漏掉现任供应商与评分标准。
5. 未在本轮读代码的模块：`supplier-intel`、`project-ledger`、`project-finance` 的招投标部分、`quote-engine` 除投标价以外的部分。
