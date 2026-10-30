# A-2 完成报告：岗位读模型 + 两个只读 API（openspec change `org-cockpit-read-model`）

任务书：`docs/QINGYAN_ORG_COCKPIT_FDE_TASKBRIEF.md` §A-2
分支：`claude/org-cockpit-read-model`（叠在 A-1 `claude/awesome-turing-dorqeg` 之上；PR base = A-1 分支，A-1 合并后改回 `main`）
OpenSpec change：`openspec/changes/org-cockpit-read-model/`（proposal / `specs/cockpit/posts-overview/spec.md`（12 条 Requirement / 28 个 Scenario）/ `specs/cockpit/company-log/spec.md`（6 / 10）/ design / tasks 6/6，`openspec validate --strict` 通过）

---

## 1. 做了什么

| 文件 | 内容 |
|---|---|
| `src/lib/cockpit/schedule.ts`（新） | 28 个自动化的真实调度表 `AUTOMATION_SCHEDULES`（cron / 本地时刻门控 / 按需）；cron 子集解析；`nextDueAt`（UTC 或组织 / 固定时区）、最长正常间隔、单自动化健康度、岗位健康度纯函数 |
| `src/lib/cockpit/waiting.ts`（新） | 驾驶舱脱敏 `redactCockpitText`（Muse 检测 + 本地补充词表）；"等你 N 件"的岗位归属、去重、排序、截断与按岗位计数 |
| `src/lib/cockpit/timeline.ts`（新） | company.log 三路信封、事件白名单、来源范围常量、`(at, id)` 倒序归并、游标编解码、参数校验 |
| `src/lib/cockpit/posts-read-model.ts`（新） | `resolveCockpitViewer`（只读组织解析 + 管理层判定）、`getOrgPostsCockpit`、`getOrgCompanyLog`；依赖可注入；生产查询条件全部由导出的纯函数构造；默认实现只读、按 orgId 限定（AutomationRun 平台级例外）；KPI 加载器类型化 + 5 秒超时 |
| `src/app/api/cockpit/posts/route.ts`（新） | `GET /api/cockpit/posts`：`withAuth` → `resolveCockpitViewer` → 读模型 |
| `src/app/api/cockpit/timeline/route.ts`（新） | `GET /api/cockpit/timeline`：同上 + 参数校验 400 |
| `src/lib/cockpit/__tests__/{schedule,waiting,timeline,posts-read-model}.test.ts`（新） | 182 + 58 + 52 + 126 = 418 条断言 |
| `scripts/test-all.sh` / `scripts/test-ci-unit.sh` | 各注册 4 条 |
| `src/lib/cockpit/posts.ts`（A-1，经 PR #244 分支修正后合入） | 未分类项目（`Project.workDomain` 默认 `general`）不再把通用动作归到 `ops_knowledge` |

### 两个接口

**`GET /api/cockpit/posts`** → `{ orgId, generatedAt, timezone, heartbeatScope: "platform", quotaHit, waitingForYou: { total, truncated, unattributed, items[≤10]: { kind, id, title, post, at, href }, href: "/capabilities/approvals" }, posts[7]: { key, name, nav, health, heartbeat, nextDueAt, automations[], pendingApprovals, needsYou, actions7d: { automationRuns, agentRuns }, kpi } }`

**`GET /api/cockpit/timeline?limit=1..50&days=1..7&cursor=`** → `{ items[]: { id, at, post, actor, actorName, kind, summary, href }, nextCursor, window: { from, to } }`

两者：未登录 401；多组织未选择 / 无组织 403（与 `/api/workforce/jobs` 同响应）；非管理层（不是平台超管 / 高管、也不是组织 `org_admin` / `org_owner`）403；不写任何表、不改活动组织。

## 2. 怎么验的

| # | 验证 | 结果 |
|---|---|---|
| 1 | 4 个新测试单独运行 | schedule 182/182、waiting 58/58、timeline 52/52、read-model 126/126 |
| 2 | 调度表对照 `vercel.json` 23 条 cron 与 28 个路由源码（含组织时区门控数组与营销流的多伦多时刻） | 全部一致（测试内交叉核对；交叉审查独立复核） |
| 3 | `nextDueAt` 表驱动 | 上海 06:30 → 07:00、多伦多跨日、2026-11-01 夏令时结束（07:00 = UTC 12:00）、周一门控（固定时区忽略组织时区）、按需 null |
| 4 | 时间线三路归并 | 7 条交错数据 `limit=3` 翻页 3/3/1 不重不漏；交叉审查用 3000 组随机数据（同秒、跨来源、窗口、limit 1–5）跑真实 `getOrgCompanyLog`，无重复无遗漏 |
| 5 | 包含测试文件在内的局部 `tsc`（`src/lib/cockpit/**` + 两个路由） | 0 错误 |
| 6 | `npm run typecheck`（全量） | 退出 0 |
| 7 | `npm run lint:baseline`；新文件 `npx eslint` | PASS；新文件 0 问题（4 条 warning 均在既有 `metrics-engine.ts`） |
| 8 | `npm test` 对比 `origin/main` 基线 | 基线 411/425 → 本分支 416/430：新增 5 项即 A-1 + A-2 的 5 个测试（全 PASS）；14 项失败清单逐条一致（环境性既有问题，见 A-1 报告） |
| 9 | `npm run test:ci` | `CI unit subset PASS`，含 5 个驾驶舱测试 |
| 10 | `npm run test:runtime-architecture`（在 `npm test` 内） | PASS（新文件不在 guarded dir） |
| 11 | `git diff --stat origin/main -- prisma/ vercel.json` | 空 |
| 12 | `openspec validate org-cockpit-read-model --strict`；`/opsx:verify` | valid；18/18 requirement、38/38 scenario 覆盖，无 WARNING |

## 3. 与任务书的偏差（请 GATE 逐条确认，详见 proposal）

1. **心跳是平台级**：`AutomationRun` 的 24 个写入点都不传 `orgId`，响应标 `heartbeatScope: "platform"`。
2. **健康度多 `n/a`（按需）与 `not_configured`（缺必需变量 / 开关未开且最近没跑）**；未配置但最近确实在跑时按运行判定，不掩盖失败。
3. **迟到按类型化调度表**（对照 `vercel.json`），不解析 `cadence` 文本。
4. **"等你 N 件" = `/capabilities/approvals` 的待我审批 ∪ workforce 需要你**（作业的审批已列出则去重；需决策类通知是这些条目的提醒，不另计）。**A-3 的跳转目标改为 `/capabilities/approvals`**——任务书写的 `/inbox` 是快速捕获页。
5. **时间线索引**：AuditLog / AgentRunEvent 无 `(orgId, createdAt)` 索引。AgentRunEvent 改为先取近期有归属 run 再按 runId 查（走索引）；AuditLog 靠 7 天窗口 + `limit + 1` + 记账动作排除。`EXPLAIN ANALYZE` 留到 staging。
6. **时间线防刷屏与防泄漏**：自动化运行只放失败 / 部分失败与低频运行，且不带错误文本；AuditLog 排除配额记账与查看类动作；AI 事件只取有岗位归属的 run。
7. **脱敏**：复用 Muse 检测函数 + 驾驶舱本地补充词表（估值 / 标的额 / 我方报价 / 最终报价 / 中标金额 / 成交价 / bid price）；替换文案用驾驶舱自己的。
8. **两个 API 只对首页同口径管理层开放**。
9. **配额命中**：当天（UTC）的 `QUOTA_HARD_LIMIT_BLOCKED` 审计或查看人收到的 `quota_hard_limit` 通知（系统发起时审计写入会失败）。
10. **KPI**：投标只在 `TENDER_FINANCIAL_CONTROL_ENABLED` 开启时调用；每个 KPI 5 秒超时；`service` / `content` 保持未接入。

## 4. 交叉审查（独立审查代理，只给代码与规格）

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| B1 | 阻塞 | Muse 词表拦不住"项目估值 / 我方报价 / 最终报价 / 中标金额 / valuation / 标的额"（实测原样通过） | 驾驶舱本地补充词表 + 10 个用例；spec 增补 scenario |
| S1 | 应修 | 平台级自动化错误文本（来自遍历所有组织的任务）进时间线，可能带出其他组织数据 | 不取 `error` 列，只显示"自动化名：状态" |
| S2 | 应修 | 每次 AI 运行写 4–5 条配额记账审计、每次对话写 `run.completed`，会淹没 company.log | 审计动作排除清单；AI 事件只取有岗位归属的 run |
| S3 | 应修 | AgentRunEvent 按时间查询无可用索引 | 先取近期 run（≤ 2000）再 `runId IN` 查事件 |
| S4 | 应修 | 投标 N+1 等慢读函数会拖住整个接口 | 每个 KPI 5 秒超时 → `error` |
| S5 | 应修 | 生产 `where` 只经假依赖测试 | 抽成 8 个导出纯函数并直接断言；默认依赖静态断言确实调用它们 |
| — | 小 | 事件白名单含 workforce 刻意排除的 `job.resume_blocked`；空 `cursor` 未报 400；未配置自动化仍给 `nextDueAt`；营销流路由与注册表的必需变量口径不一致会掩盖失败；待我审批 / 需要你吞掉所有错误；条目时间字段名与语义不符；测试文件类型错误 | 全部修正 |
| — | 记录 | `listCapabilityApprovals` 每来源先取 200 再过滤；平台 `admin` 可进任意组织（与 workforce API 现状同）；`quota_hit` 只看 `DAILY_AGENT_RUNS`；cuid 排序一致性；翻页时窗口下沿漂移 | 记入 design Risks，不在本 change 修 |

审查同时独立确认了：调度事实（含营销流每次唤醒只记一条运行）、健康度与 runner 状态一致、待我审批复用的 `total` / `hasMore` 语义、workforce 字段、配额检测字段、全部 Prisma 字段名（scratch 副本全量 `tsc` 通过）、租户隔离与组织解析无写入、`next build` 无障碍（两个路由只导出 `GET`）。

## 5. staging 待验项（GATE）

- 时间线三条查询的 `EXPLAIN ANALYZE`（AuditLog 按 `orgId` + `createdAt` 窗口；AgentRun 近期 run；AgentRunEvent 按 `runId IN`）。
- 以 `seed:org:sunny-home-deco` 组织管理员调用两个接口：七个岗位、心跳时间、等你 N 件与 `/capabilities/approvals` 待我审批 + `/workforce` 需要你的人工对账。
- 两个接口的响应时间（KPI 超时 5 秒为上限）。

## 6. 已知限制

- 岗位心跳与健康度是平台级的：别的组织的运行也会刷新本组织卡片的心跳。
- 待我审批的 PendingAction 只看 30 天窗口、每来源先取 200 行（与 `/capabilities/approvals` 同口径）；超过 100 条时去重可能不完整（`truncated: true`）。
- 一周内超过 2000 个有归属 run 的组织，时间线会漏掉最早一批 AI 事件。
- 通用动作类型缺上下文时记"未归属"，`unattributed` 计数供 A-3 展示。
