# Proposal: org-cockpit-read-model

**TASKFLOW：** A-2（岗位读模型 + API），状态列在 `docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` Phase A 表。依赖 A-1 `org-cockpit-posts`（PR #244，本分支叠在其上）。
**受影响的 Muse 意图：** 无。本 change 只复用 `src/lib/muse-bridge/contract.ts` 的敏感词检测函数（只读调用），不改 muse-bridge 任何文件，`status` 意图不接。

## Why

自动化心跳、待审批、workforce 需要你、KPI 与操作日志散在 `/assistant`、`/capabilities/approvals`、`/workforce`、`/revenue` 等六处，没有一份按岗位聚合的数据，A-3 首页岗位卡片无从取数。A-2 用纯读投影把它们收成两个只读 API，零 schema、零写入、零新 cron。

## What Changes

- 新增 `src/lib/cockpit/schedule.ts`：28 个自动化的真实调度表（与 `vercel.json` 的 cron 及各路由的本地时刻门控一致，测试交叉核对），以及按调度 + 组织时区推算下次应跑时间、最长正常间隔、单个自动化健康度、岗位健康度的纯函数。
- 新增 `src/lib/cockpit/waiting.ts`：把"待我审批"条目与 workforce 需要你条目按岗位归属、去重、排序的纯函数，以及驾驶舱文本脱敏函数（复用 Muse 的敏感词检测，命中整段替换）。
- 新增 `src/lib/cockpit/timeline.ts`：AuditLog / AgentRunEvent / AutomationRun 三路统一信封、按 `(at, id)` 倒序归并、游标编解码的纯函数。
- 新增 `src/lib/cockpit/posts-read-model.ts`：`getOrgPostsCockpit` 与 `getOrgCompanyLog` 两个读模型，依赖可注入，所有查询只读、按 orgId 限定（AutomationRun 本身是平台级，单独说明）。
- 新增 `GET /api/cockpit/posts`：返回七个岗位的心跳、下次应跑时间、健康度、各自动化明细、待审批数、需要你数、近 7 天动作数、KPI，以及顶部"等你 N 件"（去重后的总数与前 10 条）。
- 新增 `GET /api/cockpit/timeline`：company.log 时间线，统一信封 `{at, post, actor, kind, summary, href}`，游标分页，每页 ≤ 50，窗口 ≤ 7 天。
- 两个 API 用 `withAuth` + `resolveWorkforceApiOrgForUser`（只读的组织解析），只允许首页 `/` 同口径的管理层用户（平台超管 / 高管，或组织 org_admin / org_owner）访问。
- 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；写 `docs/QINGYAN_ORG_COCKPIT_A-2_REPORT.md` 并更新状态列。

**与任务书的偏差（GATE 审核时请逐条确认）：**
1. **心跳是平台级**：`AutomationRun` 的 24 个写入点都不传 `orgId`，同一自动化对所有组织只有一条运行流；岗位心跳与健康度按平台级计算，响应里标 `scope: "platform"`。
2. **健康度多两个取值**：除任务书的 `on_time | late | failed | quota_hit | never_ran` 外，按需运行的自动化返回 `n/a`（任务书验收已提到），缺必需环境变量或开关未开的返回 `not_configured`。否则未配置的 Activepieces / Aivora 流会永远显示 `never_ran`。
3. **迟到按真实调度判断**：`cadence` 是给人看的中文文本，仓库里没有任何解析它的代码。本 change 维护一张类型化调度表，测试逐项对照 `vercel.json` 与路由源码里的本地时刻数组；late 定义为距上次开始超过"最长正常间隔 × 1.5"。
4. **"等你 N 件"的口径**：任务书 GATE-A 写"与 `/inbox` 一致、点击跳 `/inbox`"，但 `/inbox` 是快速捕获页，与审批无关。本 change 用仓库里最完整的现成定义——`/capabilities/approvals` 的"待我审批"（PendingAction + ApprovalRequest + 产品内容审批，按决策权过滤），再并上 workforce 的需要你作业；作业关联的 PendingAction 已在待我审批里时去重。需决策类 Notification 不另计：已核实它们都是这些条目的提醒（`metadata.pendingActionId` / `entityType=approval_request`），另计就重复。A-3 的跳转目标相应改为 `/capabilities/approvals`。
5. **时间线索引**：零 schema 前提下，AuditLog 与 AgentRunEvent 都没有 `(orgId, createdAt)` 索引（只有 `(orgId)`、`(createdAt)`、`(orgId, runId)` 等）。本 change 用 7 天窗口 + 每路 `limit + 1` + AgentRunEvent 事件类型白名单兜底；任务书验收 3 的 `EXPLAIN` 在本容器无库可跑，列为 staging 验证项。
6. **AutomationRun 进时间线的范围**：只放失败 / 部分失败的运行，以及最长正常间隔 ≥ 24 小时的低频自动化的运行；否则每 2 分钟一次的队列 cron 会淹没 company.log。
7. **脱敏**：复用 Muse 的检测函数 `containsOutboundSensitive`（strict），替换文案用驾驶舱自己的，不用 Muse 那句"不通过 Muse 通道输出"。KPI 数值经 A-1 的 `pickKpiMetrics` 只取声明路径。
8. **访问控制收紧到管理层**：任务书写"复用 withAuth + 组织解析"。岗位视图汇总了投标中标数、营销线索、全组织审批与日志，本 change 按首页 `/` 的同一判定只放行管理层，其他成员 403。
9. **配额命中的判定**：`DAILY_AGENT_RUNS` 硬上限命中时，系统发起的 run 写 AuditLog 会失败（`userId` 外键），只有 Notification 可靠。本 change 两路都看：当天（UTC）的 AuditLog `QUOTA_HARD_LIMIT_BLOCKED`，加查看人自己收到的 `quota_hard_limit` 通知；命中则让有 AgentRun 工作的岗位（有 runType 或工作域归属）显示 `quota_hit`。
10. **KPI 取数的条件**：投标 KPI 只在 `TENDER_FINANCIAL_CONTROL_ENABLED` 开启时调用，与 `/api/org/tender-portfolio` 同门，关闭时返回 `disabled`。项目 KPI 按查看人的可见范围统计。`service` / `content` 保持"未接入"，不在本 change 里抽取路由内联查询，因为那会改动既有 API。

## Capabilities

### New Capabilities
- `cockpit/posts-overview`：岗位总览 API——每个岗位的心跳、调度与健康度规则、待审批 / 需要你 / 近 7 天动作 / KPI，顶部"等你 N 件"的口径与去重，访问控制与脱敏。
- `cockpit/company-log`：company.log 时间线 API——三路来源的统一信封、岗位归属、游标分页、窗口与条数上限、脱敏。

### Modified Capabilities
（无。`cockpit/post-registry` 尚未归档，本 change 只调用它的纯函数，不改它的要求。）

## Impact

- 新文件：`src/lib/cockpit/{schedule,waiting,timeline,posts-read-model}.ts`、`src/lib/cockpit/__tests__/{schedule,waiting,timeline,posts-read-model}.test.ts`、`src/app/api/cockpit/posts/route.ts`、`src/app/api/cockpit/timeline/route.ts`、`docs/QINGYAN_ORG_COCKPIT_A-2_REPORT.md`。
- `scripts/test-all.sh` / `scripts/test-ci-unit.sh`：各追加 4 条新测试。
- 既有文件零改动：既有页面、既有 API（含 `src/app/api/cockpit/route.ts`）、Prisma、`vercel.json`、cron、`src/lib/automation/**`、`src/lib/capabilities/**`、`src/lib/workforce-runtime/**`、`src/lib/muse-bridge/**` 都不动。
- 新 API 每次调用会触发多次只读查询，包括 5 个 KPI 读函数、待我审批、workforce 列表和 28 次最近运行查询。这是只读负载，本 change 不加缓存，首页只在打开时调用。

## Out of scope

- 不新建表、不写入任何表（含 AuditLog），不加索引，不加 cron，不做实时推送，不做跨组织视图。
- 不改 `/api/ai/pending-actions`、`/api/capabilities/approvals`、`/api/workforce/jobs`、`/api/org/tender-portfolio`、`/api/service-inbox`、`/api/operations/dashboard`、旧的 `/api/cockpit` 任何行为。
- 不做页面（A-3）、不做工作量聚合（A-4）、不做配额命中时的通知（B-5）。
- 不给 `service` / `content` 抽取读函数；不接 Muse `status` 意图。
- 不改 A-1 的岗位归属；不在本 change 内 archive。
