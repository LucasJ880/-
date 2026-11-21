# FIX-17 报告：项目文件的删除与逐步处理接口补上项目权限检查

| 项 | 值 |
|---|---|
| change | `project-files-access-guard`（新能力 `projects/files-access`，8 条要求） |
| TASKFLOW | FIX-17（FIX-12 在未合并的 #540；FIX-13 与预留的 FIX-14 / 15 / 16 还没进 main 的 TASKFLOW，取下一个空号） |
| 来源 | 2026-11-21 做 FIX-13（`document-parse-nul-and-reason`）的安全审查时发现，不在 FIX-13 范围，另开；级别由 Evan 2026-11-21「按照你推荐的做」定为读权限 |
| 分支 | `claude/blissful-mendel-o8h9yr` |
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
2. `DELETE /api/projects/:id/files/:fileId` 第一步调同一个守卫，在查文件、删 Blob、删记录之前——与项目无关的人永远得到 403，不能靠 404 / 403 的差别探测文件 ID。
3. 两处都保留 `withAuth` 外壳（统一的异常兜底与 `x-request-id`），其余逻辑与响应一字未动。两个路由文件合计 +13 / −1 行。
4. 守卫测试 `src/lib/projects/__tests__/files-route-guard.test.ts`（无 DB，进 CI 子集）：按目录枚举 `files/` 下全部 `route.ts`，每个导出的处理函数必须先调项目守卫、检查它的结果、再碰数据库 / 文件存储 / 解析 / 模型 / 入队 / 请求体。以后在这个目录下加路由漏了检查会失败并点名文件与方法。
5. 隔离库 + HTTP 测试 `src/lib/projects/__tests__/files-access-db.isolated.test.ts`：直接调路由处理函数，带真会话 cookie；原文件用 `blob-access` 的本地存储开关放真文件来观察。

改动后的响应码（两个接口相同；列表与上传本来就是这样）：

| 调用者 | 结果 |
|---|---|
| 平台 super_admin、项目负责人、项目所在组织的管理员、项目的 active 成员（不论项目角色） | 照常执行（`process-next` 200；`DELETE` 200 `{"success":true}`；文件不在本项目 404「文件不存在」） |
| 没有会话，或账号已停用 | 401「未登录」 |
| 已登录但与项目无关：别的组织的用户、同组织非成员（且不是组织管理员）、成员身份 inactive | 403「无权查看该项目」 |
| 项目 ID 不存在；项目未分发（super_admin 除外） | 404「项目不存在」 |

被拒的请求：不改任何文件记录、不删原文件、不启动解析 / 摘要 / 情报 / 自动入队；响应正文只有 `error`（及 `requestId`，如果有），不带文件 ID、标题、解析报错。

## 3. 需要你知道的取舍

- **级别是读权限（成员即可），不是写权限。** `process-next` 必须与上传同级：文件抽屉每次上传完自动调它，打开时发现失败文件还会自动带 `?retry=1`。`DELETE` 也按上传的级别：今天所有成员都能删，界面对所有成员显示删除按钮。项目路由里别的 `DELETE` 多数是写权限——以后要把删文件收紧到管理者，是换一个守卫名加一条界面任务（删除按钮现在不看请求结果，403 会表现为点了没反应），见 design D3。
- **`viewer` 角色的成员也能删文件、能触发处理**，与今天一致，也与「`viewer` 能上传」一致。
- **未分发的项目**：成员现在得到 404。界面上本来就到不了（列表与上传走同一个守卫）；分发后打开文件抽屉会自动继续处理。
- **删除被拒时的文案是「无权查看该项目」**：守卫全站共用，没有为这两个接口单独改。
- **守卫测试是读源码判断先后**：只认三个守卫名与一小组「碰数据」的标记。处理函数把读写藏进一个在守卫之前调用的自定义函数里，它认不出来；真正的行为由隔离库测试兜底。
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

改动后（退出码 0）：`FIX-17 project files route guard: 14 passed, 0 failed`

### 5.2 隔离库 + HTTP 测试

本机 Postgres 16（`127.0.0.1:5433`，41 个迁移全部应用），`NODE_ENV=test DATABASE_ENVIRONMENT=isolated`。

改动前（退出码 1，52 项里 24 项失败；失败项如下，响应正文只留状态码）：

```
  ✗ 别的组织的用户调 process-next → 403「无权查看该项目」 — {"status":200,…}
  ✗ 别的组织的用户调 process-next?retry=1 → 403 — {"status":200,…}
  ✗ 被拒的重试：解析状态、解析报错、已抽取文字、摘要状态与摘要内容都与请求前一致
  ✗ 被拒的 process-next 响应不带文件信息
  ✗ 别的组织的用户调 DELETE（真实存在的文件）→ 403 — {"status":200,…}
  ✗ 被拒的删除：文件记录还在且未变
  ✗ 被拒的删除：存储里的原文件还在
  ✗ 被拒的 DELETE 响应不带文件信息 — {"success":true}
  ✗ 别的组织的用户对有待解析文件的项目调 process-next → 403 — {"status":200,…}
  ✗ 响应里没有 documentId / documentTitle / parseError，也不出现文件标题与报错文字 — {"step":"parse","documentId":"cmwpvk47i00157dthga8apuxm","documentTitle":"SECRET_TITLE_fix17_1795233305654_dtf8j0.pdf.pending.pdf","parseStatus":"pending","parseError":null,"remaining":1,"done":false}
  ✗ 同组织但不是项目成员调 DELETE → 403 — {"status":200,…}
  ✗ 同组织但不是项目成员调 process-next?retry=1 → 403 — {"status":200,…}
  ✗ 项目成员身份为 inactive 的用户调 process-next?retry=1 → 403 — {"status":200,…}
  ✗ 项目成员身份为 inactive 的用户调 DELETE → 403 — {"status":404,…}
  ✗ 这几次被拒的重试都没有重置失败的文件
  ✗ 这几次被拒的删除都没有删文件记录与原文件
  ✗ 响应都不带文件信息
  ✗ 不存在的项目 ID 调 process-next → 404「项目不存在」 — {"status":200,…}
  ✗ 不存在的项目 ID 调 DELETE → 404「项目不存在」 — {"status":404,…}
  ✗ 成员对未分发的项目调 process-next?retry=1 → 404 — {"status":200,…}
  ✗ 未分发项目里失败的文件没有被重置
  ✗ 成员对未分发的项目调 DELETE → 404「项目不存在」 — {"status":200,…}
  ✗ 未分发项目的文件记录与原文件都还在
  ✗ 404 响应都不带文件信息
FIX-17 project files access (DB + HTTP): 28 passed, 24 failed
```

两处读法：「inactive 成员调 DELETE → 404」是因为同一份文件已被前一步同组织非成员的请求删掉了；「不存在的项目 ID 调 DELETE → 404」拿到的是「文件不存在」而不是「项目不存在」。改动前就通过的 28 项是未登录 401、列表与上传的 403、跨项目文件 ID 404、以及有权限的人的全部用例。

改动后（退出码 0，连跑 3 次结果相同）：`FIX-17 project files access (DB + HTTP): 52 passed, 0 failed`

有权限的路径没有触发解析与模型：成员调 `process-next` 走到 `step: "none"`，日志里自动入队的结果是 `auto_disabled`；测试环境没有配任何模型密钥。

### 5.3 门禁

（全量测试与 CI 子集跑完后补在这里。）

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

- 成员之间谁能删文件的细分（只有上传人或管理者能删）。
- `process-next` 成功响应里的 `parseError` 原文：对有权限的成员照旧返回，归 FIX-13 / FIX-16。
- 界面：没有改。
- `src/app/api/projects/[id]/files/**` 以外的路由有没有同类缺口：没有查。
- §6 的 `unparsedDocuments`：只写了结论。
