# A-1 完成报告：岗位注册表（openspec change `org-cockpit-posts`）

任务书：`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` §A-1
分支：`claude/awesome-turing-dorqeg`（基于 `origin/main` `51cc62c`，PR #243 之后）
OpenSpec change：`openspec/changes/org-cockpit-posts/`（proposal / `specs/cockpit/post-registry/spec.md`（10 条 Requirement / 25 个 Scenario）/ design / tasks，`openspec validate --strict` 通过）

---

## 1. 做了什么

| 文件 | 内容 |
|---|---|
| `src/lib/cockpit/posts.ts`（新） | 七岗位常量表 `POST_REGISTRY`（`as const satisfies readonly PostDefinition[]`，数组顺序即卡片顺序）；通用动作类型 `SHARED_PENDING_ACTION_TYPES` 与不归属 runType `UNATTRIBUTED_AGENT_RUN_TYPES`；反查函数 `getPostDefinition` / `postForAutomation` / `postForPendingActionType` / `postForWorkDomain` / `postForAgentRunType`（未命中一律 `null`）；按行上下文归属 `postForPendingAction`；只取声明路径的 `pickKpiMetrics`；KPI 来源的纯类型映射 `PostKpiSourceResults`；类型层断言 5 条（自动化 / 动作类型 / 通用与固定不相交 / 工作域 / KPI 路径解析到标量）。只有 3 条 `import type` 与类型位置的 `typeof import()`，零运行时依赖 |
| `src/lib/cockpit/__tests__/posts.test.ts`（新） | 217 条断言，覆盖 spec 10 条 Requirement，含校验器自检（注入未归属 / 重复 / 全集外 / 注释里的分号与引号 / 子联合引用都必须被检出） |
| `scripts/test-all.sh` | SDD-0 注册段之后、注册校验之前追加 1 条：`组织驾驶舱 岗位注册表（A-1）` |
| `scripts/test-ci-unit.sh` | 架构守卫之前追加 1 行（CI 跑的是 `test:ci`，不加则 CI 拦不住"重复归属 / KPI 漂移"） |
| `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md`（新） | 任务书原文；Phase A 表 A-1 状态 → `[G]` |
| `docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`（新） | 跨会话交接记录（环境准备、PR 策略、进度表、已做判断） |

### 岗位归属（最终）

| 岗位 | 自动化 | 固定归属的 PendingAction | 工作域 | runType | KPI（窗口；三个指标与格式） | 跳转 |
|---|---|---|---|---|---|---|
| `inbound_sales` 询盘销售 | daily-brief、trade-followup、sales-action-sync、revenue-spine-sync、wechat-push、inquiry-sla、trade-daily | sales.update_followup、sales.update_stage、sales.approve_quote_promotion、sales.send_inquiry_reply | sales | fde_inbound_sales、runtime_v2 | `loadSlaMetrics`（近 30 天）：首响中位 minutes / 24h 回复率 rate / 护栏拦截 count | `/revenue` |
| `tender` 投标 | tender-watch、tender-auto-analysis、tender-rfq-inbound | tender.send_rfq、tender.send_chase | tender | — | `getTenderPortfolioSummary`（近 365 天）：已投标 count / 中标 count / 中标率 percentage_string | `/bids` |
| `marketing` 营销增长 | market-intelligence、marketing-channel-sync、marketing-crm-attribution、marketing-health、marketing-daily-brief、marketing-experiment-review、marketing-mmm、postiz-sync | marketing.activate_campaign、marketing.approve_research_plan、marketing.propose_context_update、marketing.create_campaign_draft | — | — | `getMarketingDashboard`（本月至今）：有效线索 count / 增长执行 score / 高优先级问题 count | `/operations/growth` |
| `service` 客服 | service-inbox-sla | — | — | — | 未接入（无只读读函数） | `/service-inbox` |
| `projects` 项目交付 | project-inspection、progress-summary、proactive-scan | — | delivery | — | `listDeliveryProjects`（当前时点、查看人可见）：需关注 / 进行中 / 暂停（count） | `/projects` |
| `ops_knowledge` 运维与知识 | employee-ai-practice-miner、release-drift、agent-runs、autopilot-telemetry、approval-timeout | — | general | — | `getTeamLearningMetrics`（全部历史）：候选方法 count / 生效手册 count / 采纳率 rate | `/ai-activity` |
| `content` 内容 | aivora-sync | — | — | — | 未接入（无只读读函数） | `/operations/dashboard` |

- **通用动作类型**（4 种，无固定岗位）：`calendar.create_event`、`grader.email_draft`、`grader.internal_note`、`grader.project_task`。按每条动作的上下文归属：所属项目工作域（`Project.workDomain` 默认值 `general` 表示未分类，跳过）→ 目标类型（PROJECT → projects；CUSTOMER / OPPORTUNITY / QUOTE → inbound_sales）→ 产出 AgentRun 的 runType → 未归属。
- **不归属的 runType**：workforce_job（按工作域归属）、conversation、assistant_dispatch、background_conversation、supervisor。
- 合计：28 个自动化键各归属一个岗位；14 种动作类型中 10 种固定归属、4 种通用；4 个工作域各归属一个岗位；源码写入的 7 个 runType 中 2 个归属、5 个不归属。

## 2. 怎么验的

| # | 验证 | 结果 |
|---|---|---|
| 1 | `npx tsx src/lib/cockpit/__tests__/posts.test.ts` | 219/219 passed，约 3.7 秒（A-2 实施时补 2 条：未分类项目不归 `ops_knowledge`） |
| 2 | 运行期反向注入（临时改动，恢复后 `cmp` 逐字节一致）：未归属自动化键 / 同一键归两个岗位 / runType 拼写错误 | 三次都退出 1，分别打印 `["fake-new-automation"]`、`["wechat-push → inbound_sales + tender"]`、`["fde_inbound_salse"]` 与 `["inbound_sales:fde_inbound_salse"]` |
| 3 | 类型层反向注入（一次注入 4 种错误后局部 `tsc`） | 逐条报 TS2344：`"wechat-push"`、`"tender.send_chase"`、`"inbound_sales:guardrail（非标量）" \| "projects:sections.total"`；恢复后逐字节一致 |
| 4 | `npm run typecheck`（全量，`--max-old-space-size=6144`） | 退出 0；`--extendedDiagnostics` 内存基线 3.86 GB → 本分支 3.75 GB，类型层校验没有推高编译开销 |
| 5 | `npm run lint:baseline`；对两个新文件单独 `npx eslint` | PASS（无新增 error fingerprint）；0 问题 |
| 6 | `npm test`（全量）对比 `origin/main` 基线 | 基线 411/425 → 本分支 412/426；新增的 1 项即本测试（PASS）；14 项失败清单逐条一致，均为环境性既有问题：10 项 DB 集成（容器无 Postgres）、Gmail Draft OAuth、T4 授标情报 Postgres 矩阵、客户报价 PDF（无 Chromium 配置）、测试注册校验（PR #242 带入的 2 个未注册 trade 测试，另一会话 `register-acquisition-hub-tests` 在处理） |
| 7 | `bash scripts/test-ci-unit.sh`（= `npm run test:ci`）基线与本分支 | 两边都 `CI unit subset PASS`；本分支日志里含 `组织驾驶舱岗位注册表: 217/217 passed` |
| 8 | `bash scripts/check-test-registry.sh` | 未注册列表只剩 2 个既有 trade 欠账，不含本测试 |
| 9 | `git diff --stat origin/main -- prisma/ vercel.json` | 空 |
| 10 | `openspec validate org-cockpit-posts --strict` | valid |
| 11 | `/opsx:verify org-cockpit-posts` | 10/10 requirement 有实现映射，25/25 scenario 有覆盖；无 WARNING；1 条 SUGGESTION：spec 里"`npm run typecheck` 失败"那一半没有自动化测试，靠第 3 行的手动反向验证与 CI 的 typecheck 门本身 |

## 3. 与任务书的偏差（请 GATE 逐条确认）

1. **数量**：任务书写"23 项自动化、12 种 PendingAction"，代码现状 28 / 14，按代码现状穷举。
2. **未列出的自动化**：`wechat-push`（微信补推简报 / 跟进）、`trade-daily`（外贸每日检查）归 `inbound_sales`。
3. **`approval-timeout` 归 `ops_knowledge`**（任务书写在 `tender`）：它统一处理全组织所有类型 PendingAction 的过期与审批升级。**已认可（用户，2026-10-26）**。
4. **验收第 2 条"每个 PendingActionType 恰好归属一个岗位"改为"恰好一种归属方式"**：`calendar.create_event` 与 `grader.*` 三种由 agent-runtime-v2 销售跟进、销售草稿工具、助手场景、approval-gate、技能桥、ai-grader 多条链路产出，目标既有客户 / 商机 / 报价也有项目，固定给任何岗位都会让"等你 N 件"按岗位分错。定为通用动作类型，按行上下文确定性归属，不命中记"未归属"（A-2 / A-3 会显式展示未归属数）。
5. **`service` / `content` KPI 未接入**：两条线都只有写入型 cron 函数，计数内联在 API 路由里。A-1 不新写查询；A-2 决定是否把路由里的内联查询原样抽成读函数。
6. **`runtime_v2` 归 `inbound_sales`**：唯一写入点 intent 固定为 `sales_followup_triage`。
7. **`ops_knowledge` 跳 `/ai-activity`** 而非 `/ai/autopilot`：后者需要 `autopilot.view` 权限且受观察开关控制。

## 4. 交叉审查（独立审查代理，只给代码与规格）

初稿提交后由独立代理对抗式审查，10 条发现全部接受并在同一 change 内修订（提交 `1482019`）：

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | 阻塞 | `grader.*` / `calendar.create_event`"只由 ai-grader / proactive-scan 产出"的前提是错的（`proactive-scan` 根本不产 PendingAction） | 改为通用动作类型 + 按行上下文归属（偏差 4） |
| 2 | 应修 | KPI 路径"每段出现在源码里"的核对骗得过（10 个不存在的路径全部通过） | 改为类型层解析到标量，错了 tsc 报 `<岗位>:<路径>` |
| 3 | 应修 | 敏感字段是黑名单，漏 `ourBidPrice` / `*RevenueCad` / `summary.revenue` 等 | 格式白名单（无金额格式）+ 扩展黑名单 + `pickKpiMetrics` 只取声明路径 |
| 4 | 应修 | CI 不跑 `test-all.sh` | 加进 `scripts/test-ci-unit.sh` |
| 5 | 应修 | runType 清单漏 `runtime_v2`、`background_conversation`（初稿 grep 的正则不含数字） | 改为扫源码全集，补齐两项 |
| 6 | 应修 | KPI 单位与窗口未声明（rate 0..1 / 百分比字符串 / 得分混用） | 每个指标声明 `format`，每个来源声明 `window` |
| 7 | 小 | 联合截取先截后去注释，注释里的 `;` 会截断 | 先去全文注释再截，并断言无残留 |
| 8 | 小 | 给 A-2 / A-4 的风险提示 | 记入 design Risks |
| 9 | 小 | A-2 可能整体透出 tender 汇总结果 | 新增 `pickKpiMetrics` |
| 10 | 小 | 若干检查不可能失败（runType 全集取自清单自身等） | 删除或改为真实全集 |

## 5. 已知限制 / 留给后续 change

- **A-2 实施时补的修正（提交见 PR #244 最新提交）**：`Project.workDomain` 的默认值是 `general`（未分类项目），初稿按规则（1）会把挂在未分类项目上的通用动作归到 `ops_knowledge`。已改为：项目工作域为 `general` 时跳过规则（1），继续看目标类型 / 产出 run 类型；workforce 作业上的 `general` 仍表示平台级作业、归 `ops_knowledge`。spec 增补 1 个 scenario，测试补 2 条。

- 通用动作类型的上下文字段在各产出方写法不一（`PendingAction.projectId` / `payload.targetType` / `payload.metadata.targetType` / 只有 `agentRunId`），A-2 需要按 design D3 取齐后传入 `postForPendingAction`；取不到的落"未归属"。
- `listDeliveryProjects` 按查看人可见范围过滤、`take: 500` 封顶；`getTenderPortfolioSummary` 是 N+1，且函数内部不检查 `TENDER_FINANCIAL_CONTROL_ENABLED`（只有路由检查），A-2 必须先过同一开关；`getTeamLearningMetrics` 无上限读取反馈事件、无数据时 `acceptRate` 为 0。
- `AutomationRun` 写入时基本不带 `orgId`，A-2 的岗位心跳实际是平台级；旧的销售 `workforce_job` 可能没有 `metadata.workDomain`，按工作域归属时要走 `resolveEffectiveWorkDomain`。
- 全量 `npm run typecheck` 在默认 2 GB 堆下会 OOM（与本 change 无关，基线同样需要约 3.8 GB）。
