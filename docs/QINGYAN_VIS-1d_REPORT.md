# VIS-1d 报告：审批中心与「待我确认」按岗位收口

OpenSpec change `vis-1d-approvals-split`（新能力 `approvals/visibility`）。任务书 `docs/QINGYAN_VIS-1_VISIBILITY_TASKBRIEF.md`；design Q1–Q12 Lucas 2026-11-11 全部按推荐。依赖 VIS-1a / 1b / 1c（#393、#400、#410）。

## 1. 用户现在会怎么看到

- **审批中心**：岗位模式企业里，一条审批只对这些人可见：
  - 本人提交的，或本人是指定审批人的；
  - 审批所在工作区的成员，审批所属项目的负责人 / project_admin；
  - 按类型的可见岗位：业务页面放行 ∧ 持该类型的审批键（见 §3）。
  - 企业成员角色 org_owner / org_admin 本身不再看到全企业的业务类型审批（**BREAKING**）。没有业务归属的草稿（助手、Grader、日历）照旧对企业所有者与成员角色 `org_admin` 可见。
- **看不见的批不了**：
  - 审批中心详情、批准、驳回、撤回、重试对看不见的审批一律 404，与「不存在」同一个错误。
  - AI 助手批准入口、项目智能体步骤审批路由、审批端口、Muse `approve` 对看不见的卡与不存在的 id 返回完全相同的结果，不透露状态。另一企业里也看不见的卡同样按不存在；看得见、但不在当前企业的，照旧提示切换企业。
- **无企业的卡**：只给创建人、指定审批人，以及卡所属项目的负责人 / project_admin，与执行器对这类卡认的处理人一致。
- **AI 助手「待我确认」与侧栏红点**：用同一组条件，即既有处理人范围 ∩ 可见集合 ∩ 当前企业（另含本人的个人草稿）。
  - 红点 = 列表里未过期的条数，改为只数当前企业。
  - 解析不出当前企业时，红点只数本人的个人草稿。
- **运营看板的待审批、审批收件箱**（`/api/agent/approvals` 与 Muse）：与「待我确认」同一组条件。收件箱改为只含当前企业，项目智能体审批也只取当前企业项目上的、可见的。
- **旧模式企业**（行业包没有岗位模板）：可见规则不变。审批中心列表沿用原规则，其余入口不按可见集合收窄。只多一条「只含当前企业」（红点与收件箱，租户隔离）。
- **平台 super_admin**：全部可见。

## 2. 改了什么

| 文件 | 改动 |
|---|---|
| `src/lib/approval/audience.ts`（新） | 类型对照 `APPROVAL_FAMILIES`、单条判定 `isApprovalVisible`、端口判定 `portCardVisible`、旧模式列表规则 `legacyListVisible`、PendingAction 查询条件 `pendingActionAudienceWhere`、三个来源的判定形状；纯模块 |
| `src/lib/approval/audience-server.ts`（新） | `loadApprovalViewer(userId, orgId)`（平台角色按库读，判定输入走路由门缓存）、`viewerForCard` / `cardVisibleTo`（按卡所属企业判；无企业的项目卡另判本人是否项目负责人） |
| `src/lib/approval/pending-mine.ts`（新） | `pendingMineWhere` / `loadPendingMineWhere`、`listMyPendingActions`、`countMyPendingActions` |
| `src/lib/navigation/route-gate.ts`、`context-server.ts` | 加载器加 `loadContextForOrg`，与 `loadContext` 共用 `(userId, orgId)` 30 秒缓存与请求合并 |
| `src/lib/capabilities/approvals/query.ts` | 列表：PendingAction 在查询里按可见集合过滤，另两类投影前判可见，旧模式沿用原规则。详情：三个来源不可见与不存在同一个 404 |
| `src/lib/capabilities/approvals/decision.ts` | 判定输入只取一次。详情先判可见，再读幂等缓存；缓存只在审批与动作都相同时命中 |
| `src/lib/tender-rfq/web-entry-approval.ts` | 一个项目只取一次判定输入 |
| `src/lib/marketing/team.ts` | 抽出 `teamApprovalScopeWhere`（行为不变） |
| `src/app/api/ai/pending-actions/route.ts`、`count/route.ts` | 改调 `listMyPendingActions` / `countMyPendingActions` |
| `src/app/api/ai/pending-actions/[id]/route.ts` | 查到卡后先按卡所属企业判可见（在跨企业提示、成员校验与处理人判定之前），看不见与不存在同一个 404 |
| `src/app/api/agent/tasks/[taskId]/steps/[stepId]/approve|reject/route.ts` | 端口判为看不见时，与路由自己的「无待处理的审批请求」同一个 404 |
| `src/lib/operations/dashboard/build-dashboard.ts` | 同一组条件，企业范围沿用看板自己的 |
| `src/lib/approval/port.ts` | 收件箱带企业。批准 / 驳回一进来就按卡所属企业判可见，在已终态分支之前；PendingAction 与项目智能体审批都判。看不见与 id 不存在逐键相同 |
| `src/lib/agent/approval.ts`、`src/app/api/agent/approvals/route.ts` | `getPendingApprovals` 只取当前企业项目上的、可见的；路由按 `resolveAssistantOrgId` 取企业 |
| `src/lib/muse-bridge/router.ts` | 收件箱带绑定企业；`approve` 先判可见再判网页预览 |
| 测试 | 新增 `audience.test.ts`（纯函数）、`audience-db.isolated.test.ts`（隔离库）；route-gate 与营销中间件测试的假加载器补 `loadContextForOrg`；`draft-feedback` 一条源码断言随端口共用 select 更新 |
| `scripts/test-all.sh`、`scripts/test-ci-unit.sh` | 注册两个新测试（纯函数的另进 CI 子集） |

零 schema、不新增权限键、零新增 LLM 调用、不新增队列 / cron。执行器（`canDecideTeamApproval` 与各类型的批准键校验）不改。

## 3. 审批类型目录（按代码逐个核对）

PendingAction 已登记 20 个类型（`src/lib/pending-actions/types.ts`），另有项目智能体审批（ApprovalRequest）与产品内容审批两个来源。生产方里没有任何一处设置工作区，工作区路径实际不生效。

| 类型 | 生产方 | 指定审批人 | 可见岗位（业务页面 ∧ 审批键） |
|---|---|---|---|
| `sales.approve_quote_promotion` | `api/sales/quotes/[quoteId]/request-promotion-approval` | 持键的第一位 | `/sales/quote-sheet` ∧ `sales.quote.discount.over_limit.approve` |
| `sales.update_signed_quote` | `lib/sales/signed-quote-amount.ts` | 持键的第一位 | `/sales/quote-sheet` ∧ `sales.quote.signed_amount.approve` |
| `sales.update_quote_settings` | `lib/sales/quote-settings-approval.ts` | 持键的第一位 | `/sales/cockpit` ∧ `sales.settings.manage` |
| `orders.cancel_blinds_order` | `api/blinds-orders/[id]/transition` | 持键的第一位 | `/blinds-orders/_` ∧ `orders.cancel` |
| `install.send_warranty_email` | `lib/install/warranty-service.ts` | 持键的第一位 | `/accounting` ∧ `install.balance.confirm` |
| `install.send_repair_visit_email` | `lib/install/repair-visit-email-service.ts` | 持键的第一位 | `/install` ∧ `install.task.assign` |
| `revenue_spine.propose_commercial_fact` | `lib/revenue-spine/fact-proposals.ts` | 企业所有者优先，否则在职的 boss / admin | `/revenue` ∧ `trade.settings.manage` |
| `sales.send_inquiry_reply` | `lib/revenue-spine/fde/inbound-sales.ts`、`no-reply-followup.ts` | 跟进销售 | `/revenue` ∧ `trade.settings.manage` |
| `tender.send_rfq`、`tender.send_chase` | `lib/tender-rfq/service.ts`、`chase-service.ts` | 无（项目内） | `/bids` |
| `marketing.*`（4 类） | 增长中心路由、营销员工、研究计划、技能桥 | 多数有，技能桥两类无 | `/marketing` |
| 项目智能体审批（ApprovalRequest） | 旧编排栈步骤审批 | 任务创建人或空 | `/bids` |
| 产品内容审批 | 产品内容作业 | 无 | `/product-content` |
| `sales.update_followup`、`sales.update_stage`、`calendar.create_event`、`grader.*`（3 类） | 助手 / Grader（`lib/ai-grader/actions/to-pending-action.ts`）、营销员工的邮件草稿 | 无 | 无业务归属：企业所有者与成员角色 `org_admin` |

## 4. 按身份的可见类型（按真实实现计算：Sunny / 梦馨默认模块，岗位模式；「他人提交、不在本人项目 / 工作区」的卡）

指定审批人、本人提交、项目负责人 / project_admin、工作区成员另外可见，表里不重复。

| 身份 | 报价让利审批 | 签约改价 | 折扣设置变更 | 作废工艺单 | 质保邮件 | 返修上门邮件 | 外贸营收 | 招投标 | 营销 | 项目智能体审批 | 产品内容 | 无业务归属 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Sunny 老板（owner，企业所有者） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | ✓ |
| 不持岗位的 org_admin | — | — | — | — | — | — | — | — | — | — | — | ✓ |
| 会计（accounting） | — | — | — | — | ✓ | ✓ | — | — | — | — | — | — |
| 合价（pricing_lead） | — | — | — | — | — | — | — | — | — | — | — | — |
| 运营（ops_staff） | — | — | — | — | — | — | — | — | ✓ | — | — | — |
| 运营主管（ops_lead） | — | — | — | — | — | ✓ | — | — | ✓ | — | — | — |
| 招投标（bids） | — | — | — | — | — | — | — | ✓ | — | ✓ | — | — |
| 销售（sales_rep） | — | — | — | — | — | — | — | — | — | — | — | — |
| 梦馨 Cathy（owner + trade_rep，org_admin） | — | — | — | — | — | — | ✓ | — | ✓ | — | ✓ | ✓ |
| 梦馨外贸（trade_rep） | — | — | — | — | — | — | — | — | — | — | ✓ | — |
| 旧模式 org_admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 平台 super_admin（未绑岗位） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

「看得见」不等于「批得了」：能批判定不变，「待我审批」仍是可见 ∧ 待审批 ∧ 本人能批。例如运营看得到全部营销卡，但批不了（指定审批人照常批）。

## 5. 测试与门禁（实际运行，最终代码）

**新测试**
- `src/lib/approval/__tests__/audience.test.ts`：98 passed, 0 failed。覆盖：对照表、按身份的可见类型、端口判定顺序、查询条件与单条判定逐行同义（小求值器，每个身份 60–100 行样例）、「待我确认」求值、各入口的源码断言。已注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
- `src/lib/approval/__tests__/audience-db.isolated.test.ts`：本机隔离库 44 通过，0 失败。无库时跳过、退出码 0。已注册进 `scripts/test-all.sh`。

**隔离库**：容器里临时起的 PostgreSQL 16（装 pgvector），`prisma migrate deploy` 42 个迁移。origin/main（`a17f4f7f`）与本分支各用一个库，迁移相同（零 schema）。冒烟测试要的 Sunny / 梦馨企业用一个只写本机库的种子脚本补上（虚构成员各一）。

| 既有隔离库测试 | origin/main | 本分支 |
|---|---|---|
| phase3a3-approvals-smoke | 27 / 1 失败 | 27 / 1 失败（同一条：「Tool 停用后已批准路径也不能执行」，断言列表逐行相同） |
| b2-approval-cas.isolated | 23 | 23 |
| durable-followup-m1.isolated | 61 | 61 |
| booth-cards-db | 69 | 69 |
| website-inquiry-async-db | 58 | 58 |
| revenue-spine-db | 166 | 166 |
| onboarding-db | 82 | 82 |
| owner-today-db | 39 | 39 |
| workforce phase2c1-pause-resume / phase2c1-expiry-races / p0-execution-alignment | 26 / 7 / 51 | 26 / 7 / 51 |
| install warranty-db / repair-visit-email-db | 52 / 26 | 52 / 26 |
| tender-rfq followup-auto-db | 28 | 28（多一行既有竞态日志，见 §9） |
| messaging wechat-binding-confirm-db | 25 | 25 |

新隔离库测试的输出（逐条）：

```
═══════════════════════════════════════════════════════
═══════════════════════════════════════════════════════
  ✓ 不持岗位的 org_admin：列表里没有他人的询价卡与项目智能体审批
  ✓ 不持岗位的 org_admin：只见无业务归属的草稿，不见销售 / 安装类
  ✓ 详情：看不见与不存在同一个 404
  ✓ 批准：看不见的 404，状态不变
  ✓ 项目智能体审批详情：看不见 404
  ✓ Sunny 老板：「待我审批」有让利审批且能批
  ✓ Sunny 老板：询价、质保邮件、无业务归属草稿都可见
  ✓ 会计：只见质保邮件
  ✓ 梦馨 Cathy：看得到营收类审批
  ✓ 幂等：看不见的卡带它自己的幂等键 → 404
  ✓ 幂等：可见的审批 id 带别人的键，不返回别人的缓存（照常判过期）
  ✓ 幂等：审批与动作都相同时照旧命中
  ✓ 幂等：同一审批、不同动作不命中
  ✓ 不持岗位的 org_admin：「待我确认」只有本企业无业务归属草稿与个人草稿，不含另一企业的
  ✓ 红点数 = 列表里未过期的条数（过期的列表照常显示）
  ✓ 解析不出当前企业：红点只数本人的个人草稿
  ✓ spec 场景：列表只有本企业的助手草稿（过期的照常列出）
  ✓ spec 场景：红点数为 1
  ✓ Sunny 老板：「待我确认」有让利审批、询价与无业务归属草稿
  ✓ 不持岗位的 org_admin：收件箱不含看不见的卡（含项目智能体审批），也不含另一企业的
  ✓ 招投标（项目负责人）：收件箱有询价卡与项目智能体审批
  ✓ 项目智能体审批：只给看得见的（Sunny 老板有，不持岗位的管理员没有）
  ✓ 项目智能体审批：企业为空或另一企业时为空
  ✓ 端口批准：看不见的卡与随机 id 结果相同，未执行
  ✓ 端口批准：看不见的已执行卡也不透露状态
  ✓ 端口驳回：看不见的卡与随机 id 结果相同，状态不变
  ✓ 端口项目智能体审批：看不见与不存在相同，状态不变
  ✓ 端口：调用方企业与卡的企业不同 → 视为不存在
  ✓ 催单自动批准：批准人看不见那张卡时端口拒绝，留作待批
  ✓ AI 助手：看不见的卡与不存在的 id 返回相同的 404，未执行
  ✓ AI 助手：另一企业里也看不见的卡，与不存在相同（不透露属于哪家企业）
  ✓ AI 助手：不是那家企业成员的，另一企业的卡按不存在
  ✓ AI 助手：在卡所属企业里看得见、但当前企业不同的，照旧提示切换企业（403），未执行
  ✓ Muse：绑定解析成功
  ✓ Muse approve：看不见的卡与不存在的 id 答复相同（不是网页预览答复）
  ✓ 旧模式管理员：审批中心列表看全企业（含他人的询价卡）
  ✓ 旧模式普通成员：列表照原规则只见本人相关
  ✓ 旧模式项目负责人：「待我确认」照旧含他人的 tender.send_rfq
  ✓ 旧模式非处理人经 AI 助手：处理人判定拒绝（不是 404，可见校验已放行），未执行
  ✓ 旧模式非处理人经端口：执行器「无权操作该草稿」（可见校验已放行），未执行
  ✓ 无企业的项目卡（岗位模式）：项目负责人与创建人可见，企业管理员与持岗位的老板不可见
  ✓ 无企业的项目卡：真实查询条件与单条判定一致（运营看板口径）
  ✓ 无企业的项目卡（旧模式）：项目负责人照旧可批（不收窄），企业管理员按执行器本就不认
  ✓ 两家旧模式企业的管理员：红点只数当前企业
VIS-1d 审批可见集合 DB 端到端：44 通过，0 失败
```

**受影响的既有测试**（最终代码的 `npm test` 输出；基线 = origin/main e4c51284，见 tasks.md）

| 测试 | 基线 | 现在 |
|---|---|---|
| phase3a3-approvals-rbac | 34 | 34 |
| posts-read-model | 162 | 162 |
| waiting | 80 | 80 |
| fact-proposals | 37 | 37 |
| research-plan | 通过 | 通过 |
| b2-approval-cas-static | 18 | 18 |
| repo-conformance | 9 | 9 |
| approval-resume | 10 | 10 |
| draft-feedback | 95 | 95（一条源码断言随端口共用 select 改写，意图不变） |
| workload | 94 | 94 |
| audit-labels | 11 | 11 |
| platform-admin-scope | 43 | 43 |
| route-gate | 141 | 141（假加载器补 `loadContextForOrg`） |

`phase3a3-approvals-rbac` 没有断言审批中心列表的「管理员看全量」，无需改。

**门禁**
- `npm run test:ci`：CI unit subset PASS（334s）。
- `npm test`：602/615 通过，13 失败。origin/main（`a17f4f7f`）同环境 600/613 通过、13 失败，失败清单逐条相同（多出的 2 个是两个新测试）：Agent Trace 只读查询、Phase3A-2 Ledger DB、Phase3A-2 Smoke Access、Phase3A-3 Approvals Smoke、Governance Hygiene Gate、Governance Hygiene Concurrency Gate、Phase3A-4 Governance Smoke、Phase3A-4 Acceptance、Phase3A-5 Settle DB、Phase3A-5 Overview Acceptance、Gmail Draft OAuth Compose Scope、T4 授标情报真实 Postgres 矩阵、Quote Operations 客户报价 PDF 分页布局（Chromium；缺失则 SKIP）。都要 Postgres、Chromium、Gmail 或 Agent Trace 环境，与本次改动无关。
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`：通过。
- `npm run lint:baseline`：通过。
- `bash scripts/check-test-registry.sh`：已注册 591 个；历史欠账基线剩余 68 条。
- `npx next build --webpack`：默认堆（约 2 GB）在本机 OOM 退出（134）；`NODE_OPTIONS=--max-old-space-size=8192` 重跑通过（258s）。警告只有既有的 Sentry / OpenTelemetry 与 `html-to-pdf` 动态依赖。
- `openspec validate vis-1d-approvals-split --strict`：通过。

## 6. 独立审查与处理

审查子代理只拿 diff 与 spec 增量（不给 design），结论：2 Major、4 Minor，无 Blocker。

| # | 级别 | 发现 | 处理 |
|---|---|---|---|
| 1 | Major | 无企业、挂了项目的卡被收窄成只给创建人 / 指定审批人，项目负责人 / project_admin 批不了（执行器认他们）；旧模式运营看板列得出、批不了，违反「旧模式批准入口不收窄」 | **已修**：无企业的卡另给该项目的负责人 / project_admin（`viewerForCard` 按 `Project.ownerId` 与 active 的 project_admin 判，与执行器同源），查询条件同步；design D5 第 2 步按此修订。纯函数与隔离库各补场景 |
| 2 | Major | AI 助手入口对另一企业的卡先返回 403「当前企业与动作所属企业不一致」，对不存在的 id 返回 404，可据此探测另一企业的审批是否存在 | **已修**：查到卡后先在卡所属企业里判可见，看不见与不存在同一个 404；看得见、但不在当前企业的，照旧 403 提示切换企业。design D7 按此修订。隔离库补三条（另一企业也看不见 → 与不存在相同；非成员 → 404；看得见 → 403、未执行） |
| 3 | Minor | 项目智能体步骤审批路由：不存在时路由 404，看不见时端口结果被映射成 400，可区分 | **已修**：端口判为看不见时同一个 404（源码断言） |
| 4 | Minor | 工作区路径只认列，不回退 `payload.workspaceId` | 记为已知局限（§9）：建卡时已写进列，目前无生产方设置工作区 |
| 5 | Minor | 隔离库测试没有字面复现 spec「红点数为 1」；端到端场景 CI 不跑 | **已修**前半：补一位没有个人草稿的管理员，原样断言列表只有本企业助手草稿、红点数为 1。后半为项目惯例，记入 §9 |
| 6 | Minor | 判定输入 30 秒缓存 | design Q6 已拍板，记入 §9 |

审查同时核对为满足的：两张对照表逐条一致；无业务归属草稿只给企业所有者与成员角色 `org_admin`；旧模式列表与改动前等价；`AND` 没有被展开对象里的 `OR` 覆盖；幂等在可见判定之后、按审批与动作命中（`rememberIdempotency` 撞键分支的返回值调用方不用，无泄漏）；四处共用同一组条件；端口在终态分支之前判、看不见与不存在逐键相同；Muse 先判可见；测试不执行任何审批。

## 7. 拍板结果与实现中的落地

design Q1–Q12 Lucas 2026-11-11 全部按推荐。实现中按 design 原文落地、值得记一笔的三处（独立审查后的两处修订见 §6）：
- 旧模式企业：`pendingActionAudienceWhere` 返回 `{}`（D4），且「旧模式」按企业的行业包判，在「非成员」之前（D5 第 4 → 5 步）。这样旧模式的项目负责人在「待我确认」与运营看板里照旧看到本项目上他人的卡，可见集合条件为「不限制」，与 spec 场景一致。
- 旧模式企业里的平台 super_admin：审批中心列表照原规则（按成员角色）；详情、端口照 super_admin 全部可见。与改动前相同。
- 幂等缓存：可见判定（详情）→ 幂等读取 → 过期 → 能力检查。`rememberIdempotency` 撞键分支的返回值所有调用方都不用，不构成缓存命中路径，未改。

## 8. 上线步骤与生产核对清单

上线：合并后照常 `vercel --prod`。零 schema，无回填脚本。

上线后核对（只读）：
1. Sunny 老板登录：审批中心「待我审批」与改动前相同（让利、签约改价、折扣设置、作废工艺单、质保 / 返修邮件、询价）；「全部」页签看得到营销与产品内容卡。
2. Sunny 里不持 `owner` 岗位的企业管理员（若有）：审批中心只剩本人相关与助手 / Grader 草稿；直接打开他人询价卡的详情链接得到「审批不存在」。
3. 会计（Miki 若只持 `accounting` 时）：只见质保 / 返修邮件卡。Miki 在 `config/positions/sunny.json` 里同时持 `owner`，所以她实际看到的与老板相同（design Q10）。
4. 梦馨 Cathy：审批中心看得到商务事实提案、询盘回复、营销、产品内容；看不到招投标。
5. 侧栏红点：多企业成员切换企业后，红点数与 AI 助手「待我确认」里未过期的条数一致。
6. Muse：`status` 的项目待批数、`ask` 的最早待批 id 只含绑定企业；`approve` 一张自己看不见的卡，答复与不存在的 id 相同。
7. 催单自动批准：批准人仍持招投标岗位时照常自动发出；批准人已不持时卡留作待批（`tender/rfq-followup-preapproval`）。
8. 无企业但挂了项目的待审批卡（只读，了解存量）：`SELECT count(*) FROM "PendingAction" WHERE "orgId" IS NULL AND "projectId" IS NOT NULL AND status = 'pending';`。这类卡对创建人、指定审批人与项目负责人可见可批，与改动前执行器的规则相同。

## 9. 已知局限与建议的后续 change

本 change 只保证「看不见的批不了」，执行器规则不改。实现前核对发现、建议各自另立的问题（design Q11）：
- 创建人批不了自己的企业级草稿（执行器只认 super_admin、指定审批人、企业所有者、成员角色 `org_admin`、项目负责人与 project_admin）。
- 多位持键人只存第一位为指定审批人。
- 销售 / 订单的键校验在认领之后，失败会消耗审批卡。
- 审批中心把组织角色当平台角色传给执行器（`decision.ts` 传 `access.orgRole`）。
- 审批中心的能批判定（`canDecidePending`）与执行器不一致：不认项目负责人，却认成员角色 `org_owner`。

另外：
- 项目智能体审批与产品内容审批仍是取 200 条后在内存里过滤。范围窄的人可能看不到窗口之外更早的可见条目。量小，ApprovalRequest 是冻结的旧栈。
- 工作区路径只认 `PendingAction.workspaceId` 这一列，不回退到 `payload.workspaceId`（审批中心的能批判定与投影会回退）。`drafts.ts` 建卡时已把 payload 里的工作区写进列，且目前没有任何生产方设置工作区，所以不影响现有数据；若以后有生产方只写 payload，需要补回退。
- 判定输入最多旧 30 秒（design Q6）：岗位或权限键撤销后的 30 秒内，列表与可见判定仍按旧的；批准时执行器另按库里的当前状态重判处理人。
- 端口、Muse、幂等、详情 404 等端到端场景只在隔离库测试里验证。CI 无库时跳过（项目惯例），纯函数部分（含源码断言）在 `test:ci` 里。
- 环境隔离检查拦截写入时（非生产环境误连生产库等），对不存在的 id 端口返回隔离错误，对看不见的卡返回「草稿不存在」。这只发生在任何执行都被拒绝的环境里。
- `tender/rfq-web-entry` 的「需要组织管理员批准」提示文字在不持招投标岗位的管理员那里不再准确，本次不改（design Q12）。
- 隔离库跑 `tender-rfq/followup-auto-db` 时，本分支每次多打一行 `[createDraftBatch] failed … 25P02`（origin/main 3 次 0 行）。断言 28/28 不变。原因是 `pending-actions/drafts.ts` 在交互式事务里捕获唯一冲突后继续查询，Postgres 已中止该事务，「复用已有行」分支不可能成功。端口多了几次可见判定查询，并发两次扫描的时序随之变化，落到了这条既有分支上。已另提任务修。
