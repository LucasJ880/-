# 招投标主流程重排（FLOW-0）与 Tender Intelligence（TI）· 交接（HANDOFF）

> 任何新会话从这里进。先读本文件，再按「下一步」执行，不凭记忆重写。本文件只记录**已核对过的事实**；未核对的写明「未核对」。每完成一轮就更新本文件并提交。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-11-20 第四十五次（生产实测修复：FIX-12 一键分析不再被 300 秒硬杀，Draft PR #540；FIX-13 解析出的 U+0000 让文件「解析失败」且看不到原因，四件套待审；记录：生产 GPT-6 Astra 未启用。新会话从 §0.5i 进。上一次：2026-11-20 第四十四次，情报串联 CHAIN） |
| 任务来源 | Lucas，2026-11-11：同事反馈 ChatGPT 的 workflow 好，要更新青砚招投标类目的 workflow；三方对比（青砚 / ChatGPT / 开源），长任务要做好交接，要多轮交叉验证 |
| 方案 | `docs/QINGYAN_TENDER_FLOW_PLAN.md`（三方矩阵已填）；**当前主文档：`docs/tender-intelligence-gap-analysis.md`** |
| 底稿 | 青砚 `docs/QINGYAN_TENDER_FLOW_BASELINE.md`；开源 `docs/QINGYAN_TENDER_FLOW_OSS_SURVEY.md`；ChatGPT：`qyane-tender-intelligence` Skill 与实施任务书（Lucas 2026-11-11 上传；**原文未入库**，见 §0 第 3 条） |
| 主线状态 | `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` → Phase F：FLOW-0 `[~]`、TI-0 `[~]`；FIX-1、TI-1、TI-2、TI-3a、TI-3b、TI-4a、TI-4b、TI-4c 均为 `[x]`；Phase F（续）情报串联：CHAIN-0c、CHAIN-4b、CHAIN-4a、CHAIN-2、CHAIN-3 为 `[x]`，CHAIN-0 `[~]`（第 2–7 项待生产权限），CHAIN-1 `[ ]`（前置核查不通过，已停） |
| 工作分支 | 没有进行中的链。新 change 直接从最新 `main` 开分支、直接指向 `main`（不要再叠层，见 §0.2 的教训三）。本文件的后续更新走普通 PR |
| 性质 | main 上：询价生成器的类别归一（FIX-1，线上行为已变：询价能带上要求）；TI-1 / TI-2 / TI-3a / TI-3b 是纯函数目录，线上不可达；TI-4a 三个接口、TI-4b 面板、TI-4c 逐行录入都在开关 `TENDER_BID_WORKSPACE_ENABLED` 之后，默认关，生产未启用。情报串联：CHAIN-0c、CHAIN-4b 不加开关，合并即生效；CHAIN-4a、CHAIN-2、CHAIN-3 都在默认关的开关之后，生产未启用（§0.5h） |
| 进行中的 change | `tender-analysis-call-deadline`（FIX-12，已实施，Draft PR #540，分支 `claude/amazing-planck-0s5wnb`）；`document-parse-nul-and-reason`（FIX-13，四件套待审，分支 `claude/amazing-planck-0s5wnb-parse-error`）。见 §0.5i。情报串联能在容器里做的都已做完，剩下的见 §0.5h「之后还有什么」。此前：`tender-submission-record`（FLOW-H4a，#446）已合并并归档；`tender-submission-checklist`（FLOW-H4b，#454）已合并并归档；`stage-tasks-create-fix`（FIX-7，原 FIX-5，#447）已合并并归档；`tender-stage-status-catch-up`（FIX-6，#450）已合并并归档（不加开关）。`tender-stage-auto-advance`（FLOW-H1c，#449）已合并并归档。此前：`rfq-supplier-groups`、`rfq-followup-optin-ordering`、`requirement-review-batch-confirm` 都已归档，见 §0.5a。`rfq-round-followup-preapproval` 已归档。此前的八个 change：八个 change 已归档到 `openspec/changes/archive/2026-11-11-*`，规格在 `openspec/specs/tender/{rfq-requirement-selection,price-schedule,bid-cost-sheet,competition-leads,bid-readiness,stage-policy,bid-workspace,bid-workspace-panel,bid-workspace-line-entry}`（共 68 条要求）。`openspec list` 在 main 上为空（上面两个 change 在各自分支上；`vis-1c-notify-settings-search`、`next16-proxy-rename` 已分别归档到 `2026-11-11-*`、`2026-11-16-*`） |

---

## 0. 下一步

### 0.1 授权边界（Lucas 2026-11-11 休息前）

原话：「盯着给这几个 PR 去，开始做 TI-3 规划。我准备休息了。其他你来主导，如果需要我确定的，按照你推荐的做。权限给你。你来进行大优化。」

本会话据此这样执行：

- **可以做**：设计与取舍自己定并写明理由；四件套不等审核就实施；继续开 Draft PR 并订阅；处理这些 PR 上的 CI 失败与评审意见。
- **不做，等 Lucas / Evan**：合并到 main、部署、生产迁移、改生产数据或凭证、发询价或任何对外邮件、付费数据、提交投标或资料申请。这些此前被明确划为「每一项单独授权」，一句笼统的「权限给你」不覆盖它们；合并即上线，不可逆。
- **不改** `openspec/config.yaml` 的硬纪律文字。需要澄清的地方写在 PR 里等确认。

### 0.2 PR 链（已全部合并，2026-11-11）

| PR | change | 怎么进的 main |
|---|---|---|
| #411 | 文档与规划 | 直接 |
| #412 | FIX-1 询价类别归一 | 直接（**线上行为已变**：询价能带上要求。上线后第一次发询价请在审批卡上核对正文） |
| #413 | TI-1 价格表行项 | 先合进 #412 的分支，随 #412 进 main |
| #414 | TI-2 逐行成本核算表 | 经 #420 |
| #415 | TI-3a 竞争情报线索契约 | 经 #420 |
| #416 | TI-3b 可投标判定与阶段策略表 | 经 #420 |
| #417 | TI-4a 投标工作区存取接口 | 经 #420（开关默认关） |
| #418 | TI-4b 项目页「投标工作区」面板 | 经 #420（开关默认关） |
| #419 | TI-4c 逐行录入与补遗 | 经 #420（开关默认关） |
| #420 | 补救：把 #414–#419 的内容带进 main | 直接 |

合并后的 main 的文件树与合并前在本地验证过的那棵树逐字节相同（`84ea0738…`；验证内容：整份 `scripts/test-ci-unit.sh`、`npm run typecheck`、`npm run lint:baseline`）。

教训一（#418）：TI-4a 有一条断言写死了目录里的模块文件数，TI-4b 新增文件后会失败，首次推送后才发现。**往既有目录加文件或改既有组件之后，把读到它的既有测试全部重跑**（`grep -rln "<目录或文件名>" src/lib --include=*.test.ts`），不要只跑新写的测试。

教训二（#418 首轮 CI 红）：仓库有一条行级检查 `scripts/check-swc-nullish-logical.test.ts`，同一行里 `??` 与 `&&` / `||` 无括号并用即判失败——即使它们分属两个独立的 JSX 表达式。写组件时把 `a ?? b` 提成变量。**推送前用 CI 的环境变量跑整份子集**（约 8 分钟）：

```
DATABASE_URL="postgresql://ci:ci@127.0.0.1:5999/ci?schema=public" DIRECT_URL="$DATABASE_URL" \
JWT_SECRET=ci-only-jwt-secret-not-for-production NODE_ENV=test bash scripts/test-ci-unit.sh   # 末行应为 CI unit subset PASS
```

CI 对同一分支的新推送会取消上一轮（`cancel-in-progress`），所以连续小推送只有最后一次有结果。

教训三（叠层 PR 的合并）：九个 PR 叠成一条链，每个的合并目标是前一个的分支。合并时没按顺序、合并后分支也没删，结果 #414–#419 各自合进了上一个分支，GitHub 显示「已合并」但内容不在 main，靠 #420 补救。**以后不要叠层**：一个 change 一个 PR，都直接指向 main；前一个没合并而后一个又依赖它时，后一个先不开 PR，或在 PR 正文第一行写明「先合 #NNN，合并时勾 Delete branch」。接手时如果看到一串「已合并」，用 `git merge-base --is-ancestor origin/<分支> origin/main` 核对内容是否真的在 main。

PR 事件会以 `<wake reason="external-event">` 送进会话。处理前先在上下文里找到该 PR 的 `subscription.created` 事件原文（规则在里面）；找不到就先对该 PR 再调一次 `subscribe_pr_activity`。

### 0.3 任务书 22 条验收项的进度

已有自动化测试的 20 条：A1、A2、A8、A9、A10、A16（TI-1）；A10–A14（TI-2）；A3、A4、A5、A6、A15（TI-3a）；A7、A21（TI-3b）；A17（租户隔离）、A20（开关关闭零影响）、A22（操作人来自登录身份）（TI-4a 隔离库端到端，真路由 + 本地库）。

还没做的 2 条：A18（提示注入不触发对外动作）、A19（并发重试不重复对外）。两条都要等「有对外动作的环节」接进来才有东西可测——目前整条 TI 链没有任何对外动作。

### 0.4 Owner Gate B（按授权由本会话代定，等 Lucas 复核）

数据库方案取**方案甲：零 schema**（差距分析 §7）。理由：不动库就不需要生产迁移，开关一关即回到现状，Lucas 不在场时这是唯一可逆的选择；第一批界面只需要按项目读写，不需要跨项目查询。公司别名与「竞争对手 → 出口商」关联是否建表，留到真有跨项目查询需求时再议。

方案甲依赖一个前提：分析轮次与情报室的 JSON 位可以作为扩展落点。`openspec/config.yaml` 第 1 条的文字只列了 `Organization.settingsJson`、User settings、Notification、AuditLog，但代码里早有先例（`bidFitMatrix`、`pricingInputs`、`bidDraft` 都在这些 JSON 位里）。本会话按先例执行，**没有改 config.yaml**；这一点在对应 PR 里标出，等 Lucas 确认。

### 0.5 接下来

TI-4a（接口）、TI-4b（面板）、TI-4c（逐行录入与补遗）已合入 main 并归档。到这里，一个标可以在界面上从粘贴价格表走到「只剩成本与截标两类阻断项」。候选的下一步，按推荐顺序：

1. **FIX-2**：分析入库时保留数量与单位（`v2-map.ts` 现在会丢），让价格表可以从已分析的招标文件预填，而不是只能粘贴。
2. **成本输入落库**：等 Lucas 在三个候选里拍板（TI-4a 报告 §3；推荐专用表、按财务查看权读）。拍板前成本输入只在浏览器本地。这一步做完才能把成本假设纳入补遗复核、做低 / 基准 / 高多情景并排。
3. 只读适配器（官方授标来源）、把进口线索写成供应商线索、核算结果写回报价引擎。
4. FLOW 方案 H1：把「下一步」查表搬上 Web；TI-3b 的阻断项与三张清单是它的输入。
5. 证书出处关联到项目已上传的文件；行明细按行保存的接口（解决两人同时编辑的后写覆盖）。

#### 等 Lucas 决定的事（都已写进对应 PR 与报告）

| 事 | 推荐 | 出处 |
|---|---|---|
| 上线后的第一次询价 | #412 已在 main；第一次发询价时在审批卡上把正文核对一遍，尤其是 V1 引擎分析的老项目 | 本文 §0.2 |
| 生产开关 `TENDER_BID_WORKSPACE_ENABLED` 与组织白名单 | 先只对自家组织打开 | TI-4a 报告 |
| 成本输入最终存哪里 | 专用表，按财务查看权读 | TI-4a 报告 §3 |
| 谁可以把证书标成「已核验」 | 先按现状（有项目写权限即可，须填出处并留审计），有第二个录入人时再收窄 | TI-4c 报告 §6 |
| 情报室 `summaryJson` 是否算零 schema 的合规落点 | 算（代码里已有先例），并在 `openspec/config.yaml` 补一句 | 本文 §0.4 |
| 原「四步路径」文档、R-1 例外状态 | — | 差距分析 §10 |

#### 重要发现（TI-4a 实施中，影响后续所有设计）

`GET /api/projects/[id]/bid-intelligence` 把情报室整行（含 `summaryJson`）返回给任何项目读者，`BidIntelligenceModule` 的内容在情报页签原样渲染。**所以成本、利润这类数据不能放进这些 JSON 位**。现在的做法：非金额的工作区内容存 `summaryJson.bidWorkspace`；核算表无状态现算，输入由浏览器带上来。

### 0.5a 询价自动流（RFQ-AUTO，2026-11-11 下午开）

来源：Lucas「muse 和 grok 都有开源的 workflow，会帮我们发邮件给供应商询价……也要做出自动流，不用我们一个一个点」。核对后的结论：青砚已经会发询价、收回信、催单、出比价表；「一个一个点」是两处——催单与追问每家每次一张卡，以及第一轮要人开抽屉选供应商点生成。分两个 change 解决。

| change | TASKFLOW | 分支 | 状态 | 接手要知道的 |
|---|---|---|---|---|
| `rfq-round-followup-preapproval` | RFQ-AUTO-1 | `claude/rfq-round-autopilot` | **已合并**（#422，2026-11-11）并已归档到 `openspec/changes/archive/2026-11-11-rfq-round-followup-preapproval` | Lucas 在四个审批方式里选了「一次批准管整轮」，审过四件套后说「可以，开始实施」。开关 `TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED` 默认关。报告 `docs/QINGYAN_RFQ-AUTO-1_REPORT.md` |
| `rfq-round-auto-draft` | RFQ-AUTO-2 | `claude/rfq-round-auto-draft` | **已合并**（#425，2026-11-11）并已归档到 `openspec/changes/archive/2026-11-11-rfq-round-auto-draft` | Lucas 审过四件套后说「可以开始实施了」。实施中发现界面上要求只能在「批准分析」之前逐条确认，按原稿（每条都审完才起草）几乎不会触发；Lucas 在三个选项里选了「照样起草」：批准分析即视为审核完成，只带已确认的要求并写明有几条没带上。开关 `TENDER_RFQ_AUTO_DRAFT_ENABLED` 默认关。报告 `docs/QINGYAN_RFQ-AUTO-2_REPORT.md` |
| `rfq-auto-draft-followup-optin` | RFQ-AUTO-3 | `claude/rfq-auto-draft-followup` | **已合并**（#427，2026-11-11）并已归档到 `openspec/changes/archive/2026-11-11-rfq-auto-draft-followup-optin`（这次归档修改了两份已有规格：`rfq-followup-preapproval` 改 1 条加 5 条，`rfq-auto-draft` 改 1 条） | Lucas「开始 RFQ-AUTO-3，其他按照你推荐的做」，审过四件套后说「可以，开始实施」。个人开关（按人、按组织，默认关），开启后自动起草的卡带跟进授权。没有新的功能开关。报告 `docs/QINGYAN_RFQ-AUTO-3_REPORT.md` |
| `rfq-followup-optin-ordering` | RFQ-AUTO-3a | `claude/rfq-optin-clock-order` | **已合并**（#433，2026-11-11）并已归档到 `openspec/changes/archive/2026-11-11-rfq-followup-optin-ordering`（`rfq-followup-preapproval` 加 1 条） | 修 RFQ-AUTO-3 的一个缺口（RFQ-AUTO-5 的独立审查顺带发现）：个人开关的状态取「最近一条记录」，记录时间来自各台服务器自己的时钟，时钟不一致时后点的「关闭」可能不生效（已在旧代码上复现）。设置改为一个短事务：取本人的锁、读最近一条、需要才写，并明确给记录时间。Lucas 2026-11-11「RFQ-AUTO-3 的时钟问题可以修，开始吧」；这次没有先回传四件套再等一轮，已在 PR 里说明。报告 `docs/QINGYAN_RFQ-AUTO-3a_REPORT.md` |
| `requirement-review-batch-confirm` | RFQ-AUTO-4 | `claude/requirement-batch-confirm` | **已合并**（#429，2026-11-11）并已归档到 `openspec/changes/archive/2026-11-11-requirement-review-batch-confirm` | Lucas 审过四件套后说「可以，开始实施吧」。要求列表的勾选式批量确认 + 计数 + 批准前的提示 + 审计；不加功能开关。与原稿不同的一处（独立审查后改，写在 PR 正文最前面）：批量确认多了一个可选参数「只在等待审核时确认」，所以请求体多一个可选字段、`review.ts` 多一个可选参数。报告 `docs/QINGYAN_RFQ-AUTO-4_REPORT.md` |
| `rfq-supplier-groups` | RFQ-AUTO-5 | `claude/rfq-supplier-groups` | **已合并**（#431，2026-11-11）并已归档到 `openspec/changes/archive/2026-11-11-rfq-supplier-groups`（新规格 `tender/rfq-supplier-groups` 11 条；`rfq-auto-draft` 改 3 条加 2 条；`rfq-web-entry` 改 1 条） | Lucas 2026-11-11 审过四件套后说「RFQ-AUTO-5 可以，开始实施了」。每人自己的供应商分组（名字 / 最多 8 家 / 关键词），按项目名称做确定性的文字比对选组，恰好一组对上才用；抽屉按分组预选并可管理分组；自动起草有分组时只认分组、对不上不起草（不退回常用供应商）。分组存成本人的只追加记录（不进组织设置）。开关 `TENDER_RFQ_SUPPLIER_GROUPS_ENABLED` 默认关。报告 `docs/QINGYAN_RFQ-AUTO-5_REPORT.md`（在该分支上） |

**#422 正文里请 Lucas 确认的两处**（Lucas 没有另外留言，直接合并了 #422；按合并即同意处理，想改随时说）：

1. `openspec/config.yaml` 硬纪律第 2 条末尾加的一句（一张已批准的卡可以一并授权卡上写明的后续固定模板邮件，仅限询价轮次的催单与缺字段追问）。不同意则 #422 不应合并。
2. 建轮次抽屉里的勾选框默认勾选（design D7）；规格写的是「明确勾选」。要改成默认不勾只需改一行。

**RFQ-AUTO-2 之后**：归档已做（本次更新所在的 PR）。生产上两个开关 `TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED`、`TENDER_RFQ_AUTO_DRAFT_ENABLED` 都还是关的，打开由 Lucas 决定（建议先只对自家组织、先开自动起草再开跟进授权，各观察几轮）。

**Lucas 2026-11-11「其他按照你推荐的做」的范围**（已向他说明我的理解，他没有异议并让开始实施）：RFQ-AUTO-3 之后按下面的顺序做第 2、3 项，各自一个 change、一个 PR，每个都先回传四件套。三件事不在这句话的范围内：生产开关（没有权限，也不该由会话来改）；成本输入存专用表（要新增表，违反零 schema，须 Lucas 明确批准例外）；谁能标「已核验」（推荐就是维持现状）。

**RFQ-AUTO-3 的独立审查顺带暴露的一个既有问题（还没有 change，要不要做等 Lucas 定）**：`Organization.settingsJson` 被多处「整块读、整块写」且不加锁——收信定时任务的游标（`tender-rfq/inbound-sync.ts`）、Muse 的偏好与绑定（`muse-bridge/prefs.ts`、`binding.ts`）、管理员改询价设置（`api/organizations/[orgId]/tender-rfq-settings`）、日历监听、投标资料等。它们之间可能互相覆盖（例如刚学到的常用供应商被定时任务的一次回写冲掉）。只有少数写入方加了行锁。RFQ-AUTO-3 没有改这些写法，只是让个人开关绕开了它。

**询价自动流接下来可以做的**（按推荐顺序）：

1. ~~RFQ-AUTO-3~~：已做并归档，见上表。实施中与四件套原稿不同的四处（都是独立审查后改的，写在 #427 正文最前面，Lucas 看过后合并）：开关的状态是本人最近一条开关记录而不是组织设置里的一格；关闭任何时候都可以；带授权的待批卡不看功能开关都显示授权（也改变了 RFQ-AUTO-1 的一个界面行为）；开启时绑定模板指纹。
2. ~~批量确认按钮~~：已做并归档（RFQ-AUTO-4），见上表。
3. ~~常用供应商按项目品类分组~~：已做并归档（RFQ-AUTO-5），见上表。Lucas 审四件套时对三处取舍（分组按人、对不上就不起草、只比项目名称）没有提出异议。

**下一步计划见 §0.5b。** 三个功能开关 `TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED`、`TENDER_RFQ_AUTO_DRAFT_ENABLED`、`TENDER_RFQ_SUPPLIER_GROUPS_ENABLED` 在生产上都还是关的，打开由 Lucas 决定（建议先只对自家组织：先开自动起草，再开供应商分组，最后开跟进授权，各观察几轮）。还等 Lucas 定的事：成本输入要不要存专用表（要新增表，须明确批准零 schema 的例外）；`Organization.settingsJson` 多处不加锁整块回写要不要另开 change 处理。

**#422 之后**：归档已做（#423，已合并）。生产上开关 `TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED` 仍是关的，打开由 Lucas 决定（建议先只对自家组织）。接下来可以提「自动起草的轮次怎么带跟进授权」（暂定 RFQ-AUTO-3：个人偏好里一个明确的开关）。

### 0.5b 下一步计划（2026-11-11 晚定）

来源：Lucas 2026-11-11「按照你推荐的开始做，并且做下一步的计划，等 434 合并后开始」。本会话的理解（已当场向他说明）：按下面的顺序做，每一项一个 change、一个 PR、直接指向 main；四件套写完直接实施，取舍写在 PR 最前面；合并、部署、生产开关仍由 Lucas 来做。

| 顺序 | TASKFLOW | 做什么 | 为什么排在这里 | 状态 |
|---|---|---|---|---|
| 1 | FIX-3 | **组织设置的写入不再互相覆盖。** `Organization.settingsJson` 被多处「整块读、整块写」且不加锁：收信定时任务的游标（`tender-rfq/inbound-sync.ts`，每 10 分钟写一次）、Muse 的偏好与绑定（`muse-bridge/prefs.ts`、`binding.ts`）、询价设置（`api/organizations/[orgId]/tender-rfq-settings`）、投标资料（`tender-profile/store.ts`）。它们之间会互相冲掉——例如刚学到的常用供应商、刚改的询价发件设置，被定时任务的一次回写恢复成旧值。改为统一经一个「先锁住这一行、读最新、只改自己那一块、写回」的入口。范围只含询价与 Muse 相关的这几处；销售、安装、开户等别的写入方（其中斑马帘比例、质保设置、能力治理已经加了锁）不在本次范围。零 schema。 | 三个自动流开关打开之后，自动起草靠常用供应商、收信靠游标，这些都在这一块里；先把地基修好再放量。实际发生过没有不清楚，但定时任务每 10 分钟一次，撞上人改设置是迟早的事。 | **已完成**：#436 2026-11-11 合并，已归档（`2026-11-11-org-settings-locked-write`）。实际范围比这里写的大：只给一部分写入方加锁没有用，所以改了全部 11 处写入方加 3 个运维脚本（Lucas 已同意「范围可以」）。锁用的是 `FOR NO KEY UPDATE`（`FOR UPDATE` 会与外键检查互斥、引出死锁）。已有的三处旧锁（斑马帘比例、质保设置、能力配额策略）仍是 `FOR UPDATE`，建议另开小改动换掉，等 Lucas 定 |
| 2 | FIX-2 | **分析入库时保留数量与单位**（`v2-map.ts` 现在会丢），让价格表可以从已分析的招标文件预填，不必手工粘贴。 | 投标工作区现在的第一步是粘贴价格表；这一步省掉之后，一个标从上传文件到「只剩成本与截标两类阻断项」不需要手工转录。 | **已完成**：#437 2026-11-11 合并，已归档（`2026-11-11-analysis-quantity-unit-prefill`）。按钮在投标工作区「粘贴导入」里，沿用 `TENDER_BID_WORKSPACE_ENABLED`；只填粘贴框、不保存。上线之前做的分析没有数量线索，要重新分析 |
| 3 | FLOW-H1 | **把「下一步」查表搬上 Web**：项目页上直接告诉人现在卡在哪、下一步点哪里；TI-3b 的阻断项与三张清单是它的输入。 | 这是 Lucas 最初的诉求（不要每一步都来问人）在网页上的落点；前两步做完，它能指的路才是通的。 | **已完成**：#439 2026-11-12 合并，已归档（`2026-11-12-tender-web-next-step`）。只做了「查表上 Web」这一半：接口 `GET …/next-step`、工作台顶部的卡片、页内定位；判断调 Muse 的同一张查表（没改它）。开关 `TENDER_WEB_NEXT_STEP_ENABLED` 默认关。「用它推导六段进度条、取代三步卡」没做，见 §0.5c |
| — | — | **成本输入落库（专用表）**：推荐专用表、按财务查看权读。 | 要新增一张表，违反零 schema（硬纪律第 1 条），还要一次生产迁移。 | **不动，等 Lucas 明确说「批准为成本输入新增一张表」**；一句「按推荐做」不算 |

每一项都照这几条做（前面几轮攒下的规矩）：写四件套之前先跑 `openspec instructions <proposal|design|tasks>` 照 rules 写；动手之前先读对应的组件与现有测试；改完把读到被改文件的既有测试全部重跑；涉及对外发送、审批、同意、多租户隔离的改动，开 PR 前请一个不带结论的独立审查；用 CI 的环境变量跑整份子集；能在旧代码上失败的测试才算证据。

**生产开关（由 Lucas 操作，本会话没有权限也不该碰）**：三个开关都在部署平台的环境变量里，默认关。推荐的顺序与每一步看什么：

1. `TENDER_RFQ_AUTO_DRAFT_ENABLED=1`，并把 `TENDER_RFQ_AUTO_DRAFT_ORG_ALLOWLIST` 设成自家组织的 id。之后在一个真实的标上批准招标分析，看面板上是否出现「已为你起草第 1 轮询价」，到项目页核对这张待批卡的收件人与正文。不对就驳回这张卡——不会发出任何东西。
2. `TENDER_RFQ_SUPPLIER_GROUPS_ENABLED=1`（同样配白名单）。在询价抽屉里建一两个分组、填关键词；下一个标批准分析后，看起草的卡是不是给了对的那一组。
3. `TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED=1`（同样配白名单）。先在抽屉里手动发一轮并勾选自动跟进，观察一轮催单；满意后再到询价区块顶部开启个人开关，让自动起草的卡也带授权。
4. 任何一步不满意：把对应的环境变量删掉或设为空并重新部署，行为回到打开之前；已保存的分组、已批准的轮次都留在库里，不丢。

另外两个与询价自动流无关、同样默认关的开关（可以在上面任何一步之前或之后单独打开，互不依赖）：

- `TENDER_WEB_NEXT_STEP_ENABLED=1`（FLOW-H1，可配 `TENDER_WEB_NEXT_STEP_ORG_ALLOWLIST`）：招投标项目的工作台顶部多一张「下一步」卡片。只读、只指路。同一个开关还管 FLOW-H1b：项目页的阶段与进度条按实际进度显示、三步卡让位（只改显示）。打开后先看三四个处在不同阶段的真实的标，卡片说的与实际是否对得上；对不上就关掉，没有遗留数据。
- `TENDER_BID_WORKSPACE_ENABLED=1`（TI-4a，可配白名单）：投标工作区。FIX-2 的「从招标分析带入」按钮在它里面；卡片里的阻断项与「价格表还没录」也要它开着才出现。

### 0.5c 三项做完之后（2026-11-12）

§0.5b 的三项都已合并并归档。下面是本会话推荐的下一批；Lucas 2026-11-12 说「按照你的推荐开始吧」，三项按顺序在做，每一项仍是一个 change、一个 PR。各项的进展写在「备注」一栏的末尾。

| 推荐顺序 | 做什么 | 为什么 | 备注 |
|---|---|---|---|
| 1 | **H1 的后半：六段进度条从同一张表推导，取代工作台三步卡。** | 现在同一页上仍有三个地方说进度（卡片、决策摘要的「当前处于某某阶段」、三步卡），阶段靠手工推进，会与卡片说的不一致——FLOW-H1 的截图里就能看到（卡片说「报价齐了」，摘要标题还是「项目分发」）。 | 会动 `src/lib/tender/stage*.ts` 与阶段任务，面比 FLOW-H1 大；动手前先定「阶段还要不要人工确认才前进」 **已完成（FLOW-H1b）**：#443 2026-11-12 合并，已归档（`2026-11-12-tender-web-progress-from-facts`）。做法与这里原先设想的不同——**只改显示，没有动阶段记录与阶段任务**：「下一步」接口多返回实际进度、同一时刻记录的阶段、显示的阶段三项；没结束的项目显示两者里靠后的那个，已结束的显示记录的；不一致时项目进度区写明；有卡片时三步卡不渲染。沿用开关 `TENDER_WEB_NEXT_STEP_ENABLED`。「阶段要不要自动前进」没有做，等 Lucas 定（见下） |
| 2 | **提交环节（方案 H4）：页面上能记「已提交」并留回执；交付前检查清单由已确认的强制要求确定性生成。** | 卡片现在遇到「截标日期已过、没有提交记录」只能指到关键日期——页面上没有「标记已提交」的按钮，提交时间只能靠在对话里推进阶段写入。 | 零 schema（回执存既有文件与审计）；不自动提交 **拆成了两个 change**（调查发现这件事比原先写的大，要点见表后）。**FLOW-H4a `tender-submission-record`：PR #446 待审**——接口 `GET` / `POST …/submission-record` 与「提交」页签的「提交记录」；第一次记录走既有的阶段推进（时间用人填的），更正与补记只改提交时间；每次追加一条审计行；新开关 `TENDER_SUBMISSION_RECORD_ENABLED` 默认关；第一次记录不能撤销；回执文件上传没做。**FLOW-H4b `tender-submission-checklist`：分支 `claude/flow-h4b-checklist`，没开 PR**——已有：四件套；规则 `src/lib/tender-submission-checklist/contract.ts`；取数与标状态的服务和两个接口（`GET …/submission-checklist`、`PUT …/items/[key]`，状态存进 `TenderDeliverable.status`）；模型清单接口在开关开启时返回 409 不调模型；组件 `src/components/tender/submission-checklist-card.tsx`；测试三份（纯逻辑 37、隔离库 30、渲染 21）。**还差**：#446 合并后把分支并上最新的 main，在 `submission-tab.tsx` 里挂上组件（开关可用时不显示 `BidChecklist`），真实浏览器截图，变异核对，独立审查，报告与 TASKFLOW 行，开 PR。新开关 `TENDER_SUBMISSION_CHECKLIST_ENABLED` |
| 3 | **把三处旧的行锁从 `FOR UPDATE` 换成 `FOR NO KEY UPDATE`**（斑马帘比例、质保设置、能力配额策略）。 | FIX-3 的独立审查证明 `FOR UPDATE` 会与外键检查互斥、引出死锁；新的写入入口已经换了，这三处是遗留。 | 很小；不在招投标范围内，所以单列出来等点头 **已完成（FIX-4）**：#444 2026-11-12 合并，已归档（`2026-11-12-org-row-lock-no-key-update`）。三处四条语句改为调用 `lockOrganizationRow`；守卫禁止再对组织行用 `FOR UPDATE`。没有开关，已随合并生效。注意：左边「引出死锁」的说法对这三处不成立（独立审查在旧代码上试了 98 轮没造出），实际解决的是互相卡住（约 920 毫秒 → 约 40 毫秒） |

**第 2 项（提交环节）的现状调查要点**（2026-11-12，免得下次重查）：

- 写「提交时间」的路径只有一条：`POST /api/projects/[id]/advance-stage` → `advanceProjectStage()`（`src/lib/tender/stage-transition.ts`）。页面上唯一调用它的是对话抽屉里模型给出的「阶段推进建议」卡片；项目页没有按钮。`PATCH /api/projects/[id]` 明确拒绝写阶段时间。「提交」页签上那句「提交/开标日期在关键日期里维护」对提交时间是错的。
- 这条路径的副作用：时间只能是「现在」（记不了过去的提交时间）；同时把招投标状态写成 `bid_submitted`；发 3–4 条讨论区系统消息、一条高优先级成员通知、（有来源系统时）BidToGo 回调；**在标记已提交之后**自动建「准备投标文件」「提交投标」两条任务；没有撤销；可以从任何更早的阶段直接跳到提交，中间阶段的时间留空。
- 「提交」页签上的「投标准备清单」是模型生成的（`/api/projects/[id]/checklist`，提示词只看项目概况、任务、询价、成员、文件名，**不看要求与交付物**），而且打开项目页约 0.8 秒后会自动触发一次；只要有读权限就能触发。存成一条 `source = "ai_checklist"` 的项目文件。
- 已经有一份确定性的提交清单：分析时由 `buildSubmissionChecklist` 从强制的、类别属于提交类的要求生成，存在分析的 `summaryJson.submissionChecklist`，并投影成 `TenderDeliverable`。但它定格在分析那一刻，**不反映之后人的确认与驳回**；交付物的状态没有写接口。
- 回执没有现成的落点：项目文件没有类别或元数据列，走现有上传接口会触发招标分析、计入文件包、通知成员；可用的零 schema 落点是审计日志、讨论区系统消息的 `metadata`、`BidIntelligenceRoom.summaryJson` 里自己的一块（投标工作区已经这样用，带行锁）。`src/lib/tender-price-schedule/closing-time.ts` 里已有回执的形状 `SubmissionRecord { submittedAt, receiptRef }`（「只有带平台回执的才算数」），但投标工作区从不把它传给可投标判定，所以截标之后「已过截标」的阻断项永远出现。
- 阶段推进、放弃项目、清单接口都没有测试。

Lucas 2026-11-12 已回答的三个问题（「1.要修，要这些组队任务 2.需要 3.暂时不管工艺单」）：

- **阶段推进之后「为新阶段建任务」一直失败** → 修，要这些任务：**FIX-5 `stage-tasks-create-fix`，PR #447**（没有开关，合并即生效）。不再写不存在的 `sortOrder`；「准备投标文件」「提交投标」挪到供应商报价阶段（我的建议，可改回）；「提交投标」到期日取截标时间、截标还没到时任何任务都不晚于截标；进入新阶段时关掉之前**所有**阶段还没完成的自动任务（独立审查复现了只关上一阶段会留下永远逾期的任务）；同一项目加咨询锁查重；已放弃的项目不建，放弃项目时把还没完成的自动任务标为已取消。项目里所有成员都会收到这些任务的到期提醒。
- **要不要让阶段记录自动前进** → 要：**FLOW-H1c `tender-stage-auto-advance`，PR #449**（开关默认关，依赖 #447 先合并）。分析完成 → 项目解读；询价执行这一次真的发出 / 人工标记已发送 → 供应商询价；没取消的轮次里第一次录入报价（人工或回信解析）→ 供应商报价。只在写上之后阶段记录会变靠后时写；不改招投标状态、不发 BidToGo 回调、不发讨论区消息与通知；写一条系统审计 `tender.stage.auto_advance`。
- **Sunny 工艺单那份隔离库测试在 main 上本来就失败** → 暂时不管。

仍然等 Lucas 明确决定、本会话不会自己动的：

- ~~**FIX-6（#450）没有开关**~~（Lucas 2026-11-12：「不用加开关，按照你推荐的做吧」——已定，不加）：人确认推进到已到（或已过）的阶段、招投标状态落后时，补成人确认那一段的状态，并在有来源系统时发 BidToGo 回调——以前这一下什么也不发生。（原来的待定「供应商报价状态到不了」由它解决；调查发现最常见的是「不允许回退」那一种：状态还是新导入、记录已在供应商询价、AI 提议项目解读。）要不要加开关，等 Lucas 拍板。#446 合并后，要在「记录提交」调用推进的地方加一道检查（见 FIX-6 报告 §3.3）。

- **生产开关**（上一小节）：本会话没有权限，也不该碰。
- **成本输入落库**：要新增一张表，违反零 schema，须明确说「批准为成本输入新增一张表」。
- **谁可以把证书标成「已核验」**（TI-4c 报告里留的问题）。

**这一轮的教训**（接着 §0.2 的三条）：

- 四、**改对外发送的审批方式，开 PR 前必须请一个不带结论的独立审查。** RFQ-AUTO-1 自测全绿（51 项 + 真库 23 项）之后，独立审查仍找到 6 处真实问题，其中两处能让「人批准的」和「实际发出的」不一致：正文里的供应商名称、发件人、回复截止在批准之后别人能改；带授权的卡能在 Muse 里只看标题就批。修完后是 62 项 + 真库 28 项。审查的提问方式：只给代码和要找的失败类型，不给自己的结论。
- 六、**用真实应用走一遍，会碰到测试环境碰不到的东西。** RFQ-AUTO-2 的测试全绿之后，本地开发模式下第一次点「批准分析」得到的是「起草失败」：建审批卡被既有的「非生产环境写入保护」拦住了（测试环境不受它限制）。本地起服务截图时要加 `QINGYAN_ALLOWED_DB_ENDPOINT_PREFIXES=localhost`。另外，开发服务器的构建缓存损坏会让个别接口返回 404 页面，清掉 `.next/dev` 重启即可。
- 七、**动手之前先看界面上人实际怎么操作。** RFQ-AUTO-2 的四件套假设「批准分析之后还会逐条确认要求」，实际界面批准之后就不给按钮了。这是写完代码、起真实应用截图前核对界面才发现的，改了起草条件并重新请 Lucas 定。下次写触发条件之前先读对应的组件。
- 九、**对源码文本的断言测不出行为上的毛病。** RFQ-AUTO-4 的面板断言起初全是「这一行代码还在不在」，独立审查指出它们抓不住「提示被后面的批次冲掉」「响应看不懂被当成确认 0 条」这类问题。能从组件里抽出来的逻辑（这里是分批提交的循环）要抽成纯函数，用假的接口做行为测试；源码断言只用来防「有人把这一行改掉」。
- 八、**放进共享的大 JSON 之前，先查清楚还有谁在写它、怎么写。** RFQ-AUTO-3 原稿把个人开关放在 `Organization.settingsJson` 里，理由是「零 schema 的合规落点」。独立审查查了所有写入方，发现大多是不加锁的整块回写——对一个表示「同意」的开关来说，被悄悄恢复成开是不能接受的。改成只追加的记录。凡是「撤回必须可靠」的状态，都不要放进会被别人整块覆盖的地方。
- 十、**写四件套之前先跑 `openspec instructions <proposal|design|tasks> --change <name> --json`，照它返回的 rules 写。** 这个项目对四件套有固定要求（design 必须有「与八条硬纪律的关系」「验证方式」两节；tasks 每条自带 verify、不超过 8 条；Why 不超过两句）。RFQ-AUTO-5 与 RFQ-AUTO-3a 的四件套是在会话上下文被压缩之后凭印象写的，这几项都漏了，是 RFQ-AUTO-3a 的独立审查读 `openspec/config.yaml` 时发现的；两个 change 都在各自的 PR 里补齐了。`openspec validate --strict` 不检查这些，所以通过校验不等于合规。
- 十一、**「最近一条记录即状态」必须自己保证先后，不能靠记录时间。** 审计记录的时间是写入那台服务器的时钟给的。RFQ-AUTO-3 的个人开关与 RFQ-AUTO-5 的供应商分组都踩了：时钟不一致时，后写的排到前面去，「保存成功却不生效」。修法是持有本人的锁时明确给时间（至少比上一条晚 1 毫秒）。「有没有某条记录」这种判断（RFQ-AUTO-1 的停止）不受影响。
- 十二、**改 MODIFIED 的要求时留意长度。** 主规格里一条要求的正文超过 500 字，`openspec validate --specs --strict` 会判不通过，而 change 的增量校验不查 MODIFIED 的长度——归档之后主规格才变红。RFQ-AUTO-5 归档时撞上了（「起草条件」加了分组的内容后超长），在归档的 PR 里把分组那一段拆成单独的一条要求后再归档。
- 十三、**「取一个值」的规则要写成白名单，不要写成「排除几种不对的」。** FIX-2 第一版的数量规则是「文字里恰好一个数字就取、金额和百分比除外」，独立审查跑出四十多种会悄悄取错的写法（`5k`、`12 dozen`、`Item 3`、`Dec 2026`、`CAD 5000`、`50 per month`）。改成「整段文字必须就是：可选的前缀 + 一个数字 + 可选的认得的单位」之后，这些一次全挡住。取错比不取糟：行看起来是好的，人未必会去对。
- 十四、**测试写完做一遍变异。** 把实现逐处改坏（加一个自动保存、让确认不出现、放宽状态过滤），看有没有测试失败。FIX-2 第一版的四项测试对「带入之后自动保存」完全没有反应；改成「带入那段代码里不许出现保存的动作」加纯函数之后，30 处变异全部被发现。脚本的写法在 FIX-2 的报告 §5 里。
- 十五、**测试里的状态值要从真实的流程里来。** FIX-2 第一版用 `status: "CONFLICT"` 的要求测「有冲突的不收」，而真实流程里要求从来不会是这个状态（冲突的两条都是 `NEEDS_REVIEW`）；分析的状态用了不存在的 `RUNNING`。结果规格写的行为根本没被测到。能调真实的上游函数（去重、补遗处理、审核）就调它，状态清单从常量里取。
- 十六、**给人指路的话，只说现状，不说系统「会」做什么。** FLOW-H1 第一版写过「定时检查会给其中 N 家起草催单」「系统不会再催」「批准之后才能询价」，独立审查逐条证明在某些情况下是错的（邮箱没连、催单被驳回过、这一轮有授权；询价入口看的其实是已确认的要求）。写这类话之前先去读它说的那个功能自己的判断函数；读不全就不写。
- 十七、**页内定位用的 `id` 要放在「没有数据时也会渲染」的元素上。** FLOW-H1 第一版把「去问供应商要价」指到轮次列表的 `id`，而还没有轮次时那个列表不渲染——恰好是最需要这次点击的时候。测试只查了「文件里有这个字符串」。现在的测试核对它在区块的根元素上，并在真实浏览器里核对点击之后按钮在视野里。
- 十八、**改页面文件之后，一定在真实浏览器里把页面打开一次。** FLOW-H1 修审查发现的时候，一次按「从 A 标记到 B 标记」的整段替换把项目页的 `export default` 一并删掉了，还推了上去。类型检查、lint、整份单元测试子集全部通过——页面没有默认导出不是类型错误。是重拍截图时浏览器报出来的。整段替换前先看一眼被替换的那一段里有什么；页面文件现在有一条断言盯着默认导出。
- 十九、**测试里的日期一律相对当前时间算，不要写死。** FLOW-H1b 的新测试把截标日期写成了 38 天后的一个固定日子，而进度条的状态要看真实的时钟——到那天之后 CI 会对所有人变红。独立审查把时钟往后拨才发现。
- 二十、**页面手上的数据可能比接口返回的旧，不要拿两边去比。** FLOW-H1b 第一版让页面用自己加载的项目数据算「记录的阶段」，再与接口给的实际进度比；而批准询价、分析完成都会在后台把阶段记录往前写，页面手上的不会跟着刷新，于是那行说明会说「记录没有自动推进」——其实已经推进了。改成同一个接口在同一时刻把两边都读出来、把结论也算好。
- 二十一、**从别处抄来的理由要自己验证一遍。** FIX-4 的四件套照着上一轮交接文档写了「`FOR UPDATE` 会引出死锁」，还配了一个「并发不死锁」的测试。独立审查把这个测试放到旧代码上跑，照样通过——那三处根本造不出死锁，真正的毛病是互相卡住。**一个用来证明「修好了」的测试，先在没修的代码上跑一遍，看它是不是真的会失败。**
- 二十二、**页面上填的时间，要按所填那一天的时区偏移换算，不能拿「今天」的偏移。** FLOW-H4a 第一版用 `new Date().getTimezoneOffset()` 去换算人填的日期：在 11 月（标准时间）补记 10 月（夏令时）的提交，会整整错一小时。自测与真实浏览器都没发现（填的都是当周的日期），是独立审查把时区设成多伦多才跑出来的。测试要在一个有夏令时的时区里、取夏令时两侧的日期各核对一次。
- 二十三、**想依赖的「既有行为」，先跑一遍确认它真的存在。** FLOW-H4a 的理由之一是「不要在已提交之后再建『提交投标』的任务」，测试也断言「没有建」。实际上建任务那一步在 main 上一直是坏的，带不带那个参数测试都通过。写「不发生某事」的断言之前，先让它在对照组里发生一次。
- 二十四、**一个 change 依赖另一个还没合并的 PR 时，照实写合并顺序，测试在合并后的代码上验证。** FLOW-H1c 要调用 FIX-5 修好的建任务；不叠层（直接指向 main），而是在一个临时工作区里把 FIX-5 的分支并进来跑隔离库测试与变异，PR 最上面写明「#447 先合并」、单独跑时哪几项会失败、为什么。
- 二十六、**TASKFLOW 编号开工前先在最新的 main 上查一遍，开 PR 前再查一遍。** 本任务的「修好阶段任务」用了 FIX-5，另一个会话同一天也用 FIX-5 做了别的、并先合并，报告文件同名冲突。改号要连带改：报告文件名、四件套、测试名、TASKFLOW 行、引用它的别的 change 与报告。
- 二十五、**「只写时间、不动任务」也可能把阶段记录往回拉。** 阶段记录先看时间、没有时间才看招投标状态；对一个只有状态（例如已提交）、没有任何阶段时间的项目写上「供应商报价」的时间，阶段记录就从「项目提交」退回「供应商报价」。凡是往阶段记录里写时间，先算写上之后的阶段是不是更靠后。
- 五、**在容器里跑过 `next dev` 之后，`.next/dev/types` 可能留下损坏的生成文件，让 `npm run typecheck` 报与源码无关的错。** 删掉 `.next/dev` 重跑即可；直接 `npx tsc` 会内存溢出，要用 `npm run typecheck`。

### 0.5d §0.5c 做完之后（2026-11-15）

§0.5c 的三项都已合并并归档（FLOW-H1b #443、FIX-4 #444；提交环节拆成 FLOW-H4a #446 与 FLOW-H4b #454），途中按 Lucas 的回答另做了 FIX-7 #447、FLOW-H1c #449、FIX-6 #450。方案 §7 的 H1、H4 已做完；还没做的是 H2、H3、H5–H8。Lucas 2026-11-15：「454已经合并，继续按照你推荐的做」。推荐顺序（每项一个 change、一个 PR，直接指向 main）：

| 推荐顺序 | 做什么 | 为什么 | 备注 |
|---|---|---|---|
| 1 | **FLOW-H4c：提交记录接进可投标判定。** 有了提交记录（FLOW-H4a）之后，截标已过不再报「已过截标」的阻断项。 | §0.5c 调查要点第 5 条：`closing-time.ts` 早有回执的形状，但投标工作区从不传给可投标判定，截标之后这条阻断项永远出现——交完标的项目也一样。 | 小；零 schema；读 FLOW-H4a 已经写下的审计行。H4 的收尾 **已完成**：#459 2026-11-15 合并，已归档（`2026-11-15-tender-readiness-submission-record`）。独立审查后加了第三种判定「已交标（仅供复盘）」，免得交完标的项目显示绿色的「可提交 Owner 决定」 |
| 2 | **H3（按调查结果改写）：询价发出之后招标分析更新过，在那一轮上标出来。** 某一轮询价发出之后，又有一份更新的可用分析（补遗或重新分析），就在该轮上写明「这一轮是在分析更新之前发出的，引用的要求可能变了，请核对」。不说具体哪条变了。 | 断点 G6。原写法（「接受补遗变更后受影响的要求回到待确认」「已发询价引用了被改的要求就标出」）的前提在代码里不成立，见表后「H3 调查要点」。 | 只提示，不自动重发（出站先审批）；零 schema（按轮次的发出时间与分析的创建时间判断）。V2 补遗变更候选的显示另算，见要点第 3 条 **已完成（FLOW-H3）**：#464 2026-11-15 合并，已归档（`2026-11-15-tender-rfq-round-analysis-update-note`）。独立审查后改为与询价单用同一份分析、批准也算更新、另发一轮后不再提示 |
| 3 | **H5：两道闸生效。** No-Go 之后询价与草稿入口给出明确提示；未批准的分析生成草稿时标明「基于未确认的要求」。 | 断点 G4、G5。 | 方案 §9 第 6 条「拦还是只提醒」：本会话推荐**只提醒**（不拦），PR 最上面写明，Lucas 可改 |
| 4 | **H2 / W-3：比价所选供应商的落地价接进定价助手的成本来源。** | 断点 G2。 | 涉及价格计算（要分清毛利率、成本加成、海运、关税、可抵扣税款），先写四件套给 Lucas 看再实施 |

**H3 调查要点**（2026-11-15，只读调查，免得下次重查）：

1. **生产上没有「增量分析」**：唯一会选 INCREMENTAL 的 `detectRunKind` 只有测试在调；建分析时写死 `runKind: "FULL"`、`parentRunId: null`（`enqueue-package.ts`），新的一份用 `supersedesRunId` 取代旧的。所以补遗来了 = 一份新的完整分析，全部要求重新抽取、都是待确认（`v2-persist-core.ts` 先删后建，`reviewStatus: "AI_EXTRACTED"`）——「受影响的要求回到待确认」已经发生，而且是全部。
2. **要求跨分析没有稳定的标识**：只有 `requirementCode`，V2 里是去重之后按位置编的 `R-001…`，两份分析里同一个编号不一定是同一条。
3. **补遗变更候选**（`TenderAnalysisChangeCandidate`）：V2 在完整分析里也会写（来自模型的 `addendumChanges` 与没解决的冲突，没有前后对照）；页面只在增量分析时显示它们（`analysis-panel.tsx`），所以生产上看不到。「接受」只把候选标为已接受，不改任何要求（代码与接口都写明了），也不留审计。要不要显示、按钮怎么办，单独定。
4. **询价轮次不记它用了哪些要求**：`ProjectInquiry` / `InquiryItem` 没有要求、分析的字段；审批卡载荷只存渲染好的邮件正文（强制条款的编号能从正文里正则取回，评分条款取不回），不存分析的 id。
5. 投标工作区的「补遗」（TI-4c）是人手录入的、按价格表行号，与分析的变更候选没有关联。

H6（跨项目询价追踪页，T-2）、H7（前接发现，P2-1～P2-3）、H8（RFQ 设置页，W-2）在 TASKFLOW 里各有任务书，不在这一批。

### 0.5e 报价表助手两项修复（FIX-8、FIX-9，2026-11-15）

**授权（Lucas 2026-11-15）**：「你自己做好 hand off，这个项目中的 PR 你自己盯，自己合并，你全权负责。如果有方案，都按照推荐的走。」——本条线上的 PR 由会话自己盯 CI 与评审、自己合并（合并方式沿用 merge commit），有多个方案时按推荐的走。部署、生产数据、对外发送不在这条授权里，仍按 §5。

| 项 | 做了什么 | PR | 状态 |
|---|---|---|---|
| FIX-8 | 报价表助手保存不再整块替换 `pricingInputs`，保留报价引擎镜像的我方报价（`ourPrice*`）；报告 `docs/QINGYAN_FIX-8_REPORT.md` | #478、归档 #479 | 已合并并归档（`2026-11-15-pricing-helper-save-keeps-bid-mirror`） |
| FIX-9 | 保存与重新推导的写入与报价同步串行：事务里先拿报价引擎的项目行锁（导出 `lockProject`），再重读、只改自己的键、写回；模型调用与比价取数在锁外；与 FLOW-H2（#476）的成本来源合在一起；报告 `docs/QINGYAN_FIX-9_REPORT.md` | #483、归档（与本节同一个 PR） | 已合并并归档（`2026-11-15-pricing-helper-write-lock`） |

接手要知道的：

1. `BidIntelligenceRoom.summaryJson.pricingInputs` 现在有三个写入方：报价表助手的三项人工输入、FLOW-H2 的 `ourCostSource`、报价引擎的 `ourPrice*` 镜像。**谁写都要先 `lockProject`、再重读、只改自己的键**（报价引擎与报价表助手已经这样做）。`summaryJson` 的其它键（情报、分析写的）的写入方还没有拿这把锁——是已知的余项，没开 change。
2. 推导的 60 秒频控在锁外判断，两个推导同时到达可能都调一次模型（与以前相同，没修）。
3. 本地跑隔离库测试的做法（云容器里验证过）：
   - `npm ci`；`npm i -g @fission-ai/openspec@1.15.0`（`npx openspec` 在没装依赖时找不到可执行文件）。
   - 容器里有 Postgres 16 但默认没起、没有 pgvector：`service postgresql start`；`apt-get install -y postgresql-16-pgvector`；建库后 `npx prisma migrate deploy`。容器休眠后 Postgres 会停，重新 `service postgresql start` 即可（库还在）。
   - 环境变量：`DATABASE_URL` / `DIRECT_URL` 指向 `localhost`、`NODE_ENV=test`、`DATABASE_ENVIRONMENT=isolated`、任意 32 字节以上的 `JWT_SECRET`。`assertSafeTestDatabase` 对 localhost 放行。
   - 全量 `npm test` 约 25 分钟。main 上本来就失败的 9 项与偶发的 1 项列在 `docs/QINGYAN_FIX-9_REPORT.md` §5，比较时先对照这份清单。
4. 写并发测试时，路由第一次调用很慢（加载模块、建连接），会让「持锁期间发起」的交错不成立；先预热一次（见 `pricing-helper-lock-db.isolated.test.ts`）。

### 0.5f §0.5d 做完之后：授权与下一批（2026-11-15）

**授权（Lucas 原话；另一条线 FIX-8 / FIX-9 记在 §0.5e 的是同一次授权）**：「476、481可合并后，你自己去合并，继续按照你推荐的做」；「如果有新的四件套或者是其他的方案，都按照你推荐的走。你自己做好 hand off，那你全权负责这个项目」。

据此的做法：
- 四件套与方案按 Claude 的推荐直接实施，不再单独等审；涉及价格计算的也一样，但取舍照旧写在 PR 最上面。
- Claude 合并自己的 PR：CI 绿、没有冲突、开 PR 前的独立审查已处理之后合并（用 `merge`，带 `expectedHeadSha`）。归档 PR 同样。
- **仍要 Lucas 明确同意才做的**（任务书与 `openspec/config.yaml` 的硬约束，这次授权没有解除）：生产部署、生产开关与生产数据、生产迁移、对外发信 / 询价、付款、正式投标、凭据。所有新功能照旧默认关或只对管理员可见。
- 交接文档由 Claude 每次合并后更新（「最后更新」、本节、TASKFLOW 状态列）。

**下一批（按推荐顺序）**

| 顺序 | 做什么 | 为什么 | 状态 |
|---|---|---|---|
| 1 | **W-2：组织页「询价与落地价设置」**（发件三项、汇率连同日期与来源、运费 / 保险 / 清关、项目关税率与交付截止） | 没有页面，FLOW-H2 的落地价在多数组织里「换算不出」 | 已合并并归档（#487；报告 `docs/QINGYAN_W-2_REPORT.md`） |
| 2 | **T-2：询价追踪页 `/bids/rfq` 与 `/bids` 汇总卡**（需要我处理 / 等回复 / 已报价 / 未响应；下次自动催的日期；落地价取比价矩阵） | 任务书 `docs/QINGYAN_T-1_T-2_RFQ_TRACKING_TASKBRIEF.md` §3 已由 Evan 拍板；T-1 已完成 | 已合并（#491）并归档（`2026-11-15-rfq-tracker`）；报告 `docs/QINGYAN_T-2_REPORT.md` |
| 3 | **W-2b：回复提前量 / 轮次锁 / 催单天数可在页面上改**（先扩 PUT） | W-2 的余项 | 已合并（#492）并归档（`2026-11-16-rfq-timing-settings`）；报告 `docs/QINGYAN_W-2b_REPORT.md` |
| 4 | H7（前接发现 P2-1～P2-3：CanadaBuys 开放数据每日拉取 → 匹配打分 → 早报跟标） | 范围大，涉及外部数据源；P2-1 的大半已由 PROC-1 做完 | 只读调查 `docs/QINGYAN_H7_INVESTIGATION.md` 切的 5 个 change 里 4 个已合并并归档：P2-3a 跟这个标（#496）、P2-1 新标视图与每天排期（#502）、P2-3b 早报（#511）、P2-2 匹配度（#514，验收召回待名单）；另修 P2-1b 截标时区（#508）。P2-3c 自动拉附件先不做；P2-4 另立。需 Lucas：生产外部情报开关现值、开放数据许可、召回用的 10 个历史投标、生产部署 |

### 0.5g 调查室 summaryJson 的写入（FIX-10、FIX-11，2026-11-16）

接 §0.5e 第 1 条余项。Lucas 2026-11-16「继续按推荐的做下一项」；同一天另一个会话在做 H7 的 P2-1 收尾（分支 `claude/p21-new-notice-view`），本条线只动调查室 `summaryJson` 的写入，不碰采购监控。

| 项 | 做了什么 | PR | 状态 |
|---|---|---|---|
| FIX-10 | **数据丢失**：每次分析跑完的投影把 `BidIntelligenceRoom.summaryJson` 整块换成这次分析的摘要——每来一份补遗、每重新分析一次，报价表助手的输入、镜像的我方报价、投标工作区价格表、跟标都被清空；开始投标调查在已有房间时同样整块换掉。新增写入入口 `src/lib/tender-room/summary-json.ts`，两处改走它；投影记 `projectedKeys`，下次只去掉其中这次没有的。报告 `docs/QINGYAN_FIX-10_REPORT.md` | #498、归档 #500 | 已合并并归档（`2026-11-16-room-summary-merge-write`，规格 `openspec/specs/tender/room-summary`） |
| FIX-11 | 其它 7 个写入方（跟标检查 / 设置、外部情报、投标草稿、分析备忘、外部情报确认、投标工作区）改走入口；投标工作区原来与报价同步会死锁；守卫测试拦住新的直接写法。报告 `docs/QINGYAN_FIX-11_REPORT.md` | #504、归档（与本节同一个 PR） | 已合并并归档（`2026-11-16-room-summary-writers-lock`） |

接手要知道的：

1. **写调查室 `summaryJson` 一律用 `patchRoomSummary` / `patchRoomSummaryTx`**：锁项目行 → 重读 → 只给出要设 / 要去掉的键；依赖旧值的计算放进 patch 函数里做；模型调用与外部请求放在调用之前。守卫测试 `src/lib/tender-room/__tests__/summary-write-guard.test.ts` 会拦住直接写法；确需例外（自己先 `lockProject` 的）要写进守卫的名单并说明。
2. 已经被清空的房间没有补数据。生产上有多少房间受过影响，看不到（没有生产连接）；要查可以比对「有 `projectedFromRunId` 但没有 `pricingInputs` / `bidWorkspace`」的房间，需要 Lucas 授权读生产。
3. 写这类交错测试：先预热一次路由；会被数据库中止的那一边立刻 `.then(v => v, e => …)` 接住；比较 `jsonb` 读回的对象要先按键排序（Postgres 不保留键的顺序）。
4. 生成的建议任务「Lock project row in pricing-helper save」（session `…D3tKEskbiukXzwWpp`）已被 FIX-9 做掉，那个会话里的计划可以丢弃。

### 0.5h 情报串联（CHAIN，2026-11-19）

任务书：`docs/QINGYAN_CHAIN_TENDER_INTEL_CHAIN_TASKBRIEF.md`（当天 13:05 修订版：新增 CHAIN-0c 与判断点 8）。TASKFLOW：Phase F（续）— 情报串联。

**授权（Lucas 2026-11-19）**：「这个更新你全权负责，开 PR 和合并你自己定，按照你推荐的去做，做好 HAND OFF，交叉验证」。本会话据此：CHAIN-4b、CHAIN-0c 的四件套按推荐定、自己实施、经独立审查后**自己合并**，归档也自己合并。仍不做：生产环境变量、部署、对外邮件、付费数据；判断点 2（改 T4 冻结服务白名单）任务书写明「需要你明确批准」，不算在这次授权里。

**授权续（Lucas 2026-11-19 / 11-20）**：「接着做 CHAIN-4a……之后是 CHAIN-1、2、3。判断点 2 要改 T4 冻结服务的白名单这个授权也给你，你全权负责」；「开始按照这个开始实现 Chain-3 还是按照流程。你全权负责合并，分多个子 agent 多维度审核提意见修复，做好 hand off」。据此 CHAIN-4a / 2 / 3 的实现与归档都自己合并；判断点 2 的授权**没有用上**（CHAIN-1 没有数据源，白名单没改）。

**新规则「多维审查」（Lucas 2026-11-19 定，#528 写进 `openspec/config.yaml` 工作约定与 `CLAUDE.md`）**：每次开 PR 前并行派子 agent 各审一个维度（实现 PR 至少四个：正确性与回归、安全 / 隐私 / 硬纪律、规格—代码—测试一致性、使用流畅与文案），（惯例，规则原文只写「各自独立审查本次 diff」：）只给代码与规格、不给结论；逐条核实后修，重跑测试；PR 正文要有「多维审查」一节（维度 / 发现 / 处理）。归档 PR 至少一个子 agent 核对主规格与增量、TASKFLOW 状态。

**已完成**

| change | PR | 状态 |
|---|---|---|
| CHAIN-4b `rfq-supplier-identity-guard`（询价与供应商侧文件不带出招标身份；顺带堵住旧路径把预估金额 / 我方报价 / 中标价印给供应商） | #522（合并）、#523（归档 + 任务书修订版） | `[x]`；**staging 真实标包实测未做**（报告 §6），做完前不开 CHAIN-0 第 7 项 |
| CHAIN-0c `tender-job-failure-surfacing`（分析 Job 失败 / 卡住立刻收尾为「AI 分析未完成」并通知） | #524（合并）、#525 归档 + 本节 | `[x]`；生产事件实际走的路径待生产记录（报告 §2） |
| CHAIN-4a `rfq-supplier-attachment`（询价邮件带一份重排的询价单 PDF；判断点 5 按 A） | #526（合并）、#527（归档） | `[x]`；开关 `TENDER_RFQ_ATTACHMENT_ENABLED` 默认关；载荷存的是附件 HTML 的 SHA-256（PDF 字节每次不同，报告 §1）；**staging 用测试邮箱收信核对未做** |
| CHAIN-1 `tender-award-source-apc`（Alberta APC 授标） | 没有 PR | `[ ]`，**前置核查不通过，已停**：APC 对匿名程序化访问返回 Cloudflare 人机验证（连 robots.txt）；Alberta 开放数据没有竞争性货物授标。见 `docs/QINGYAN_CHAIN-1_PRECHECK.md`，要人决定走书面许可还是人工录入 |
| CHAIN-2 `tender-auto-supplier-run`（批准分析后自动建候选池 + 寻源建议卡；情报推荐并入自动起草；判断点 1 按 A、4 按 B） | #528（合并，含规则「多维审查」）、#529（归档） | `[x]`；开关 `TENDER_AUTO_SUPPLIER_RUN_ENABLED`、`TENDER_RFQ_INTEL_RECIPIENTS_ENABLED` 默认关，另要 `SUPPLIER_INTEL_ENABLED` |
| CHAIN-3 `tender-import-leads-connector`（进口记录人工导入 → 比对历史中标者 → 按出口商汇总 → 加入供应商库；判断点 3 按 A、7 按 A） | #530（合并）、#531（归档 + 本节） | `[x]`；开关 `TENDER_IMPORT_LEADS_ENABLED` 默认关；系统不访问任何第三方网站、不调模型；进口线索的供应商**不**自动进自动起草（design D4b，任务书验收项只做到一半，报告 §1） |

**等人做的（需要生产权限）**

1. CHAIN-0 核查表 `docs/QINGYAN_CHAIN-0_ENV_CHECK.md` 第 2–7 项（第 1 项已验证）。注意 `TENDER_EXTERNAL_INTEL_ENABLED` 只认 `1`；`SUPPLIER_INTEL_ORG_ALLOWLIST` 留空 = 全组织生效。
2. CHAIN-4b staging 实测：TBS 24062-27-057 与一个 Alberta 标各起草一次询价、生成一次「供应商询价与符合性确认表」，结果补进 `docs/QINGYAN_CHAIN-4b_REPORT.md` §6（决定要不要做「本轮不带这几条要求」）。
3. 「12-01 21C31-254242」那个 Job 的 AgentRun `errorCode` 与事件（Vercel 2026-11-19 10:15–10:45 Warning / Error 日志），补进 `docs/QINGYAN_CHAIN-0c_REPORT.md` §2；第 3 步失败本身的原因若在模型侧，另立 change。（2026-11-20：Lucas 判断与「12-3」同一根因——切片被 300 秒硬杀，见 §0.5i 与 FIX-12 #540；记录仍未核对。）
4. CHAIN-4a staging：开 `TENDER_RFQ_ATTACHMENT_ENABLED` 后用测试邮箱收一封带附件的询价，在邮件客户端里打开核对中文与版式（任务书 `docs/QINGYAN_CHAIN_TENDER_INTEL_CHAIN_TASKBRIEF.md`「上线顺序」第 4 条；附件样子见 `docs/QINGYAN_CHAIN-4a_REPORT.md` §2）。
5. 开 CHAIN-2：先对 Sunny 开 `SUPPLIER_INTEL_ENABLED`（CHAIN-0 第 6 项），再开 `TENDER_AUTO_SUPPLIER_RUN_ENABLED`（同时把 `TENDER_AUTO_SUPPLIER_RUN_ORG_ALLOWLIST` 设成 Sunny 的组织 id——**本节提到的 `*_ORG_ALLOWLIST` 留空都等于全组织生效**）；`TENDER_RFQ_INTEL_RECIPIENTS_ENABLED` 等评估做起来、推荐稳定后再开。
6. 开 CHAIN-3：`T4_AWARD_INTELLIGENCE_SCHEMA_READY` 已开（才有中标者可比）后对 Sunny 开 `TENDER_IMPORT_LEADS_ENABLED`（`TENDER_IMPORT_LEADS_ORG_ALLOWLIST` 设成 Sunny 的组织 id），用 2–3 个真实标验证线索有没有用，再决定买不买授权贸易数据（判断点 3 B）。

**之后还有什么（2026-11-20，第四十四次）**——任务书的 CHAIN-0c / 2 / 3 / 4a / 4b 都已合并并归档，CHAIN-1 前置核查不通过已停（`[ ]`，没写代码）；剩下的都要人先拍板或要生产权限：

1. **CHAIN-1 走哪条路**（Lucas / Evan 定）：向 Service Alberta / 1GX 要书面许可或授标导出（拿到前不碰 APC）；或在授标记录里人工补录 Alberta 历史中标——**但现有入口做不到**（第四十四次核对）：`PROVINCIAL_MANUAL` 是采购监控的来源键，不是授标来源类型（`src/lib/procurement-records/watch-config.ts:57`；授标来源类型见 `src/lib/tender-intel/awards.ts` `AWARD_SOURCE_TYPES`）；授标历史面板只能确认 CanadaBuys 检索结果或 Web 线索里的对手名，带编号确认时一律记为 `CANADABUYS_OPEN_DATA`（`src/app/api/projects/[id]/external-intel/award-history/route.ts` 约 166–175 行），Alberta 编号会被标错来源。要走这条路，大概需要一个小的人工录入入口（另立 change，动手前先核对）。
2. **CHAIN-0b 自动分析也接续跑**（任务书后续队列）：先有人看 Vercel Request Logs 确认 `/api/cron/tender-auto-analysis` 是否还在用（上传后连续多条、每条接近 240 秒），确认在用再写任务书、`/opsx:propose`。
3. **GATE：别名裁决的权限**（CHAIN-3）：现在能修改本项目的人就能做对全组织生效、不能撤回的「疑似同一家」裁决（确认框写明了范围）；要不要提高到组织管理员、要不要做撤回，等 GATE 定。
4. **小 change（容器里能做，未开）**：
   - 报价表助手的落地价按财务权限收口：`GET /api/projects/[id]/pricing-helper` 在 `TENDER_PRICING_COMPARE_SOURCE_ENABLED` 开着时把比价矩阵的落地价给所有项目读者，而成本表接口与 CHAIN-2 寻源卡都按 `resolveFinancePrivilege(...).canReadAll` 收口。同一个 GET 不论开关都把已保存的 `inputs.ourCostCad`（我方成本）返回给项目读者，开关开着时 `compareCost.source` 里也带已记录的落地价——三处一起核对、一起收口（CHAIN-2 审查时发现，报告 §5；会话里只排成了建议任务「Gate landed cost in pricing-helper by finance access」，新会话看不到，以本条为准，未做）。
   - 主规格 `tender/rfq-web-entry` 第 6 条要求超过 500 字，`openspec validate --specs --strict` 143 过 1 不过（144 项，含本次归档的 `tender/import-leads`；只有这一条警告）。超长的是「原地审批与待批轮次保护」（522 字，CHAIN-4a 归档 #527 的 MODIFIED 增量把它从 351 字撑上去）；拆成两条要求即可，走一个只改规格的小 change。
   - 投标准备度「进口线索」阶段（`src/lib/tender-bid-readiness/stage-policy.ts`）还不读 CHAIN-3 导入的记录（CHAIN-3 Out of scope）。
5. **生产**：上面「等人做的」第 1–6 项。

以下是第四十三次写的 CHAIN-4a 要点，留作记录（基本按此实现；附件哈希一条有出入：载荷存附件 HTML 的 SHA-256，PDF 字节的 SHA-256 只进审计，因为同一份 HTML 两次转 PDF 字节不同，见 `docs/QINGYAN_CHAIN-4a_REPORT.md` §1）：

**（已完成）CHAIN-4a `rfq-supplier-attachment`**（询价邮件带一份重排的 PDF 附件）。判断点 5 推荐 A（只放重排的询价单 PDF）。要点：
- 附件只来自 `buildRfqDocument` 已筛好的 `lineItems`；出 PDF 前过 CHAIN-4b 的 `scanIdentity`（`src/lib/bid-workflow/project-identity-deny.ts`）+ 既有敏感词表；对供应商的称呼用 `identity.reference`。
- `SendEmailParams` 加 `attachments`、`buildRawEmail` 支持 multipart；不传附件时原始邮件逐字节不变（快照测试）。
- 附件字节 SHA-256 进载荷与 `rfqDocHash`；执行器发送前重新生成比对（执行器里已有 CHAIN-4b 的复核，附件比对加在它旁边）。
- 新开关 `TENDER_RFQ_ATTACHMENT_ENABLED`（默认关）。

之后按任务书顺序：CHAIN-1（先做 APC 匿名可读与使用条款的前置核查，要登录 / 人机验证即停）→ CHAIN-2（依赖 `SUPPLIER_INTEL_ENABLED` 已开）→ CHAIN-3。判断点 1、3、4、5、7 都有推荐项；判断点 2 取 A 需 Evan 明确批准。（第四十四次：CHAIN-1 前置核查不通过已停，CHAIN-2 / 3 已合并并归档，见上表；判断点 2 后来 Lucas 已授权，但没用上。）

**本会话的环境做法（容器里可复用）**

- Node 24：从 nodejs.org 下到 `/tmp/claude-0/node24/` 再加进 PATH（系统自带 22）；`npm ci` 后 `npx prisma generate`。
- 隔离库：本机 Postgres 16（`pg_ctlcluster 16 main start`），先 `apt-get install -y postgresql-16-pgvector` 才能 `prisma migrate deploy`；环境变量 `DATABASE_URL` / `DIRECT_URL` 指 localhost、`NODE_ENV=test DATABASE_ENVIRONMENT=isolated`，另要 `JWT_SECRET`（测试值即可）。Postgres 可能中途停掉，跑隔离库前先 `pg_lsclusters`。
- 全量 `npm test` 带隔离库约 1.5 小时；**不要同时在同一个库上并行跑别的隔离库测试**（本会话因此让 Mention Gateway M2-A 撞了唯一约束）。在本机 main 上也失败的 9 项名单见 `docs/QINGYAN_CHAIN-4b_REPORT.md` §5，比对时用。（第四十四次：现在是 11 项，CHAIN-3 时 701/712，名单见 `docs/QINGYAN_CHAIN-3_REPORT.md` §4。）
- 判重 / 查找类逻辑别靠「读最早 N 条」：CHAIN-3 第一轮审查就抓到查重只读 2000 条；按键用 `$queryRaw` 在 JSON 字段上查（`"rawMetadataJson"->>'dedupeKey' = ANY(...)`）。

### 0.5i 生产实测修复（FIX-12 / FIX-13，2026-11-20）

来源：Lucas 2026-11-20 生产实测（项目「12-3 Indoor Canadian Flag」，Job 09:27 创建）发现三件事：「各开一个 change、Draft PR，流程照旧」；第 3 件「只在交接文档里记一笔，不改」。FIX-12、FIX-13 与本文件的更新各用一个分支（名字从 `claude/amazing-planck-0s5wnb` 派生，都从 main `91d928e4` 开、直接指向 main、互不叠层，Lucas 同意）：FIX-12 Draft PR #540；FIX-13 四件套等审、还没开 PR；本文件的更新在 `claude/amazing-planck-0s5wnb-handoff` 单独开 Draft PR。**这次没有合并授权**：Draft PR 由 Lucas / Evan 看过后合并。

| 件 | change / TASKFLOW | 分支 | PR | 状态 |
|---|---|---|---|---|
| 1 一键分析第 3 步被 Vercel 300 秒硬杀（09:46:29、09:54:29 两次 504）；11-19「12-01」的「长时间没有进展」同一根因（Lucas 判断，「12-01」的生产记录本会话未核对，见 §0.5h「等人做的」第 3 条） | `tender-analysis-call-deadline` / FIX-12 | `claude/amazing-planck-0s5wnb` | Draft #540 | 已实施，**CI 通过**（2026-11-20 17:35 UTC），等 Lucas / Evan 合并；报告 `docs/QINGYAN_FIX-12_REPORT.md`。四件套 Lucas 同意；截止失败计入窗口 3 次上限同意；窗口开批门槛 45 → 80 秒是 Lucas 的建议、已采纳（design D8） |
| 2 招标文件「文件解析失败」不显示原因（上传 6、纳入 4，两份 `2026004-Appendix-B-RFP-e(PDF).pdf` / `-f(PDF).pdf` 被排除） | `document-parse-nul-and-reason` / FIX-13 | `claude/amazing-planck-0s5wnb-parse-error` | 未开（四件套已推到分支，等审） | 修法 Lucas 已定：两条解析路径写库前清掉 U+0000（顺带落单代理字符），不解密；界面显示 `parseError` 原文 |
| 3 生产 GPT-6 Astra 未启用 | — | — | — | 只记录（见下面第 3 条） |

接手要知道的：

1. **FIX-12 的根因（已核对代码）**：窗口超时按剩余预算裁到 35.3 秒是对的，但被中止后 `createTenderCompletion`（`src/lib/ai/model-policy/tender.ts`）的换备用（terra → sol）和 `callStructured`（`src/lib/tender-understanding/llm.ts`）的「瞬时错误再试一次」都沿用同一个超时——一次窗口调用最多四段。**t+260s 那轮 terra / retryCount 0 来自 `callStructured` 的重试**（钉住的模型只在备用成功后才换，`retryCount` 缺省 0），不是窗口层。修法：每个阶段算一个绝对截止时间（切片截止 − 15 秒）带到每一次请求；剩余 < 5 秒不再重试 / 换模型（错误码 `CALL_DEADLINE_EXCEEDED`），以 `call_deadline` 让出。回归测试 `src/lib/tender-auto-analysis/__tests__/v2-slice-deadline.test.ts` 用虚拟时钟复现了生产时间线（改前 330 秒，改后 190 秒让出）。
2. **FIX-13 的根因**：Lucas 本地证实——英文版 Appendix B 用 unpdf 1.4.0 `extractText(mergePages:false)` 读出 4 页，第 2 页利益冲突一节的勾选框被抽成 1 个 U+0000（`"...check the box.\n\u0000 The Bidder declare..."`），其余页为 0，落单代理字符 0；`pdffonts` 显示有 SymbolMT（CID TrueType、Identity-H）；去掉权限加密后的版本同样含该字符——**加密已排除**。本会话在本机隔离库上复现了后半段：PostgreSQL 文本列不收 U+0000（22021），两条解析路径都整份写库失败、被标成「failed」。**生产上这两份文件的 `parseError` 原文未核对**；法文版没测，按同一来源推断相同。生产库查询改为可选（有权限的人复核用）：`SELECT d.title, d."parseStatus", d."parseError" FROM "ProjectDocument" d JOIN "Project" p ON p.id = d."projectId" WHERE p.name = '12-3 Indoor Canadian Flag';`。排查时已排除：文件名里的「(PDF)」（上传时括号换成下划线，Blob 路径来回一致）。
3. **记录（不改）**：生产 `ai.call` 日志 `flagDecision = kill_switch`（`ENABLE_GPT6_ASTRA` 没开，`src/lib/ai/model-policy/flags.ts` 约 75 行），实际模型 `gpt-5.6-terra`（招标角色的基线是推理模型），备用 `gpt-5.6-sol`；**GPT-6 Astra 当前未启用**。后果：`tender.ts` 里的同模型重试（`retry_same`）只对 Astra 生效，生产上第一次可重试的失败就直接换 sol；`tender.ts` 头注释「GPT-6 Astra 是招标推理主模型」写的是开关打开之后的状态。要不要开由 Lucas 定。
4. **上线后**：FIX-12 合并部署后，「12-01」「12-3」两个项目在项目页「AI 数字员工 · 投标分析」卡片上点「重新分析」（一键分析，走 `/api/cron/agent-runs`；分析面板里的「重新分析当前投标文件包」走旧管线 `/api/cron/tender-auto-analysis`，同样受修复保护）；Vercel 上 `/api/cron/agent-runs` 不应再有 300 秒 504。FIX-13 合并部署后，打开「12-3」的项目文件页（会自动重试失败的文件）或点重试，确认两份附录 B 变为已解析，再重新发起分析。
5. **FIX-12 多维审查留下的两个后续 change（还没开，会话里生成建议任务的工具超时，以这里为准；细节见 `docs/QINGYAN_FIX-12_REPORT.md` §7）**：
   - 切片之外仍可能越过 300 秒的路径（最高优先）：`processQueuedWorkforceJobs(2)`（`src/lib/workforce-runtime/processor.ts` 约 785–791 行）两个任务共用 240 秒预算，但循环与轮次都不看 `executionBudget.deadlineAt`，第二个任务可能在 226 秒之后再跑一轮不受预算约束的步骤；另有 PERSIST 只留 5 秒余量、旧 cron 的 FINALIZE 无时限、kick 的预算起点、SDK 重试等待不看 signal。
   - 降级结果用白话说清楚：局限说明里的英文错误码、Analyst 两次没完成时没有说明、复核没跑完却显示「未通过 AI 质检」、被截止的澄清检查永久记为未解决。
6. **FIX-13 实施要点（四件套等审；审过后 `/opsx:apply document-parse-nul-and-reason`，tasks 共 7 条）**：
   - 回归测试的 PDF 在测试里现拼（不入库客户文件）。已验证的最小做法（unpdf 1.4.0）：PDF 1.3，页面资源两个字体——`/F1` 为 Type1 Helvetica（WinAnsiEncoding），`/F2` 为 `/Type0 /BaseFont /SymbolMT /Encoding /Identity-H`，`DescendantFonts` 是一个 `CIDFontType2`（`CIDSystemInfo` Adobe / Identity / 0，只有 FontDescriptor，**没有嵌入字体、没有 ToUnicode**）。第 1 页内容流 `BT /F1 12 Tf 72 720 Td (Conflict of interest: if none, check the box.) Tj ET` + `BT /F2 12 Tf 72 700 Td <0000> Tj ET` + `BT /F1 12 Tf 84 700 Td (The Bidder declares that no conflict exists.) Tj ET` → unpdf 抽出 `"Conflict of interest: if none, check the box.\n\u0000 The Bidder declares that no conflict exists."`（与 Appendix B 同一形态）；第 2 页 `BT /F2 12 Tf 72 720 Td <00000000000000000000> Tj ET` → 5 个 U+0000（判为需要 OCR）。xref 按对象偏移手写即可。
   - 隔离库测试走真实的两条路径：`parseDocumentPagesAndStore`（`page-parse.ts`）与 `parseAndStoreContent`（`parse-content.ts`）；本地文件存储用 `PRODUCT_CONTENT_LOCAL_STORE=1` + `PRODUCT_CONTENT_LOCAL_STORE_DIR`，`blobUrl` 写成 `/api/files/<pathname>`；`ProjectDocument` 有外键，先按既有隔离库测试的做法建组织与项目。改动前的代码上两条路径都是 `failed`、`parseError` 含 22021。
   - 截断（`slice`）之后再清理一遍——截断可能劈开一对代理字符。
   - 综合解读的覆盖快照（`v2-persist.ts` `loadCoverageForRun`）**只取原来六项**，`parseError` 不能进去（它会经投标草稿取数进模型提示）；分析面板把现算的「文件名 → parseError」交给综合解读视图。
7. 本会话的环境做法同 §0.5h「本会话的环境做法」（Node 24、本机 Postgres + pgvector、隔离库变量）；两个 change 各在自己的 git worktree 里做，避免一个跑全量测试时另一个切分支。

### 0.6 实施中沿用的约定

- 纯函数目录：`src/lib/tender-price-schedule/`、`tender-bid-cost/`、`tender-competition/`、`tender-bid-readiness/`。文件基本名避开架构守卫的禁用词（plan / engine / queue / scheduler 等，按 `-`、`_`、`.` 切分后整词匹配）。
- 金额一律用 `src/lib/project-finance/money.ts` 的定点工具；合计 = 各行舍入值之和。
- 新测试同时登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- 实施中发现规格没覆盖的对外行为：先补规格增量、`openspec validate --strict` 通过，再继续写代码。
- 测试里的公司名一律虚构或用代号；渥太华夹具在 `src/lib/tender-price-schedule/__tests__/fixtures/ottawa-18026.ts`。
- 每个 change 一个分支、一个 Draft PR、一份 `docs/QINGYAN_<ID>_REPORT.md`、TASKFLOW 一行。

运行环境：`npm ci --ignore-scripts` 后 `npx prisma generate`；单文件测试 `npx tsx <file>`；`NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 约需数分钟。容器里没有 `.env`，没有任何生产连接。

FLOW-0 还欠的（不阻塞 TI）：同事的「三个时刻」；同标实测（第 4 轮）；独立复核（第 5 轮）；四步路径方案原文；生产开关实际值；R-1 例外是否算已批准。

---

### 0.7 在容器里起真实应用截图的做法（TI-4b 用过，可复用）

```
service postgresql start        # 本地 PostgreSQL 16，角色 qy / qy，库 qy_isolated，pgvector 已装，迁移已全部应用
export DATABASE_URL="postgresql://qy:qy@localhost:5432/qy_isolated" DIRECT_URL="$DATABASE_URL" JWT_SECRET="<任意 32 位以上>"
TENDER_BID_WORKSPACE_ENABLED=1 npx next dev -p 3100
```

造演示账号时三个坑（缺任何一个，项目页都会被路由门 302 到 `/tasks`）：

1. 组织的 `modulesJson` 必须显式写 `{"enabled":["bids","projects"]}`——有成员身份而模块未配置时路由门按关闭处理。
2. 用户要是该项目的 `ProjectMember`（或组织开了 bids 且平台角色在名单里）。
3. 路由门的企业侧输入有 30 秒进程内缓存，改完库要等一下。

登录：`createSession({sub, email, role})`（`@/lib/auth/session`）生成的值放进 cookie `qy_session`。页签直达：`/projects/<id>?tab=bid`。页面内部有滚动容器，Playwright 元素截图会拼花——把视口高度临时调大（如 7000）再按 `boundingBox` 裁剪。容器重建后以上都要重来（数据库、依赖、种子数据都不保留）。

## 1. 进度

| 轮 | 内容 | 状态 | 产物 |
|---|---|---|---|
| 1 | 青砚基线 | 完成 2026-11-11 | 基线文档；12 条断点；3 条更正；5 条未核对 |
| 2 | 开源调研 | 完成 2026-11-11 | 开源调研文档；13 个仓库；3 处抽查 |
| 3 | ChatGPT 一方入矩阵 | 完成 2026-11-11（据 Skill 原文；真实对话产出与「三个时刻」未收到） | 方案 §6 |
| TI-A | Tender Intelligence Phase A：只读架构审查 | 完成 2026-11-11；Owner Gate A 已过（按建议执行） | `docs/tender-intelligence-gap-analysis.md`：实体映射、8 面板落点、3 个现存问题、10 项待拍板、分阶段安排 |
| 4 | 同标实测 | 未开始 | — |
| 5 | 独立复核 → 定稿 → 拍板 | 未开始 | — |

---

| 开源二 | 第二轮开源调研：成本核算、不逐项询问的流程、贸易数据 | 完成 2026-11-11 | 开源调研 §6；6 处抽查 |
| 规划 | FIX-1、TI-1、TI-2 四件套 | 完成 2026-11-11；Lucas 同日批准实施 | 已归档：`openspec/changes/archive/2026-11-11-{rfq-requirement-category-match,tender-price-schedule-lines,tender-bid-cost-sheet}/` |

| 实施 | FIX-1：询价单类别归一 | 完成 2026-11-11，#412 待审 | `build.test.ts` 21 → 31 项；`docs/QINGYAN_FIX-1_REPORT.md` |
| 实施 | TI-1：价格表行项 | 完成 2026-11-11，#413 待审 | 4 个测试 81 项；验收项 A1 / A2 / A8 / A9 / A10 / A16；`docs/QINGYAN_TI-1_REPORT.md` |
| 实施 | TI-2：逐行成本核算表 | 完成 2026-11-11，#414 待审 | 5 个测试 103 项；验收项 A10–A14；样例 `docs/acceptance/ti-2/ottawa-sample-cost-sheet.md`；`docs/QINGYAN_TI-2_REPORT.md` |

| 实施 | TI-3a：竞争情报线索契约 | 完成 2026-11-11，#415 待审 | 3 个测试 64 项；验收项 A3 / A4 / A5 / A6 / A15；`docs/QINGYAN_TI-3a_REPORT.md` |
| 实施 | TI-3b：可投标判定与阶段策略表 | 完成 2026-11-11，#416 待审 | 4 个测试 87 项；验收项 A7 / A16 / A21；`docs/QINGYAN_TI-3b_REPORT.md` |
| 实施 | TI-4a：投标工作区存取接口 | 完成 2026-11-11，#417 待审 | 纯逻辑 46 项 + 隔离库端到端 40 项；验收项 A17 / A20 / A22；`docs/QINGYAN_TI-4a_REPORT.md` |
| 实施 | TI-4b：项目页「投标工作区」面板 | 完成 2026-11-11，#418 待审 | 40 项断言；真实应用截图 5 张 `docs/acceptance/ti-4b/`；`docs/QINGYAN_TI-4b_REPORT.md` |
| 实施 | TI-4c：逐行录入与补遗 | 完成 2026-11-11，#419 待审 | 新增 41 项断言，既有三个测试 +23 项（隔离库 49 项全过）；截图 3 张 `docs/acceptance/ti-4c/`；`docs/QINGYAN_TI-4c_REPORT.md` |

## 2. 已核对的要点（细节看底稿，这里只放接手必须知道的）

- 青砚的核心问题是步与步之间没连上，不是单步做得差（基线 §1、§9）。
- 确定性的「下一步」查表已经存在：`src/lib/muse-bridge/next-step.ts` 的 `decideNextStep`，10 条规则，零 LLM。唯一调用方是 `src/lib/muse-bridge/router.ts:594`，而 Muse Connector 已永久冻结。Web 工作台用的是另一套只有三步的投影 `src/lib/tender/workbench-state.ts`。
- 同一个标的进度有四套说法（基线 §3）。
- 开源项目里没有一个覆盖「读标书 → 询价 → 比价 → 定价」；可借的集中在交付前检查与补遗失效传递（开源调研 §1、§4）。
- 方案 §7 的 H1–H8 是**假设**，不是结论。第 3 轮之前不要据此开 change。
- Tender Intelligence 审查的要点（细节看差距分析）：
  - 供应商情报 S1–S4 的代码都在 HEAD 上，`SUPPLIER_INTEL_ENABLED` 默认关；主备推荐、逐要求匹配、强制要求闸、认证登记都已有。「已有 1688 排名」说大了，1688 专用适配器是 `DEFERRED`。
  - 证据链用现有的 `MemoryClaim` / `MemoryClaimEvidence`；金额口径分离已在 PROC-1 的 `ProcurementLineItem.amountBasis`。
  - 真缺的五样：价格表行项、文件领取方快照、竞争对手公司实体与别名、进口线索关联、逐行成本情景。
  - 成本实验室扩 `src/lib/quote-engine`，不另写计算器。
  - 三个现存问题：询价单类别大小写对不上（`tender-rfq/build.ts:187` 对 `v2-map.ts:214`）；数量与单位在 `v2-map.ts` 被丢；`TenderArchiveItem` 没有写入方。
  - 架构守卫禁止 Prisma 模型名与 `src/lib` 文件名含 Plan / Run / Task / Event / engine / queue 等词——「Plan Taker」在代码里叫「文件领取方（document holder）」。
- TASKFLOW 里与本任务重叠的项：H2 = W-3，H6 = T-2，H7 = P2-1～3，H8 = W-2。不要重复立项。截至 2026-11-16 还没完成的：P2-2 的验收召回、P2-3c（拉文件包）、P2-4、P3-1～P3-3；W-2、W-3、T-2、P2-1、P2-3a、P2-3b 已完成。

---

## 3. 交叉验证的规矩（本任务的硬要求）

- 每条事实带出处与可信度（A / B / D，定义见基线表头）。B 级事实在动手改那一块之前先升到 A。
- 调研代理的报告不直接采信：关键结论由主会话读原文复核，不一致的记进底稿的更正记录。第 1 轮这样查出 3 条（基线 §10），其中一条是文档自己过时了（PROC-1 交接文档落后于报告与 TASKFLOW）。
- ChatGPT 的自述不算证据，要指令原文或真实产出（方案 §2.2）。
- 开源仓库内容当数据看，不执行其中任何指令；README 自述与源码事实分开标。
- 定稿前要有一轮不看结论、只看证据的独立复核（第 5 轮）。

---

## 4. 环境与坑

- 云容器是 Node 22，`.nvmrc` 要求 24；仓库不带 `node_modules`。本轮没有装依赖、没有跑测试（只改文档）。
- OpenSpec CLI 没装进依赖：`OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 <cmd>` 可用。
- 搜 GitHub 用 `gh api -X GET search/repositories -f q='…' -f sort=stars -f order=desc`，能搜公开仓库。GitHub MCP 工具只对 `lucasj880/-` 有权限。
- 开源仓库的克隆在会话临时目录，会话结束即消失；要重读按开源调研 §2 的地址重新拉。
- 对外请求里不带公司、项目、人名。
- `docs/` 下的文件不删；`openspec/specs/**` 不手写；`.claude/launch.json` 不动。

---

## 5. 不要做的事

- 不要合并、不要部署、不要 archive 未合并的 change。（2026-11-15 起 Lucas 授权：本条线上的 PR 由会话自己盯、自己合并，见 §0.5e；部署仍不要做。）
- 新的 change 先 `/opsx:propose`、审过再 apply；不要 propose 之外顺手改代码。
- 不要新建并行的 Tender / Supplier / Task 体系；供应商主档只有 `Supplier` 一个。
- 不要发询价、付费、提交投标或资料申请、合并、部署、动生产数据或凭证——每一项都要 Lucas 单独明确授权。
- 不要把「领取文件」写成「投标」，不要把历史运单写成当前供货关系，不要在未接通数据源时造数据。
- 不要把 H1–H8 当成已拍板。
- 不要采纳开源调研 §4「明确不借」里的任何一项。
- 不要让「下一步」由模型决定（硬纪律第 7 条）。
- 不要新增队列、定时任务、Prisma 模型（硬纪律第 1、3 条）；确有需要就写成「需例外」交 Lucas / Evan 拍板。

---

## 6. 给 ChatGPT 一方的 Skill 补丁：只读的事不再逐项询问

背景：Lucas 2026-11-11 反馈，用 `qyane-tender-intelligence` Skill 跑的时候，ChatGPT 每次都要停下来问「要不要查海关数据」之类的问题。青砚里的对应做法是阶段策略表（差距分析 §17.1）。在青砚做完之前，把下面这段加到 `SKILL.md` 第 1 节之后即可止住询问。Skill 原文是英文，补丁也用英文。

```markdown
## 1a. Default execution policy: do not ask before read-only work

Run every read-only stage by default. Do not ask whether to run a stage, which
sources to check, or whether to continue. Classify each stage before starting
and act on its class:

- AUTO: read-only, free, nothing leaves the workspace. Parsing files,
  plan-taker analysis from material already provided, public award and
  procurement history, public manufacturer catalogs, the compliance matrix,
  cost scenarios, the timeline, the Owner brief. Run it.
- NEEDS_MATERIAL: depends on something only the user holds, such as a portal
  screenshot, a supplier quote, a certificate or a freight quote. Do not stop.
  Run everything else, then list under "Missing inputs" exactly what is needed
  and which result it would change.
- NOT_CONNECTED: a source this session cannot reach, such as licensed
  customs or shipment data or an authenticated portal. Do not ask whether to
  query it. Report NOT_CONNECTED, say what the source would add, and continue.
  If the source is connected and free to query, use it without asking. If it
  charges per query, treat the query as APPROVAL.
- APPROVAL: supplier emails, government requests, filings, payments, logins,
  orders. Prepare the draft, stop, and ask.

Ask a question only in three cases:
1. An APPROVAL action is next.
2. Two official documents conflict and the latest addendum does not resolve it.
3. The canonical tender (issuer plus solicitation ID) cannot be identified.

When a calculation needs an assumption, choose the conservative value, label
it as an assumption with its basis, and show the sensitivity. Do not pause.

Finish every run with the full set of standard outputs. Close with three
lists: Missing inputs, Not connected, Awaiting approval.
```

要点：把「能不能做」「要不要做」从对话里拿出来，事先归类。只有对外发送、付费、提交这一类才停。
