# Tasks：最近任务接口只给还能打开项目的人，检查报告只给平台管理员（FIX-23）

> 开工前提：
> 1. FIX-21（`project-intel-bidpackage-access`，#554）合并后把 main 合入本分支（`git merge origin/main`）再开工。
>    - 代码上不重叠：本 change 的代码只动 `src/app/api/agent/tasks/`、`src/lib/agent-tasks/`，FIX-21 不动这两处。
>    - 两个测试脚本 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 和 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 两边都改：
>      - `test-all.sh`：本 change 的新行放在 `dto.test.ts` 那一条之后，与 FIX-21 加在 FIX-17 两条之后的两行不相邻；
>      - `test-ci-unit.sh`：FIX-21 在 `files-route-guard.test.ts` 那一行之后加了一行；本 change 的两行不贴着那里，放在 `src/lib/tenancy/__tests__/tenant-context.test.ts` 那一行之后（main `22a87fb7` 上 `:137`，合入 FIX-21 后是 `:138`）；
>      - TASKFLOW：FIX-23 一行放在 FIX-21 一行及它登记的后续各行之后。
>    - 四件套按 main `22a87fb7` 写行号；合入后逐处复核（尤其 `recent/route.ts`、`dto.ts`、`authz-contract.test.ts`、`search/where.ts`、`projects/access.ts`、两个测试脚本），对不上先改四件套，跑 `openspec validate agent-tasks-recent-safe-view --strict`，再动代码。
>    - 复核结果（合入 main `212613ec` 后，2026-11-23）：上面列的源码文件 FIX-21 都没有改，行号照旧；`scripts/test-ci-unit.sh` 的 `tenant-context.test.ts` 后移到 `:138`；TASKFLOW 里 FIX-21 已登记了一行 `| FIX-23 |`（它的后续 9，状态 `[ ]`，夹在它的后续各行中间），3.2 改写这一行并挪到 FIX-21 后续各行之后，不另加第二行。
> 2. design「留给 GATE」两条已定（按推荐，Lucas 2026-11-22 授权）：第 1 条 A（不是平台管理员时 `checkReportJson` 为 `null`）、第 2 条 A（与项目读权限守卫同口径）。下面各条按这个结论写，没有分支。
> 3. 开工前跑一遍将要触碰模块的已注册测试，记下通过数：
>    - `npx tsx src/lib/agent-tasks/__tests__/dto.test.ts`（main 上 23）；
>    - `npx tsx src/app/api/agent/tasks/__tests__/authz-contract.test.ts`（main 上 9）；
>    - `npx tsx src/lib/search/__tests__/search-where.test.ts`；
>    - `npm run test:runtime-architecture`。
>    - 同时记下 `grep -c "| 待定 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的值（main `22a87fb7` 上为 0；FIX-21 等合并后会变），写进报告草稿，3.2 的 verify 用它。
>    - 记下的值（合入 main `212613ec` 后）：`dto.test.ts` 23 / 0、`authz-contract.test.ts` 9 / 0、`search-where.test.ts` 28 / 0、`test:runtime-architecture` PASS；`| 待定 |` 为 12。

## 1. 测试先行（不改路由）

- [x] 1.1 改授权布线契约测试 `src/app/api/agent/tasks/__tests__/authz-contract.test.ts`（design D6）。
  - 登记 `recent/route.ts`，必须出现：`isPlatformAdmin`、2.1 新加的 dto 投影函数名、`buildReadableProjectWhere`、`listEffectiveMemberships`；步骤的 `select` 里不得出现 `error`、`inputJson`、`outputJson`（design D3）。
  - 新增目录完整性检查：递归列出 `src/app/api/agent/tasks/` 下所有 `route.ts`，每个都要在登记表里，漏了就失败并点名文件。
  - 把这个测试与 `src/lib/agent-tasks/__tests__/dto.test.ts` 加进 `scripts/test-ci-unit.sh`，位置见开工前提第 1 条。
  - verify：在改动前的代码上退出码非 0，失败项只有 `recent/route.ts` 那一条；完整性检查列出 7 个路由文件、全部已登记；输出存进报告。
  - verify：`bash scripts/check-test-registry.sh` 输出 OK。
- [x] 1.2 写隔离库 + HTTP 测试 `src/lib/agent-tasks/__tests__/recent-view-db.isolated.test.ts`（用例名用中文），注册进 `scripts/test-all.sh`，放在 `dto.test.ts` 那一条之后（隔离库执行，否则跳过）。
  - 夹具与断言按 design D6：
    - 对照组每人在 P1–P4 上各一条 cron、一条 manual，每人可见任务不超过 20 条；
    - 先筛后取与 `limit` 校验用单独的条数用户（P1 上 22 条较早、P2 上 25 条更新）；
    - 岗位预览用组织丙与 P5、P6；
    - 每条任务显式写不同的 `createdAt`；
    - 三种标记串；逐人对照守卫（放行的按 `createdAt` 倒序取前 20 条，含顺序）；`triggerType`；401；请求前后库内逐字段不变。
  - 每条用例对应规格 `agents/agent-tasks-recent-view` 的一个 Scenario。
  - verify：在改动前的代码上用隔离库跑，下面这些用例失败，其余通过：
    - 对照断言里所有不是 super_admin 的对照组用户（每人都在未分发的 P3 上有任务）；
    - 置空与标记串；
    - 条数用户的全部用例（`?limit=5`、不带 `limit`、`?limit=50`、`-5`、`abc`、`0`、`2.5`）；
    - 岗位预览。
  - verify：输出存进报告；`bash scripts/check-test-registry.sh` 输出 OK。

## 2. 实现

- [x] 2.1 `src/lib/agent-tasks/dto.ts`：在列表视图部分（紧挨 `sanitizeListStepError`）加一个列表步骤投影（design D3）。
  - 是平台管理员时原样返回；
  - 不是时把 `AGENT_STEP_INTERNAL_FIELDS` 里在该步骤上出现的键逐个置 `null`，其余键不动、不新增键；
  - 已有导出不改。
  - `dto.test.ts` 加用例：三种内部字段都在时都置 `null`；只有 `checkReportJson` 时只置它；平台管理员原样；置空的键与 `AGENT_STEP_INTERNAL_FIELDS` 逐项相同。
  - verify：`npx tsx src/lib/agent-tasks/__tests__/dto.test.ts` 退出码 0，原有 23 项照过。
  - verify：`npm run test:runtime-architecture` 通过；`git diff --exit-code origin/main -- src/lib/runtime-architecture/` 无差异。
- [x] 2.2 `src/app/api/agent/tasks/recent/route.ts`（design D1、D2、D3）。
  - 不是 super_admin 时：先取有效组织成员身份，挑出 owner / admin 的组织；把可读项目条件作为 `project` 关系条件，与 `createdById`、`triggerType` 放进同一个 `where`，再 `take`。
  - 每一步经 2.1 的投影，按 `isPlatformAdmin(user)` 区分。
  - `limit`：转成数字后是大于 0 的整数才用，否则按 10，再封顶 20（design D7）。
  - `select`、排序、响应形状 `{ tasks }` 不变。
  - verify：`npx tsx src/app/api/agent/tasks/__tests__/authz-contract.test.ts` 退出码 0。
  - verify：隔离库测试全部通过，连跑 3 次结果一致，输出存进报告。
  - verify：`npx tsx src/lib/search/__tests__/search-where.test.ts` 通过数与开工前相同。

## 3. 验收

- [x] 3.1 全部门禁。verify：
  - `npm test` 对照既有失败清单无新增；
  - `npm run test:ci` PASS（含新加进去的两个测试）；
  - `npm run typecheck` 退出码 0；
  - `npm run lint:baseline` PASS；
  - `bash scripts/check-test-registry.sh` OK；
  - `npm run test:runtime-architecture` PASS；
  - `OPENSPEC_TELEMETRY=0 openspec validate agent-tasks-recent-safe-view --strict` valid；
  - 开工前提第 3 条记下的通过数不减。
- [x] 3.2 写 `docs/QINGYAN_FIX-23_REPORT.md` + 更新 TASKFLOW 状态列。
  - 报告内容：
    - 开工前复核：合入 main 后逐处复核行号的结果，对不上的地方与四件套怎么改的；
    - 改动前 / 改动后，谁在这个接口上少看到了什么（按 design Context「谁的任务会出现在谁的列表里」的几类人）；
    - `limit` 非法值（`-5`、`abc`、`0`、`2.5`）改动前 / 改动后各返回什么，含改动前 `abc` 与 `2.5` 的实际行为；
    - 冻结面核对：`recent/route.ts` 在冻结区内部、不是基线消费者，导入 `dto.ts` 不进普查；runtime-architecture baseline 无差异；
    - 三个测试改动前 / 改动后的输出，门禁结果；
    - 「留给 GATE」两条的结论；
    - **没有开关，合并即在生产生效**；回滚只能 revert 这一个 PR；
    - **合并后要人做的事**：
      - 只读查询：写进 `docs/acceptance/fix-23/prod-check.sql`（`BEGIN READ ONLY`，只有 SELECT），Evan 在生产库跑，结果原样贴回。分两段：
        - A 段：合并后会从创建人列表里消失的任务。条件是创建人不是 super_admin、而且按项目读权限口径打不开项目。按原因（项目未分发 / 别的企业 / 同企业非成员 / 项目成员身份已停用 / 组织成员身份已停用的原管理员）与触发方式（cron / manual）各数几条。cron 一列就是后续第 3 条要看的数。
        - B 段：创建人不是 super_admin 的任务里，检查报告带「步骤执行失败：」的步骤、带「利润率」的步骤各几条，按任务类型分。这些就是过去能从这个接口读到的内容；有没有人真的读过查不到，因为接口不记调用者。
      - 要处理的数据：没有。本 change 不改任何数据。
      - 合并后点一遍（Lucas）：界面上没有要点的地方（唯一调用方没挂载）。登录后在浏览器地址栏打开 `/api/agent/tasks/recent?limit=5`：
        - 用 super_admin 打开，检查报告是原文；
        - 用一个不是 super_admin 的项目负责人打开，每一步 `checkReportJson` 都是 `null`，列出的任务所属项目他都打得开。
    - 测试输出、多维审查结论。
  - `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：「Phase F（续）— 情报串联」表的 FIX-23 一行（FIX-21 已登记、状态 `[ ]`）改写为本 change 的说明，挪到 FIX-21 后续各行之后（位置见开工前提第 1 条），状态 `[~]`。同时登记 3 条后续任务，各一行，编号写「待定」，状态 `[ ]`：
    1. `GET /api/agent/approvals` 的 `approvals` 字段原样带 `riskReason` 与 `previewJson`（`src/lib/agent/approval.ts:111-164`）。
       - `riskReason` 在检查不通过时由 `src/lib/agent-core/skills/flow-runner.ts:391-393` 拼进检查报告的 blockers，含原始报错；`previewJson` 是步骤原始输出（`:394`），报价草稿那一步含价格。
       - 与 `src/lib/agent-tasks/dto.ts:22-26` 的 `APPROVAL_INTERNAL_FIELDS` 约定不一致；全仓库没有界面调用这个接口。
    2. 旧仪表盘的「自动巡检」卡没有挂载：`ManagementDashboardClient`（`src/components/dashboard/management-dashboard-client.tsx:37`）没有任何页面引用，首页渲染的是 `OrgCockpitHome`。
       - 卡片（`src/components/dashboard/dashboard-auto-inspections.tsx`）是 `/api/agent/tasks/recent` 唯一的界面调用方。本 change 之后，它对不是平台管理员的人数不出「N 项发现」。
       - 删掉这两个组件，还是挂回去并另做安全的问题摘要（FIX-23 GATE 1 选项 C），待定。
    3. cron 巡检对未分发的项目也建任务：`src/app/api/cron/inspect/route.ts:30-45` 只按 `status: "active"` 选项目、不看 `intakeStatus`。这些任务挂在负责人名下，负责人（不是 super_admin）从详情接口与最近任务接口都看不到。该不该跳过未分发项目，按 prod-check A 段 cron 一列的条数定。
  - verify：报告存在，含「开工前复核」「没有开关，合并即在生产生效」「合并后要人做的事」三节；`docs/acceptance/fix-23/prod-check.sql` 存在，除 `BEGIN READ ONLY` / `ROLLBACK` 外只有 SELECT。
  - verify：`grep -n "^| FIX-23 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行、状态 `[~]`；`grep -c "| 待定 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 不少于（开工前提第 3 条记下的值 + 3）。

## Workflow follow-up

- `/opsx:verify agent-tasks-recent-safe-view`。
- 开 PR 前按 `openspec/config.yaml`「多维审查」并行派子 agent，逐条核实后修，重跑测试；PR 正文写「多维审查」一节。维度：
  - 正确性与回归；
  - 安全 / 隐私与八条硬纪律；
  - 规格—代码—测试一致性；
  - 使用流畅与文案；
  - 另加「权限口径」：逐项核对可读项目条件与项目读权限守卫等价，含岗位预览；
  - 另加「冻结面」：runtime-architecture 普查与 baseline 无变化，改动属于 `security_fix`。
- PR 合并后跑 `/opsx:archive agent-tasks-recent-safe-view --yes`，走独立小 PR；TASKFLOW FIX-23 改 `[x]`；至少一个子 agent 核对主规格与 delta、TASKFLOW 状态与合并记录。
- 另开任务（不在本 change）：3 条，登记在 3.2。
