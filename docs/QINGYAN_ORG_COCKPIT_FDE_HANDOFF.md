# 组织驾驶舱 × Inbound Sales FDE — 交接记录（换会话从这里接）

> 每完成一个 change 的一个阶段就更新本文件并推送。新会话开工顺序：先读 `CLAUDE.md` §1，再读本文件"当前位置"，再 `openspec list` 看进行中的 change，用 `/opsx:continue <change>` 接着做，不凭记忆重写。

| 项 | 值 |
|---|---|
| 任务书 | `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md`（状态列是 A / B 阶段的事实源） |
| 工作分支 | A-1：`claude/awesome-turing-dorqeg`（基线 `origin/main` @ `51cc62c`，PR #243 合并后）；A-2 起见 PR 策略 |
| PR 策略 | **已定（用户，2026-10-26）**：每个 change 一个独立分支、一个 PR。A-1 用 `claude/awesome-turing-dorqeg`；之后的 change 用 `claude/<change-name>`，从前一个 change 的分支切出（叠加），PR base 指向前一个 change 的分支，前一个合并进 `main` 后把 base 改回 `main`。archive 另走 `claude/archive-<change-name>` 小 PR |
| 每个 change 的完成定义 | 四件套 `openspec validate --strict` 通过 → apply 全部 task 打勾 → 本 change 测试 + typecheck + lint:baseline 绿 → `/opsx:verify` 报告 → 独立审查代理交叉验证（只给代码与规格）并处理发现 → 写 REPORT + 状态列 `[G]` → 提交推送 → 更新本文件 |

## 当前位置

- **A-1 `org-cockpit-posts`**：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_A-1_REPORT.md`；PR 见进度表。合并后另开 `claude/archive-org-cockpit-posts` 做 `/opsx:archive org-cockpit-posts --yes`。
- **A-2 `org-cockpit-read-model`**（分支 `claude/org-cockpit-read-model`，叠在 A-1 上）：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_A-2_REPORT.md`（含 staging 待验项：时间线 `EXPLAIN ANALYZE`、sunny-home-deco 人工对账）。
- **A-3 `org-cockpit-home`**（分支 `claude/org-cockpit-home`，叠在 A-2 上，[PR #246](https://github.com/LucasJ880/-/pull/246)，base = A-2 分支）：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_A-3_REPORT.md`。**GATE 决策项**：旧首页每 5 分钟 `POST /api/proactive/scan` 随替换停止，未开自动化偏好的管理层不再收到主动提醒——接受，或另开 change 让定时任务为管理层同步通知（等用户 / Evan 回复）。
- **A-4 `org-cockpit-workload`**（分支 `claude/org-cockpit-workload`，叠在 A-3 上，[PR #247](https://github.com/LucasJ880/-/pull/247)，base = A-3 分支）：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_A-4_REPORT.md`（偏差 9 条，交叉审查 5 应修 + 4 小全部处理）。
- **B-1 `fde-feedback-loop`**（分支 `claude/fde-feedback-loop`，叠在 A-4 上，[PR #248](https://github.com/LucasJ880/-/pull/248)，base = A-4 分支）：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_B-1_REPORT.md`（交叉审查 1 阻塞 + 6 应修全部处理）。
  - **GATE 决策项（阻塞 B-2）**：现有代码没有"审批时改稿"的路径。`payloadVersion` 恒为 1、审批中心校验 `payloadHash`、批准接口只收决定 + 备注、执行器发载荷正文。所以 `approved_edited` 不会出现，而 B-2 以它为触发。选项：
    - (a) 审批时允许改稿；
    - (b) 对"人工回复作废草稿"（`SUPERSEDED_BY_MANUAL_REPLY`）做草稿 vs 人工回复的 diff；
    - (c) B-2 暂缓。
    - 等用户 / Evan 拍板，未拍板前不开 B-2。
  - GATE 注意项：`metrics.ts` 采纳率与 `preference-learner` 的 40 条窗口会受系统事件影响（读者未改）。
  - B-1 设计要点：终态映射复用 `cockpit/workload.ts` 的 `pendingActionOutcome`；端口批准 / 驳回非重复分支 + 过期赢家 + `approval-timeout` 内补漏（10 分钟沉淀）三路写入时间不重叠，先查后写。事件 `skillSlug = inbound_sales_fde`、`feedbackScope = team_candidate`、`aiOutputRef.terminal/feedbackType`。快照里买家信息替换为占位符，只保留收件人邮箱；事件里连收件人邮箱也不留。
- **B-4 `fde-score-calibration`**（分支 `claude/fde-score-calibration`，叠在 B-1 上，[PR #249](https://github.com/LucasJ880/-/pull/249)，base = B-1 分支）：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_B-4_REPORT.md`（偏差 8 条，交叉审查 1 阻塞 + 2 应修 + 5 可选全部处理）。
  - 做了什么：`GET /api/revenue/score-calibration?days=`（30–180，缺省 90）+ `/revenue` 底部点开才加载的"评分校准（只报不改）"区块。首次评估六维（得分 ÷ 当时满分）对商机当前阶段：分桶赢单率 / 报价率、命中率、区分度、等级表、建议权重；"复制为 policy 片段"只写剪贴板。
  - **GATE 决策项**：建议权重有下限——productFit ≥ 3、其余可评估维度 ≥ 1。productFit = 0 会让评分把所有询盘判不合格并自动关闭；任一维为 0 后永远无法再校准。测试锁定"粘贴建议不改变不合格判定"。
  - 口径：结局取 `SalesOpportunity.stage`（与 `/revenue` 同）；QUOTE_SENT 只当"报过价"证据；disqualified 与入驻测试排除且计数；门槛按已定（won + lost）≥ 30。
- **B-5 `fde-internal-autonomy`**（分支 `claude/fde-internal-autonomy`，叠在 B-4 上，[PR #250](https://github.com/LucasJ880/-/pull/250)，base = B-4 分支）：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_B-5_REPORT.md`（偏差 10 条，交叉审查 2 阻塞 + 5 应修 + 可选项全部处理）。
  - 做了什么：
    - `policy.autonomy.autoStale`（默认关）；
    - `revenue-spine` 定时任务在 next action 之前自动搁置 Revenue Spine 维护的商机：`stageChangedAt` 非空，最后活动 = max(最后互动, 阶段变更, 最新互动记录) 超过 `staleAfterDays`，买家未来信且不在等我们回复，无在途审批（含报价让利）；
    - 审计 `policyKey`，按负责人汇总通知；
    - FDE `decline` 判不合格审计带 `businessProfile.excludedCategoryAction`；
    - `scripts/seed-revenue-autonomy.ts` 给 sunny-home-deco 开 dogfood（D-4）。
  - 任务书第 1 条（decline 自动关闭）、第 3 条（配额 `quota_hit` + 通知 admin）既有代码已实现，只补审计键名与静态断言。
  - **GATE 注意项**：company.log 操作人显示为负责人（`AuditLog.userId` 外键），来源与键名只在 `afterData`。建议后续给 A-2 时间线加动作中文标签与来源。
  - staging：先跑 seed 脚本 dry-run，再 `--write`；核对审计、通知，确认 Sunny 窗饰车道商机未被动。
- **决策已到（用户，2026-10-26）**：B-2 选 (b)，对"人工回复作废草稿"（`SUPERSEDED_BY_MANUAL_REPLY`）做草稿 vs 人工回复的 diff；B-3 选 (b)，偏好放进 `revenue_spine.policy` 新段。
- **B-2 `fde-fact-proposals`**（分支 `claude/fde-fact-proposals`，叠在 B-5 上，[PR #251](https://github.com/LucasJ880/-/pull/251)，base = B-5 分支）：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_B-2_REPORT.md`（偏差 13 条；交叉审查两轮：第一轮 2 阻塞 + 9 应修，第二轮 4 应修，全部处理）。
  - 归档顺序：先归档 `fde-feedback-loop`，再归档本 change（本 change 修改 B-1 的能力）。
  - 做了什么：
    - B-1 记录器加"人工已回复"终态（`replaced_by_manual_reply`，humanDecision edited，diff = 快照 vs 外发互动正文）；开发信与线索页手工留痕只记事件、不抽；
    - 规则化抽取 6 个 commercialFacts 键：先截引用、只看新增行、价格句整句跳过、结束语按整封判；
    - 起卡前用当前值补齐没写的子字段、用合并规则预校验；新类型 `revenue_spine.propose_commercial_fact`，审批人按平台角色挑（所有者能批 → 在职 boss → admin），没人能批不起卡；
    - 认领前角色门按批准人 `User.role` 判（审批中心传的是组织角色）；批准时在最新配置上重新合并，经 `publishRevenueSpineRule(business_profile)` 写入。
  - **GATE 注意项**：外贸收件箱的外发正文常是收件箱 LLM 草稿被采用；落款只补空缺；并发起卡 / 并发批准；外发同步多一步；补漏 7 天窗口会处理上线前 7 天的作废。
  - staging：见报告第 5 节（boss 在审批中心批准、sales 被拒、驳回后不再起、带价格不起卡）。
- **B-3 `fde-preferences-in-draft`**（分支 `claude/fde-preferences-in-draft`，叠在 B-2 上，[PR #252](https://github.com/LucasJ880/-/pull/252)，base = B-2 分支）：全部完成，状态 `[G]` 等 GATE。报告 `docs/QINGYAN_ORG_COCKPIT_B-3_REPORT.md`（偏差 11 条；交叉审查两轮：第一轮 2 阻塞 + 3 应修，第二轮 2 应修，可选项一并处理）。
  - 偏好放 `revenue_spine.policy` 的 `fde` 段：`useConfirmedPreferences`（默认 false）+ 问候 / 结束语 / 敬语 / 必问 / 免问 / 禁用词；关闭时草稿逐字节不变（金样本 `__tests__/fixtures/draft-golden-pre-b3.json`，10 例，用改动前代码生成）。
  - 偏好逐条校验（守卫、数字字符、数字词、商务条款用语），违规忽略并按组织 + 指纹记一次审计；禁用词只替换模板句子，保护行与嵌着的专名 / 链接不动；替换后多出守卫违规则本封不替换并按键名记审计。
  - **GATE 注意项**：没有设置界面（经 `PUT /api/revenue/policy`）；只接首封草稿，跟进草稿不读偏好；数字词宁可多拦；"需内部确认"段整行不替换。
- **全部 FDE change（A-1..A-4、B-1..B-5）都已 `[G]`**。剩余：A-5 / B-6 决策项；合并后依次归档（B-1 必须先于 B-2）；staging 验证见各报告第 5 节。
- **决策已到（用户，2026-10-26 第二轮）**：
  - A-3 的"旧首页主动扫描停止"→ **另开 change**（`org-cockpit-proactive-notify`），让既有定时任务为管理层同步提醒，不新增 cron；
  - **A-5、B-6 开始**（A-5 按 D-1 只做模板版；B-6 先做只读就绪度指标，不启动 V2 本身）；
  - **盯 PR**：#244–#252 已订阅活动事件，安全网 check-in 已排（50 分钟后，之后约 4 小时一次）；
  - 合并后再做归档（B-1 先于 B-2）；
  - 改进项按推荐顺序做。
- **长任务队列**（每项一个 change、一个分支、一个 PR，按顺序叠加；每项都走 propose → apply → 测试 → verify → 交叉审查 → 报告 → PR → 本文件）：
  1. **C-2 `fde-preferences-in-followup`**（分支 `claude/fde-preferences-in-followup`，叠在 B-3 上，[PR #253](https://github.com/LucasJ880/-/pull/253)，base = B-3 分支）：**完成**。报告 `docs/QINGYAN_ORG_COCKPIT_C-2_REPORT.md`。无回复跟进草稿读 `policy.fde` 偏好，关闭时逐字节不变（跟进金样本 `followup-golden-pre-c2.json`）；交叉审查 1 阻塞 + 5 应修全部处理。GATE 注意项：只缺免问字段时第 1 次跟进退到兜底问句。
  2. **A-3b `org-cockpit-proactive-notify`**（分支 `claude/org-cockpit-proactive-notify`，叠在 C-2 上，[PR #254](https://github.com/LucasJ880/-/pull/254)，base = C-2 分支）：**完成**。报告 `docs/QINGYAN_ORG_COCKPIT_A-3b_REPORT.md`。交叉审查两轮各 1 阻塞 + 3 应修全部处理；门禁 433/447 = 基线、test:ci / typecheck / lint 绿。
     - 交叉审查阻塞：`Notification.sourceKey` 全局唯一，旧 key `proactive:{dedupeKey}` 不含用户 → 同组织第二位管理层永远收不到同一条提醒。已改 `proactive:{userId}:{dedupeKey}`，本人名下旧 key 视为已发（**GATE 注意项**：上线后被别人占掉的提醒会补发本人一次）。
     - 轮转改为游标续排（`AutomationRun.metadataJson.notifyOnlyResumeAfter`，本定时任务自己的运行记录）；补发整轮出错计入失败（运行记 partial）；两轮主体抽成 `runProactiveScanCron(deps)`。
  3. **A-5 `org-cockpit-daily-digest`**（模板版，零 LLM）：**等用户选**。Corporate Memory 写入只允许人工（`assertWritableActorType` 拒 system / ai / agent，`MEMORY_WRITE_PERMISSION = CONSERVATIVE_ADMIN_ONLY`），"夜间日结 → MemoryClaim"与之冲突。选项：(1) 为日结开 system 写入窄例外（需 Evan 批）；(2)（推荐）日结写 `AuditLog cockpit.post_daily_digest`，每组织每天一条、只含计数，不进 MemoryClaim；(3) 暂缓。
  4. **B-6 `fde-v2-readiness`**（分支 `claude/fde-v2-readiness`，叠在 A-3b 上，[PR #255](https://github.com/LucasJ880/-/pull/255)，base = A-3b 分支）：**完成**。报告 `docs/QINGYAN_ORG_COCKPIT_B-6_REPORT.md`。只读：四条条件（事实提案满 30 天 / MOQ 可引用 / 生产周期可引用 / 至少 3 个类目——组织级口径固定"无法度量"）+ 依据计数（提案终态复用 A-4 `pendingActionOutcome`；只发目录首封不进占比）；`GET /api/revenue/v2-readiness`；`/revenue` 收起区块。任务书 B-6 状态列已改 `[~]`（V2 启动待条件满足后由 Evan 决定）。交叉审查 1 阻塞（过期口径）+ 4 应修全部处理。
  5. **`org-cockpit-timeline-labels`**（A-2 时间线常见动作中文标签与来源）：未开始。
- **其它会话在做的（不要重复）**：
  - "每color"：会话 "Fix 每color MOQ wording" 已在分支 `claude/trusting-rubin-uqc5k9`（基于 `main`，change `fix-zh-moq-per-unit`）改好、测试绿，等用户同意开 PR。**与 B-3 金样本的关系**：B-3 的 `draft-golden-pre-b3.json` 里 `zh-website-configured-facts` 一例记的是旧文案"每color"，两者谁后合并，谁按 `draft-golden-cases.ts` 头注释的命令重生成金样本并在 PR 里说明。
  - 清理未引用的 `src/components/dashboard/**`：会话 "Remove unused old homepage dashboard components" 在等 A-3 合并。
- 记录的改进点：A-2 时间线的审计摘要是原始 action 代码（如 `PENDING_ACTION_APPROVED · pending_action`），可在 A-2 读模型加常见动作的中文标签（后续 change）。
- A-2 实施中发现并已修到 A-1（PR #244 分支 `1776263`，再合进 A-2）：`Project.workDomain` 默认 `general` = 未分类项目，不能按工作域规则归到 `ops_knowledge`。

## 进度表

| ID | change | 四件套 | apply | 测试 | verify | 交叉验证 | 状态列 |
|---|---|---|---|---|---|---|---|
| A-1 | `org-cockpit-posts`（[PR #244](https://github.com/LucasJ880/-/pull/244)，base `main`） | ✅（修订 `1482019`） | 4/4 | ✅ 412/426，失败清单 = 基线；test:ci PASS | ✅ 无 WARNING | ✅ 10 条全部处理 | `[G]` |
| A-2 | `org-cockpit-read-model`（[PR #245](https://github.com/LucasJ880/-/pull/245)，base = A-1 分支） | ✅（修订 `4aa5183`） | 6/6 | ✅ 416/430，失败清单 = 基线；test:ci PASS | ✅ 无 WARNING | ✅ 1 阻塞 + 5 应修全部处理 | `[G]` |
| A-3 | `org-cockpit-home`（[PR #246](https://github.com/LucasJ880/-/pull/246)，base = A-2 分支） | ✅ `c7f4b57`（两轮审查后修订） | 8/8 | ✅ 419/433，失败清单 = 基线；test:ci PASS；typecheck 0 | ✅ 无 WARNING | ✅ 两轮：1 阻塞（列为 GATE 决策项）+ 8 应修 + 第二轮 4 项，全部处理 | `[G]` |
| A-4 | `org-cockpit-workload`（[PR #247](https://github.com/LucasJ880/-/pull/247)，base = A-3 分支） | ✅ `00080806` | 7/7 | ✅ 422/436，失败清单 = 基线；test:ci PASS；typecheck 0 | ✅ 无 WARNING | ✅ 5 应修 + 4 小全部处理 | `[G]` |
| B-1 | `fde-feedback-loop`（[PR #248](https://github.com/LucasJ880/-/pull/248)，base = A-4 分支） | ✅ `61feec70` | 6/6 | ✅ 424/438，失败清单 = 基线；test:ci PASS；typecheck 0 | ✅ 无 WARNING | ✅ 1 阻塞 + 6 应修全部处理 | `[G]` |
| B-2 | `fde-fact-proposals`（[PR #251](https://github.com/LucasJ880/-/pull/251)，base = B-5 分支） | ✅（两轮审查后修订 `b949bce7`） | 5/5 | ✅ 430/444，失败清单 = 基线；test:ci PASS；typecheck 0 | ✅ 无 WARNING | ✅ 两轮：2 阻塞 + 9 应修，第二轮 4 应修，全部处理 | `[G]` |
| B-3 | `fde-preferences-in-draft`（[PR #252](https://github.com/LucasJ880/-/pull/252)，base = B-2 分支） | ✅（两轮审查后修订 `e1244d62`） | 5/5 | ✅ 431/445，失败清单 = 基线；test:ci PASS；typecheck 0 | ✅ 无 WARNING | ✅ 两轮：2 阻塞 + 3 应修，第二轮 2 应修，全部处理 | `[G]` |
| B-4 | `fde-score-calibration`（[PR #249](https://github.com/LucasJ880/-/pull/249)，base = B-1 分支） | ✅ `c8361609`（审查后修订） | 5/5 | ✅ 427/441，失败清单 = 基线；test:ci PASS；typecheck 0 | ✅ 无 WARNING | ✅ 1 阻塞（列为 GATE 决策项）+ 2 应修 + 5 可选全部处理 | `[G]` |
| B-5 | `fde-internal-autonomy`（[PR #250](https://github.com/LucasJ880/-/pull/250)，base = B-4 分支） | ✅ `73679c5e`（审查后修订） | 5/5 | ✅ 428/442，失败清单 = 基线；test:ci PASS；typecheck 0 | ✅ 无 WARNING | ✅ 2 阻塞 + 5 应修 + 可选项全部处理 | `[G]` |
| C-2 | `fde-preferences-in-followup`（[PR #253](https://github.com/LucasJ880/-/pull/253)，base = B-3 分支） | ✅（审查后修订 `c877dd77`） | 5/5 | ✅ 432/446，失败清单 = 基线；test:ci PASS；typecheck 0；lint PASS | ✅ 无 WARNING | ✅ 1 阻塞 + 5 应修全部处理 | 沿用 B-3 |
| A-3b | `org-cockpit-proactive-notify`（[PR #254](https://github.com/LucasJ880/-/pull/254)，base = C-2 分支） | ✅（两轮审查后修订 `19cc8d8b`） | 6/6 | ✅ 433/447，失败清单 = 基线；test:ci PASS；typecheck 0；lint PASS | ✅ 无 WARNING | ✅ 两轮：各 1 阻塞 + 3 应修，全部处理 | 沿用 A-3 |
| B-6 | `fde-v2-readiness`（[PR #255](https://github.com/LucasJ880/-/pull/255)，base = A-3b 分支） | ✅（审查后修订 `b80f27d0`） | 5/5 | ✅ 435/449，失败清单 = 基线；test:ci PASS；typecheck 0；lint PASS | ✅ 无 WARNING | ✅ 1 阻塞 + 4 应修 + 可选项全部处理 | `[~]` |

A-5、B-6 原为决策项；用户 2026-10-26 第二轮决定开始：B-6 按只读就绪度开 change（`fde-v2-readiness`），A-5 等 Corporate Memory 写入口径的选择（见当前位置长任务队列第 3 项）。C-2 / A-3b 是改进项，状态沿用 B-3 / A-3 行。

## 已做的判断（GATE 审核时逐条确认；详见各 change 的 proposal "偏差"一节）

1. 代码现状是 28 项自动化、14 种 PendingAction（任务书写 23 / 12）；A-1 按代码现状穷举。
2. `approval-timeout` 归 `ops_knowledge`，不归 `tender`（它处理全组织所有类型的审批过期）。**已认可（用户，2026-10-26）**。
3. ~~`grader.*` 与 `calendar.create_event` 归 `projects`~~（交叉审查证伪：多条链路产出）→ 改为**通用动作类型**，按行上下文归属（项目工作域 → 目标类型 → 产出 runType → 未归属）。`runtime_v2` 归 `inbound_sales`。
4. 工作域：`sales`→`inbound_sales`、`tender`→`tender`、`delivery`→`projects`、`general`→`ops_knowledge`。
5. `service`、`content` 没有既有只读读函数，A-1 的 KPI 标"未接入"；A-2 决定是否把路由里的内联查询原样抽成读函数。
6. `tender` 的 KPI 来源 `getTenderPortfolioSummary`、`marketing` 的 `getMarketingDashboard` 返回值含毛利 / 利润 / 估值 / 中标金额，KPI 只取白名单计数字段。
7. `ops_knowledge` 卡片跳 `/ai-activity`（不跳 `/ai/autopilot`，后者有权限门与开关）。
8. （A-2）心跳是平台级（AutomationRun 不带 orgId）；健康度多 `n/a` / `not_configured`；迟到按类型化调度表（对照 vercel.json）判断。
9. （A-2）"等你 N 件" = `/capabilities/approvals` 待我审批（PendingAction + ApprovalRequest + 产品内容审批，带决策权）∪ workforce 需要你，作业的审批已列出则去重；通知不另计。**A-3 的跳转目标是 `/capabilities/approvals`，不是 `/inbox`**（`/inbox` 是快速捕获页）。
10. （A-2）两个 API 只对首页同口径管理层开放；时间线无 `(orgId, createdAt)` 索引，靠 7 天窗口 + limit+1 + 事件白名单，`EXPLAIN` 留到 staging。

## A-4 预研事实（只读调研结果，写 proposal 前先核对一遍）

任务书 A-4 的口径与代码现状有几处对不上，propose 时要逐条写成"偏差"：

1. **AutomationRun** 有 `orgId String?` 列和 `[orgId, automationKey, startedAt]` 索引，但唯一写入方 `runTrackedAutomation`（`src/lib/automation/runner.ts`）的 45 个调用点都不传 orgId → 实际恒为 null，仍按平台级处理。**AgentRun** `orgId` 必填，但没有 `(orgId, createdAt)` 索引（有 `[orgId, status]`）。
2. **PendingAction 状态只有** pending / approved（执行中的占位）/ executed / failed / rejected。
   - 没有 `expired` / `edited` / `auto_executed`。
   - 过期 = `status: "failed"` 且 `failureReason: "已过期"`、无 `decidedById`（`expireOverdueApprovals`，`src/lib/approval/port.ts`；执行器懒过期 `executor.ts`）。
   - 人工取消 = failed + "已取消"（有 decidedById）；关联任务取消 = rejected + "关联任务已取消…"。
   - 其他 failed 原因：BATCH_PREPARE_FAILED、未接入执行器、报价让利已变化、`SUPERSEDED_BY_ONBOARDING_TEST` 前缀。
   - **没有"编辑后批准"信号**：PendingAction 无 editedPayload，审批接口只收 decision + reason。`humanDecision: "edited"` 属于 employee-ai 反馈系统（`src/lib/employee-ai/feedback-service.ts`），不是 PendingAction。
   - 没有自动执行路径（报价路由直接 pending→executed 也带 decidedById）。
   - 索引 `[orgId, status, createdAt]`。
3. **SalesAction.inputContext.guardrailBlockedAt**：ISO 字符串，`guardrailMarkerPatch`（`src/lib/revenue-spine/fde/inbound-sales.ts`）在 draftStatus 为 guardrail_blocked / no_email 且有违规时写入，重跑不清除；SalesAction `orgId` 必填。
4. **AiUsageLedger 没有 runType**。
   - `sourceType` 取值：AGENT_RUNTIME / PRODUCT_CONTENT / IMAGE_ENGINE / SUPERVISOR / WORKFLOW / MANUAL_IMPORT。
   - 只能经 `runId → AgentRun.runType` 归岗位，而且 runId 经常为空（`ai/usage-ledger-bridge.ts` 不填）。
   - 字段：`costAmount Decimal(18,6)`、`inputTokens` / `outputTokens`。索引 `[orgId, occurredAt]`。
5. **Organization.settingsJson**（`Json?`）目前没有 `cockpit` 键；仓库惯例是每个键一个纯函数读取 `settingsJson: unknown`（如 `resolveOrgTimezone`、`runVisibilityFromOrgSettings`）。
6. **sla-metrics.ts**（`src/lib/revenue-spine/sla-metrics.ts`）已导出可复用的判定：
   - `isOnboardingTestInquiry({utmSource, customerTags, lostReason})`；
   - `utmSourceOf(inputContext)`；
   - `TRADE_SHOW_SOURCE = "trade_show"`，来源取 `opportunity.source ?? inputContext.source`。
   - 统计范围：`employeeKey = FDE_EMPLOYEE_KEY`、`actionType = "inbound_inquiry"`，先按商机去重，再排除测试询盘，再把展会单列。
   - `sla-tiers.ts` 已在复用这些判定。
7. **`/ai-activity` 不显示任何运行计数**：它按**当前用户**分页读 AuditLog（`ai_generate` / `ai_send` / `ai_analyze`），浏览器本地时区分天。GATE-A2"14 天工作量图与 `/ai-activity` 的运行计数一致"按字面无法满足，需改口径。
8. **按天分桶**：组织时区来自 `settingsJson.timezone`（`resolveOrgTimezone`，默认 America/Toronto），`getLocalTimeParts(date, tz).date` 给 YYYY-MM-DD，`localDayBounds` / `zonedLocalToUtc` 在 `revenue-spine/owner-today.ts`、`business-days.ts`；没有现成的多天分桶函数。

## B-4 预研事实（评分校准，写 proposal 前核对）

1. **评估记录**：`SalesOpportunityAssessment`。
   - 六维分数只在 `dimensionsJson`：`[{key,label,score,max,reason}]`，key 为 productFit / commercialPotential / buyerQuality / intent / completeness / strategicValue。
   - **`max` = 打分当时的 policy 权重**：要按 score/max 归一。`policyVersion` 恒为 v1，不能据此区分权重。
   - 唯一写入方 `fde/inbound-sales.ts`；一个商机可有多条，"当前" = `createdAt` 最新（与商机详情页一致）。
   - `qualification` 不落在评估上。
2. **权重**：`policy.scoring.weights`，默认 25/20/20/15/10/10。总分 = min(100, 各维之和)。分级阈值 hot 90 / high 70 / medium 50。
3. **结果真值**：
   - `BusinessOutcome` 经 `entityType="sales_opportunity"` + `entityId` 关联。写入的类型有 CUSTOMER_REPLIED / RFQ_RECEIVED / QUOTE_SENT / SAMPLE_REQUESTED / NEGOTIATION_STARTED / DEAL_WON / DEAL_LOST / REVENUE_RECORDED。
   - **没有 disqualified 结果**；`sourceId` 带时间戳，会重复写。
   - **`/revenue` 用 `SalesOpportunity.stage` + `wonAt` / `lostAt` / `lostReason`**（`revenue-spine/cockpit.ts`），校准应与之同口径。
   - **disqualified 是循环的**：由 `score.qualification` 自己决定，不能拿来校准评分。
4. **`/revenue` 页没有胜率 / 转化率 / 分级分布 / 时间窗口**。
   - 只有 stageCounts 排除测试商机，用 `EXCLUDE_ONBOARDING_TEST_OPPORTUNITIES`，只看 lostReason；
   - SLA 指标用更严的 `isOnboardingTestInquiry`。
5. **policy 不在 `settingsJson`**：在 `OrgBusinessRule`（`ruleKey = "revenue_spine.policy"`，最高版本，`loadRevenueSpinePolicy`）。
   - 权重片段形状：`{"scoring":{"weights":{...}}}`；
   - 应用方式：`PUT /api/revenue/policy` `{ policy: <片段> }`，boss / admin，发布新版本。
6. **面板位置**：`/revenue` 是单个客户端页（`src/app/(main)/revenue/page.tsx`），可在队列网格后加只读区块。
   - API 惯例：`resolveRevenueAccess(request)` + `force-dynamic` + `?days=` + `clampWindowDays`（默认 30、上限 180，需另设 90 默认）。

## B-3 预研事实（偏好接入草稿；**开 change 前先等来源决定**）

1. **任务书前提与代码不符**：
   - `preference-learner.ts` 只产**个人**、**自由文本**偏好，且只有两条规则：`email_concise_default`、`no_discount_first_touch`。
   - 这些偏好写进 `EmployeeAiProfile.learnedPreferences.inferred`，员工确认后才进 `manuallyConfirmedPreferences.confirmed`。
   - 没有"问候 / 落款 / 必问字段 / 禁用语"这类结构化偏好，也没有团队范围的偏好存储。
2. **employee-ai 里"团队范围"的东西**：
   - 链路是 `practice-miner` → `CandidatePractice`（`/settings/digital-employees/team-learning` 审批）→ 发布为 `RolePlaybook`（`status=active`，有 `rules` / `workflows` / `templates` 自由 JSON）。
   - `context-builder.ts` 把 active playbook 摘要拼进 LLM 提示；`roleScope` 缺省为 `sales`，没有 `inbound_sales_fde`。
3. **草稿里已有的可配置项**：落款来自 `businessProfile.commercialFacts.signature`（`reply-draft.ts` `signatureLines` / `signOff`）；追问来自 `rfq/missing-info.ts` `buildClarifyingQuestions`（按缺失字段与 `maxQuestionsPerReply`）。
4. **守卫**：`reply-draft.ts` `checkDraftGuardrails(body, allowed)`，润色之后再跑。
5. **开关位置**：任务书写 `settingsJson.revenue_spine.fde.useConfirmedPreferences`，代码里还没有这个键。Revenue Spine 的其它开关在 `OrgBusinessRule(revenue_spine.policy)`。
6. **已决定（用户，2026-10-26）：选 (b)**。原选项：
   - (a) active `RolePlaybook`（`roleScope = inbound_sales_fde`）的 `templates` 里约定结构化块（问候 / 落款 / 追问顺序 / 禁用词），由管理员在 playbook 里维护；
   - (b) 放进 `revenue_spine.policy` 新段（与 `notify` / `autonomy` 同级），不经 employee-ai；
   - (c) 暂缓，等 B-2 / practice-miner 能产出结构化团队偏好。

## 环境（云端容器每次都是新的，照做即可）

```bash
# Node 24（容器自带 v22，项目要求 >=24 <25）
mkdir -p /opt/node24 && cd /opt/node24 \
  && curl -sS -O https://nodejs.org/dist/v24.22.1/node-v24.22.1-linux-x64.tar.xz \
  && tar -xJf node-v24.22.1-linux-x64.tar.xz && rm node-v24.22.1-linux-x64.tar.xz
export PATH=/opt/node24/node-v24.22.1-linux-x64/bin:$PATH

cd <repo> && npm ci
# npm 11 默认不跑依赖的 install 脚本，手动补三步：
(cd node_modules/esbuild && node install.js)
(cd node_modules/@prisma/engines && node scripts/postinstall.js)
npx prisma generate

npm i -g @fission-ai/openspec@1.15.0   # openspec CLI
```

## 已知的既有问题（不是本任务引入，不在本任务修）

- `bash scripts/check-test-registry.sh` 在 `main` 上已失败：PR #242 带入 `src/lib/trade/__tests__/inbound-org.test.ts`、`src/lib/trade/__tests__/channel-inbound-id-db.isolated.test.ts` 未注册。另一会话的 `register-acquisition-hub-tests` change（分支 `claude/affectionate-ptolemy-81vzuy`）在处理。
- 容器里没有 Postgres：DB 集成测试会以 MISSING_DATABASE_URL 失败或跳过；`npm test` 的失败项要与基线逐条比对，只认新增失败。
