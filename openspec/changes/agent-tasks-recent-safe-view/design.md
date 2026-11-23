# Design：最近任务接口只给还能打开项目的人，检查报告只给平台管理员（FIX-23）

## Context

动机见 proposal.md 的 Why。这里只写决定做法需要的现状（main = `22a87fb7`，行号都对过）。

**接口现在做什么**（`src/app/api/agent/tasks/recent/route.ts`，整个文件 46 行）：

- 只包了 `withAuth`（`:10`）：有会话、账号 active 即可。
- 查询条件只有 `createdById: user.id`（`:16`）与可选的 `triggerType`（`:17`）；`limit` 默认 10、上限 20（`:12`），按建任务时间倒序取前 N 条（`:41-42`）。
- 每个任务返回项目的 ID 与名字（`:29`）；每一步返回 `id / title / status / outputSummary / checkReportJson`（`:30-39`），`checkReportJson` 原样给出（`:36`）。
- 不查项目权限，不分平台管理员与业务用户。

**检查报告里有什么**：

- 技能执行失败时，检查报告是「步骤执行失败：<原始报错>」，issues 与 blockers 各一条（`src/lib/agent/checker.ts:22-40`）。写入点：
  - 旧编排 `src/lib/agent-core/skills/flow-runner.ts:367-371`（cron 巡检、项目页手动建的任务都走这里）；
  - 一键投标方案 `src/app/api/projects/[id]/ai-bid-package/run-step/route.ts:127-131`（FIX-21 合并后是 `:148-152`）。
- 原始报错可能夹带模型原文：报价草稿模型返回格式不对时，原始输出的前 500 字作为报错存下（`src/lib/agent/skills/quote.ts:144`），报价草稿以供应商单价为输入。用到报价草稿的模板：一键投标方案（`src/lib/agent/templates/ai-bid-package.ts:31-36`）、投标准备（`bid-preparation.ts:30-35`）。
- 技能自带的检查报告也会带业务数字：cron 巡检第 4 步「报价状态检查」（`src/lib/agent/templates/project-inspection.ts:35-42`）把规则检查的问题原样写进报告（`quote.ts:274-288`），其中有「利润率 X%，低于 Y% 安全线」「利润率 X%，偏低」（`src/lib/quote/rules.ts:74`、`:83`）。
- 旧编排里技能失败的步骤状态是「等待审批」，不是「失败」：检查不通过就转人工（`flow-runner.ts:373-379`）。所以不能按步骤状态认出「这份报告里有原始报错」。

**同一张任务表的安全约定**：

- `src/lib/agent-tasks/dto.ts:1-9`：普通业务用户拿不到 `inputJson / outputJson / checkReportJson / 原始 error`，禁止「先返回完整对象再由前端删字段」；平台管理员保留完整诊断视图。
- 业务视图把 `checkReportJson` 置 `null`（`dto.ts:119`），诊断视图给原文（`:147`）；内部字段清单是 `AGENT_STEP_INTERNAL_FIELDS`（`:16-20`）；列表视图已有一个只脱敏报错的 `sanitizeListStepError`（`:199-210`）。
- `/api/agent/tasks/:taskId` 先过项目读权限守卫，再按 `isPlatformAdmin` 选视图（`[taskId]/route.ts:47-55`）；列表 `/api/agent/tasks` 同样先过守卫（`tasks/route.ts:25-27`）。
- FIX-21（未合并，分支 `claude/zen-turing-azudvx-fix21`）把一键投标方案两个接口也改成了这个口径（GATE 1 = C，Lucas 2026-11-22）。
- 本接口是同一张表上唯一的例外。Security P0 当时有意没改它（`docs/QINGYAN_TENDER_PROJECT_SECURITY_P0_REPORT.md:91`，遗留项 SD-2 在 `:154`），理由是 dashboard「自动巡检」卡要解析检查报告，「如需硬化另立安全投影任务」。

**界面上谁在调**（逐个查过）：

- 全仓库只有 `src/components/dashboard/dashboard-auto-inspections.tsx:62` 调它，固定 `?triggerType=cron&limit=5`。卡片用检查报告数「N 项发现」并列出问题（`:130-138`、`:175-181`）；`checkReportJson` 为 `null` 时这两处都按「没有问题」处理，不报错。
- 这张卡只挂在 `src/components/dashboard/management-dashboard-client.tsx:289`，而 `ManagementDashboardClient`（`:37`）在 main 上**没有任何页面引用**：首页渲染的是 `OrgCockpitHome`（`src/app/(main)/page.tsx:21`），驾驶舱测试断言首页不再引用旧仪表盘（`src/components/cockpit/__tests__/org-cockpit-view.test.tsx:258`）。全仓库对 `management-dashboard-client` 的引用只剩两个读源码的测试（`src/lib/navigation/__tests__/entry-naming.test.ts:286`、`src/lib/authorization/__tests__/residual-reads.test.ts:162`）。
- 所以今天界面上没有人能看到这个接口的输出；能拿到它的只有直接请求接口的人（浏览器地址栏、脚本）。
- 服务端代码、cron、数字员工工具都不调这个接口。

**谁的任务会出现在谁的列表里**：

- cron 巡检以项目负责人的身份建任务（`src/app/api/cron/inspect/route.ts:59-65`，`userId: project.ownerId`，`triggerType: "cron"`），只按 `status: "active"` 选项目、不看是否已分发（`:30-45`）。
- 手动任务：
  - `POST /api/agent/tasks` 要项目管理权限（`tasks/route.ts:88`）。界面入口有两个：平台管理员才看得到的项目内部面板；对话里 AI 提出的任务卡（`src/components/work-suggestion/index.tsx:15-16`、`agent-task-card.tsx:23`）。
  - 一键投标方案的建任务在 FIX-21 之前任何登录账号都能调。
- 因此「已被移出项目」「从别的企业建过任务」的人确实可能有挂在别人项目上的任务。生产上有多少，只读查询见 tasks 3.2。

**项目读权限守卫与现成的批量写法**：

- `requireProjectReadAccess`（`src/lib/projects/access.ts:116-165`）：
  - super_admin 全放行（含未分发，`:130-137`）；
  - 其余人：未分发 404（`:139-141`）；放行负责人（`:152`）、项目所在组织 active 的 owner / admin（`:156`）、项目 active 成员（`:160`）；否则 403。
  - 组织角色经 `getOrgMembership` 读取，岗位预览中只认预览企业、角色降为 `org_member`（`src/lib/auth/index.ts:70-80`）；平台角色在预览中降为 `user`（`:48-57`）。
- 现成的批量写法：`buildReadableProjectWhere(userId, adminOrgIds)`（`src/lib/search/where.ts:46-58`，注释写明「与详情页读判定同口径」）。`/api/search` 的用法（`src/app/api/search/route.ts:21-29`）：
  - super_admin 不加范围；
  - 其余人用 `listEffectiveMemberships`（`src/lib/preview/server.ts:226-230`：active 组织成员身份，预览中只有预览企业、角色 `org_member`）取组织，再用 `isOrgSystemAdmin`（`src/lib/rbac/roles.ts:121-123`）挑出 owner / admin。
  - 这与守卫的 `hasOrgRole(role, "org_admin")` 等价（`roles.ts:39-44`、`:125-130`：只有 owner 40、admin 30 两级不低于 30）。
- 另一个现成函数 `buildProjectVisibilityWhere`（`src/lib/projects/visibility.ts:36-64`）口径不同：
  - 任何 active 组织成员都能看到本组织全部项目；
  - 负责人只在项目没有组织时才算。
  - 它是项目列表页的口径，不是详情接口的口径。

**冻结面**：

- `src/lib/agent-tasks` 与 `src/app/api/agent/tasks` 都在 runtime-architecture 的 `agent-task-legacy` 冻结区（`src/lib/runtime-architecture/manifest.ts:150-173`；路径在 `:154`、`:157`），允许的改动含 `security_fix`（`:166-172`）。
- 冻结模块的消费者普查跳过冻结区自己的文件（`src/lib/runtime-architecture/guards.ts:251-252`）；对 `agent-tasks-legacy`，`src/app/api/agent/` 下的文件都算区内（`:301-302`）。
- baseline 里 `agent-tasks-legacy` 的消费者只有 `src/components/project-detail/internal-agent-tools.tsx`（`runtime-architecture-baseline.json:322-324`），区内文件只有 `dto.ts` 与 `guarded-mutation.ts`（`:49-52`）。`recent/route.ts` 在 baseline 里一处都没出现，它不是冻结面的基线消费者，而是冻结区内部的文件。
- 同目录的两个路由已经直接导入 `dto.ts`（`tasks/route.ts:9`、`[taskId]/route.ts:9-12`）。
- 普查不扫测试文件（`src/lib/runtime-architecture/scan.ts:24`、`:33`），所以在 `src/lib/agent-tasks/__tests__/` 下加测试不算新文件。

**现有测试**：

- `src/lib/agent-tasks/__tests__/dto.test.ts`：23 项，`scripts/test-all.sh:177`。
- `src/app/api/agent/tasks/__tests__/authz-contract.test.ts`：9 项，`:178`。它的登记表（`:37-73`）列了这个目录 7 个路由文件中的 6 个，**没有 `recent/route.ts`**。
- 两个都不在 `scripts/test-ci-unit.sh` 里。

## Goals / Non-Goals

**Goals:**

- 不是 super_admin 的调用者只看到自己建的、而且现在仍能打开项目的任务；判断与 `/api/agent/tasks/:taskId` 用的守卫一致，在一次查询里完成。
- 不是平台管理员的调用者拿不到检查报告；平台管理员照旧。
- 响应形状、参数、排序不变；平台管理员看到的一字不变。
- `/api/agent/tasks/` 目录以后新加的路由没登记进授权布线契约，CI 里就失败。

**Non-Goals:**

- 不改 `src/lib/projects/access.ts`、`src/lib/projects/visibility.ts`、`src/lib/search/where.ts`、`src/lib/preview/server.ts`、`src/lib/rbac/roles.ts`、`src/lib/rbac/platform-admin.ts`：只导入。
- 不改 `src/lib/agent/checker.ts`、`src/lib/agent-core/skills/flow-runner.ts`、`src/lib/agent/skills/**`、`src/app/api/projects/[id]/ai-bid-package/**`：检查报告照旧按原文存库。
- 不改 `src/lib/agent-tasks/guarded-mutation.ts`；`dto.ts` 只加一个函数，不改已有导出。
- 不改 `src/app/api/agent/tasks/route.ts`、`[taskId]/**`、`src/app/api/agent/approvals/route.ts`、`src/app/api/cron/inspect/route.ts`。
- 不改 `src/components/dashboard/**`、`src/components/agent-tasks/**`（界面）。
- 不改 `src/lib/runtime-architecture/**`（含 baseline 与 manifest）。
- 不改 `prisma/**`、`src/lib/muse-bridge/**`。

## Decisions

### D1 范围：与项目读权限守卫同口径，写进一次查询（「留给 GATE」第 2 条，推荐 A）

- 做法：
  - 调用者是 super_admin（按 `withAuth` 给的用户判断，预览中已降为 `user`）时，不加项目条件。
  - 否则先 `listEffectiveMemberships(user.id)`，用 `isOrgSystemAdmin` 挑出组织；再把 `buildReadableProjectWhere(user.id, adminOrgIds)` 作为 `project` 的关系条件，与 `createdById`、`triggerType` 放进同一个 `where`。
  - 照 `/api/search` 的写法（`search/route.ts:21-29`），不新写判定。
- 不加路由门（`/api/search` 另外判的 `shouldSearchProjects`）：详情接口也不看路由门，这里对齐的是接口，不是页面。
- 为什么等价：逐项对照见 Context「项目读权限守卫与现成的批量写法」。
  - 预览：两边的组织角色都降为 `org_member`，都过不了管理员那一档；项目成员身份与负责人两边都不看预览。
  - 守卫以后改了（例如 FIX-21 后续第 4 条要收紧「已离开组织的负责人」）、这里没跟着改，隔离库测试的对照断言会失败（D6）。
- 改口径影响谁：自己建了任务、但现在打不开那个项目的人。super_admin 不受影响。
- 被否决：每个任务逐个调守卫。
  - 最多 20 个任务，每个 3–4 次查询；
  - 守卫要 `request`、返回的是响应对象，不适合在循环里用；
  - 结果与本做法相同。
- 被否决：用 `buildProjectVisibilityWhere`（列表页口径）。
  - 同组织的普通成员（不是项目成员）会继续看到自己在别人项目上建的任务，点进详情却是 403；
  - 已离开组织、仍是负责人的人反而看不到自己的 cron 巡检任务，与详情接口相反。
- 被否决：只加「项目的组织 ∈ 调用者的 active 组织」。挡住了别的企业，挡不住被移出项目的人。
- 被否决：在 `src/lib/projects/visibility.ts` 另写一个同口径的条件函数。与 `search/where.ts:46-58` 重复，多一处会漂移的地方；把那个函数挪过去要改搜索模块和它的读源码测试（`src/lib/search/__tests__/search-where.test.ts:94`），超出本次范围。

### D2 先筛后取

- 项目条件和其它条件一起放在 `where` 里，`take: limit` 取的是「最近 N 条可见任务」。
- 被否决：先取 N 条再在内存里筛。返回会少于 N 条，更早但可见的任务会被新近不可见的任务挤掉（夹具用例见 D6 第 4 条）。

### D3 不是平台管理员时 `checkReportJson` 为 `null`：在冻结面内部直接复用 dto（「留给 GATE」第 1 条，推荐 A）

- 做法：
  - `dto.ts` 的列表视图部分（紧挨 `sanitizeListStepError`）加一个函数：传入步骤与「是不是平台管理员」。
    - 是平台管理员：原样返回；
    - 不是：把 `AGENT_STEP_INTERNAL_FIELDS` 里在这个步骤上出现的键逐个置 `null`，其余键不动，不新增键。
  - 路由按 `isPlatformAdmin(user)` 调它。`recent/route.ts` 只选了 `checkReportJson` 这一个内部字段，所以效果就是 `checkReportJson: null`。以后有人往这里的 `select` 加 `outputJson`，也会自动置空。
- 为什么能导入：`recent/route.ts` 在冻结区内部，导入 `dto.ts` 不进消费者普查（Context「冻结面」），同目录两个路由已经这样用；`dto.ts` 加函数不加文件，`FROZEN_AREA_NEW_FILE` 不触发。改动类别是 `security_fix`。`npm run test:runtime-architecture` 应当不改 baseline 就通过（验证方式）。
- 与 FIX-21 的区别：FIX-21 的两个路由在 `src/app/api/projects/` 下，导入会成为冻结面的新消费者，所以只能照抄固定提示、再用测试比对。这里不需要照抄。
- 键保留、值为 `null`：与业务视图 `dto.ts:119` 一致，现有调用方按「没有问题」处理。
- 步骤摘要 `outputSummary` 保留：业务视图也保留（`dto.ts:114`）。
  - cron 巡检四步的摘要：上下文与风险扫描是项目名和条数（`project-understanding.ts:38`、`risk-scan.ts:41`），报价审查是评分与条数（`quote.ts:293`），进展摘要是模型写的项目进展摘要（`progress-summary.ts:22`）。最后这一份与项目「进展摘要」接口给能读项目的人看的出自同一个生成器（`src/app/api/projects/[id]/progress-summary/route.ts:60`、`:72`）。
  - 报价草稿成功与失败时的摘要是条数与固定说法（`quote.ts:153`、`:156`）。
  - 失败时的摘要都是固定说法，原始报错只进 `error` 与检查报告。
- 被否决：用 `toBusinessAgentTaskStep` / `toDiagnosticAgentTaskStep`。
  - 要多选 5 列，响应多出十几个键，形状变了；
  - 平台管理员那边要么多选 `inputJson / outputJson`（20 步原始输出，报价草稿含价格，响应变大），要么诊断视图里这两项是假的 `null`。
- 被否决：在路由里手写一行置空。同一条规则多一处会漂移的地方；`dto.ts` 已有列表视图的先例。
- 被否决：在前端删字段。`dto.ts` 头注释明令禁止。

### D4 平台管理员照旧拿原文

- 平台管理员（`isPlatformAdmin`，只认 super_admin，`src/lib/rbac/platform-admin.ts:14-22`）拿到的任务范围与每一步内容都与改动前一致。
- 与 `/api/agent/tasks/:taskId` 的诊断视图、FIX-21 GATE 1 = C 的「平台管理员照旧全看」同一口径，所以不放进 GATE。
- 被否决：平台管理员也置空。排障要看原始报错，详情接口给平台管理员原文，这里没理由更严。

### D5 cron 那一侧

- cron 巡检不调这个接口，写库不变（`flow-runner.ts` 不动）。
- 读这一侧：
  - cron 任务挂在项目负责人名下，负责人在已分发项目上一定过读权限，所以照旧出现，只是 `checkReportJson` 为 `null`（负责人不是 super_admin 时）。
  - 唯一会消失的是未分发项目上的巡检任务：cron 不看分发状态就建任务，而守卫对未分发项目只放行 super_admin。这与详情接口一致；cron 该不该在未分发项目上跑，另开任务（tasks 3.2 后续第 3 条）。
- `triggerType=cron` 的唯一调用方是没挂载的卡片（Context）。
- 被否决：对 `triggerType=cron` 放宽成只看创建人。巡检报告同样带利润率（Context），口径不能因为参数而变。

### D6 测试

- 新增隔离库 + HTTP 测试 `src/lib/agent-tasks/__tests__/recent-view-db.isolated.test.ts`：
  - 直接调路由导出的 `GET`，带 `createSession` 签的会话 cookie，照 FIX-17 / FIX-21 的隔离库测试写法；岗位预览用例照 `src/lib/preview/__tests__/preview-db.isolated.test.ts`，在 `withPreviewToken` 里调用。只用虚构企业名。
  - 夹具：
    - 组织甲、乙；甲的项目 P1、P2（已分发）、P3（未分发）；一个没有组织的已分发项目 P4。
    - 人：
      - P1 与 P3 的负责人：已离开组织甲、不是这两个项目的成员；
      - P1 的 active 只读成员；
      - P1 成员身份为 inactive 的原成员；
      - 甲的 active 管理员（不是项目成员）；
      - 甲的 inactive 原管理员；
      - 甲的普通成员（不是项目成员）；
      - 乙的管理员；
      - super_admin（不属于甲）；
      - 已停用账号。
    - 每人在 P1–P4 上各建 cron 与 manual 任务若干（直接写库，模拟 FIX-21 之前谁都能建任务的情况）；其中甲的管理员在 P4 上也建一条，验证组织管理员不会因为同企业就看到没有组织的项目。
    - 岗位预览用例另建一个岗位模式的组织丙，super_admin 是丙的 active 管理员。他在丙的两个已分发项目上各建一条任务：P5（不是项目成员）、P6（active 项目成员）。
    - 步骤的检查报告里放三种标记串：原始报错、价格、「利润率 X%」。
  - 断言：
    1. 对照断言：对每个夹具用户，`?limit=20` 返回的任务 ID 集合 = 这个人建的任务里、对其项目直接调 `requireProjectReadAccess`（同一 cookie）放行的那些。不一致即失败，并打印差异。
    2. 不是平台管理员的人：每一步 `checkReportJson` 为 `null`；键集合与改动前相同（任务 10 个键：`id / taskType / triggerType / intent / status / currentStepIndex / totalSteps / createdAt / completedAt / project`；步骤 5 个键：`id / title / status / outputSummary / checkReportJson`）；响应正文里不出现三种标记串，也不出现打不开的项目的名字。
    3. super_admin：拿到 P1–P6 上自己建的全部任务（含未分发的 P3）；检查报告与库里一字不差。以岗位预览身份（预览企业丙）调用时按普通用户处理：
       - 只返回 P6 上的任务，而且它的 `checkReportJson` 为 `null`；
       - P1–P5 上的都不返回：不是项目成员，预览中在丙的组织角色是 `org_member`、过不了管理员那一档，别的企业视同非成员。
    4. 先筛后取：只读成员有 1 条 P1 上较早的任务，另有 25 条更新的、挂在打不开项目上的任务；`?limit=5` 只返回那 1 条。
    5. `?triggerType=cron` 只返回 cron 任务。
    6. 未登录、已停用账号：401。
    7. 请求前后 `AgentTask` / `AgentTaskStep` 逐字段不变。
- `authz-contract.test.ts`：
  - 登记 `recent/route.ts`，必须出现：`isPlatformAdmin`、D3 的 dto 投影函数名、`buildReadableProjectWhere`、`listEffectiveMemberships`。
  - 新增目录完整性检查：递归列出 `src/app/api/agent/tasks/` 下所有 `route.ts`，每个都要在登记表里，漏了就失败并点名。
  - 这个测试与 `dto.test.ts` 都不用库，同时进 `scripts/test-ci-unit.sh`。
- `dto.test.ts`：新函数的用例。
  - 不是平台管理员时三种内部字段都置 `null`、其余键不动、不新增键；
  - 只有 `checkReportJson` 时只置它；
  - 平台管理员原样；
  - 新函数置空的键与 `AGENT_STEP_INTERNAL_FIELDS` 逐项相同。
- 测试先行：三个测试都先在改动前的代码上跑一次，记下失败项；再改代码重跑。两份输出贴进报告。
  - 隔离库测试在改动前应当失败的：对照断言里被移出、跨企业、同企业非成员、未分发、inactive 原管理员这几类人；置空与标记串；先筛后取；岗位预览。
  - 契约测试在改动前应当失败的：`recent/route.ts` 那一条。
- 被否决：只写读源码的测试。看不出查询条件写对没有，也看不出与守卫等价。
- 被否决：用假的 `db` 跑路由。关系条件（`members.some`、`orgId in`）的语义只有真库能验证。

## 与八条硬纪律的关系

1. 零 schema：遵守。不新增 model / 字段 / migration；测试只往隔离库写夹具并清理。
2. 出站动作先审批：不涉及。这是只读接口，本次只少返回东西。
3. 禁止第三套队列：遵守。不新增队列 / 调度 / lease / worker。改的是旧编排冻结区里一个读接口，类别是 `security_fix`；不加文件，runtime-architecture baseline 不变。
4. 脱敏：不涉及 Muse 通道。与脱敏方向一致：
   - 不是平台管理员的人拿到的检查报告整段换成 `null`，不做局部遮盖；
   - 报价审查写进报告的利润率、模型原文里的单价、原始报错都不出；
   - 规格里有对应的 SHALL NOT。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。不新增模型调用；范围判断是查成员关系。
8. 测试注册：遵守。
   - 新的隔离库测试注册进 `scripts/test-all.sh`，放在 `dto.test.ts` 那一条之后；
   - `authz-contract.test.ts` 与 `dto.test.ts` 加进 `scripts/test-ci-unit.sh`；
   - `bash scripts/check-test-registry.sh` 通过，`ci/test-registry-baseline.txt` 不加行。

## 验证方式

- `npx tsx src/app/api/agent/tasks/__tests__/authz-contract.test.ts`：改动前退出码非 0，失败项只有 `recent/route.ts` 一条；改动后退出码 0，目录完整性检查列出 7 个路由文件全部已登记。
- `npx tsx src/lib/agent-tasks/__tests__/dto.test.ts`：退出码 0，原有 23 项照过。
- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… DIRECT_URL=… npx tsx src/lib/agent-tasks/__tests__/recent-view-db.isolated.test.ts`：改动前 D6 列出的用例失败，改动后全部通过；连跑 3 次结果一致。
- `npm run test:runtime-architecture` 通过，且 `git diff --exit-code origin/main -- src/lib/runtime-architecture/` 无差异（baseline 与 manifest 都没动）。
- 其余门禁：
  - `npm test` 对照既有失败清单无新增；
  - `npm run test:ci` PASS；
  - `npm run typecheck` 退出码 0；
  - `npm run lint:baseline` PASS；
  - `bash scripts/check-test-registry.sh` OK；
  - `OPENSPEC_TELEMETRY=0 openspec validate agent-tasks-recent-safe-view --strict` valid。

## Risks / Trade-offs

- [有人正靠这个缺口读别人项目的任务] 合并后这些任务从他的列表里消失，界面上到不了这一步，只可能是直接请求。不保留兼容。过去有没有人读过查不到：这个接口不记调用者。
- [不是平台管理员的人用脚本看不到检查报告了] 详情接口本来就不给他们；要看原始报错找平台管理员。不保留兼容。
- [未分发项目上的巡检任务从负责人列表里消失] 与详情接口一致；有多少条看 tasks 3.2 的只读查询 A 段。
- [卡片以后重新挂上] 不是平台管理员的人看不到「N 项发现」与问题列表，只看到任务、步骤与摘要。要恢复，得另做安全的问题摘要（「留给 GATE」第 1 条选项 C），登记为后续第 2 条。
- [守卫与批量条件以后漂移] 守卫在 `access.ts`，批量条件在 `search/where.ts`，是两处代码。隔离库测试的对照断言（D6 第 1 条）逐人比对，任何一边改了都会失败；夹具里特意放了「已离开组织的负责人」，FIX-21 后续第 4 条要改的正是这一档。
- [每个请求多一次查询] 一次 `organizationMember` 查询（岗位预览中另有一次预览读取，有 30 秒缓存）；任务查询多一个项目关系条件，仍走 `createdById` 索引（`prisma/schema.prisma` 中 `AgentTask` 的 `@@index([createdById, status])`）。与任务条数无关。

## Migration Plan

没有数据迁移、没有开关。合并即在生产生效；回滚就是 revert 这一个 PR。合并后要人做的事写在 tasks 3.2 的报告要求里。

## 留给 GATE

### 1. 不是平台管理员的人拿到的检查报告（`checkReportJson`）

先摆事实：

- 检查报告里可能有原始报错（含模型原文与单价），也可能有报价审查的利润率（Context）。
- 同一张表的详情接口对这些人给 `null`。
- 唯一的界面调用方是一张没挂载的卡片。
- 旧编排里技能失败的步骤是「等待审批」，按状态认不出哪份报告带原始报错。

- **A. 置 `null`，与详情接口的业务视图同口径（推荐）。**
  - 后果：
    - 同一张表的三个读接口口径一致；原始报错、模型原文、利润率都不出。
    - 界面上没有人受影响。
    - 用脚本调接口的负责人、组织管理员、项目成员拿不到检查报告了。
    - 卡片以后如果重新挂上，对这些人只显示任务与步骤，不显示「N 项发现」。
  - 先例：`/api/agent/tasks/:taskId`（`[taskId]/route.ts:50-55`、`dto.ts:119`）；FIX-21 GATE 1 = C。
- **B. 按内容整段替换：认出失败报告就换成固定说法，技能自带的报告照给。**
  - 做法：靠报告文字以「步骤执行失败：」开头来认（`checker.ts:30`、`:36`）。
  - 后果：
    - 卡片重新挂上时还能数「N 项发现」；
    - 靠一句文字前缀认敏感内容，以后失败报告的说法一改就漏；
    - 报价审查的利润率照样出给这些人；
    - 新规则只在这一个接口生效。
- **C. 服务端另给一个安全的问题摘要（例如每步只给问题条数与级别），同时改卡片读新字段。**
  - 后果：
    - 响应多一个新字段，规格多两条；
    - 要改一个今天没挂载的组件；
    - 对现在的界面没有收益。
    - 如果以后决定把卡片挂回去，再按这个做（后续第 2 条）。
- **D. 不改。**
  - 后果：与 `dto.ts:1-9` 和 FIX-21 GATE 1 = C 不一致；本 change 只剩项目范围那一半。

我的推荐：A。

- 它补上的是仓库里明文写下、另外两个接口已经执行的约定，代价只是一个函数与几条用例；界面上没有人受影响。
- B 靠文字前缀，漏得掉，也不管利润率。
- C 是给一张没挂载的卡片做功能，等决定挂回去时再做。

### 2. 任务范围按哪个口径筛

- **A. 与项目读权限守卫同口径（推荐）。** 就是 `/api/agent/tasks/:taskId` 用的判断：
  - 已分发，且调用者是负责人、项目所在组织 active 的 owner / admin、或项目 active 成员；
  - super_admin 不受限。
  - 后果：
    - 列表里出现的任务，点进详情一定打得开；
    - 被移出项目的人、别的企业的人、同企业但不是项目成员也不是组织管理员的人，看不到自己在那些项目上建过的任务；
    - 未分发项目上的任务只有 super_admin 看得到；
    - 已离开组织但仍是负责人或仍是项目成员的人照样看得到（守卫的既有行为，FIX-21 后续第 4 条）。
  - 先例：`/api/search` 的项目结果（`search/route.ts:21-29`，规格 `search/global-search`「项目结果的范围」）。
- **B. 按项目列表页的可见口径（`buildProjectVisibilityWhere`）。**
  - 后果：
    - 同企业的普通成员能看到自己在任何本企业项目上建的任务，点进详情却 403；
    - 已离开组织的负责人看不到自己的巡检任务；
    - 与详情接口不一致。
- **C. 只按企业：任务所属项目的组织是调用者的 active 组织之一。**
  - 后果：挡住了别的企业；挡不住被移出项目的人；没有组织的项目要另写规则。
- **D. 不筛（现状）。**
  - 后果：被移出的人、别的企业的人一直能读到项目名、步骤摘要（GATE 1 选 A 之后不再有检查报告）。

我的推荐：A。

- 它与同一张表的详情和列表接口用的是同一个判断，也有现成的批量写法。
- B 和 C 都会出现「列表里看得到、详情里打不开」或反过来的情况。
