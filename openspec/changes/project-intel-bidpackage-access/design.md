# Design：项目情报与一键投标方案的六个接口补上项目权限检查（FIX-21）

## Context

动机见 proposal.md 的 Why。这里只写决定做法需要的现状（main = `2ef4f9c8`，行号都对过）。

**六个处理函数现在做什么**（都只包了 `withAuth`：`src/lib/common/api-helpers.ts` 只查「有会话、账号 active」，外加统一异常兜底与 `x-request-id`）：

- `GET …/ai-bid-package`（`src/app/api/projects/[id]/ai-bid-package/route.ts:35`）：
  - 不带 `taskId` 时取该项目最近一次 `ai_bid_package` 任务。
  - 选出每一步的 `outputJson`、`inputJson`、`error`（`:73`、`:78`），把输出原样作为 `data` 返回，原始报错作为 `error` 返回（`:111-112`）。
  - 四步是文档摘要 → 情报 → 报价草稿 → 邮件草稿（`src/lib/agent-core/skills/bid-package.ts:21-56`）。
  - 报价草稿以该项目已报价的供应商单价 / 总价为输入（`src/lib/agent/skills/quote.ts:89-130`），产出带价格的行项。
- `POST …/ai-bid-package`（`:11`）：查一次项目是否存在（`:14`），然后建一个 4 步、状态 `queued` 的 AgentTask（`bid-package.ts:65-101`）。
- `POST …/ai-bid-package/run-step`（`run-step/route.ts:16`）：
  - 读请求体里的 `taskId`（`:18`），按 `id + projectId` 找任务（`:25`）。
  - 执行下一步待执行的技能（`:92`）：报价与邮件草稿各自调模型（`quote.ts:135`、`email-draft.ts:117 / :220`）；文档摘要、情报两步会写文件记录与情报。
  - 把技能输出与原始报错写进步骤，并在响应里原样返回（`:185`）。
  - 最后一步完成时，给除调用者以外的 active 成员和负责人发高优先级站内通知「AI 投标方案已生成」（`:161-169`；`src/lib/notifications/create.ts:98-126`）。
- `POST …/intelligence/regenerate`（`intelligence/regenerate/route.ts:11`），依次做三件事：
  - 调模型重算情报（`:15`；有已解析文档时才调，没有就直接返回：`src/lib/files/intelligence-extractor.ts:184-194`）；
  - 刷新结构化摘要（`:22`）；
  - 按调用者的可见范围重算相似项目（`:23`）：先删掉该项目全部相似项目记录再重建（`src/lib/projects/similarity.ts:204-217`）。别的组织的人调用时可见范围与该项目所在组织的交集为空，相似项目会被清空。
- `GET …/intelligence/review`（`review/route.ts:21`）：返回审核状态、审核人（姓名，没有姓名时是邮箱）、审核时间、备注、评分、推荐、风险、匹配分、`fullReportJson._meta`。
- `PATCH …/intelligence/review`（`:77`）：改审核状态（含 `approved` / `delivered`）、备注、评分。状态为通过 / 需修改 / 已交付时记下调用者为审核人（`:129`）。

**现成的守卫**（`src/lib/projects/access.ts`）：

| 守卫 | 位置 | 放行 | 其余登录用户 |
|---|---|---|---|
| `requireProjectReadAccess` | `:116-165` | super_admin、负责人、组织所有者 / 管理员（组织成员身份 active）、active 项目成员 | 403「无权查看该项目」 |
| `requireProjectWriteAccess` | `:54-110` | super_admin、负责人、组织所有者 / 管理员、项目管理员 | 403「无权修改该项目」 |
| `requireProjectManageAccess` | `:168` | 就是写权限 | 同上 |

两个守卫共同的规则：未登录 401；项目不存在 404；非 super_admin 遇到未分发项目 404（`:77`、`:139`）。`withAuth` 里再调守卫有先例：`ai-summary/route.ts:9-11`，以及 FIX-17 的两个接口。

**界面上谁在调**：

- 一键投标方案：`src/components/agent-tasks/ai-bid-package.tsx:385-470`（`GET` / `POST` / `run-step`）。它只挂在「内部 · AI 任务运行时（仅平台管理员可见）」里（`src/components/project-detail/internal-agent-tools.tsx:3-6`、`:26`；`src/app/(main)/projects/[id]/page.tsx:757-760` 以 `isPlatformAdmin` 门控，平台管理员即 super_admin，`src/lib/rbac/platform-admin.ts:14-22`）。
- 情报卡：`src/components/bidtogo/intelligence-card.tsx` 的「重新分析」按钮（`:583-597`，调 `regenerate`）与审核面板（`:643`，按钮在 `:406-432`，调 `PATCH review`）。情报页签（`src/components/project-detail/tabs/intel-tab.tsx:46-65`）没有把 `canManage` 传给这张卡，所以**所有能打开项目的成员都看得到这两个按钮**。两处失败都只 `console.error`（`:340`、`:461-465`），界面不提示。
- `GET …/intelligence/review` 没有界面调用。项目详情 `GET`（`[id]/route.ts:33`、`:65`，读权限）本来就整行返回情报，含审核字段。
- 没有服务端代码、cron、数字员工工具调这 6 个 HTTP 接口。`src/lib/agent-core/skills/static-bridge.ts:8` 写明 `ai-bid-package` 两个 route 是它的调用方之一，另一条是 agent-core 工具注册，那条路径自带组织校验。

## Goals / Non-Goals

**Goals:**

- 六个处理函数在任何数据库读写、建任务、模型调用、改写情报与相似项目、发通知之前，先过项目级权限检查。
- 放行的人看到的请求、返回、副作用一字不变。
- `src/app/api/projects/[id]/` 整个目录以后新增的处理函数漏了检查，CI 里就失败。

**Non-Goals:**

- 不改 `src/lib/projects/access.ts`、`src/lib/projects/diagnostic-access.ts`（守卫本身、文案、放行名单）。
- 不改 `src/lib/common/api-helpers.ts`（`withAuth`）。
- 不改 `src/lib/agent-core/skills/static-bridge.ts`、`src/lib/agent-core/skills/bid-package.ts`、`src/lib/agent/skills/**`（技能与它们的模型调用）。
- 不改 `src/lib/files/intelligence-extractor.ts`、`src/lib/files/ai-intelligence.ts`、`src/lib/projects/structured-summary.ts`、`src/lib/projects/similarity.ts`。
- 不改 `src/lib/notifications/**`。
- 不改 `src/components/agent-tasks/ai-bid-package.tsx`、`src/components/bidtogo/intelligence-card.tsx`、`src/components/project-detail/**`、`src/app/(main)/projects/[id]/page.tsx`（界面）。
- 不改 `src/app/api/projects/[id]/files/**` 与 `src/lib/projects/__tests__/files-route-guard.test.ts`、`files-access-db.isolated.test.ts`（FIX-17 的路由与测试）。
- 不改 `src/app/api/agent/tasks/**`、`src/app/api/projects/[id]/` 下其余路由文件。
- 不改 `prisma/**`、`src/lib/muse-bridge/**`。

## Decisions

### D1 用现成的守卫，不新造

六个处理函数的第一步调 `requireProjectReadAccess` 或 `requireProjectWriteAccess`；返回的是响应就原样返回。

- 被否决：新写一个「情报 / 一键投标方案守卫」。放行名单与读、写两个守卫完全一样，多一个入口只多一处以后会漂移的地方。
- 被否决：在路由里手写成员查询。会绕开 `access.ts` 里已经收好的「未分发项目 404」「岗位预览」等规则（文件头注释要求所有面向用户的项目鉴权走这里）。

### D2 `GET …/intelligence/review` 用读权限

- 理由：同样的字段，项目详情 `GET` 已经用读权限整行返回给所有成员（`[id]/route.ts:33`、`:65`）。
- 改口径影响谁：只有与项目无关的人。这个接口没有界面调用。
- 被否决：写权限。比项目详情还严，挡不住任何东西。

### D3 `PATCH …/intelligence/review` 用读权限（「留给 GATE」第 2 条）

- 理由：
  - 同类先例 `progress-summary/review` 的 `PATCH` 用读权限（`progress-summary/review/route.ts:56-58`），审核状态几乎相同（`:49`）。
  - 界面上所有成员都看得到审核按钮，界面也没有按角色区分。
  - 被改动的记录会写下审核人，事后查得到是谁（`review/route.ts:129`）。
- 改口径影响谁：只有与项目无关的人；成员照常。
- 被否决：写权限。招标分析的批准用写权限（`tender-analysis/runs/[runId]/approve/route.ts:22`），这条备选有依据；但这个 change 要堵的是跨组织越权，而改成写权限会顺带改变成员分工：普通成员点「通过 / 需修改 / 已交付」会静默失败（`intelligence-card.tsx:329-341`），要一起改界面（把 `canManage` 传进情报卡、隐藏或禁用按钮）。放进 GATE 由 Evan 定。

### D4 `POST …/intelligence/regenerate` 用读权限

- 理由：
  - FIX-17 合并后，`process-next` 用读权限，第 3 步就调同一个 `generateProjectIntelligence`（FIX-17 分支 `files/process-next/route.ts:205`）。成员上传文件后本来就会触发同一次情报生成。
  - 同类「再跑一次分析」的接口：
    - `ai-summary` `POST`：读权限，`ai-summary/route.ts:81-83`，确定性刷新；
    - `progress-summary` `POST`：读权限，`progress-summary/route.ts:57-60`，调模型生成；
    - `checklist` `POST`：读权限，`checklist/route.ts:97-100`，调模型。
  - 「重新分析」按钮对所有成员显示。
- 改口径影响谁：只有与项目无关的人。
- 被否决：写权限。成员仍能通过上传加逐步处理触发同一次情报生成，收紧这一处挡不住；只会让成员点按钮没反应（错误只进 console，`intelligence-card.tsx:461-465`）。

### D5 `POST …/ai-bid-package` 与 `POST …/ai-bid-package/run-step` 用写权限

- 理由：
  - 同一张 AgentTask 表的通用入口：
    - 建任务要管理权限（`src/app/api/agent/tasks/route.ts:73`「创建可执行任务需项目管理权限」、`:88`）；
    - 执行与取消要管理权限（`src/app/api/agent/tasks/[taskId]/execute/route.ts:27`、`cancel/route.ts:25`）。
    - 管理权限就是写权限（`access.ts:168`）。
  - 发起招标分析与重新分析也用写权限（`tender-analysis/package/route.ts:29`、`tender-analysis/runs/[runId]/reanalyze/route.ts:16`）。
  - `run-step` 一次会调模型生成报价草稿与询价邮件草稿，最后一步给全组发高优先级通知，属于「发起分析」一类动作。
- 改口径影响谁：
  - 界面：这个面板只给平台管理员看（`page.tsx:757-760`），平台管理员过写权限，**界面上没有人受影响**。
  - API：负责人、组织所有者 / 管理员、项目管理员照常可用；项目里的操作员、测试、财务审核、只读成员不能再用脚本或手工请求建任务、执行步骤。他们在界面上本来就看不到这个面板。
- 被否决：读权限。没有界面需要它，却会让只读成员能生成报价草稿、给全组发通知。
- 被否决：只给平台管理员（调试面守卫 `src/lib/projects/diagnostic-access.ts:15-31`，「平台管理员 + 项目权限」）。它与界面挂载条件最一致，但会把负责人、组织管理员也挡在外面，是改内部工具的产品口径，列进 GATE 第 1 条的选项 D。

### D6 `GET …/ai-bid-package` 用读权限，价格怎么处理留给 GATE

- 理由：同一张表的通用入口，列任务与看任务详情都用读权限（`agent/tasks/route.ts:25`、`agent/tasks/[taskId]/route.ts:47`）；招标分析也是「发起用写、看结果用读」（`tender-analysis/runs/[runId]/route.ts:33`）。
- 改口径影响谁：只有与项目无关的人。界面上只有平台管理员。
- 被否决：写权限（「能发起才能看」）。仓库里查看任务结果没有用写权限的先例。
- 报价草稿里的价格要不要再按财务查看权裁掉：本 change 不裁，见「留给 GATE」第 1 条。

### D7 保留 `withAuth` 外壳，守卫放在处理函数第一步

- `regenerate` 的守卫放在 `try` 之外。否则守卫抛错会被吞成「重新分析失败」500。
- `run-step` 的守卫放在读请求体之前；`PATCH review` 也一样。
- `POST …/ai-bid-package` 原有的「项目不存在」查询（`:14-20`）保留不删。守卫之后它不会再命中，但删了属于顺手改，不在本次。
- 后面用到的 `user.id`（建任务的发起人、执行技能的人、通知排除的人、审核人）继续用 `withAuth` 传进来的那个；两处解析出来的是同一个会话用户。
- 被否决：去掉 `withAuth`，改成普通 `export async function`。会丢掉统一的异常兜底与 `x-request-id`，而这几个接口都调模型、最容易抛错。代价是每次请求多查一次用户，FIX-17 已经这样做。

### D8 `run-step` 调技能时不传组织（本次不传，也不为它另开一条）

`runStaticSkill` 的 `orgId` 参数只做一件事：拿它与「同一个项目」自己的 `orgId` 比较，不同就拒绝（`src/lib/agent-core/skills/static-bridge.ts:35-44`、`:65-79`）。守卫之后从 `access.project.orgId` 取来再传进去，永远与项目自己的相等。它是一句不会起作用的检查，还会让读代码的人以为这里多了一道组织隔离。

- 被否决：顺手传上。理由同上。
- 相关但不同的问题（另开任务，不在本次）：技能执行上下文本身不带组织（`src/lib/agent/types.ts:72-78`），技能与情报生成的模型调用都不带 `orgId`（`quote.ts:135`、`email-draft.ts:117`、`intelligence-extractor.ts:96`）。所以月度 AI 费用预检（`src/lib/ai/client.ts:173-184`，要 `orgId` 与 `userId` 都在才查）对这几条路径不生效。要修就改 `src/lib/agent/skills/**` 与情报生成，范围与本次无关。

### D9 目录守卫测试：覆盖整个 `src/app/api/projects/[id]/`，与 FIX-17 的守卫测试并存

新文件 `src/lib/projects/__tests__/project-routes-guard.test.ts`，不用数据库，进 CI 子集。

**规则**（对每个路由文件导出的每个 `GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS`）：

1. 用 `export { … }` 或 `export * from` 导出的文件判失败：认不出其中的处理函数。
2. 处理函数里必须调用名单里的一个守卫。守卫按导入它的模块与原始导出名认定：`import { requireDiagnosticProjectReadAccess as requireProjectReadAccess }` 按 diagnostic-access 认；从别处导入的同名函数不算。
3. 第一次调用守卫之前不得出现：`db.`、文件存储读写、解析、模型调用（`createCompletion*`、`generate*`、`runStaticSkill`）、建任务、入队、发通知、写审计。
4. 第一次调用守卫之前，`await` 只能是取路由参数或读请求体（`request.json / formData / text`）。
5. 守卫的返回值必须赋给一个变量，并且被检查：
   - 返回响应的守卫：`x instanceof NextResponse) return x` 或 `isAccessError(x)) return x`；
   - 返回布尔的守卫：`if (!x) return …`。
6. 例外名单里的文件按「已下线」检查：只导入 `next/server`，不出现 `db`，不出现 `await`，正文里返回 410。例外名单里的文件不存在也判失败，提示删掉这条例外。
7. 防空跑：断言目录下至少找到 170 个路由文件、240 个处理函数（main 上是 176 个、251 个），并断言本次 4 个文件都在。
8. 检查器自测：漏守卫、先碰库后守卫、调了守卫不看结果、冒名守卫、`export { … }`、例外接口被改回干活，各一条，必须被指出。

**守卫名单与出处**（每一个都读过代码，确认它先判项目可见性，再加自己的条件；括号里是 main 上以它为第一个守卫的处理函数数）：

| 来源模块 | 守卫 | 出处 | 说明 |
|---|---|---|---|
| `@/lib/projects/access` | `requireProjectReadAccess`（67）、`requireProjectWriteAccess`（48）、`requireProjectManageAccess`（11） | `access.ts:116`、`:54`、`:168` | 项目可见性统一入口 |
| `@/lib/projects/diagnostic-access` | `requireDiagnosticProjectReadAccess`（24）、`requireDiagnosticProjectManageAccess`（23） | `diagnostic-access.ts:15-31` | 平台管理员 + 项目读 / 管理；路由里以 `requireProjectReadAccess` / `requireProjectManageAccess` 的别名导入 |
| `@/lib/tender-auto-analysis/api-access` | `requireTenderAnalysisRead`（5）、`requireTenderAnalysisWrite`（13） | `api-access.ts:19-32` | 直接转调读 / 写守卫；结果用 `isAccessError` 检查 |
| `@/lib/quote-engine/access` | `requireQuoteAccess`（22） | `quote-engine/access.ts:34-46` | 先读权限，再判报价能力 |
| `@/lib/project-finance/access` | `requireCostAccess`（22） | `project-finance/access.ts:117-144` | 先读权限；读权限给 403 时，只给本组织、已分发、持财务键的人另开只读入口（`:99-115`） |
| `@/lib/tender-import-leads/api-access` | `requireImportLeadsRead`（1）、`requireImportLeadsWrite`（3） | `tender-import-leads/api-access.ts:17-32` | 先读权限，再判组织成员与开关 |
| `@/lib/project-discussion/access` | `canViewProjectDiscussion`（2）、`canPostProjectMessage`（1） | `project-discussion/access.ts:68-105` | 返回布尔：项目存在、未分发只给 super_admin、负责人 / 成员 / 组织管理员 |

合计 242 个，加上 FIX-17 的 2 个与本次 6 个是 250 个，再加 1 个例外，就是目录下的 251 个处理函数。任务提到的 `requireSupplierIntelAccess` 只用在 `src/app/api/supplier-intel/**`，这个目录里没有用到，不进名单。

**例外名单**：`src/app/api/projects/[id]/inquiries/batch-followup/route.ts` 的 `POST`。T-2 已下线（文件头注释：Evan 2026-11-07 拍板，原调用方已被 W-1 删除），只返回 410，不鉴权、不调模型、不读写库。

**起草时的核对**：用一个一次性原型（只放在 scratchpad，没进仓库）按上面 2–6 条跑过：
- 在 main `2ef4f9c8` 上，251 个处理函数里只有 9 个不过：本次 6 个、FIX-17 的 2 个、batch-followup；
- 在 FIX-17 分支上只剩本次 6 个与 batch-followup。
- 先读请求体、再按内容选守卫级别的 3 个处理函数靠第 4 条通过：`finance/expenses/[expenseId]` `PATCH`、`join-brief` `POST`、`quote-engine/[quoteId]/status` `POST`。

**与 FIX-17 `files-route-guard.test.ts` 的重叠**：`files/` 下 3 个文件两份测试都会查。保留两份，不合并。

- FIX-17 那份对 `files/` 更严：守卫必须是取参数后的第一个 `await`，先读请求体也算违规。它的规格 Scenario 点名了那条命令，删掉要改 FIX-17 的规格。
- 新的这份把规则放宽到全目录现有写法都能满足的程度（第 4 条），换来覆盖整个目录。
- 被否决：把 FIX-17 的检查器原样扩到整个目录。上面 3 个先读请求体的处理函数会误报，改它们不在本次范围。
- 被否决：把两份合成一个共享检查器。要动 FIX-17 的测试文件与规格，没有行为上的收益。
- 被否决：沿用 `authz-contract.test.ts` 那种「文件 → 必需符号」的固定清单。管不到以后新加的文件。

### D10 隔离库 + HTTP 测试

新文件 `src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts`，进 `scripts/test-all.sh`（隔离库执行，否则跳过）。写法照 FIX-17 的 `files-access-db.isolated.test.ts`：直接调路由导出的处理函数，带 `createSession` 签的会话 cookie。

- **夹具**：
  - 组织甲的人：负责人、组织管理员（不是项目成员）、项目管理员成员、只读成员、操作员成员、同组织非成员、项目成员身份 inactive 的人、组织成员身份 inactive 的原组织管理员。
  - 其他人：组织乙的管理员；不属于任何组织的 super_admin；已停用账号（曾是项目管理员）。
  - 项目甲（已分发），专给被拒用例。里面放：一份已解析、带正文、待摘要的文件；一份情报（带审核备注、审核人、`_meta`）；两条相似项目记录；一个已完成的一键投标方案任务，报价草稿步骤的输出里放一个唯一的价格标记串；一个下一步是文档摘要的待执行任务。
  - 项目丙（已分发），专给放行用例：没有待摘要文件、没有可用文档内容。
  - 项目甲二（未分发）。
  - 项目乙（组织乙），有一个自己的任务。
- **不调模型怎么观察**：照 `src/lib/sales/__tests__/period-narrative-db.isolated.test.ts:3`、`:51`、`:81-82` 的做法，本机起一个 OpenAI 兼容假服务，把 `OPENAI_BASE_URL` 指过去、`OPENAI_API_KEY` 设成测试值，统计收到的请求数。每个被拒用例前后请求数不变。放行用例也挑不需要调模型的路径（项目丙没有可用文档；执行的那一步是无事可做的文档摘要），所以整个测试应当是 0 次请求。
  - 被否决：不配模型密钥，靠「没密钥就报错」判断。被拒和「调了但失败」分不开。
- **不改数据怎么观察**：被拒前后逐字段比对这些记录：
  - 项目甲的情报行、项目行、相似项目记录；
  - 两个任务及其步骤、项目甲的任务数；
  - 待摘要文件的摘要状态；
  - 项目甲全体成员的站内通知数。
- **被拒响应不带内容**：正文只允许 `error`（及 `requestId`）；不出现价格标记串、审核备注、审核人姓名。
- 被否决：只有守卫测试。它证明「调了守卫」，证明不了「被拒时没调模型、没发通知、数据没动」。
- 被否决：mock 掉 `db`。仓库约定用真库；跨组织成员关系的判断正是要测的东西。

### D11 「改动前失败」怎么取证

先写两个测试、不改路由，各跑一遍把输出存下来。预期：
- 守卫测试点名本次 6 个处理函数，其余通过；
- 隔离库测试里，被拒用例拿到 200 / 500，情报或相似项目被改，任务被建，或假模型服务收到请求。

再改路由重跑。两份输出都贴进报告。

- 被否决：改完再 `git stash` 回去跑。顺序反了容易把「测试本身写错」当成「修好了」。

## 与八条硬纪律的关系

1. 零 schema：遵守。不新增 model / 字段 / migration；测试只往隔离库写夹具并清理。
2. 出站动作先审批：不涉及。`run-step` 最后一步发的是站内通知，邮件草稿步骤只起草、不发送（`email-draft.ts` 只调模型，没有发送或建审批卡）；本次只是让无关的人触发不了它们。
3. 禁止第三套队列：遵守。不新增队列 / 调度 / lease；一键投标方案仍是前端逐步驱动既有的 AgentTask，本次只在前面加门。
4. 脱敏：不涉及 Muse 通道。与脱敏方向一致：被拒的响应不带报价草稿与审核结论（规格里有 SHALL NOT）。报价草稿要不要按财务查看权裁剪，见 GATE 第 1 条。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。不新增模型调用；权限判断是查成员关系。无关的人以后触发不了情报重算与技能执行，模型调用只会少。
8. 测试注册：遵守。两个新测试都注册进 `scripts/test-all.sh`（放在 FIX-17 两条之后）；守卫测试同时进 `scripts/test-ci-unit.sh`；`bash scripts/check-test-registry.sh` 通过，`ci/test-registry-baseline.txt` 不加行。

## 验证方式

- `npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts`：改动前退出码非 0，只点名本次 6 个处理函数；改动后 0。
- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… DIRECT_URL=… npx tsx src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts`：改动前被拒用例失败，改动后全部通过；连跑 3 次结果一致。
- `npx tsx src/lib/projects/__tests__/files-route-guard.test.ts`（FIX-17）仍通过。
- 其余门禁：
  - `npm test` 对照既有失败清单无新增；
  - `npm run test:ci` PASS；
  - `npm run typecheck` 退出码 0；
  - `npm run lint:baseline` PASS；
  - `bash scripts/check-test-registry.sh` OK；
  - `OPENSPEC_TELEMETRY=0 openspec validate project-intel-bidpackage-access --strict` valid。

## Risks / Trade-offs

- [有人正靠这个缺口干活] 合并后这些请求变 403：不是项目成员却在读别人的投标方案 / 情报、或用脚本跑别人的一键投标方案的人；项目里不是管理者、却用脚本建任务或执行步骤的成员。界面上到不了这一步，只可能是脚本或手工请求。不保留兼容。
- [目录守卫测试以后误报] 新路由用了名单外的守卫（例如新写一个包装守卫），测试会失败并指出位置。这时要么改用名单里的守卫，要么把新守卫连同出处加进名单。名单故意不认「任意名字里带 Access 的函数」。
- [守卫测试靠读源码判断先后] 处理函数把读写藏进一个在守卫之前、且不需要 `await` 的本地函数里，它认不出来。行为由隔离库测试兜底。
- [依赖 FIX-17] FIX-17 没合并时，目录守卫测试会指出 `files/` 下那 2 个处理函数。实施前先确认 main 已含 FIX-17，并把本分支 rebase 上去（tasks 1.1）。
- [每个请求多几次主键查询] 用户一次、项目与成员关系各一次。相对一次模型调用可以忽略。

## Migration Plan

没有数据迁移、没有开关。合并即生效；回滚就是 revert 这一个 PR。

## 留给 GATE

### 1. `GET …/ai-bid-package` 返回的报价草稿价格（以及步骤原始输出）给谁看

本 change 默认实现选项 A。

- **A. 只加项目读权限，不裁（推荐）。**
  - 后果：项目的任何 active 成员（含只读）用脚本仍能读到报价草稿的行项与价格、询价邮件草稿、步骤原始报错。别的组织与组织内无关的人都看不到了。
  - 推荐理由：
    - 同一批人今天已经能从别的读接口拿到同样的价格：`GET …/inquiries`（读权限，`inquiries/route.ts:10-16`）返回供应商单价 / 总价；旧报价单 `GET …/quotes/:quoteId`（读权限，`quotes/[quoteId]/route.ts:9-11`、`:87`）带 `costPrice`。只裁这一处不减少组织内的暴露。
    - 这个面板只有平台管理员看得到，而 super_admin 在财务口径里本来就是有特权的（`project-finance/access.ts:40-48`）。
- **B. 读权限，另按财务查看权裁报价草稿那一步。**
  - 做法：没有 `canReadAll` 的人看到的报价草稿步骤 `data` 整段换成一句固定提示（整段替换，与脱敏规则「不做局部遮盖」一致）。
  - 先例：TI-4a 成本核算没有财务查看权给 403（`bid-workspace/cost-sheet/route.ts:23-24`）；CHAIN-2 寻源建议里，没有财务查看权的人不给「我方落地价」一栏（`tender-intel/sourcing-suggestions.ts:144-157`）。任务里说的「CHAIN-2b / 2e」这两个编号我在 main 的 docs 与代码里没找到，按这两处已合并的做法写。
  - 后果：
    - 新规则只在这一个接口生效，上面两个读接口照样给价格；
    - 每次多两次岗位键查询；
    - 规格与测试要加财务岗位夹具；
    - `run-step` 自己的响应也带同一份 `data`（`run-step/route.ts:185`），要不要一起裁也得定。
- **C. 照 AgentTask 的业务投影：非平台管理员不给步骤原始输出与原始报错。**
  - 先例：`/api/agent/tasks/:taskId` 对非平台管理员返回安全投影，没有 `inputJson` / `outputJson` / 原始 `error`（`agent/tasks/[taskId]/route.ts:14-22`、`:50-55`；`src/lib/agent-tasks/dto.ts:5-6`、`:102-120`）。
  - 后果：同一张表的两个读口子口径一致；界面不受影响；改变非管理员看到的响应形状（今天只有脚本能看到）。
- **D. 三个 ai-bid-package 处理函数都改成调试面守卫（平台管理员 + 项目权限）。**
  - 先例：`diagnostic-access.ts:15-31`，目录里 47 个处理函数在用。
  - 后果：
    - 与界面挂载条件一致；价格问题随之消失；
    - 负责人、组织管理员、项目管理员也不能再用接口发起或查看；
    - 规格第二条要改。

我的推荐：本次按 A 合并。这个 change 要堵的是跨组织与组织内无关的人，这一点 A 已经做到；B 是新规则，而且裁不干净。要收紧的话，D 最省事：用现成守卫、不加新规则、与界面一致，另开一个小 change 做。

### 2. `PATCH …/intelligence/review`（改情报审核结论）用读还是写

本 change 默认实现选项 A。

- **A. 读权限（推荐）。**
  - 后果：所有项目成员（含只读）都能把情报标成「已通过」「已交付」，审核人记的是本人；界面不改。
  - 先例：`progress-summary/review` 的 `PATCH`。
- **B. 写权限。**
  - 后果：只有负责人、组织所有者 / 管理员、项目管理员能改。只读成员、操作员等点审核按钮会静默失败。要另加界面任务：把 `canManage` 传进情报卡，隐藏或禁用审核按钮。规格第一条与测试相应调整。
  - 先例：招标分析的批准（`tender-analysis/runs/[runId]/approve/route.ts:22`）。

我的推荐：本次按 A。它与同类的进度摘要审核一致，也不需要动界面。如果 Evan 认为「已交付」这类状态只应由管理者标，选 B，并在本 change 里加一条界面任务（tasks 仍不超过 8 条）。
