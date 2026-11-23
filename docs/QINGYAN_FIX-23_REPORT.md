# FIX-23 报告：最近任务接口只给还能打开项目的人，检查报告只给平台管理员

> **白话说明（合并后谁会发现什么变了）**：这次只改了后台一个接口 `GET /api/agent/tasks/recent`（「我最近的自动化任务」），界面一个字没改，也没有人会在界面上察觉：唯一调它的「自动巡检」卡没有挂在任何页面上。以前，不是平台管理员的人直接请求这个接口，能读到每一步检查报告的原文（步骤原始报错，可能夹带模型原文和报价单价；报价审查写进去的利润率），已被移出项目、或在别的企业的项目上建过任务的人也一直能读到那个项目的名字、步骤摘要和检查报告。现在只列出调用者现在还能打开的项目上的任务，不是平台管理员的人看到的每一步检查报告都是空的（`null`）；平台管理员照旧看到全部原文。

| 项 | 值 |
|---|---|
| change | `agent-tasks-recent-safe-view`（新能力 `agents/agent-tasks-recent-view`，9 条要求） |
| TASKFLOW | FIX-23（Phase F（续）— 情报串联表，FIX-21 后续 9；FIX-21 登记的那一行已改写并挪到 FIX-21 后续各行之后），另登记 3 条「编号待定」后续任务 |
| 来源 | 2026-11-23 审查 FIX-21（`project-intel-bidpackage-access`）时两位审查员各自核实：同一张任务表上最后一个不按项目权限筛、也不经安全投影的读接口 |
| GATE | 「留给 GATE」两条，Lucas 2026-11-22 授权按推荐定：第 1 条 **A**（不是平台管理员时 `checkReportJson` 为 `null`）、第 2 条 **A**（与项目读权限守卫同口径） |
| 分支 | `claude/zen-turing-azudvx-fix23`；四件套提交 `857c9427`（main `22a87fb7` 上写），开工时合入 main `212613ec`（含 FIX-21 #554） |
| 性质 | 修既有的越权与信息外泄。零 schema、零新模型调用、没有新增出站、没有新队列。**没有开关——合并即在生产生效** |

## 1. 开工前复核

合入 main `212613ec` 后逐处复核四件套引用的文件与行号：

- `src/app/api/agent/tasks/recent/route.ts`、`src/lib/agent-tasks/dto.ts`、`src/app/api/agent/tasks/__tests__/authz-contract.test.ts`、`src/lib/search/where.ts`、`src/lib/projects/access.ts`、`src/lib/preview/server.ts`、`src/lib/rbac/**`、`src/app/api/search/route.ts`、`src/app/api/agent/tasks/route.ts`、`[taskId]/route.ts`、`src/lib/runtime-architecture/**`：FIX-21 都没有改（`git diff 857c9427 origin/main --stat` 只有 TASKFLOW 与两个测试脚本），行号照旧。
- `scripts/test-ci-unit.sh`：FIX-21 在 `files-route-guard.test.ts` 之后加了一行，`tenant-context.test.ts` 从 `:137` 后移到 `:138`。四件套三处已改写成「main `22a87fb7` 上 `:137`，合入 FIX-21 后是 `:138`」。
- `scripts/test-all.sh`：`dto.test.ts` 仍在 `:177`；FIX-21 的两行在 `:596-597`，不相邻。
- `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：FIX-21 已登记了一行 `| FIX-23 |`（它的后续 9，状态 `[ ]`，夹在它的后续各行中间）。tasks 3.2 原写「新增 FIX-23 一行」；改为改写这一行并挪到 FIX-21 后续各行之后，不另加第二行（tasks.md 已改）。
- 开工前基线（tasks 开工前提第 3 条）：`dto.test.ts` 23 / 0、`authz-contract.test.ts` 9 / 0、`search-where.test.ts` 28 / 0、`npm run test:runtime-architecture` PASS；`grep -c "| 待定 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 为 **12**。
- design 里「FIX-21（未合并……）」改为「#554，2026-11-23 合并」。

改完四件套后 `openspec validate agent-tasks-recent-safe-view --strict` valid，再动代码。

## 2. 做了什么

1. `src/lib/agent-tasks/dto.ts` 列表视图部分（紧挨 `sanitizeListStepError`）加 `sanitizeListStepInternals(step, diagnostic)`：平台管理员原样返回；其余人把 `AGENT_STEP_INTERNAL_FIELDS`（`inputJson / outputJson / checkReportJson`）里在该步骤上出现的键逐个置 `null`，键保留、其余键不动、不新增键。已有导出不改。
2. `src/app/api/agent/tasks/recent/route.ts`：
   - 不是 super_admin 时（按 `withAuth` 给的用户判断，岗位预览中已降为 `user`）：`listEffectiveMemberships` 取有效组织成员身份 → `isOrgSystemAdmin` 挑出 owner / admin 的组织 → `buildReadableProjectWhere(user.id, adminOrgIds)` 作为 `project` 关系条件，与 `createdById`、`triggerType` 放进同一个 `where`，再 `take`（先筛后取）。写法照 `/api/search`。
   - 每一步经 `sanitizeListStepInternals(step, isPlatformAdmin(user))`。
   - `limit`：`Number(参数)` 是大于 0 的整数才用，否则 10；再封顶 20。
   - `select`、排序、响应形状 `{ tasks }` 不变；步骤照旧不选 `error / inputJson / outputJson`。
3. 授权布线契约测试登记 `recent/route.ts`，并加目录完整性检查与步骤 `select` 检查（§5.1）。
4. 新增隔离库 + HTTP 测试（§5.2）。
5. 注册：隔离库测试进 `scripts/test-all.sh`（`dto.test.ts` 之后）；`dto.test.ts` 与 `authz-contract.test.ts` 进 `scripts/test-ci-unit.sh`（`tenant-context.test.ts` 之后，不贴着 FIX-21 的那一行）。

代码改动：`recent/route.ts` +41 / −3，`dto.ts` +25。

### 2.1 改动前 / 改动后，谁在这个接口上少看到了什么

| 谁（按 design Context「谁的任务会出现在谁的列表里」） | 改动前 | 改动后 |
|---|---|---|
| 平台 super_admin（不在岗位预览中） | 自己建的全部任务，检查报告原文 | **不变**（合法 `limit` 下一字不变） |
| 项目负责人（cron 巡检以他的名义建任务），不是 super_admin | 自己名下的全部任务（含未分发项目上的巡检），检查报告原文 | 已分发项目上的任务照旧，每一步 `checkReportJson` 为 `null`；**未分发项目上的巡检任务不再出现**（与详情接口一致） |
| 项目所在组织 active 的所有者 / 管理员，项目的 active 成员（不论项目角色） | 自己建的全部任务，检查报告原文 | 能打开的项目上的任务照旧，检查报告为 `null` |
| 项目成员身份已停用的原成员 | 照旧看到自己在那个项目上建过的任务、项目名、步骤摘要、检查报告 | **看不到** |
| 别的企业的用户（包括别的企业的管理员） | 同上 | **看不到** |
| 同企业、不是项目成员也不是组织所有者 / 管理员 | 同上 | **看不到** |
| 组织成员身份已停用、又不是项目成员的原组织管理员 | 同上 | **看不到** |
| 已离开组织、但仍是项目负责人或仍是项目 active 成员的人 | 看得到 | 照样看得到（守卫的既有行为，FIX-21 后续 4） |
| 以岗位预览身份访问的 super_admin | 自己建的全部任务，检查报告原文 | 按预览身份判断：只有预览企业里自己是项目成员（或负责人）的项目；检查报告为 `null` |

所有人：拿不到的任务也不再占「最近 N 条」的名额。

### 2.2 `limit` 非法值改动前 / 改动后（隔离库实测，条数用户：能打开的 P1 上 22 条较早任务，打不开的 P2 上 25 条更新任务）

| 请求 | 改动前（实测） | 改动后 |
|---|---|---|
| `?limit=-5` | 200，**最早的 5 条**（Prisma 6.19.2 负 `take` 从排序末尾取；`-100000` 即最早的 10 万条，不受 20 的上限） | 200，能打开的项目上最新的 10 条 |
| `?limit=abc` | **500「服务器内部错误」**（`Number("abc")` 是 `NaN`，Prisma 报 `PrismaClientValidationError: Argument take is missing`） | 同上，10 条 |
| `?limit=0` | 200，`tasks` 为空 | 同上，10 条 |
| `?limit=2.5` | 200，2 条（Prisma 收下了小数） | 同上，10 条 |
| `?limit=`（空串） | 200，10 条（`|| "10"` 兜住） | 同上，10 条 |
| 不带 / `?limit=5` / `?limit=50` | 10 / 5 / 20 条，但取的是全部自己建的任务里最新的（本例全是打不开的 P2 上的） | 10 / 5 / 20 条，只从能打开的项目里取 |

唯一的界面调用方固定传 `5`，不受影响。

### 2.3 冻结面核对

- `recent/route.ts` 在 runtime-architecture `agent-task-legacy` 冻结区**内部**（`src/app/api/agent/` 算区内），不是 baseline 里的消费者；导入 `dto.ts` 不进消费者普查。同目录 `tasks/route.ts`、`[taskId]/route.ts` 本来就直接导入 `dto.ts`。
- `dto.ts` 只加函数不加文件，`FROZEN_AREA_NEW_FILE` 不触发；测试文件不进普查。改动类别 `security_fix`。
- `bash scripts/test-runtime-architecture.sh` PASS；`git diff --exit-code origin/main -- src/lib/runtime-architecture/` 无差异（baseline 与 manifest 都没动）。

## 3. 需要你知道的取舍

- **用脚本调这个接口的负责人、组织管理员、项目成员拿不到检查报告了**（GATE 1 = A）。同一张表的详情接口本来就不给他们；要看原始报错找平台管理员。
- **「自动巡检」卡以后要是重新挂上**，对不是平台管理员的人只显示任务、步骤与摘要，数不出「N 项发现」（`checkReportJson` 为 `null` 时卡片按「没有问题」处理，不报错）。要恢复得另做安全的问题摘要（GATE 1 选项 C），登记为后续 2。
- **未分发项目上的巡检任务从负责人列表里消失**：cron 不看分发状态就建任务，守卫对未分发项目只放行 super_admin。与详情接口一致；cron 该不该在未分发项目上跑，登记为后续 3，按 prod-check A 段的条数定。
- **每个请求多一次查询**：不是 super_admin、不在岗位预览中时多一次成员表查询（与任务条数无关）；super_admin 不查。任务查询多一个项目关系条件，仍走 `createdById` 索引。生产数据上没测过耗时。

## 4. 与四件套不一致、已改四件套的地方

1. `scripts/test-ci-unit.sh` 的 `tenant-context.test.ts` 行号 `:137` → `:138`（FIX-21 加了一行）。proposal、design D6、tasks 开工前提三处改写。
2. TASKFLOW 里 FIX-21 已登记了 `| FIX-23 |` 一行：tasks 3.2「新增 FIX-23 一行」改为「改写这一行并挪到 FIX-21 后续各行之后」；开工前提第 1 条加复核结果。
3. tasks 开工前提第 3 条写进了记下的基线数字（含 `| 待定 |` = 12）。
4. 列表步骤投影的函数名定为 `sanitizeListStepInternals`（四件套只写「2.1 新加的 dto 投影函数名」）。
5. 隔离库测试的夹具比 design D6 多两处（design D6 已补写）：对照组加「甲的 active 所有者（不是项目成员）」，覆盖规格「所有者或管理员」的所有者一档；P1 的只读成员同时是没有组织的 P4 的 active 成员，覆盖「没有组织的项目上的项目成员」。条数用例另加 `?limit=`（空串），规格本来就写了空串。
6. design D6「改动前应当失败的」只列了四类；实测改动前失败的还有「打不开项目的人看不到」4 条、「未分发项目上的巡检任务」2 条——都是项目范围的断言，属于同一个缺口。`triggerType` 筛选与排序两条写成与范围无关（改动前后都通过），另在「未分发」一节加一条「结果正好是守卫放行的项目上的 cron 任务」。
7. design 里「FIX-21（未合并……）」改为已合并。

以上都不改变范围与对外行为。

## 5. 验证

### 5.1 授权布线契约（`npx tsx src/app/api/agent/tasks/__tests__/authz-contract.test.ts`）

- 新增：登记 `recent/route.ts`（必须出现 `isPlatformAdmin`、`sanitizeListStepInternals`、`buildReadableProjectWhere`、`listEffectiveMemberships`）；递归列出 `src/app/api/agent/tasks/` 下全部 `route.ts`，每个都要在登记表里（另查登记表里没有已不存在的文件）；`recent/route.ts` 的步骤 `select` 块（按花括号配对取出）不得出现 `error / inputJson / outputJson`，找不到步骤 `select` 也判失败。
- 改动前：**12 passed, 1 failed**，失败项只有「recent GET 按项目读权限口径筛+按平台管理员区分的步骤投影 — 缺: isPlatformAdmin, sanitizeListStepInternals, buildReadableProjectWhere, listEffectiveMemberships」；目录完整性列出 7 个路由文件、全部已登记。
- 改动后：**13 passed, 0 failed**，退出码 0。
- 变异（临时改、跑完还原）：在目录下加一个没登记的 `zz-probe/route.ts` → 「✗ 目录下 8 个路由文件都已登记 — 未登记: zz-probe/route.ts」；在 `recent/route.ts` 步骤 `select` 里加 `error: true` → 「✗ recent/route.ts 的步骤 select 不含 error / inputJson / outputJson — 选了: error」。

### 5.2 隔离库 + HTTP（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… npx tsx src/lib/agent-tasks/__tests__/recent-view-db.isolated.test.ts`，库 `qy_iso_d`）

夹具（只用虚构企业名）：组织甲、乙、丙（丙按岗位模式）；甲的 P1、P2（已分发）、P3（未分发）；没有组织的 P4；丙的 P5、P6。对照组 9 人（负责人：已离开甲；P1 只读成员；P1 inactive 原成员；甲的 active 管理员；甲的 active 所有者；甲的 inactive 原管理员；甲的普通成员；乙的管理员；super_admin）每人在 P1–P4 上各一条 cron、一条 manual；super_admin 另在 P5（不是项目成员）、P6（active 成员）上各一条；条数用户 P1 上 22 条较早、P2 上 25 条更新；已停用账号一条。每条任务显式写递增的 `createdAt`；步骤检查报告里放原始报错标记串、价格标记串与「利润率 7.5%，低于 10% 安全线」；意图与步骤摘要带项目标记。

| 一节（对应规格 Scenario） | 改动前 过 / 不过 | 改动后 |
|---|---|---|
| 与项目读权限逐人一致（9 人逐个对照守卫 + 守卫放行结果与规格描述一致） | 2 / 8（只有 super_admin 与守卫自检通过） | 10 / 0 |
| 还能打开项目的人照常看到 | 3 / 0 | 3 / 0 |
| 打不开项目的人看不到 | 0 / 4 | 4 / 0 |
| 未分发项目上的巡检任务 | 1 / 2 | 3 / 0 |
| 触发方式筛选与排序照旧 | 3 / 0 | 3 / 0 |
| 不是平台管理员的人：检查报告为空、键集合不变、正文里没有标记串与打不开的项目 | 10 / 16（键集合与只读成员的字段照旧通过） | 26 / 0 |
| 平台管理员照旧看到全部原文 | 3 / 0 | 3 / 0 |
| 以岗位预览身份访问的 super_admin | 1 / 4 | 5 / 0 |
| 条数上限按可见任务计（`5` / 不带 / `50` / `-5` / `abc` / `0` / `2.5` / 空串） | 0 / 8 | 8 / 0 |
| 未登录与已停用账号 401 | 2 / 0 | 2 / 0 |
| 请求前后库内不变、库里检查报告仍是原文 | 2 / 0 | 2 / 0 |
| **合计** | **27 passed, 42 failed**（退出码 1） | **69 passed, 0 failed**（退出码 0），连跑 3 次结果一致 |

变异（临时改路由、跑完还原）：组织管理员一档不传（`adminOrgIds` 换成 `[]`）→ 4 条失败（管理员 / 所有者对照、照常看到、manual 筛选）；`diagnostic` 恒为 true → 9 条失败；`limit` 负数取绝对值 → `?limit=-5` 一条失败。

### 5.3 `dto.test.ts`

23 → **30 passed, 0 failed**（原有 23 项照过）。新增 7 项：不是平台管理员时三种内部字段都置 `null`；其余键不动、键顺序不变、不新增键；不改传入对象；置空的键与 `AGENT_STEP_INTERNAL_FIELDS` 逐项相同；只有 `checkReportJson` 时只置它、不补出另两个键；业务结果里没有检查报告原文；平台管理员原样返回。

### 5.4 门禁

| 命令 | 结果 |
|---|---|
| `npm test`（全新库 `qy_full_fix23`，`prisma migrate deploy` 后跑，日志 `/home/user/full-agent-tasks-recent-safe-view.log`） | **714 / 725 通过，11 失败**：其中 10 项与 main 基线逐条相同（来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB）；多出的 1 项「Supplier Intel S1 审计脊柱 DB」是并发计时断言（T20「signal vs complete：子写排队到终态提交之后」，`childSettledAt` 比 `holderCommittedAt` 早 1 ms），全量跑的同时本机在跑 CI 子集，CPU 争用；在同一个库上单独重跑 3 次都是 86 / 0。本 change 不碰 `src/lib/supplier-intel/`。新测试在全量里 69 / 0 |
| `npm run test:ci`（`env -u DATABASE_ENVIRONMENT` + CI 库） | **CI unit subset PASS**（含新加的 `dto.test.ts` 30 / 0、`authz-contract.test.ts` 13 / 0） |
| `npm run typecheck` | 退出码 0 |
| `npm run lint:baseline` | PASS（current errors 38，baseline 53，无新增 fingerprint） |
| `bash scripts/check-test-registry.sh` | OK：已注册 692 个；历史欠账基线剩余 66 条（`ci/test-registry-baseline.txt` 未改） |
| `bash scripts/test-runtime-architecture.sh` | PASS（repo conformance 9 / 0）；`src/lib/runtime-architecture/` 对 main 无差异 |
| `OPENSPEC_TELEMETRY=0 openspec validate agent-tasks-recent-safe-view --strict` | valid |
| 开工前基线 | `dto.test.ts` 23 → 30、`authz-contract.test.ts` 9 → 13、`search-where.test.ts` 28 → 28，都不减 |

### 5.5 prod-check.sql 演练

`docs/acceptance/fix-23/prod-check.sql` 在隔离库上对本测试的夹具（跑一遍测试、不清理，核对完按标记删掉）跑过：A 段 8 行逐行与夹具的预期一致（「0 合并后照旧可见」36 条 / 5 人、「1 项目未分发」16 条、「2 项目成员身份已停用」2 条、「3 原管理员」4 条、「4 同企业非成员」33 条、「5 原普通成员」2 条、「6 项目没有组织」14 条、「7 别的企业」4 条）；B 段 `custom` 33 / 33、`project_inspection` 32 / 32 与夹具相同。

## 6. 没验证到的

- 生产数据上合并后会少多少条、查询耗时：只读查询交给 Evan（§9）。
- 真实 Next 服务里岗位预览的成员身份经 `next/headers` 的 `cookies()` 读到：测试里与其它预览测试一样用 `withPreviewToken` 注入（测试进程读不到请求 cookie），生产路径没有单独跑。
- 浏览器里点一遍：界面上没有入口（唯一调用方没挂载），见 §9 的手动核对。

## 7. 没有开关，合并即在生产生效；回退办法

没有开关，没有数据迁移。回滚只能 revert 这一个 PR（三处源码：`recent/route.ts`、`dto.ts` 新函数、两个测试脚本的注册行；测试文件随之回退）。

## 8. 后续任务（已登记进 TASKFLOW，编号「待定」）

1. `GET /api/agent/approvals` 的 `approvals` 字段原样带 `riskReason` 与 `previewJson`（`src/lib/agent/approval.ts:111-164`）：`riskReason` 在检查不通过时由 `src/lib/agent-core/skills/flow-runner.ts:391-393` 拼进检查报告的 blockers，含原始报错；`previewJson` 是步骤原始输出（`:394`），报价草稿那一步含价格。与 `src/lib/agent-tasks/dto.ts:22-26` 的 `APPROVAL_INTERNAL_FIELDS` 约定不一致；全仓库没有界面调用这个接口。
2. 旧仪表盘的「自动巡检」卡没有挂载：`ManagementDashboardClient`（`src/components/dashboard/management-dashboard-client.tsx:37`）没有任何页面引用，首页渲染的是 `OrgCockpitHome`。卡片（`src/components/dashboard/dashboard-auto-inspections.tsx`）是本接口唯一的界面调用方，本 change 之后它对不是平台管理员的人数不出「N 项发现」。删掉这两个组件，还是挂回去并另做安全的问题摘要（GATE 1 选项 C），待定。
3. cron 巡检对未分发的项目也建任务：`src/app/api/cron/inspect/route.ts:30-45` 只按 `status: "active"` 选项目、不看 `intakeStatus`。这些任务挂在负责人名下，负责人（不是 super_admin）从详情接口与最近任务接口都看不到。该不该跳过未分发项目，按 prod-check A 段「1 项目未分发」一行的 cron 条数定。

## 9. 合并后要人做的事

- **只读查询（Evan，生产库）**：`psql "<生产只读连接串>" -f docs/acceptance/fix-23/prod-check.sql`（`BEGIN READ ONLY` … `ROLLBACK`，只有 SELECT），结果原样贴回。
  - A 段：合并后会从创建人列表里消失的任务（创建人不是 super_admin、账号 active、按项目读权限口径打不开项目），按原因（项目未分发 / 项目成员身份已停用 / 组织成员身份已停用的原管理员 / 同企业非成员 / 原普通成员 / 项目没有组织 / 别的企业）与触发方式（cron / 其它）各数几条，「0 合并后照旧可见」是对照。「1 项目未分发」一行的 cron 数就是后续 3 要看的数。
  - B 段：创建人不是 super_admin 的任务里，检查报告带「步骤执行失败：」的步骤、带「利润率」的步骤各几条，按任务类型分。这些就是过去能从这个接口读到的内容；有没有人真的读过查不到，因为接口不记调用者。
- **要处理的数据**：没有。本 change 不改任何数据。
- **合并后点一遍（Lucas）**：界面上没有要点的地方。登录后在浏览器地址栏打开 `/api/agent/tasks/recent?limit=5`：
  - 用 super_admin 打开，检查报告（`checkReportJson`）是原文；
  - 用一个不是 super_admin 的项目负责人打开，每一步 `checkReportJson` 都是 `null`，列出的任务所属项目他都打得开。

## 10. 与八条硬纪律的关系

1. 零 schema：遵守。没有 model / 字段 / migration；测试只往隔离库写夹具并清理。
2. 出站先审批：不涉及。只读接口，本次只少返回东西。
3. 禁止第三套队列：遵守。不新增队列 / 调度 / lease / worker；改的是旧编排冻结区里一个读接口，类别 `security_fix`，runtime-architecture baseline 不变。
4. 脱敏：不涉及 Muse 通道；方向一致——不是平台管理员的人拿到的检查报告整段换成 `null`，原始报错、模型原文里的单价、报价审查的利润率都不出。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。不新增模型调用；范围判断是查成员关系。
8. 测试注册：遵守。新测试进 `scripts/test-all.sh`；两个不用库的测试进 `scripts/test-ci-unit.sh`；`check-test-registry.sh` OK，基线未加行。

## 11. 提交

| 提交 | 内容 |
|---|---|
| `967c664d` | 合入 main `212613ec`（FIX-21 #554） |
| `56644263` | 测试先行：契约测试登记最近任务接口 + 目录完整性；新增隔离库测试；注册；四件套按合入后的 main 复核 |
| `bedcc3c5` | `dto.ts` 列表步骤投影 + 7 项单测 |
| `c12a3c30` | 路由：可读项目条件、步骤投影、`limit` 校验 |
| （本提交） | 报告、prod-check.sql、TASKFLOW |

## 12. 多维审查

（由协调会话补）
