# FIX-17 报告：项目文件的删除与逐步处理接口补上项目权限检查

> **白话说明（合并后谁会发现什么变了）**：这次只给后台两个文件接口（删除文件、自动解析文件）补上了「是不是这个项目的人」的检查，界面一个字没改。项目成员、负责人、组织管理员和平台管理员用起来和以前完全一样；以前别的组织或与项目无关的账号，只要知道项目编号就能删掉文件、重新跑解析（花模型费用），现在会被直接拒绝。正常用户唯一可能碰到的情况：页面开着时刚被移出项目的人，再点删除或「重新处理」会没有反应，刷新后看到「项目不存在或无权访问」。

| 项 | 值 |
|---|---|
| change | `project-files-access-guard`（新能力 `projects/files-access`，8 条要求） |
| TASKFLOW | FIX-17（Phase F（续）— 情报串联表，FIX-12 之后；FIX-12 已由 #540 合并，FIX-13 为 #546，FIX-14 / 15 / 16 已预留） |
| 来源 | 2026-11-21 做 FIX-13（`document-parse-nul-and-reason`）的安全审查时发现，不在 FIX-13 范围，另开；级别由 Evan 2026-11-21「按照你推荐的做」定为读权限 |
| 分支 | `claude/zen-turing-azudvx-fix17`（2026-11-22 接手：以 `claude/blissful-mendel-o8h9yr` 的四个提交为正本，合入 main 后续做；原分支停在 `3253ca3a`，不再更新） |
| 性质 | 修既有的越权。零 schema、零新模型调用、没有新增出站、没有新队列。**没有开关——合并即生效** |

## 1. 问题

`src/app/api/projects/[id]/files/` 下四个处理函数，两个只查「已登录」：

| 路由文件 | 方法 | 改动前的守卫 | 结论 |
|---|---|---|---|
| `files/route.ts` | `GET`（列表） | `requireProjectReadAccess` | 已核对，不改 |
| `files/route.ts` | `POST`（上传） | `requireProjectReadAccess` | 已核对，不改 |
| `files/[fileId]/route.ts` | `DELETE` | 只有 `withAuth` | **缺口，已补** |
| `files/process-next/route.ts` | `POST` | 只有 `withAuth` | **缺口，已补** |

目录下没有别的路由（没有重命名、移动文件夹接口）。目录外顺带读过两处，都是项目读权限、不改：浏览器读项目文件的代理 `GET /api/files/projects/:projectId/...`、`POST /api/projects/:id/checklist`。

缺口的后果（改动前的代码上用隔离库实测，见 §5）：另一个组织的登录账号、同组织但不是项目成员的账号、成员身份已停用的账号，只要有项目 ID 就能——

- 带 `?retry=1` 把该项目失败 / 卡住的文件重置成待解析，清空解析报错、已抽取文字与 AI 摘要；
- 逐个触发文件解析、AI 摘要与项目情报分析（模型费用记在该项目头上）；
- 从响应里读到文件 ID、文件标题与解析报错原文；
- 删掉文件记录，并删掉 Blob 里的原文件（不可恢复）。

未分发的项目、不存在的项目 ID 也照样执行。

## 2. 做了什么

1. `POST /api/projects/:id/files/process-next`（含 `?retry=1`）第一步调现成的 `requireProjectReadAccess`，返回的是响应就原样返回。在任何读写、解析、模型调用、自动入队之前。
2. `DELETE /api/projects/:id/files/:fileId` 第一步调同一个守卫，在查文件、删 Blob、删记录之前——被拒的人拿到的响应与文件 ID 是否存在无关，探测不到文件 ID（项目不存在或未分发时是 404，其余被拒是 403）。
3. 两处都保留 `withAuth` 外壳（统一的异常兜底与 `x-request-id`），其余逻辑与响应一字未动。两个路由文件合计 +13 / −1 行。
4. 守卫测试 `src/lib/projects/__tests__/files-route-guard.test.ts`（无 DB，进 CI 子集）：按目录枚举 `files/` 下全部 `route.ts`，每个导出的处理函数必须先调项目守卫（取路由参数之后的第一个 await 就是它）、检查守卫返回值本身、再碰数据库 / 文件存储 / 解析 / 模型 / 入队 / 请求体；路由文件里出现 `export { … }` / `export * from` 一律判失败（这种写法的处理函数认不出来）。以后在这个目录下加路由漏了检查会失败并点名文件与方法。
5. 隔离库 + HTTP 测试 `src/lib/projects/__tests__/files-access-db.isolated.test.ts`：直接调路由处理函数，带真会话 cookie；原文件用 `blob-access` 的本地存储开关放真文件来观察。

改动后的响应码（两个接口相同；列表与上传本来就是这样）：

| 调用者 | 结果 |
|---|---|
| 平台 super_admin、项目负责人、项目所在组织的所有者或管理员（组织成员身份 active）、项目的 active 成员（不论项目角色） | 照常执行（`process-next` 200；`DELETE` 200 `{"success":true}`；文件不在本项目 404「文件不存在」） |
| 没有会话，或账号已停用 | 401「未登录」 |
| 已登录但与项目无关：别的组织的用户、同组织非成员（且不是组织管理员）、项目成员身份 inactive、组织成员身份 inactive 的原组织管理员（不是项目成员） | 403「无权查看该项目」 |
| 项目 ID 不存在；项目未分发（super_admin 除外） | 404「项目不存在」 |

被拒的请求：不改任何文件记录、不删原文件、不启动解析 / 摘要 / 情报 / 自动入队；响应正文只有 `error`（及 `requestId`，如果有），不带文件 ID、标题、解析报错。

## 3. 需要你知道的取舍

- **级别是读权限（成员即可），不是写权限。** `process-next` 必须与上传同级：文件抽屉每次上传完自动调它，打开时发现失败文件还会自动带 `?retry=1`。`DELETE` 也按上传的级别：今天所有成员都能删，界面对所有成员显示删除按钮。项目路由里别的 `DELETE` 多数是写权限——以后要把删文件收紧，是换一个守卫加一条界面任务（删除按钮现在不看请求结果，403 会表现为点了没反应），见 design D3 与下面「留给 GATE」。
- **`viewer` 角色的成员也能删文件、能触发处理**，与今天一致，也与「`viewer` 能上传」一致。
- **未分发的项目**：成员现在得到 404。界面上本来就到不了（列表与上传走同一个守卫）；分发后打开文件抽屉会自动继续处理。
- **今天就会出现「点了没反应」**：页面开着时刚被移出项目（或组织管理员身份被停用）的人，再点删除，图标转一下、文件还在、没有任何文字；点「重新处理」，进度条闪一下就消失。刷新后整页显示「项目不存在或无权访问」。这是删除按钮与自动处理不看请求结果的既有行为，本次不改界面。
- **被拒时接口返回的文字是「无权查看该项目」**（守卫全站共用，没有为这两个接口单独改）；文件抽屉的删除按钮不显示这段文字，界面上表现为点了没反应、文件还在。
- **守卫测试是读源码判断先后**：只认三个守卫名与一小组「碰数据」的标记；不检查守卫的参数是不是路径里的项目 ID。2026-11-22 的审查找到三种漏报写法（守卫之前先 await 一个里面写库的本地函数、`export { x as DELETE }`、检查的不是守卫返回值），都已补上检查与自测；真正的行为仍由隔离库测试兜底。
- **合并后有人的脚本 / 手工请求会从 200 变 403**——如果有人不是成员却在处理或删除别的项目的文件。没有保留兼容。
- **每个请求多几次主键查询**（用户一次、项目与成员关系各一次），相对一步动辄数秒的解析 / 模型调用可以忽略。

## 4. 与八条硬纪律的关系

| 纪律 | 情况 |
|---|---|
| 零 schema | 没有 schema 变更；测试只往隔离库写夹具并清理 |
| 出站先审批 | 不涉及，没有任何对外发送 |
| 禁止第三套队列 | 没有新增队列 / 调度；`process-next` 仍由前端逐步驱动，自动入队仍走既有入口，只是前面多了一道门 |
| 脱敏 | 不改 Muse 通道；被拒的响应不带文件标题与解析报错 |
| 不爬登录页 | 不涉及 |
| 邮箱分离 | 不涉及 |
| 确定性优先 | 没有新增模型调用；权限判断是查成员关系。无关调用者触发不了解析与摘要，模型调用只会少 |
| 测试注册 | 两个新测试已注册进 `scripts/test-all.sh`；守卫测试同时进 `scripts/test-ci-unit.sh`；`ci/test-registry-baseline.txt` 没有加行 |

## 5. 验证

顺序：先写两个测试、不改路由各跑一遍；再加守卫重跑。

### 5.0 将要触碰模块的基线（tasks 1.1）

`scripts/test-all.sh` 里 `src/lib/files/`、`src/lib/projects/`、`src/lib/tender-auto-analysis/` 下已注册的 42 个测试，不带库（隔离库测试自动跳过）分别在 main `2ef4f9c8` 与本分支各跑一遍：每个测试的最后一行（通过 / 失败数）逐行相同；本分支只多出两个新测试（守卫 17 / 17；隔离库测试不带库时跳过）。带库的结果见 §5.2 与 §5.3 的全量。

### 5.1 守卫测试

改动前（退出码 1）：

```
  ✓ 检查器：完全不做项目权限检查的处理函数被指出
  ✓ 检查器：先读数据库、后做权限检查的处理函数被指出
  ✓ 检查器：调了守卫却不看结果的处理函数被指出
  ✓ 检查器：被注释掉的守卫不算数
  ✓ 检查器：先过守卫再碰数据的两种写法都通过
  ✓ 目录下找到已知的三个路由文件（列表与上传、删除、逐步处理）
  ✓ src/app/api/projects/[id]/files/[fileId]/route.ts：至少导出一个 HTTP 处理函数
  ✗ src/app/api/projects/[id]/files/[fileId]/route.ts DELETE：先过项目权限检查，再碰数据库 / 文件存储 / 解析 / 模型 / 入队 "没有调用项目权限守卫"
  ✓ src/app/api/projects/[id]/files/process-next/route.ts：至少导出一个 HTTP 处理函数
  ✗ src/app/api/projects/[id]/files/process-next/route.ts POST：先过项目权限检查，再碰数据库 / 文件存储 / 解析 / 模型 / 入队 "没有调用项目权限守卫"
  ✓ src/app/api/projects/[id]/files/route.ts：至少导出一个 HTTP 处理函数
  ✓ src/app/api/projects/[id]/files/route.ts GET：先过项目权限检查，再碰数据库 / 文件存储 / 解析 / 模型 / 入队
  ✓ src/app/api/projects/[id]/files/route.ts POST：先过项目权限检查，再碰数据库 / 文件存储 / 解析 / 模型 / 入队
  ✓ 目录下一共至少四个处理函数（列表、上传、删除、逐步处理）

漏了项目权限检查的处理函数：
  - src/app/api/projects/[id]/files/[fileId]/route.ts DELETE：没有调用项目权限守卫
  - src/app/api/projects/[id]/files/process-next/route.ts POST：没有调用项目权限守卫

FIX-17 project files route guard: 12 passed, 2 failed
```

改动后（退出码 0）：`FIX-17 project files route guard: 14 passed, 0 failed`。2026-11-22 加了三条检查器自测之后：改动后 17 / 17；两个路由文件分别换回 origin/main 版本各 16 过 1 败。

### 5.2 隔离库 + HTTP 测试

本机 Postgres 16（`127.0.0.1:5433`，41 个迁移全部应用），`NODE_ENV=test DATABASE_ENVIRONMENT=isolated`。

改动前（2026-11-22 接手后补了用例重跑：退出码 1，59 项里 27 项失败——2026-11-22 交叉验证后又补一条「不存在的文件 ID 与真实文件同一个 403」，60 项里 28 项失败；两个路由文件换回 origin/main 版本，测试不变。响应正文只留状态码）：

```
  ✗ 别的组织的用户调 process-next → 403「无权查看该项目」 — {"status":200,…}
  ✗ 别的组织的用户调 process-next?retry=1 → 403 — {"status":200,…}
  ✗ 被拒的重试：解析状态、解析报错、已抽取文字、摘要状态与摘要内容都与请求前一致 — （快照不同，略）
  ✗ 被拒的 process-next 响应不带文件信息 — （200，正文带处理结果，略）
  ✗ 别的组织的用户调 DELETE（真实存在的文件）→ 403 — {"status":200,…}
  ✗ 被拒的删除：文件记录还在且未变
  ✗ 被拒的删除：存储里的原文件还在
  ✗ 被拒的 DELETE 响应不带文件信息 — {"success":true}
  ✗ 别的组织的用户对有待解析文件的项目调 process-next → 403 — {"status":200,…}
  ✗ 响应里没有 documentId / documentTitle / parseError，也不出现文件标题与报错文字 — {"step":"parse",…}
  ✗ 待解析的文件没有被解析（状态与报错都没变） — （快照不同，略）
  ✗ 同组织但不是项目成员调 DELETE → 403 — {"status":200,…}
  ✗ 同组织但不是项目成员调 process-next?retry=1 → 403 — {"status":200,…}
  ✗ 项目成员身份为 inactive 的用户调 process-next?retry=1 → 403 — {"status":200,…}
  ✗ 项目成员身份为 inactive 的用户调 DELETE → 403 — {"status":200,…}
  ✗ 组织成员身份已 inactive 的组织管理员调 process-next?retry=1 与 DELETE → 403 — （两次都是 200，略）
  ✗ 这几次被拒的重试都没有重置失败的文件
  ✗ 这几次被拒的删除都没有删文件记录与原文件
  ✗ inactive 成员与原组织管理员各自要删的那份文件，记录与原文件都还在
  ✗ 响应都不带文件信息
  ✗ 不存在的项目 ID 调 process-next → 404「项目不存在」 — {"status":200,…}
  ✗ 不存在的项目 ID 调 DELETE → 404「项目不存在」 — {"status":404,…}
  ✗ 成员对未分发的项目调 process-next?retry=1 → 404 — {"status":200,…}
  ✗ 未分发项目里失败的文件没有被重置
  ✗ 成员对未分发的项目调 DELETE → 404「项目不存在」 — {"status":200,…}
  ✗ 未分发项目的文件记录与原文件都还在
  ✗ 404 响应都不带文件信息
FIX-17 project files access (DB + HTTP): 32 passed, 27 failed
（补那一条之后：32 passed, 28 failed）
```

读法：「不存在的项目 ID 调 DELETE → 404」改动前拿到的是「文件不存在」而不是「项目不存在」。改动前就通过的 32 项：未登录与已停用账号的 401、列表与上传的 401 / 403、跨项目文件 ID 的 404、有权限的人的全部用例、super_admin 对未分发项目 200，以及几条兜底断言——「被拒的请求没有生成项目情报、没有入队、没有改项目本身的记录」在夹具下改动前也不会发生（没有摘要、自动入队开关关着、没有可补全的字段），它们只是兜底，真正能区分改动前后的是 403 / 404 本身、文件快照与「待解析的文件没有被解析」（那份待解析文件是一个真实的 txt 原文件，改动前会被解析成 done）。

改动后（退出码 0，连跑 3 次结果相同）：`FIX-17 project files access (DB + HTTP): 59 passed, 0 failed`；补那一条之后 `60 passed, 0 failed`（连跑 2 次，2026-11-22，main `01e444b9` 合入之后）

有权限的路径没有触发解析与模型：成员调 `process-next` 走到 `step: "none"`，日志里自动入队的结果是 `auto_disabled`；测试环境没有配任何模型密钥。

### 5.3 门禁

分支 `claude/zen-turing-azudvx-fix17`。代码提交以合入 main `13c7ed33` 后的 `8ec427d0` 为准跑全量；合入 main `01e444b9`（#547，只动 OpenSpec 与文档）之后重跑 CI 子集与各项校验。

| 门禁 | 结果 |
|---|---|
| `npm test`（本机，全新隔离库 `qy_full_fix17`，约 22 分钟） | **`707/717 通过, 10 失败`**；10 项与本机 main `2ef4f9c8` 基线（`703/713`）逐条相同：来信观察 DB、Sunny 工艺单 DB、Phase3A-3 Approvals、Phase3A-4 Governance、Phase3A-4 Acceptance、Autopilot A2-P0、Phase3A-5 Overview、T4 授标情报 Postgres 矩阵、客户报价 PDF 分页布局、招标询价自动起草 DB；没有新增 |
| CI 环境变量下 `npm run test:ci` | PASS（`8ec427d0`，以及合入 `01e444b9` 后的 `b228342f` 再跑一次） |
| `npm run typecheck` | 退出码 0 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint，相对基线少 15 处） |
| `bash scripts/check-test-registry.sh` | OK，已注册 684 个，历史欠账基线剩余 66 条 |
| `bash scripts/test-runtime-architecture.sh` | PASS |
| `openspec validate project-files-access-guard --strict` | valid |
| 守卫测试 / 隔离库测试（单跑） | 17 / 17；60 / 60 |
| `git diff origin/main -- prisma/ vercel.json package.json package-lock.json` | 空 |

已知限制（交叉验证提出、不改）：
- 隔离库里「没有生成项目情报、没有把招标分析入队」「没有改项目本身的记录」两条断言在夹具下改不改都通过（夹具没有摘要、自动入队开关关着、没有可补全的字段），它们只是兜底；能区分改动前后的是 401 / 403 / 404、文件快照、待解析的 txt 没被解析。
- 守卫测试是静态检查：守卫之前调一个不 await 的本地写库函数会漏报；守卫传错 ID 认不出（现有两个路由由隔离库测试兜着）。它只扫 `files/` 目录，其它目录的接口由 FIX-21 的目录守卫管。

## 6. 顺带核对：数字员工工具的 `DOCUMENT_PARSE_FAILED` 字符串

只查、写结论，本次没有改 `src/lib/tender-workforce/tools.ts`。去向由子 agent 追踪，下面标「已核对」的几环我对过代码。

`handleParseDocuments` 有两处带页级解析的报错原文（`<文件名>: <报错原文>`，每条截 200 字）：全部失败时拼进返回的 `error`；部分失败时放进返回数据的 `unparsedDocuments`。报错原文来自 `src/lib/tender-auto-analysis/page-parse.ts`，除几句固定文字外是解析库 / 数据库 / 读文件抛出的异常文本，只去掉换行、截 500 字（已核对）。

| 去向 | 全部失败的 `error` | 部分失败的 `unparsedDocuments` |
|---|---|---|
| 模型提示 | **不进**。只写进该步骤的 `AgentRunStep.errorMessage` 与 `tool.failed` 事件载荷（`agent-runtime-v2/executor.ts`，已核对），不会成为后续步骤的输入 | **会进**。留在 t2 步骤的输出里 → 被抄进交接信封的 `outputs`（`workforce-runtime/handoff.ts`，已核对）→ t8 综合步骤依赖 t2，把上游 `outputs` 放进 `userPrompt` 发给模型（`workforce-runtime/synthesis.ts`，已核对）。t2 那一条超过 4096 字节时才被丢掉 |
| 通知 / 邮件 | **不进**。失败通知与审计用的是查表得到的固定句「卡在第 N 步〈…〉：工具执行失败」（`tender-auto-analysis/alerts.ts`、`tender-workforce/job-failure-surfacing.ts`，已核对） | 不进 |
| Muse 通道 | **不进**。`src/lib/muse-bridge/` 下没有任何地方读步骤报错、`parseError` 或 `unparsedDocuments`（已核对） | 不进 |
| 给人看的页面 | 不显示原文（项目页失败原因、Job 时间线、Agent Trace、助手任务卡这几条是子 agent 的结论，我没有逐条复核） | 除模型提示外没有读它的地方（全仓只有写入那一行，已核对） |

结论：任务书点名的 `error` 字符串不进模型提示、通知、Muse。**同一个函数里的 `unparsedDocuments` 会把同样的报错原文送进 t8 综合步骤的模型提示**（已有的那一次模型调用，没有新增）。

处理办法（另开一条；并进预留的 FIX-16「降级说明」还是另取号由 Evan 定）：`unparsedDocuments` 与 `error` 里只留文件名加一个固定分类（下载失败 / 格式不支持 / 页数超限 / 解析出错），不带异常原文；原文已经存在 `ProjectDocument.parseError` 里，排查不受影响。

## 7. 没做的

- 成员之间谁能删文件的细分（只有上传人或管理者能删等，见下面「留给 GATE」）。
- `process-next` 成功响应里的 `parseError` 原文：对有权限的成员照旧返回，归 FIX-13 / FIX-16。
- 界面：没有改。
- `src/app/api/projects/[id]/files/**` 以外的同类缺口：**已核对，不在本 change 改**。2026-11-22 逐个扫了 `src/app/api/projects/[id]/` 下 176 个 `route.ts`，只有 `withAuth`、没有项目权限检查的另有 4 个文件 / 6 个处理函数（代码核实，没有实跑）：

  | 文件 | 方法 | 任何登录账号对任何项目能做到的 |
  |---|---|---|
  | `ai-bid-package/route.ts` | GET | 拿到该项目最新一次 AI 投标方案任务的全部步骤输出：文档摘要、情报报告、**报价草稿（含价格）**、询价邮件草稿——跨组织泄露商业敏感数据，四个里最重 |
  | `ai-bid-package/route.ts` | POST | 在别人的项目里建任务 |
  | `ai-bid-package/run-step/route.ts` | POST | 执行下一步：调模型生成报价与邮件草稿（不带组织），响应里带回结果，改任务状态，完成时通知受害项目的成员 |
  | `intelligence/regenerate/route.ts` | POST | 调模型重算并覆盖项目情报；按调用者的可见范围重算相似项目，会先清空受害项目的相似项目记录 |
  | `intelligence/review/route.ts` | GET | 读到审核人姓名（或邮箱）、审核备注、评分、推荐结论、风险等级、匹配分 |
  | `intelligence/review/route.ts` | PATCH | 把报告标成已批准 / 已交付，并以调用者的名字记为审核人 |

  建议另开一个 change 尽快修（同一种修法），由 Evan 定。
- 已离开组织的人：组织成员身份被停用、项目成员身份还是 active 的人（或仍是项目负责人）照样能处理、**不可恢复地删除**这些文件——项目读权限的判定不看组织成员状态（`src/lib/projects/access.ts` 的既有行为，影响全部项目读接口；移出组织时也不会停掉项目成员身份）。本次不改，另开任务评估。
- §6 的 `unparsedDocuments`：只写了结论。

## 8. 多维审查与交叉验证

两轮，都只给需求、四件套与 diff，不给结论；每条意见核实后处理。

**第一轮（2026-11-22，五个维度各一个子 agent，都没有阻断项）**

| 维度 | 主要发现 | 处理 |
|---|---|---|
| 正确性与回归 | 改前 / 改后 27 行观测一致（解析、摘要、跳过、情报、无事可做、重试、删除四种）；守卫测试漏报三种写法（守卫前调本地写库函数、`export { x as DELETE }`、检查的不是守卫返回值） | **已补**：守卫测试要求守卫是取参数后第一个 `await`、`export {` / `export *` 判失败、检查的变量必须是守卫返回值（自测三条） |
| 安全 / 隐私与硬纪律 | 10 项绕过实验都挡住；报告 §7 与 proposal 的「没有查」矛盾；注释写「永远 403」不准确 | **已改**：§7 与 proposal 同一份清单并写后果；注释与报告改为「探测不到文件 ID」 |
| 规格—代码—测试一致性 | 项数与改前失败数写错；Req1「与加检查之前一致」没限定已分发项目；Req6 四条断言改前也过；tasks 1.1 基线没做 | **已改 / 已补**：数字、Req1 限定、待解析文件改为真实 txt 存储（没守卫就会被解析）、1.1 基线；「不改项目记录」那条写明是兜底 |
| 权限口径 | design 说「上传人本人或管理者能删没有先例」不对（`finance/expenses/[expenseId]`）；删除会级联删页与分析文档关联、`TenderAnalysisSourceRef.documentId` 无外键会悬空 | **已改** design D3 事实；级别由 Evan 2026-11-21 定为读权限（「留给 GATE」A） |
| 使用流畅与文案 | 报告开头与 TASKFLOW 行缺白话；「FIX-12 在未合并的 #540」过时 | **已改** |

**第二轮：交叉验证（2026-11-22，一个没参与实现与第一轮的子 agent，只看需求、四件套、diff，亲自跑验证）**

- 结论：代码层面没有不能合并的问题；当时唯一的阻断是 §5.3 门禁还是占位、tasks 3.1 没勾 → **已补**（§5.3）。
- 它亲自跑的：守卫测试 17 / 17；隔离库测试 59 / 59（3 次）；两个路由换回 main 版本后 15 / 2 失败、32 / 27 失败；6 个变异（注释掉守卫、挪到写库或查文件之后）守卫测试全部失败，隔离库测试 5 个失败、1 个通过（DELETE 守卫挪到查文件之后、404 判断之前——被拒时行为等价）；`openspec validate --strict` valid；窄范围 tsc 与 eslint 退出码 0。
- 权限口径：调用方只有文件抽屉与新建项目的导入横幅，都挂在项目详情页上，而项目详情页要先过同一个 `requireProjectReadAccess`——能看到这两个界面的人不会被误挡。
- 「探测不到文件 ID」没有直接测 → **已补**一条断言（别的组织的用户用不存在的文件 ID 与用真实文件拿到同一个 403），换回旧路由时失败；隔离库测试现在 60 项。
- 两条兜底断言在夹具下改不改都通过、守卫测试是静态检查有漏报 / 误报 → 不改，写进 §5.3「已知限制」。
- TASKFLOW 的 FIX-12 行仍是 `[~]` → 不是本 PR 引入，由 #545（FIX-12 归档）修。

