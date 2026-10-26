# A-1 完成报告：岗位注册表（openspec change `org-cockpit-posts`）

任务书：`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` §A-1
分支：`claude/awesome-turing-dorqeg`（基于 `origin/main` `51cc62c`，PR #243 之后）
OpenSpec change：`openspec/changes/org-cockpit-posts/`（proposal / `specs/cockpit/post-registry/spec.md` / design / tasks，`openspec validate --strict` 通过）

---

## 1. 做了什么

| 文件 | 内容 |
|---|---|
| `src/lib/cockpit/posts.ts`（新） | 七岗位常量表 `POST_REGISTRY`（`as const satisfies readonly PostDefinition[]`，数组顺序即卡片顺序）；`PostKey` / `PostDefinition` / `PostKpiSpec` 类型；反查函数 `getPostDefinition` / `postForAutomation` / `postForPendingActionType` / `postForWorkDomain` / `postForAgentRunType`（未命中一律 `null`）；对 `AutomationKey` / `PendingActionType` / `WorkDomain` 的类型层穷举断言。文件只有 3 条 `import type`，零运行时依赖 |
| `src/lib/cockpit/__tests__/posts.test.ts`（新） | 158 条断言，覆盖 spec 9 条 Requirement（见 §2），含校验器自检（注入未归属 / 重复 / 全集外的键必须被检出） |
| `scripts/test-all.sh` | SDD-0 注册段之后、注册校验之前追加 1 条：`组织驾驶舱 岗位注册表（A-1）` |
| `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md`（新） | 任务书原文；Phase A 表 A-1 状态 → `[G]` |
| `docs/QINGYAN_ORG_COCKPIT_FDE_HANDOFF.md`（新） | 跨会话交接记录（环境准备、进度表、已做判断） |

### 岗位归属（最终）

| 岗位 | 自动化 | PendingAction | 工作域 | runType | KPI 来源（三个指标） | 跳转 |
|---|---|---|---|---|---|---|
| `inbound_sales` 询盘销售 | daily-brief、trade-followup、sales-action-sync、revenue-spine-sync、wechat-push、inquiry-sla、trade-daily | sales.update_followup、sales.update_stage、sales.approve_quote_promotion、sales.send_inquiry_reply | sales | fde_inbound_sales | `loadSlaMetrics`：首响中位 / 24h 回复率 / 护栏拦截 | `/revenue` |
| `tender` 投标 | tender-watch、tender-auto-analysis、tender-rfq-inbound | tender.send_rfq、tender.send_chase | tender | — | `getTenderPortfolioSummary`：已投标 / 中标 / 中标率 | `/bids` |
| `marketing` 营销增长 | market-intelligence、marketing-channel-sync、marketing-crm-attribution、marketing-health、marketing-daily-brief、marketing-experiment-review、marketing-mmm、postiz-sync | marketing.activate_campaign、marketing.approve_research_plan、marketing.propose_context_update、marketing.create_campaign_draft | — | — | `getMarketingDashboard`：有效线索 / 增长执行 / 高优先级问题 | `/operations/growth` |
| `service` 客服 | service-inbox-sla | — | — | — | 未接入（无只读读函数） | `/service-inbox` |
| `projects` 项目交付 | project-inspection、progress-summary、proactive-scan | grader.internal_note、grader.project_task、grader.email_draft、calendar.create_event | delivery | — | `listDeliveryProjects`：需关注 / 进行中 / 暂停 | `/projects` |
| `ops_knowledge` 运维与知识 | employee-ai-practice-miner、release-drift、agent-runs、autopilot-telemetry、approval-timeout | — | general | — | `getTeamLearningMetrics`：候选方法 / 生效手册 / 采纳率 | `/ai-activity` |
| `content` 内容 | aivora-sync | — | — | — | 未接入（无只读读函数） | `/operations/dashboard` |

合计 28 个自动化键、14 种 PendingAction 类型、4 个工作域，各恰好归属一个岗位。

## 2. 怎么验的

<!-- 由 §3 门禁结果填写 -->

## 3. 与任务书的偏差（请 GATE 逐条确认）

1. **数量**：任务书写"23 项自动化、12 种 PendingAction"，代码现状 28 / 14，按代码现状穷举。
2. **未列出的自动化**：`wechat-push`（微信补推简报 / 跟进）、`trade-daily`（外贸每日检查）归 `inbound_sales`。
3. **`approval-timeout` 归 `ops_knowledge`**（任务书写在 `tender`）：它统一处理全组织所有类型 PendingAction 的过期与审批升级（`src/app/api/cron/approval-timeout/route.ts`），放在投标会让投标卡片的健康被与投标无关的失败染红。若 GATE 坚持原方案，只需把这一行挪到 `tender`，测试里对应断言同步改。
4. **PendingAction 归属**（任务书未指定）：按产出方——`grader.*` 与 `calendar.create_event` 只由 `src/lib/ai-grader/actions/to-pending-action.ts` 产出，归 `projects`；其余按命名空间。
5. **`service` / `content` KPI 未接入**：两条线都只有写入型 cron 函数，计数内联在 API 路由里。A-1 不新写查询；A-2 决定是否把路由里的内联查询原样抽成读函数。
6. **`ops_knowledge` 跳 `/ai-activity`** 而非 `/ai/autopilot`：后者需要 `autopilot.view` 权限且受观察开关控制。

## 4. 已知限制 / 留给后续 change

- KPI 只是"指针"（模块 + 导出名 + 属性路径），测试做的是静态核对；路径能否在返回值类型上解析，由 A-2 的类型化取数适配器在编译期保证。
- `listDeliveryProjects` 按查看人的可见范围过滤，不是全组织总数；`getTenderPortfolioSummary` 需要时间窗口且按项目循环取成本（N+1）；`getTeamLearningMetrics` 无上限读取反馈事件。三者的窗口 / 缓存 / 口径由 A-2 定。
- `tender`、`marketing` 的读函数返回值含毛利率 / 利润 / 估值 / 中标金额：A-1 只声明白名单字段并用敏感词正则拦截声明；A-2 取数时必须只取声明的路径，并过 Muse 脱敏函数。
- `main` 上 `scripts/check-test-registry.sh` 已失败（PR #242 带入 2 个未注册 trade 测试），由另一会话的 `register-acquisition-hub-tests` 处理，本 change 不碰。
