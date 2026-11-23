# FIX-23 报告：最近任务接口只给还能打开项目的人，检查报告只给平台管理员

> **白话说明（合并后谁会发现什么变了）**：这次只改了后台一个接口 `GET /api/agent/tasks/recent`（「我最近的自动化任务」），界面一个字没改，也没有人会在界面上察觉：唯一调它的「自动巡检」卡没有挂在任何页面上。以前，不是平台管理员的人直接请求这个接口，能读到每一步检查报告的原文（步骤原始报错，可能夹带模型原文和报价单价；报价审查写进去的利润率），已被移出项目、或在别的企业的项目上建过任务的人也一直能读到那个项目的名字、步骤摘要和检查报告。现在只列出调用者现在还能打开的项目上的任务，不是平台管理员的人看到的每一步检查报告都是空的（`null`）；平台管理员照旧看到全部原文。另外这个接口和项目里的「AI 任务」列表接口原来都能用 `limit=-1000` 这样的负数一次拉出全部任务，现在不行了；项目页的「AI 任务」面板不传这个参数，看到的和以前一样。

| 项 | 值 |
|---|---|
| change | `agent-tasks-recent-safe-view`（新能力 `agents/agent-tasks-recent-view`，10 条要求） |
| TASKFLOW | FIX-23（Phase F（续）— 情报串联表，FIX-21 后续 9；FIX-21 登记的那一行已改写并挪到 FIX-21 后续各行之后），另登记 5 条「编号待定」后续任务 |
| 来源 | 2026-11-23 审查 FIX-21（`project-intel-bidpackage-access`）时两位审查员各自核实：同一张任务表上最后一个不按项目权限筛、也不经安全投影的读接口 |
| GATE | 「留给 GATE」两条，Lucas 2026-11-22 授权按推荐定：第 1 条 **A**（不是平台管理员时 `checkReportJson` 为 `null`）、第 2 条 **A**（与项目读权限守卫同口径） |
| PR | #562，2026-11-23 合并（合并提交 `d94e4323`）；归档 `openspec/changes/archive/2026-11-23-agent-tasks-recent-safe-view/`；归档后 `openspec validate --specs --strict` 153 / 153 |
| 分支 | `claude/zen-turing-azudvx-fix23`；四件套提交 `857c9427`（main `22a87fb7` 上写），开工时合入 main `212613ec`（含 FIX-21 #554），审查后修订前又合入 main `a8caa985`（没有冲突，本 change 引用的文件都没变，只有 TASKFLOW 与两个测试脚本多了别人的行） |
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
   - `limit`：`parseListLimit`（`dto.ts`）——去首尾空白后是十进制正整数（`/^[1-9]\d*$/`）才用，否则 10；再封顶 20（第一版是「`Number(参数)` 是大于 0 的整数」，审查后收紧，见 §11）。
   - `select`、排序、响应形状 `{ tasks }` 不变；步骤照旧不选 `error / inputJson / outputJson`。
3. `src/app/api/agent/tasks/route.ts`（项目任务列表 `GET /api/agent/tasks?projectId=`，审查后并进）：只改 `limit` 一行，用同一个 `parseListLimit`，保留原有的缺省 20、封顶 100。
4. `dto.ts` 另加 `parseListLimit(raw, { fallback, max })` 与 `RECENT_TASKS_LIMIT`（10 / 20）、`PROJECT_TASKS_LIMIT`（20 / 100）。
5. 授权布线契约测试登记 `recent/route.ts`，并加目录完整性检查与步骤 `select` 检查（§5.1）。
6. 新增隔离库 + HTTP 测试（§5.2）与截获查询参数的不连库测试（§5.3）。
7. 注册：隔离库测试与截获参数的测试进 `scripts/test-all.sh`（`dto.test.ts` 之后）；`dto.test.ts`、`authz-contract.test.ts`、`recent-route-args.test.ts` 进 `scripts/test-ci-unit.sh`（`tenant-context.test.ts` 之后，不贴着 FIX-21 的那一行）。

代码改动（对 main）：`recent/route.ts` +33 / −3，`tasks/route.ts` +3 / −2，`dto.ts` +43。

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

### 2.2 `limit` 非法值改动前 / 改动后（隔离库实测）

最近任务（条数用户：能打开的 P1 上 22 条较早任务，打不开的 P2 上 25 条更新任务）：

| 请求 | 改动前（实测） | 改动后 |
|---|---|---|
| `?limit=-5` | 200，**最早的 5 条**（Prisma 6.19.2 负 `take` 从排序末尾取；`-100000` 即最早的 10 万条，不受 20 的上限） | 200，能打开的项目上最新的 10 条 |
| `?limit=abc` | **500「服务器内部错误」**（`Number("abc")` 是 `NaN`，Prisma 报 `PrismaClientValidationError: Argument take is missing`） | 同上，10 条 |
| `?limit=0` | 200，`tasks` 为空 | 同上，10 条 |
| `?limit=2.5` | 200，2 条（Prisma 收下了小数） | 同上，10 条 |
| `?limit=`（空串） | 200，10 条（`|| "10"` 兜住），但都是 P2 上的 | 同上，10 条 |
| `?limit=0x10` / `1e1` / `5.0` / `%2B3`（值 `+3`） | 200，16 / 10 / 5 / 3 条 | 同上，10 条 |
| 不带 / `?limit=5` / `?limit=50` | 10 / 5 / 20 条，但取的是全部自己建的任务里最新的（本例全是打不开的 P2 上的） | 10 / 5 / 20 条，只从能打开的项目里取 |

唯一的界面调用方固定传 `5`，不受影响。查询串里裸写的 `+` 会被解码成空格：`?limit=+3` 等于 `?limit= 3`，改动后按 3 条。

项目任务列表 `GET /api/agent/tasks?projectId=P1`（P1 上共 41 条，调用者是 P1 成员）：

| 请求 | 改动前（实测） | 改动后 |
|---|---|---|
| `?limit=-5` | 200，**最早的 5 条** | 200，最新的 20 条 |
| `?limit=-1000` | 200，**全部 41 条**（不受 100 的上限） | 同上，20 条 |
| `?limit=2.5` / `0x10` | 200，2 / 16 条 | 同上，20 条 |
| `?limit=abc` / `0` | 200，20 条（`|| 20` 兜住） | 同上，20 条 |
| 不带 / `?limit=5` / `?limit=150` | 20 / 5 / 41 条 | 20 / 5 / 41 条（150 按上限 100） |

界面调用方 `src/components/agent-tasks/project-agent-tasks.tsx:111` 不带 `limit`，不受影响。

### 2.3 冻结面核对

- `recent/route.ts` 在 runtime-architecture `agent-task-legacy` 冻结区**内部**（`src/app/api/agent/` 算区内），不是 baseline 里的消费者；导入 `dto.ts` 不进消费者普查。同目录 `tasks/route.ts`、`[taskId]/route.ts` 本来就直接导入 `dto.ts`。
- `dto.ts` 只加函数、类型与常量，不加文件，`FROZEN_AREA_NEW_FILE` 不触发；测试文件不进普查。改动类别 `security_fix`。协调会话建议的新文件 `src/lib/agent-tasks/recent-query.ts` 会触发 `FROZEN_AREA_NEW_FILE`（要在同一个 PR 里改 baseline，design Non-Goals 不改 `src/lib/runtime-architecture/**`），所以 `parseListLimit` 放进已有的 `dto.ts`。
- `bash scripts/test-runtime-architecture.sh` PASS；`git diff --exit-code origin/main -- src/lib/runtime-architecture/` 无差异（baseline 与 manifest 都没动）。

## 3. 需要你知道的取舍

- **用脚本调这个接口的负责人、组织管理员、项目成员拿不到检查报告了**（GATE 1 = A）。同一张表的详情接口本来就不给他们；要看原始报错找平台管理员。
- **「自动巡检」卡以后要是重新挂上**，对不是平台管理员的人只显示任务、步骤与摘要，数不出「N 项发现」（`checkReportJson` 为 `null` 时卡片按「没有问题」处理，不报错）。要恢复得另做安全的问题摘要（GATE 1 选项 C），登记为后续 2。
- **未分发项目上的巡检任务从负责人列表里消失**：cron 不看分发状态就建任务，守卫对未分发项目只放行 super_admin。与详情接口一致；cron 该不该在未分发项目上跑，登记为后续 3，按 prod-check A 段的条数定。
- **每个请求多一次查询**：不是 super_admin、不在岗位预览中时多一次成员表查询（与任务条数无关）；super_admin 不查。任务查询多一个项目关系条件，仍走 `createdById` 索引。生产数据上没测过耗时。
- **项目角色是空串的 active 项目成员**：守卫拒（`if (projectRole)`），本接口的批量条件放行（`members.some` 不看角色）——两边唯一不一致的地方。不改共用的 `buildReadableProjectWhere`（全局搜索也用它）；prod-check C 段数生产行数（§9）。
- **`limit` 写法收紧**：`0x10`、`1e1`、`5.0`、`+3`、前导零（`05`）现在都按缺省，原来分别是 16 / 10 / 5 / 3 / 5 条。界面不传这些写法。

## 4. 与四件套不一致的地方（都已同步）

逐条核对过四件套现在的文字（`openspec validate --strict` valid）：

| # | 不一致 | 同步到哪里 |
|---|---|---|
| 1 | `scripts/test-ci-unit.sh` 的 `tenant-context.test.ts` 行号 `:137` → `:138`（FIX-21 加了一行） | proposal 开头依赖说明、design D6、tasks 开工前提第 1 条 |
| 2 | TASKFLOW 里 FIX-21 已登记了 `| FIX-23 |` 一行 | tasks 开工前提第 1 条（复核结果）与 3.2（「改写这一行并挪位」）；proposal 开头与 Impact「文档」 |
| 3 | 开工前基线数字（含 `| 待定 |` = 12） | tasks 开工前提第 3 条；3.2 的 verify 改为「+ 5」 |
| 4 | 列表步骤投影的函数名定为 `sanitizeListStepInternals` | design D3、D6，tasks 1.1 |
| 5 | 隔离库夹具多两处：对照组加组织所有者；只读成员同时是没有组织的 P4 的成员；条数用例加空串 | design D6 |
| 6 | 改动前失败的还有「打不开项目的人看不到」4 项、「未分发项目上的巡检任务」2 项、空串 | design D6「改动前应当失败的」、tasks 1.2 verify |
| 7 | FIX-21 已合并 | design Context |
| 8 | （审查后）`limit` 只认十进制正整数 | 规格「条数上限按可见任务计」与场景、design D7、tasks 2.2 / 2.3、proposal What / Impact |
| 9 | （审查后）项目任务列表的负数 `limit` 并进本 change | 规格新增「项目任务列表的条数」、design Context / Goals / Non-Goals / D7、tasks 2.3、proposal Why / What / Impact |
| 10 | （审查后）`parseListLimit` 放在 `dto.ts`，不另建文件 | design Non-Goals 与 D7、tasks 2.3、proposal Impact |
| 11 | （审查后）新增截获参数的测试；契约测试多两个失败条件 | 规格「检查报告为空」「条数上限」的场景与「目录登记」一条、design D6、tasks 2.3、proposal What |
| 12 | （审查后）prod-check A 段按 cron / manual / 其它分、B 段只算 active 账号、加 C 段 | tasks 3.2 |
| 13 | （审查后）后续任务 3 → 5 条，第 1 条补写 | tasks 3.2、proposal Out of scope |
| 14 | （审查后）空串角色的差异 | design Risks、proposal Out of scope |

以上没有扩大范围：第 9 条是协调会话按审查意见定的并入，规格已覆盖。

## 5. 验证

### 5.1 授权布线契约（`npx tsx src/app/api/agent/tasks/__tests__/authz-contract.test.ts`）

- 新增：登记 `recent/route.ts`（必须出现 `isPlatformAdmin`、`sanitizeListStepInternals`、`buildReadableProjectWhere`、`listEffectiveMemberships`、`parseListLimit`；列表 `route.ts` 也要有 `parseListLimit`）；递归列出 `src/app/api/agent/tasks/` 下全部路由文件（`/^route\.(ts|tsx|js|jsx|mjs)$/`），每个都要在登记表里；登记了不存在的文件记为该条失败并点名（不因 ENOENT 崩溃），另查登记表里没有已不存在的文件；`recent/route.ts` 的步骤 `select` 块（按花括号配对取出）不得出现 `error / inputJson / outputJson`，找不到步骤 `select` 也判失败。
- 改动前：**12 passed, 1 failed**，失败项只有「recent GET … — 缺: isPlatformAdmin, sanitizeListStepInternals, buildReadableProjectWhere, listEffectiveMemberships」；目录完整性列出 7 个路由文件、全部已登记。
- 改动后：**13 passed, 0 failed**，退出码 0。
- 变异（临时改、跑完还原）：

| 变异 | 结果 |
|---|---|
| 目录下加一个没登记的 `zz-probe/route.ts` | ✗「目录下 8 个路由文件都已登记 — 未登记: zz-probe/route.ts」 |
| 加一个没登记的 `zz-probe/route.js` | ✗ 同上，点名 `zz-probe/route.js` |
| `recent/route.ts` 步骤 `select` 里加 `error: true` | ✗「… 选了: error」 |
| 登记表里的 `[taskId]/cancel/route.ts` 改成不存在的 `[taskId]/gone/route.ts` | 10 / 3：该条「登记的文件不存在: [taskId]/gone/route.ts」、「登记表里没有已不存在的路由文件 — 不存在: …」、目录完整性点名没登记的 cancel；没有崩溃 |
| 步骤里把 `orderBy` 挪到 `select` 前面（认不出步骤 `select`） | ✗「… 找不到步骤 select」 |

- 已知限制：它按源码文本找步骤 `select`，§5.3 的五种写法都能骗过它（实测 7 种变异它全部 13 / 0 通过）；由 §5.3 的截获参数测试兜住。

### 5.2 隔离库 + HTTP（`NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… npx tsx src/lib/agent-tasks/__tests__/recent-view-db.isolated.test.ts`，库 `qy_iso_d`）

夹具（只用虚构企业名）：组织甲、乙、丙（丙按岗位模式）；甲的 P1、P2（已分发）、P3（未分发）；没有组织的 P4；丙的 P5、P6。对照组 9 人（负责人：已离开甲；P1 只读成员；P1 inactive 原成员；甲的 active 管理员；甲的 active 所有者；甲的 inactive 原管理员；甲的普通成员；乙的管理员；super_admin）每人在 P1–P4 上各一条 cron、一条 manual；super_admin 另在 P5（不是项目成员）、P6（active 成员）上各一条；条数用户 P1 上 22 条较早（11 条 cron）、P2 上 25 条更新；已停用账号一条。每条任务显式写递增的 `createdAt`；步骤检查报告里放原始报错标记串、价格标记串与「利润率 7.5%，低于 10% 安全线」；意图与步骤摘要带项目标记。

| 一节（对应规格 Scenario） | 改动前（main 上的两个路由与 `dto.ts`）过 / 不过 | 改动后 |
|---|---|---|
| 与项目读权限逐人一致（9 人逐个对照守卫 + 守卫放行结果与规格描述一致） | 2 / 8（只有 super_admin 与守卫自检通过） | 10 / 0 |
| 还能打开项目的人照常看到 | 3 / 0 | 3 / 0 |
| 打不开项目的人看不到 | 0 / 4 | 4 / 0 |
| 未分发项目上的巡检任务 | 1 / 2 | 3 / 0 |
| 触发方式筛选与排序照旧（含组织管理员 2 条 cron、条数用户 11 条 cron 取最新 10 条的排序） | 5 / 0 | 5 / 0 |
| 不是平台管理员的人：检查报告为空、键集合不变、正文里没有标记串与打不开的项目 | 10 / 16（键集合与只读成员的字段照旧通过） | 26 / 0 |
| 平台管理员照旧看到全部原文 | 3 / 0 | 3 / 0 |
| 以岗位预览身份访问的 super_admin | 1 / 4 | 5 / 0 |
| 条数上限按可见任务计（`5` / 不带 / `50` / `-5` / `abc` / `0` / `2.5` / 空串 / `0x10` / `1e1` / `5.0` / `%2B3`） | 0 / 12 | 12 / 0 |
| 项目任务列表的条数（41 条；不带 / `5` / `-5` / `-1000` / `abc` / `0` / `2.5` / `0x10` / `150`） | 6 / 4（`-5`、`-1000`、`2.5`、`0x10`） | 10 / 0 |
| 未登录与已停用账号 401 | 2 / 0 | 2 / 0 |
| 请求前后库内不变、库里检查报告仍是原文 | 2 / 0 | 2 / 0 |
| **合计** | **35 passed, 50 failed**（退出码 1） | **85 passed, 0 failed**（退出码 0），连跑 3 次结果一致 |

第一版（审查前）是 27 / 42 → 69 / 0；审查后加了 cron 排序 2 项、`limit` 4 项、项目任务列表 10 项。

变异（第一版上做，临时改路由、跑完还原）：组织管理员一档不传（`adminOrgIds` 换成 `[]`）→ 4 条失败；`diagnostic` 恒为 true → 9 条失败；`limit` 负数取绝对值 → `?limit=-5` 一条失败。

### 5.3 截获查询参数（`npx tsx src/lib/agent-tasks/__tests__/recent-route-args.test.ts`，不连库，进 CI 子集）

在导入前把 `globalThis.prisma` 换成假的 db（`src/lib/db.ts` 优先用它），直接调两个列表路由的 `GET`，截获 `db.agentTask.findMany` 实际收到的参数：findMany 只收到 `where / select / orderBy / take`；任务层 `select` 恰好 11 个键、项目只选 `id / name`、步骤只有 `select` 与 `orderBy`，步骤 `select` 恰好 5 个键；`where` 与守卫同口径（字面量比对：组织管理员 / 所有者带 `orgId in`，普通成员没有这一档，super_admin 只有 `createdById`、不查成员表）；`triggerType` 照传；不是平台管理员时步骤 `checkReportJson` 为 `null`、super_admin 原样；未登录 401 且不查任务；25 种 `limit` 写法下两个路由的 `take`。

- 改动后：**20 passed, 0 failed**。
- 两个路由换回 main 版本：**13 passed, 7 failed**（范围条件 4 项、检查报告置空 1 项、两个路由的 `take` 各 1 项）。
- 只换回第一版的 `recent/route.ts`（`Number.isInteger` 规则）：18 / 2（最近任务 `05` / `5.0` / `0x10` / `+3` 被采用；项目任务列表负数原样传给 `take`）。
- 变异（每次在 `recent/route.ts` 里让步骤或任务多选字段，跑完还原；契约测试同时跑）：

| 变异 | 截获参数测试 | 契约测试 |
|---|---|---|
| 1 展开常量：`...EXTRA_STEP`（`{ error: true }`） | 19 / 1 ✗ | 13 / 0（没抓到） |
| 2 引号键：`"error": true` | 19 / 1 ✗ | 13 / 0（没抓到） |
| 3 计算键：`["err" + "or"]: true` | 19 / 1 ✗ | 13 / 0（没抓到） |
| 4 简写：`const error = true; … error,` | 19 / 1 ✗ | 13 / 0（没抓到） |
| 5 注释里放假 select（`// steps: { select: { id: true } }`）+ 真 select 加 `error: true` | 19 / 1 ✗ | 13 / 0（没抓到） |
| 6 任务层加 `createdBy: { select: { email: true } }` | 19 / 1 ✗ | 13 / 0 |
| 7 任务层加 `approvalRequests: { select: { previewJson, riskReason } }` | 19 / 1 ✗ | 13 / 0 |

### 5.4 `dto.test.ts`

23 → **33 passed, 0 failed**（原有 23 项照过）。列表步骤投影 7 项：不是平台管理员时三种内部字段都置 `null`；其余键不动、键顺序不变、不新增键；不改传入对象；置空的键与 `AGENT_STEP_INTERNAL_FIELDS` 逐项相同；只有 `checkReportJson` 时只置它、不补出另两个键；业务结果里没有检查报告原文；平台管理员原样返回。列表条数 3 项：两组常量；十进制正整数照用、超过上限按上限；缺省、空串、0、负数、小数、非数字、`0x10`、`1e1`、`+3`、前导零按缺省。

### 5.5 门禁（审查后修订完、合入 main `a8caa985` 后重跑）

| 命令 | 结果 |
|---|---|
| `npm test`（`qy_full_fix23` 删掉重建、`prisma migrate deploy` 后跑，本机没有别的全量在跑时开始；日志 `/home/user/full-agent-tasks-recent-safe-view.log`） | **720 / 730 通过，10 失败，与 main 基线逐条相同**（来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB）；上次多出的「Supplier Intel S1 审计脊柱 DB」这次通过，没有再出现。本 change 的三个测试在全量里：隔离库 85 / 0、截获参数 20 / 0、`dto.test.ts` 33 / 0；05:43–06:08，期间本机没有别的全量或 CI 子集在跑 |
| `npm run test:ci`（`env -u DATABASE_ENVIRONMENT` + CI 库） | **CI unit subset PASS**（含 `dto.test.ts` 33 / 0、`authz-contract.test.ts` 13 / 0、`recent-route-args.test.ts` 20 / 0）；在全量跑完之后单独跑 |
| `npm run typecheck` | 退出码 0 |
| `npm run lint:baseline` | PASS（current errors 38，baseline 53，无新增 fingerprint） |
| `bash scripts/check-test-registry.sh` | OK：已注册 696 个；历史欠账基线剩余 66 条（`ci/test-registry-baseline.txt` 未改） |
| `bash scripts/test-runtime-architecture.sh` | PASS（repo conformance 9 / 0）；`src/lib/runtime-architecture/` 对 main 无差异 |
| `OPENSPEC_TELEMETRY=0 openspec validate agent-tasks-recent-safe-view --strict` | valid |
| 归档演练 | 在临时副本里 `openspec archive agent-tasks-recent-safe-view --yes`：`agents/agent-tasks-recent-view` 新建，+10 条要求；`openspec validate --specs --strict` 归档前 151 / 0，归档后 152 / 0；主规格 10 条要求、27 个场景，正文最长 315 字 |
| 开工前基线 | `dto.test.ts` 23 → 33、`authz-contract.test.ts` 9 → 13、`search-where.test.ts` 28 → 28，都不减 |

第一版（`eb32b0e7`）的全量：714 / 725，10 项与基线相同，另 1 项「Supplier Intel S1 审计脊柱 DB」的 T20 并发计时断言（`childSettledAt` 比 `holderCommittedAt` 早 1 ms；当时本机同时在跑 CI 子集），单独重跑 3 次 86 / 0。

### 5.6 prod-check.sql 演练

`docs/acceptance/fix-23/prod-check.sql` 在隔离库上对本测试的夹具（跑一遍测试、不清理，核对完按标记删掉）跑过：
- A 段 8 行逐行与夹具的预期一致（「0 合并后照旧可见」36 条 / 5 人、「1 项目未分发」16 条（cron 8）、「2 项目成员身份已停用」2 条、「3 原管理员」4 条、「4 同企业非成员」33 条、「5 原普通成员」2 条、「6 项目没有组织」14 条、「7 别的企业」4 条；其它触发方式 0）；
- B 段（只算 active 账号，已停用账号那一条不计）`custom` 32 / 32、`project_inspection` 32 / 32；
- C 段 0；在事务里把 P1 的两个只读成员角色改成空串再查，是 2 行 / 1 个项目 / 2 人，随后回滚。

## 6. 没验证到的与已知限制

- 生产数据上合并后会少多少条、查询耗时：只读查询交给 Evan（§9）。
- 真实 Next 服务里岗位预览的成员身份经 `next/headers` 的 `cookies()` 读到：测试里与其它预览测试一样用 `withPreviewToken` 注入（测试进程读不到请求 cookie），生产路径没有单独跑。
- 浏览器里点一遍：界面上没有入口（唯一调用方没挂载），见 §9 的手动核对。
- 已知限制：`scripts/check-test-registry.sh` 只扫 `src/lib/**/__tests__/*.test.ts`；`src/app/api/agent/tasks/__tests__/authz-contract.test.ts` 这类放在 `src/app/**` 下的测试漏注册它查不出来（本 change 的都已手工注册进两个脚本）。
- 已知限制：契约测试按源码文本找步骤 `select`，能被展开常量、引号键、计算键、简写、注释骗过（§5.3）；字段集合由截获参数的测试守。
- 已知限制：项目角色是空串的 active 项目成员，守卫拒、本接口放行（§3）；prod-check C 段数生产行数。

## 7. 没有开关，合并即在生产生效；回退办法

没有开关，没有数据迁移。回滚只能 revert 这一个 PR（源码：`recent/route.ts`、`tasks/route.ts` 的 `limit` 一行、`dto.ts` 新加的函数与常量、两个测试脚本的注册行；测试文件随之回退）。

## 8. 后续任务（已登记进 TASKFLOW，编号「待定」）

1. `GET /api/agent/approvals` 的 `approvals` 字段原样带 `riskReason` 与 `previewJson`（`src/lib/agent/approval.ts:111-164`）：`riskReason` 在检查不通过时由 `src/lib/agent-core/skills/flow-runner.ts:391-393` 拼进检查报告的 blockers，含原始报错；`previewJson` 是步骤原始输出（`:394`），报价草稿那一步含价格。与 `src/lib/agent-tasks/dto.ts:22-26` 的 `APPROVAL_INTERNAL_FIELDS` 约定不一致。审查后补：只按审批可见集合判断、不重查项目读权限，被移出项目的人照样拿到该项目名字、原始报错与价格；`inbox[].preview` 同样返回（`src/lib/approval/port.ts:140`，`riskReason ?? previewJson`）。全仓库没有界面调用这个接口。
2. 旧仪表盘的「自动巡检」卡没有挂载：`ManagementDashboardClient`（`src/components/dashboard/management-dashboard-client.tsx:37`）没有任何页面引用，首页渲染的是 `OrgCockpitHome`。卡片（`src/components/dashboard/dashboard-auto-inspections.tsx`）是本接口唯一的界面调用方，本 change 之后它对不是平台管理员的人数不出「N 项发现」。删掉这两个组件，还是挂回去并另做安全的问题摘要（GATE 1 选项 C），待定。
3. cron 巡检对未分发的项目也建任务：`src/app/api/cron/inspect/route.ts:30-45` 只按 `status: "active"` 选项目、不看 `intakeStatus`。这些任务挂在负责人名下，负责人（不是 super_admin）从详情接口与最近任务接口都看不到。该不该跳过未分发项目，按 prod-check A 段「1 项目未分发」一行的 cron 条数定。
4. （审查后加）execute / approve 的响应 `reason` 可能带原始异常文字：技能抛错时 `src/lib/agent-core/skills/flow-runner.ts:351-356` 把 `err.message` 作为 `reason` 返回，`POST /api/agent/tasks/:taskId/execute`（`src/app/api/agent/tasks/[taskId]/execute/route.ts:34`）与 `POST …/steps/:stepId/approve`（`approve/route.ts:65`）原样给调用者，不分平台管理员。
5. （审查后加）公开的自定义流程模板跨企业可见：`GET /api/agent/templates`（`src/app/api/agent/templates/route.ts:22`）按 `isPublic` 列出所有企业的公开模板，`GET /api/agent/templates/:templateId`（`[templateId]/route.ts:28`）返回整条记录、含 `createdById`。

另：prod-check C 段不为 0 时，另开任务处理空串角色的项目成员。

## 9. 合并后要人做的事

- **只读查询（Evan，生产库）**：`psql "<生产只读连接串>" -f docs/acceptance/fix-23/prod-check.sql`（`BEGIN READ ONLY` … `ROLLBACK`，只有 SELECT），结果原样贴回。
  - A 段：合并后会从创建人列表里消失的任务（创建人不是 super_admin、账号 active、按项目读权限口径打不开项目），按原因（项目未分发 / 项目成员身份已停用 / 组织成员身份已停用的原管理员 / 同企业非成员 / 原普通成员 / 项目没有组织 / 别的企业）与触发方式（cron / manual / 其它）各数几条，「0 合并后照旧可见」是对照。「1 项目未分发」一行的 cron 数就是后续 3 要看的数。
  - B 段：创建人不是 super_admin、账号 active 的任务里，检查报告带「步骤执行失败：」的步骤、带「利润率」的步骤各几条，按任务类型分。这些就是过去能从这个接口读到的内容；有没有人真的读过查不到，因为接口不记调用者。
  - C 段：项目角色是空串的 active 项目成员有几行。**不为 0 时另开任务**（这些人在最近任务里看得到自己建的任务，点进详情却是 403）。
- **要处理的数据**：没有。本 change 不改任何数据。
- **合并后点一遍（Lucas）**：界面上没有要点的地方。登录后在浏览器地址栏打开 `/api/agent/tasks/recent?limit=5`：
  - 用 super_admin 打开，检查报告（`checkReportJson`）是原文；
  - 用一个不是 super_admin 的项目负责人打开，每一步 `checkReportJson` 都是 `null`，列出的任务所属项目他都打得开。
  - 另在项目页「AI 任务」面板看一眼，列表照常（它不传 `limit`）。

## 10. 与八条硬纪律的关系

1. 零 schema：遵守。没有 model / 字段 / migration；测试只往隔离库写夹具并清理。
2. 出站先审批：不涉及。只读接口，本次只少返回东西。
3. 禁止第三套队列：遵守。不新增队列 / 调度 / lease / worker；改的是旧编排冻结区里两个读接口，类别 `security_fix`，不加非测试文件，runtime-architecture baseline 不变。
4. 脱敏：不涉及 Muse 通道；方向一致——不是平台管理员的人拿到的检查报告整段换成 `null`，原始报错、模型原文里的单价、报价审查的利润率都不出。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。不新增模型调用；范围判断是查成员关系。
8. 测试注册：遵守。新测试进 `scripts/test-all.sh`；三个不用库的测试进 `scripts/test-ci-unit.sh`；`check-test-registry.sh` OK，基线未加行。

## 11. 审查后的修订（2026-11-23，四个维度审查，都没有阻断项；协调会话核实后定）

| # | 意见 | 去向 |
|---|---|---|
| 1 | 测试质量 2（应修）：`parseLimit` 移到 lib 并单测；加不连库、进 CI 子集、截获 `findMany` 参数的测试 | 已修：`parseListLimit` 进 `dto.ts`（不另建 `recent-query.ts`：冻结区新文件触发 `FROZEN_AREA_NEW_FILE`，§2.3）；新测试 `recent-route-args.test.ts` 20 项，五种绕过写法与任务层两种多选都抓到（§5.3） |
| 2 | 决定：`limit` 只认十进制正整数 | 已改：`/^[1-9]\d*$/`（去首尾空白），规格 R4 改写，`0x10` / `1e1` / `5.0` / `+3` / 前导零都按缺省 |
| 3 | 决定：`tasks/route.ts:29` 同一个负数 `limit` 缺口并进本 change | 已改：同一个 `parseListLimit`（缺省 20、封顶 100）；规格加「项目任务列表的条数」与两个场景；隔离库测试加一节（改动前 `-1000` 返回全部 41 条、`-5` 返回最早的 5 条）；proposal Why / What、design、tasks 同步 |
| 4 | 安全 5：任务层审批内部字段、`createdBy` 也禁选 | 已修（按第 1 条的截获断言做）：任务层 `select` 键集合必须恰好 11 个，加 `createdBy`、`approvalRequests` 的变异都失败 |
| 5 | 测试质量 1、3：目录完整性匹配 `route.(ts|tsx|js|jsx|mjs)`；登记了不存在的文件不崩溃 | 已修（§5.1 变异） |
| 6 | 规格 6：cron 筛选下的排序用 2 条以上 cron 的身份 | 已修：组织管理员（2 条）、条数用户（11 条取最新 10 条，逐条比顺序）；规格加「cron 筛选下的排序」场景 |
| 7 | 正确性 1：空串项目角色守卫拒、批量条件放行 | 不改共用函数；prod-check 加 C 段；design Risks、报告 §3 / §6 / §9 写明 |
| 8 | 规格 8：B 段只算 active 账号；触发方式口径与 tasks 一致 | 已改：B 段加 `u.status = 'active'`；A 段按 cron / manual / 其它三列，tasks 3.2 同步写成这三列 |
| 9 | 规格 1（应修）：tasks 1.2 verify 与 design D6 补全改动前失败项；报告 §4 改名并核对 | 已改（§4 表逐条写了同步位置） |
| 10 | 规格 2–5：proposal 挪位措辞、design 测试先行措辞、Non-Goals「加一个函数与它的类型」、契约测试另两个失败条件 | 已改：proposal 开头与 Impact；design D6「契约测试与隔离库测试先行」；Non-Goals 按实际写成「投影函数与它的类型、`limit` 解析函数与两组条数常量」；规格「目录登记」一条与 design D6 都写了「登记了不存在的文件」「认不出步骤 select」 |
| 11 | 安全 1–4：后续任务登记 | 已登记：后续 1 补写两句；新增后续 4（execute / approve 的 `reason`）、后续 5（公开模板跨企业可见）；第 3 条决定已并进本 change，不单独登记。`| 待定 |` 12 → 17 |
| 12 | 测试质量 4（只记）：`check-test-registry.sh` 只扫 `src/lib/**` | 写进 §6 已知限制 |

## 12. 提交

| 提交 | 内容 |
|---|---|
| `967c664d` | 合入 main `212613ec`（FIX-21 #554） |
| `56644263` | 测试先行：契约测试登记最近任务接口 + 目录完整性；新增隔离库测试；注册；四件套按合入后的 main 复核 |
| `bedcc3c5` | `dto.ts` 列表步骤投影 + 7 项单测 |
| `c12a3c30` | 路由：可读项目条件、步骤投影、`limit` 校验 |
| `eb32b0e7` | 报告、prod-check.sql、TASKFLOW |
| `951849be` | 合入 main `a8caa985` |
| `4b285ce9` | 审查后修订（代码与测试）：`parseListLimit`、项目任务列表 `limit`、截获参数测试、契约测试加固、隔离库测试补用例 |
| `b885aa79` | 审查后修订（文档）：规格 / proposal / design / tasks、prod-check.sql、TASKFLOW、报告 |
| （本提交） | 补全量、CI 子集与归档演练的数字 |

## 13. 多维审查

（由协调会话补）
