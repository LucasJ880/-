# Design：项目情报与一键投标方案的六个接口补上项目权限检查（FIX-21）

## Context

动机见 proposal.md 的 Why。这里只写决定做法需要的现状（main = `2ef4f9c8`，行号都对过）。

**六个处理函数现在做什么**（都只包了 `withAuth`：`src/lib/common/api-helpers.ts` 只查「有会话、账号 active」，外加统一异常兜底与 `x-request-id`）：

- `GET …/ai-bid-package`（`src/app/api/projects/[id]/ai-bid-package/route.ts:35`）：
  - 不带 `taskId` 时取该项目最近一次 `ai_bid_package` 任务。
  - 选出每一步的 `outputJson`（`:73`）、`error`（`:75`）、`inputJson`（`:78`），把输出原样作为 `data` 返回，原始报错作为 `error` 返回（`:111-112`）。
  - 四步是文档摘要 → 情报 → 报价草稿 → 邮件草稿（`src/lib/agent-core/skills/bid-package.ts:21-56`）。
  - 报价草稿以该项目已报价的供应商单价 / 总价为输入（`src/lib/agent/skills/quote.ts:89-130`），产出的行项带对客户报价 `unitPrice` 与内部成本 `costPrice`（提示词 `src/lib/ai/prompts/trade.ts:107-117`、`:164-166`）；模型返回格式不对时，原始输出的前 500 字作为报错存下（`quote.ts:144`）。
- `POST …/ai-bid-package`（`:11`）：查一次项目是否存在（`:14`），然后建一个 4 步、状态 `queued` 的 AgentTask（`bid-package.ts:65-101`）。
- `POST …/ai-bid-package/run-step`（`run-step/route.ts:16`）：
  - 读请求体里的 `taskId`（`:18`），按 `id + projectId` 找任务（`:25`）。
  - 执行下一步待执行的技能（`:92`）：报价与邮件草稿各自调模型（`quote.ts:135`、`email-draft.ts:117 / :220`）；文档摘要、情报两步会写文件记录与情报。
  - 把技能输出与原始报错写进步骤，并在响应里原样返回（`:185-186`；未知技能与技能抛错两条分支也返回原始报错：`:74`、`:113`）。
  - 最后一步完成时，给除调用者以外的 active 成员和负责人发高优先级站内通知「AI 投标方案已生成」（`:161-169`；`src/lib/notifications/create.ts:98-126`）。通知不 `await`，响应先回，通知随后写库；每条通知的 `sourceKey` 是 `bid_package_done:<任务 ID>:<收件人 ID>`，并带 `projectId`（`create.ts:119-122`）。通知点开落在项目详情页（`src/lib/notifications/type-visibility.ts:37`）。
- `POST …/intelligence/regenerate`（`intelligence/regenerate/route.ts:11`），依次做三件事：
  - 调模型重算情报（`:15`；有已解析文档时才调，没有就直接返回：`src/lib/files/intelligence-extractor.ts:184-194`）。**重算写库时把审核结论一起重置**：`reportStatus` 改回 `ai_generated`，`reviewedBy / reviewedAt / reviewNotes / reviewScore` 全部清空（`intelligence-extractor.ts:346-369`），不留审计。
  - 刷新结构化摘要（`:22`；确定性，不调模型）。
  - 按调用者的可见范围重建相似项目（`:23`）：先删掉该项目全部相似项目记录再重建（`src/lib/projects/similarity.ts:204-217`），候选只取调用者能看到、且与该项目同组织的项目（`:35-49`）。
    - 别的组织的人调用时交集为空，相似项目会被清空。
    - 项目成员但不是该组织成员的人调用时，候选只剩他自己也参与的项目，重建出的名单会变短，所有人看到的都跟着变。
  - 专门的「重算相似项目」接口 `POST …/similarities` 用的是写权限（`similarities/route.ts:21-24`）。
- `GET …/intelligence/review`（`review/route.ts:21`）：返回审核状态、审核人（存的是姓名，没有姓名时是邮箱）、审核时间、备注、评分、推荐、风险、匹配分、`fullReportJson._meta`。
- `PATCH …/intelligence/review`（`:77`）：改审核状态（含 `approved` / `delivered`）、备注、评分。只有状态为通过 / 需修改 / 已交付时才记下调用者为审核人（`:124-131`）；只改备注、评分或改成 `in_review` 不记人。

**现成的守卫**（`src/lib/projects/access.ts`）：

| 守卫 | 位置 | 放行 | 其余登录用户 |
|---|---|---|---|
| `requireProjectReadAccess` | `:116-165` | super_admin、负责人、组织所有者 / 管理员（组织成员身份 active）、active 项目成员（不论项目有没有所属组织） | 403「无权查看该项目」 |
| `requireProjectWriteAccess` | `:54-110` | super_admin、负责人、组织所有者 / 管理员；项目有所属组织时再加项目管理员（`:93-106`） | 403「无权修改该项目」 |
| `requireProjectManageAccess` | `:168` | 就是写权限 | 同上 |

两个守卫共同的规则：未登录 401；项目不存在 404；非 super_admin 遇到未分发项目 404（`:77`、`:139`）。`withAuth` 里再调守卫有先例：`ai-summary/route.ts:9-11`，以及 FIX-17 的两个接口。

**同一张任务表的安全约定**：

- `src/lib/agent-tasks/dto.ts:1-9` 写明「普通业务用户禁止拿到 Agent 执行内幕：inputJson / outputJson / checkReportJson / 原始 error」，并禁止「先返回完整对象再由前端删字段」；平台管理员保留完整诊断视图。
- `/api/agent/tasks` 的列表与详情照此执行（`agent/tasks/route.ts:27`、`:63`；`agent/tasks/[taskId]/route.ts:50-55`）。
- 固定提示文字是 `SAFE_STEP_ERROR_MESSAGE`「处理失败，请稍后重试或联系管理员」（`dto.ts:13`）；列表视图的报错脱敏是 `sanitizeListStepError`（`dto.ts:203-212`）。
- 一键投标方案的两个接口没有走这套约定。

**界面上谁在调**：

- 一键投标方案：`src/components/agent-tasks/ai-bid-package.tsx:386-470`（`GET` / `POST` / `run-step`）。它只挂在「内部 · AI 任务运行时（仅平台管理员可见）」里（`src/components/project-detail/internal-agent-tools.tsx:3-6`、`:26`；`src/app/(main)/projects/[id]/page.tsx:757-760` 以 `isPlatformAdmin` 门控，平台管理员即 super_admin，`src/lib/rbac/platform-admin.ts:14-22`）。
- 情报卡：`src/components/bidtogo/intelligence-card.tsx` 的「重新分析」按钮（`:583-597`，调 `regenerate`）与审核面板（`:643-647`，按钮在 `:402-434`，调 `PATCH review`）。情报页签（`src/components/project-detail/tabs/intel-tab.tsx:46-65`）没有把 `canManage` 传给这张卡，所以**所有能打开项目的成员都看得到这两个按钮**。两处失败都只 `console.error`（`:340`、`:461-465`），界面不提示。
- `GET …/intelligence/review` 没有界面调用。项目详情 `GET`（`[id]/route.ts:33`、`:65`，读权限）本来就整行返回情报，含审核字段。
- 没有服务端代码、cron、数字员工工具调这 6 个 HTTP 接口。`src/lib/agent-core/skills/static-bridge.ts:8` 写明 `ai-bid-package` 两个 route 是它的调用方之一，另一条是 agent-core 工具注册，那条路径自带组织校验。

## Goals / Non-Goals

**Goals:**

- 六个处理函数在任何数据库读写、建任务、模型调用、改写情报与相似项目、发通知之前，先过项目级权限检查。
- 一键投标方案的两个接口对非平台管理员只给安全视图，与同一张任务表的通用接口一致。
- 其余放行的人看到的请求、返回、副作用一字不变。
- `src/app/api/projects/[id]/` 整个目录以后新增的处理函数漏了检查，CI 里就失败。

**Non-Goals:**

- 不改 `src/lib/projects/access.ts`、`src/lib/projects/diagnostic-access.ts`（守卫本身、文案、放行名单）。
- 不改 `src/lib/common/api-helpers.ts`（`withAuth`）。
- 不改 `src/lib/agent-tasks/dto.ts`、`src/lib/rbac/platform-admin.ts`。复用 `platform-admin.ts` 的平台管理员判断；`dto.ts` 的固定提示与报错脱敏照同一口径写进两个路由，不导入（`src/lib/agent-tasks` 是 runtime-architecture 冻结面，见 D12）。
- 不改 `src/lib/agent-core/skills/static-bridge.ts`、`src/lib/agent-core/skills/bid-package.ts`、`src/lib/agent/skills/**`（技能与它们的模型调用）。
- 不改 `src/lib/files/intelligence-extractor.ts`、`src/lib/files/ai-intelligence.ts`、`src/lib/projects/structured-summary.ts`、`src/lib/projects/similarity.ts`（重算时重置审核结论、按调用者可见范围重建相似项目都照旧）。
- 不改 `src/lib/notifications/**`。
- 不改 `src/components/agent-tasks/ai-bid-package.tsx`、`src/components/bidtogo/intelligence-card.tsx`、`src/components/project-detail/**`、`src/app/(main)/projects/[id]/page.tsx`（界面）。
- 不改 `src/app/api/projects/[id]/files/**` 与 `src/lib/projects/__tests__/files-route-guard.test.ts`、`files-access-db.isolated.test.ts`（FIX-17 的路由与测试）。
- 不改 `src/app/api/agent/tasks/**`、`src/app/api/projects/[id]/similarities/route.ts`、`src/app/api/projects/[id]/` 下其余路由文件。
- 不改 `prisma/**`、`src/lib/muse-bridge/**`。

## Decisions

### D1 用现成的守卫，不新造

六个处理函数的第一步调 `requireProjectReadAccess` 或 `requireProjectWriteAccess`；返回的是响应就原样返回。

- 被否决：新写一个「情报 / 一键投标方案守卫」。放行名单与读、写两个守卫完全一样，多一个入口只多一处以后会漂移的地方。
- 被否决：在路由里手写成员查询。会绕开 `access.ts` 里已经收好的「未分发项目 404」「岗位预览」等规则（文件头注释要求所有面向用户的项目鉴权走这里，`access.ts:27-30`）。

### D2 `GET …/intelligence/review` 用读权限

- 理由：同样的字段，项目详情 `GET` 已经用读权限整行返回给所有成员（`[id]/route.ts:33`、`:65`）。
- 改口径影响谁：只有与项目无关的人。这个接口没有界面调用。
- 被否决：写权限。比项目详情还严，挡不住任何东西。

### D3 `PATCH …/intelligence/review` 用读权限（「留给 GATE」第 2 条，已定 A，Lucas 2026-11-22）

- 理由：
  - 同类先例 `progress-summary/review` 的 `PATCH` 用读权限（`progress-summary/review/route.ts:56-58`），审核状态几乎相同（`:49`）。
  - 界面上所有成员都看得到审核按钮，界面也没有按角色区分。
- 追溯性有限，写在这里免得高估：
  - 只有改成通过 / 需修改 / 已交付时才记审核人（`review/route.ts:124-131`）；只改备注、评分或改成 `in_review` 不记人。
  - 「重新分析」会把审核人连同结论一起清空（`intelligence-extractor.ts:346-369`）。
  - 没有审计记录（Out of scope）。
- 改口径影响谁：只有与项目无关的人；成员照常。
- 被否决：写权限。招标分析的批准用写权限（`tender-analysis/runs/[runId]/approve/route.ts:22`），这条备选有依据；但这个 change 要堵的是跨组织越权，而改成写权限会顺带改变成员分工：
  - 普通成员点「通过 / 需修改 / 已交付」会静默失败（`intelligence-card.tsx:329-341`），要一起改界面（把 `canManage` 传进情报卡、隐藏或禁用按钮）；
  - 单改这一处挡不住只读成员经「重新分析」把结论清空（见 D4）。
  - 放进了 GATE；Lucas 2026-11-22 定 A（读权限），不改界面。

### D4 `POST …/intelligence/regenerate` 用读权限（「留给 GATE」第 3 条，已定 A，Lucas 2026-11-22）

- 理由：
  - FIX-17 合并后，`process-next` 用读权限，第 3 步就调同一个 `generateProjectIntelligence`（FIX-17 分支 `files/process-next/route.ts:200-205`，有比现有情报更新的文档时才调）；上传也是读权限（FIX-17 分支 `files/route.ts:81`）。成员上传文件后本来就会触发同一次情报生成，连带重置审核结论。
  - 同类「再跑一次分析」的接口：
    - `ai-summary` `POST`：读权限，`ai-summary/route.ts:81-83`，确定性刷新结构化摘要（与 regenerate 第二步同一个函数）；
    - `progress-summary` `POST`：读权限，`progress-summary/route.ts:57-60`，调模型生成；
    - `checklist` `POST`：读权限，`checklist/route.ts:97-100`，调模型。
  - 「重新分析」按钮对所有成员显示。
- 反例（照写，不回避）：`POST …/similarities` 重算相似项目用写权限（`similarities/route.ts:21-24`），regenerate 第三步做的是同一件事（`recomputeProjectSimilarities`）。
- **已知后果**（选读权限就要接受）：
  - 项目里任何 active 成员（含只读）点一次「重新分析」，都会把情报的审核结论重置为「AI 已生成」，并清空审核人、审核时间、备注、评分；备注找不回来，也没有审计记录。
  - 项目成员但不是该组织成员的人点「重新分析」，相似项目名单会按他的可见范围重建、变短（见 Context）。
  - 这两条今天对任何登录账号都成立；本次之后缩小到项目成员。
- 改口径影响谁：只有与项目无关的人。
- 被否决：写权限。
  - 成员仍能经「上传新文件 + 逐步处理」触发同一次情报生成、清空审核结论，收紧这一处挡不住；
  - 不改界面的话，非管理者点按钮没反应（错误只进 console，`intelligence-card.tsx:461-465`）。
  - 列进 GATE 第 3 条的选项 B；Lucas 2026-11-22 定 A，不选 B。
- 真正的修法在重算本身：重新生成情报时不清空已有的人工审核结论（或先留痕）。这要改 `src/lib/files/intelligence-extractor.ts`，另开任务（Lucas 2026-11-22 点名，登记在 tasks 3.2 的后续任务第 1 条）。

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
  - API：负责人、组织所有者 / 管理员、项目有所属组织时的项目管理员照常可用。这些人不能再用脚本或手工请求建任务、执行步骤：
    - 项目里的操作员、测试、财务审核、只读成员；
    - 没有所属组织的项目里的项目管理员（`access.ts:93`）。
  - 他们在界面上本来就看不到这个面板。
- 被否决：读权限。没有界面需要它，却会让只读成员能生成报价草稿、给全组发通知。
- 被否决：只给平台管理员（调试面守卫 `src/lib/projects/diagnostic-access.ts:15-31`，「平台管理员 + 项目权限」）。它与界面挂载条件最一致，但会把负责人、组织管理员也挡在外面，是改内部工具的产品口径，列进 GATE 第 1 条的选项 D。

### D6 `GET …/ai-bid-package` 用读权限

- 理由：同一张表的通用入口，列任务与看任务详情都用读权限（`agent/tasks/route.ts:25`、`agent/tasks/[taskId]/route.ts:47`）；招标分析也是「发起用写、看结果用读」（`tender-analysis/runs/[runId]/route.ts:33`）。
- 改口径影响谁：只有与项目无关的人。界面上只有平台管理员。
- 被否决：写权限（「能发起才能看」）。仓库里查看任务结果没有用写权限的先例。
- 看到的内容：非平台管理员只拿安全视图，见 D12 与「留给 GATE」第 1 条。

### D7 保留 `withAuth` 外壳，守卫放在处理函数第一步

- `regenerate` 的守卫放在 `try` 之外。否则守卫抛错会被吞成「重新分析失败」500。
- `run-step` 的守卫放在读请求体之前；`PATCH review` 也一样。
- `POST …/ai-bid-package` 原有的「项目不存在」查询（`:14-20`）保留不删。守卫之后它不会再命中，但删了属于顺手改，不在本次（登记在 tasks 3.2 的后续任务第 7 条）。
- 后面用到的 `user.id`（建任务的发起人、执行技能的人、通知排除的人、审核人）继续用 `withAuth` 传进来的那个；两处解析出来的是同一个会话用户。判断是不是平台管理员用守卫返回的 `access.user`（与 `agent/tasks/[taskId]/route.ts:50` 一样）。
- 被否决：去掉 `withAuth`，改成普通 `export async function`。会丢掉统一的异常兜底与 `x-request-id`，而这几个接口都调模型、最容易抛错。代价是每次请求多查一次用户，FIX-17 已经这样做。

### D8 `run-step` 调技能时不传组织（本次不传，也不为它另开一条）

`runStaticSkill` 的 `orgId` 参数只做一件事：拿它与「同一个项目」自己的 `orgId` 比较，不同就拒绝（`src/lib/agent-core/skills/static-bridge.ts:35-44`、`:65-79`）。守卫之后从 `access.project.orgId` 取来再传进去，永远与项目自己的相等。它是一句不会起作用的检查，还会让读代码的人以为这里多了一道组织隔离。

- 被否决：顺手传上。理由同上。
- 相关但不同的问题（另开任务，不在本次；登记在 tasks 3.2 的后续任务第 2 条）：技能执行上下文本身不带组织（`src/lib/agent/types.ts:72-78`），技能与情报生成的模型调用都不带 `orgId`（`quote.ts:135`、`email-draft.ts:117`、`intelligence-extractor.ts:96`）。所以月度 AI 费用预检（`src/lib/ai/client.ts:173-184`，要 `orgId` 与 `userId` 都在才查）对这几条路径不生效。要修就改 `src/lib/agent/skills/**` 与情报生成，范围与本次无关。

### D9 目录守卫测试：覆盖整个 `src/app/api/projects/[id]/`，与 FIX-17 的守卫测试并存

新文件 `src/lib/projects/__tests__/project-routes-guard.test.ts`，不用数据库，进 CI 子集。用 TypeScript 编译器解析源码，按语法树判断，注释里的字不算数；不用正则扫文本。

**枚举**：目录下所有名为 `route.ts`、`route.tsx`、`route.js`、`route.jsx`、`route.mjs` 的文件（`tsconfig` 是 `allowJs: true`，`next.config.ts` 没设 `pageExtensions`；交叉验证 F4 加了后三种，按扩展名选解析方式），每个文件导出的每个 `GET / POST / PUT / PATCH / DELETE / HEAD / OPTIONS`。

**规则**（多维审查后收紧，Lucas 2026-11-23 的修订清单第 1、14 条）：

1. 认不出处理函数正文的导出写法判失败：
   - `export { … }`、`export * from`、解构的 `export const { GET, POST } = handlers`；
   - `export const GET = 某个变量`、`withAuth(某个函数名)` 这类正文不在导出语句里的写法；
   - 包装函数只认从 `@/lib/common/api-helpers` 导入的 `withAuth`，别的包装函数（如 `withRateLimit(async …)`）判失败；
   - 导出的处理函数必须是 `const`（`export let POST = …` 判失败），模块顶层对它重新赋值也判失败（交叉验证 F3）。
2. 处理函数里必须调用名单里的一个守卫。守卫、守卫结果的判定函数（`isAccessError`，只认 `@/lib/tender-auto-analysis/api-access` 导出的）、`NextResponse`（只认 `next/server` 导出的）都按导入的来源模块与原始导出名认定：
   - `import { requireDiagnosticProjectReadAccess as requireProjectReadAccess }` 按 diagnostic-access 认；
   - 从别处导入的同名函数、文件里自己定义的同名函数不算；
   - 处理函数里（含参数与内层函数）有与它们同名的局部声明，判失败（函数声明会提升，能冒名顶替）；
   - 被注释掉的调用不算。
3. 取路由参数、读请求体之后的第一步就是守卫。守卫之前的顶层语句只允许：
   - 取路由参数：`const { id } = await ctx.params`、`const p = await params`（`ctx` 是处理函数的第二个参数，名字不限；`params` 是第二个参数写成 `{ params }` 时解构出来的，如 `src/app/api/projects/[id]/route.ts`）；
   - 读请求体：`const body = await request.json() / formData() / text()`（`request` 是处理函数的第一个参数，名字不限），可接 `.catch(() => 常量)`，例如 `await request.json().catch(() => ({}))`；先 `let body;` 再 `body = await request.json()`；以及 `join-brief` 的 `try { body = await request.json(); } catch { return 400 }`（读失败只回一个内容由常量构成的 400）；
   - 常量别名：`const M = 文件顶层常量`（`tender-rfq/attachment` 的写法），不含调用、`await`、`new`、赋值。
   其余一律判失败：任何表达式语句（不 `await` 的调用、`void …`、`after(…)`、`.catch(…)`）、`if`、提前 `return`、`await` 别的调用、`.catch` 里不是返回常量。数据库按导入来源认：`@/lib/db` 的 `db` 及其别名导入（`import { db as prisma }`）、命名空间导入（`import * as m from "@/lib/db"`）、路径以 `/db` 或 `/prisma` 结尾的模块、`@prisma/client` 的 `PrismaClient` 与名为 `prisma` / `prismaClient` 的导入，出现在守卫之前就点名「碰了数据库」——不论严格还是第 11 条的名单（交叉验证 F1、F2）。
   允许的语句里嵌着的代码也算（交叉验证 F1）：守卫之前的解构不许带默认值或计算键（`const { id, _x = await db.… } = await ctx.params`、`const { [String(await f())]: x } = …` 判失败）；处理函数的参数不许带默认值（`(request, ctx, user, _p = db.…)` 判失败），解构参数同样；`catch` 的变量只能是一个名字。
4. （并入第 3 条。）
5. 守卫的返回值必须赋给一个变量，并且下一条语句就检查它，不通过就直接返回，中间不做别的事（`if` 分支里只有这一条 `return`，没有 `else`）：
   - 返回响应的守卫：`if (x instanceof NextResponse) return …` 或 `if (isAccessError(x)) return …`；
   - 返回布尔的守卫：`if (!x) return …`；
   - 返回的只能是：守卫结果 `x` 本身；`NextResponse.json(常量, { status: 401 | 403 | 404, … })`；文件里由常量构造拒绝页的辅助函数（实参都是常量）；三元的两边各自满足（条件里不得有调用），如 `tender-intel/sourcing` 的 `access.status === 401 ? access : NextResponse.json({ … }, { status: 404 })`。返回 200、先调用别的函数再返回，都判失败。
   - 拒绝页辅助函数要检查它的正文（交叉验证 F5）：不 `await`、不碰数据、没有内层函数，只调用字符串的 `replace(…)`、`NextResponse.json(…)` 与 `new NextResponse(…)`；参数没有默认值；每个返回值都是 `NextResponse.json(…, { status })` 或 `new NextResponse(…, { status })`，`status` 是 401 / 403 / 404 字面量，或是它的某个参数、调用处对应的实参是 401 / 403 / 404（`tender-rfq/attachment` 的 `messagePage(status, message)` 是这样）。探针 N20（`page(404)` 里先删库再返回 200）判失败。
6. 第一次调用守卫的那条语句，必须是处理函数正文的顶层语句，形如 `const x = await 守卫(…)`；不能在 `if`、`try`、循环、三元、`&&` / `||` / `??`、内层函数里。
7. 紧接着的下一条语句就是第 5 条的检查。先调守卫、读完库再检查结果，判失败。
8. 检查的是地址里的项目，也是这个请求：
   - 守卫的项目参数（第二个参数）必须是 `const` 解构路由参数里 `id` 这个键得到的变量（`const { id } = await ctx.params` 的 `id`，或 `const { id: projectId } = await params` 这类改名后的变量），或 `const p = await ctx.params` 的 `p.id`；`let` 绑定、处理函数里任何地方对它重新赋值（含解构赋值、`++`）都判失败；
   - 守卫之后不得以任何方式再用路由参数（防止「守卫查一个、后面用另一个」，交叉验证 F6）：守卫之后的语句里出现处理函数第二个参数（`ctx`，含 `await ctx.params.then(…)`、把 `ctx` 交给别的函数）或解构出的 `params`，都判失败；
   - 传的是嵌套路由的其它参数（`quoteId`、`runId` 等），或请求体、查询串里的另一个项目，判失败；
   - 返回响应的守卫，第一个参数必须是处理函数收到的请求本身（第一个参数），伪造的请求判失败。
9. 例外名单里的文件按「已下线」检查：只导入 `next/server`，不出现 `db`，不出现 `await`，正文里返回 410。例外名单里的文件不存在也判失败，提示删掉这条例外。
10. 防空跑：断言目录下至少找到 170 个路由文件、240 个处理函数（实现时是 176 个、251 个），并断言本次 4 个文件都在。
11. 守卫前预处理名单（实现时核对出来的既有写法，名单只减不增）：目录里有 3 个处理函数在守卫之前先做了不碰数据、不 `await` 的预处理，按第 3 条会不过：
    - `src/app/api/projects/[id]/route.ts` `PATCH`：鉴权前先过运行环境隔离闸 `assertNonProdSideEffectsAllowed("write")`，非生产环境禁写时直接返回它的响应；
    - `finance/expenses/[expenseId]/route.ts` `PATCH`：按请求体里的动作算出 `requireCostAccess` 要的权限；
    - `quote-engine/[quoteId]/status/route.ts` `POST`：先校验请求体里的目标状态（无效回 400「无效状态」），再按目标状态选 `requireQuoteAccess` 的级别。
    改它们不在本 change 范围（不顺手改别的接口），所以列进名单。名单里的处理函数在守卫之前额外允许（交叉验证 F2 收紧后）：
    - `const` 声明与没有 `else` 的 `if (…) return …`，里面不 `await`、不赋值、没有内层函数、不碰数据，调用的只能是这一份明确的函数名单（就是这 3 个处理函数实际用到的）：从 `@/lib/env/runtime-isolation` 导入的 `assertNonProdSideEffectsAllowed`、`String(…)`、`new Set(…)`、`x.has(…)`、`x.includes(…)`；
    - 守卫前的 `return` 只许返回闸的结果（赋给 `const` 的 `assertNonProdSideEffectsAllowed(…)` 的返回值），或 4xx / 5xx 的 `NextResponse.json(常量, { status })`，不许 200；
    - 其余规则照旧；名单是冻结的 3 项集合 `PRE_GUARD_PREP_FROZEN` 的子集（新接口加进名单就失败）；它们改成守卫第一步之后测试会提示删掉对应条目；名单里的文件或方法不在了也判失败。改它们登记为后续任务。
    - 被否决：照修订清单的字面「守卫之前一律不允许 return / 表达式」直接收紧。这 3 个既有处理函数会不过（审查时以为 0 个），要么本 change 去改它们（超范围），要么测试一直红。
    - 被否决：对所有处理函数放宽成「守卫之前允许不 `await`、不碰数据的预处理」。新接口就又能先判开关再调守卫，修订清单要堵的正是这个。
12. 检查器自测。下面每一种写法都必须被指出：
    - 完全不调守卫；先读库、后调守卫；守卫之前先 `await` 一个本地函数（里面写库）；守卫之前提前 `return`（先判开关再调守卫）；守卫之前不 `await` 的写库调用；守卫之前不 `await` 地调用一个导入的函数；读请求体的 `.catch(…)` 里写库；守卫之前用 `db` 的别名导入读库、`const { projectDocument } = db`；
    - 调了守卫不看结果（不赋值、赋值了不检查）；检查的不是守卫的返回值（另一个变量）；调了守卫，先读库、再检查结果；拒绝分支先读写库再返回；拒绝分支返回 200；拒绝分支调用别的函数再返回；布尔守卫按 `instanceof` 检查；
    - 被注释掉的守卫；冒名守卫（同名、从别处导入；同名、文件里自己定义；处理函数里同名局部函数遮蔽导入的守卫）；文件里自己定义的、或从别处导入的同名 `isAccessError`；
    - `export { … as DELETE }`、`export * from`、`export const { GET, POST } = handlers`、`export const GET = 变量`、`withAuth(函数名)`、`withAuth` 以外的包装函数；
    - 守卫只在 `if` / `try` / 三元里调用；
    - 守卫查的是请求体里的另一个项目 ID（`body.projectId`、从请求体解构出的 `projectId`）、嵌套路由的另一个参数；项目 ID 用 `let` 绑定；守卫之后对它重新赋值；守卫之后又从 `ctx.params` 取一次 `id`；守卫的第一个参数不是处理函数收到的请求；
    - 例外接口被改回干活（读库、`await`、不再返回 410）；例外名单里的文件不存在、方法不存在；
    - 预处理名单：同一写法不在名单里判失败；名单里的处理函数在守卫之前 `await` 别的调用、碰数据库仍判失败；名单里的处理函数改成守卫第一步后提示删掉这一条；名单里的方法不存在；审查员的 L01–L06（不 `await` 地调写函数、`if (写函数()) return`、命名空间导入 `db`、别的 prisma 客户端、守卫前 return 200、新接口加进名单）；
    - 交叉验证补的：取路由参数 / 读请求体的解构默认值里写库、解构默认值调用别的函数、计算键藏调用、处理函数参数默认值（含解构参数的默认值）；`export let POST`、模块顶层对处理函数重新赋值；拒绝页辅助函数里删库再返回 200（N20）、状态码来自参数而调用处传 200、辅助函数里调用别的函数；守卫之后 `ctx.params.then(…)`、把 `ctx` 交给别的函数、再用 `params`；`route.mjs` 里漏了检查；枚举认 `route.js / .jsx / .mjs`、不认 `page.tsx` 与 `route.test.ts`。

    下面几种正例必须通过（正例都是合成的、不在任何名单里的路由源码，同时覆盖规格「新加的接口不用登记」）：
    - 先过守卫再碰数据的 `withAuth` 写法与 `export async function` 写法；第二个参数解构出 `{ params }` 再 `await params`；
    - 守卫第一步、之后才判开关（BIDPAGE `bid-page-summary` 现行版本 `9b0828ac` 的写法）；`const p = await ctx.params` 再传 `p.id`；
    - 先 `await request.json().catch(…)` 再调守卫；`try` 里读请求体再调守卫，按内容在分支里再调写权限守卫不受约束；
    - 守卫前取文件常量的别名、拒绝时返回由常量构造的 401 / 404 页；拒绝时把守卫的响应换成另一个拒绝响应；
    - 别名导入的调试面守卫；返回布尔的讨论区守卫；`isAccessError(x)) return x`；预处理名单里的既有写法。
13. 一键投标方案两个路由照抄的固定提示（第 D12 节）与 `src/lib/agent-tasks/dto.ts` 的 `SAFE_STEP_ERROR_MESSAGE` 一字不差：按源码文本比较（读文件、解析语法树，不导入冻结面）。

**守卫名单与出处**：每一个都读过代码，确认里面包含项目可见性判断（要么直接调读 / 写守卫，要么自己按同样的规则判），有的在前面先判开关或平台管理员。括号里是 main 上以它为第一个守卫的处理函数数。

| 来源模块 | 守卫 | 出处 | 说明 |
|---|---|---|---|
| `@/lib/projects/access` | `requireProjectReadAccess`（67）、`requireProjectWriteAccess`（48）、`requireProjectManageAccess`（11） | `access.ts:116`、`:54`、`:168` | 项目可见性统一入口 |
| `@/lib/projects/diagnostic-access` | `requireDiagnosticProjectReadAccess`（24）、`requireDiagnosticProjectManageAccess`（23） | `diagnostic-access.ts:15-31` | 先判平台管理员，再判项目读 / 管理；路由里以 `requireProjectReadAccess` / `requireProjectManageAccess` 的别名导入 |
| `@/lib/tender-auto-analysis/api-access` | `requireTenderAnalysisRead`（5）、`requireTenderAnalysisWrite`（13） | `api-access.ts:19-32` | 直接转调读 / 写守卫；结果用 `isAccessError` 检查 |
| `@/lib/quote-engine/access` | `requireQuoteAccess`（22） | `quote-engine/access.ts:34-46` | 先判开关，再判读权限，再判报价能力 |
| `@/lib/project-finance/access` | `requireCostAccess`（22） | `project-finance/access.ts:117-144` | 先判开关，再判读权限；读权限给 403 时，只给本组织、已分发、持财务键的人另开只读入口（`:99-115`） |
| `@/lib/tender-import-leads/api-access` | `requireImportLeadsRead`（1）、`requireImportLeadsWrite`（3） | `tender-import-leads/api-access.ts:17-32` | 先读权限，再判组织成员与开关 |
| `@/lib/project-discussion/access` | `canViewProjectDiscussion`（2）、`canPostProjectMessage`（1） | `project-discussion/access.ts:68-105` | 返回布尔：项目存在、未分发只给 super_admin、负责人 / 成员 / 组织管理员 |

合计 242 个，加上 FIX-17 的 2 个与本次 6 个是 250 个，再加 1 个例外，就是目录下的 251 个处理函数。任务提到的 `requireSupplierIntelAccess` 只用在 `src/app/api/supplier-intel/**`，这个目录里没有用到，不进名单。

**例外名单**：`src/app/api/projects/[id]/inquiries/batch-followup/route.ts` 的 `POST`。

- T-2 已下线（文件头注释：Evan 2026-11-07 拍板，原调用方已被 W-1 删除），只返回 410，不鉴权、不调模型、不读写库。
- 目录里没有别的处理函数既不调守卫、又不在本次与 FIX-17 的修补范围内，所以名单只有这一条。

**以后新加的接口（例如并行的 BIDPAGE 会话要在这个目录下加的）：写法合规就通过，不用改测试里的任何名单。**

- 为什么不用登记：
  - 测试每次运行都现场枚举目录下全部 `route.ts` / `route.tsx`，没有路由清单要维护；
  - 守卫名单记的是守卫函数，不是路由；
  - 第 10 条的数目只是下限（至少 170 个文件、240 个处理函数），新加接口只会让实际数变大；表里每个守卫后面括号里的个数只是说明，测试不断言。
- 合规写法（`withAuth` 与 `export async function` 都行，下面以 `withAuth` 为例）：

  ```ts
  export const GET = withAuth(async (request, ctx, user) => {
    const { id: projectId } = await ctx.params;
    const access = await requireProjectReadAccess(request, projectId);
    if (access instanceof NextResponse) return access;
    // 到这里之后才碰数据库、模型、通知
  });
  ```

  - 守卫从名单里的模块按原名导入，例如 `import { requireProjectReadAccess } from "@/lib/projects/access"`；
  - 处理函数正文写在导出语句里（第 1 条）；
  - 守卫调用是处理函数正文的顶层语句，赋给一个变量，下一条语句就是 `instanceof NextResponse` 检查，拒绝时返回守卫结果或 401 / 403 / 404（第 5–7 条）；
  - 第一个参数是处理函数收到的请求，第二个参数是 `const` 解构路由参数 `id` 得到的变量，之后不改写、不再取路由参数（第 8 条）；
  - 守卫之前只取路由参数和读请求体（第 3 条）：不判开关、不提前 return、不调任何函数；开关之类放在守卫之后。
- 只有两种情况要改测试里的名单，都与新接口放在同一个 PR：
  - 新接口用了名单以外的守卫（例如新写一个包装守卫）：把它按「来源模块、原始导出名、出处行号、里面怎么判项目可见性」加进守卫名单；
  - 新接口是固定返回 410 的已下线接口：加进例外名单，写明下线理由与出处。
- 先后顺序：
  - 新接口先于 FIX-21 合进 main：FIX-21 开工跑 tasks 1.2 时会一起查到。合规的直接通过；不合规的会出现在失败清单里，停下回报，在新接口自己的 change 里改，不在本 change 里顺手改。
  - 新接口在 FIX-21 之后合并：它的 PR 跑 `npm run test:ci` 时就会被这个测试查。

**起草与复审时的核对**：用一次性原型按第 2–9 条跑过（只放在 scratchpad，没进仓库），结果如下。

- main `2ef4f9c8`：251 个处理函数里只有 8 个不过，是本次 6 个与 FIX-17 的 2 个；batch-followup 按例外通过。FIX-17 分支上只剩本次 6 个。
- 第 4 条如果不认 `.catch(…)`，会多误报 2 个：`finance/expenses/[expenseId]` `PATCH`、`quote-engine/[quoteId]/status` `POST`。`join-brief` `POST` 先读请求体（不带 `.catch`）再调守卫，按第 4 条通过。
- 第 6–8 条在 main 的 242 个、FIX-17 分支的 244 个已有守卫的处理函数上 **0 个误报**。`handoff/preview` 里第二次调写权限守卫只是探测能力，不是第一个守卫，不受第 7 条约束。
- 实现时（FIX-17 合并后的 main `07c02358` 合入本分支）：176 个文件、251 个处理函数，只有本次 6 个不过，244 个通过、1 个按例外通过。
- 多维审查后收紧（合入 main `22a87fb7` 后）：176 个文件、251 个处理函数，严格通过 247 个、守卫前预处理名单 3 个（第 11 条）、例外 1 个，改动前只点名本次 6 个。BIDPAGE `bid-page-summary` 现行版本（`9b0828ac`）已改成守卫第一步、之后才判开关，按这个写法的合成正例通过；它起初的写法（先判开关再调守卫）现在会被指出（「守卫之前提前 return」反例）。
- 三段合成的漏洞写法，第 2–5 条全部放行，第 6–8 条各指出一段：守卫只在 `if` 里；守卫后先读库再检查；守卫查请求体里的项目 ID。

**与 FIX-17 `files-route-guard.test.ts` 的重叠**：`files/` 下 3 个文件两份测试都会查。保留两份，不合并。

- FIX-17 那份对 `files/` 更严：守卫必须是取参数后的第一个 `await`，先读请求体也算违规。它的规格 Scenario 点名了那条命令，删掉要改 FIX-17 的规格。
- 新的这份把「先读请求体」放宽到全目录现有写法都能满足的程度（第 3 条），同时加了 FIX-17 那份没有的第 5–8、11 条；`files/` 下现有写法两份都能过。
- 被否决：把 FIX-17 的检查器原样扩到整个目录。上面 3 个先读请求体的处理函数会误报，改它们不在本次范围。
- 被否决：把两份合成一个共享检查器。要动 FIX-17 的测试文件与规格，没有行为上的收益。
- 被否决：沿用 `authz-contract.test.ts` 那种「文件 → 必需符号」的固定清单。管不到以后新加的文件。
- 被否决：用正则扫文本（FIX-17 的做法）。第 6–8 条要知道语句的层级与变量从哪来，正则做不稳。

### D10 隔离库 + HTTP 测试

新文件 `src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts`，进 `scripts/test-all.sh`（隔离库执行，否则跳过）。写法照 FIX-17 的 `files-access-db.isolated.test.ts`：直接调路由导出的处理函数，带 `createSession` 签的会话 cookie。

- **人**：
  - 组织甲的人：
    - 负责人（是项目甲、丙、甲二的负责人）；
    - 组织管理员（不是任何项目的成员）；
    - 项目管理员、只读成员、操作员：项目甲与项目丙的 active 成员；
    - 同组织非成员（组织角色 `org_member`）；
    - 项目甲成员身份 inactive 的人；
    - 组织成员身份 inactive 的原组织管理员。
  - 其他人：
    - 组织乙的管理员；
    - 不属于任何组织的 super_admin；
    - 已停用账号（曾是项目甲的项目管理员）。
- **项目**：
  - 项目甲（组织甲，已分发），专给被拒用例。里面放：
    - 一份已解析、带正文、待摘要的文件；
    - 一份情报，状态 `approved`，带审核备注、审核人、评分、`_meta`；
    - 两条相似项目记录；
    - 一个已完成的一键投标方案任务，报价草稿步骤的输出里放一个唯一的价格标记串；
    - 一个 `queued` 任务，下一步是文档摘要。
  - 项目丙（组织甲，已分发），专给放行用例：没有待摘要文件，没有可用文档内容。里面放：
    - 一份情报，供审核读写的放行用例；
    - 任务「丙-展示」：报价草稿步骤已完成，输出里放价格标记串；另一步失败，报错里放一个唯一的原始报错标记串；
    - 任务「丙-末步」：前 3 步已完成，只剩最后一步待执行，这一步是文档摘要。项目丙没有待摘要文件，所以这一步不调模型。
  - 项目甲二（组织甲，未分发）：一个 `queued` 任务。
  - 项目乙（组织乙）：一个自己的任务。
  - 项目丁（没有所属组织，已分发）：负责人同上，项目甲的项目管理员也是它的 active 项目管理员；用来测「没有所属组织的项目里，项目管理员不过写权限」（`access.ts:93`）；只读成员也是它的 active 成员，测读权限放行。
  - 多维审查后补的夹具（修订清单第 2、10、12、15、16 条）：
    - 项目甲另加测试、财务审核两个角色的 active 成员，与一个只剩最后一步的任务（改动前被拒的执行会让任务完成、给全组发通知）；
    - 项目丙另加：一个 `custom_flow` 类型、只剩最后一步的任务；「带报错但状态是已完成」「状态是失败但没有报错」的边界步骤；下一步是未知报价动作的任务（技能返回失败、不带报错，不调模型）；
    - 项目「模」（组织甲）：报价草稿任务（假服务回一段不是 JSON 的原文 → 技能 `success=false`、报错是模型原文）与单个询价项的邮件草稿任务（假服务回 400 → 技能抛错，走 `run-step` 的 catch 分支），各给项目管理员与 super_admin 一个；带一个供应商、一轮询价与一个询价项；
    - 组织「预」（岗位模式，`window_covering_services_v1`，种好岗位）与项目「预」：以岗位预览身份访问的 super_admin 是组织「预」的 active 成员、项目「预」的只读成员，带签好的预览 cookie。
- **不调模型怎么观察**：照 `src/lib/sales/__tests__/period-narrative-db.isolated.test.ts:3`、`:51`、`:81-82` 的做法，本机起一个 OpenAI 兼容假服务，把 `OPENAI_BASE_URL` 指过去、`OPENAI_API_KEY` 设成测试值，统计收到的请求数。
  - 每个被拒用例前后请求数不变。
  - 放行用例大多挑不需要调模型的路径（项目丙没有可用文档；执行的那一步是无事可做的文档摘要）；只有项目「模」的 4 次执行故意调模型（看失败时报错给谁看）。所以被拒用例 0 次请求，整个测试只有项目「模」的 4 次。
  - 被否决：不配模型密钥，靠「没密钥就报错」判断。被拒和「调了但失败」分不开。
- **不改数据怎么观察**：被拒前后逐字段比对这些记录：
  - 项目甲的情报行、项目行、相似项目记录；
  - 项目甲、甲二、乙的各个任务及其步骤，项目甲与项目丁的任务数；
  - 待摘要文件的摘要状态；
  - `projectId` 为项目甲的站内通知数。
- **通知怎么数**：`run-step` 发通知不 `await`（`run-step/route.ts:161-169`），响应回来时通知可能还没写库。
  - 放行用例：按 `projectId = 丙`、且 `sourceKey` 以 `bid_package_done:<丙-末步的任务 ID>:` 开头去数。每 100 毫秒查一次，最多等 5 秒，直到到达预期条数（只读成员、操作员、负责人各一条，共 3 条）；再等 300 毫秒确认不多出来。
  - 被拒用例：只数 `projectId = 甲` 的通知。放行用例都不碰项目甲，丙那边晚到的通知不会混进来。
- **被拒响应不带内容**：正文只允许 `error`（及 `requestId`）；不出现价格标记串、审核备注、审核人姓名。
- **安全视图**：
  - 只读成员、负责人、组织管理员分别 `GET …/ai-bid-package?taskId=<丙-展示>`：每一步 `data` 是空对象；全文不出现价格标记串与原始报错标记串；失败那一步的 `error` 是固定提示「处理失败，请稍后重试或联系管理员」。
  - super_admin 同样调用：报价那一步的 `data` 带价格标记串，失败那一步的 `error` 是原始报错标记串。
  - 项目管理员执行「丙-末步」：响应 `data` 是空对象；super_admin 随后 `GET …?taskId=<丙-末步>`，这一步的 `data` 是技能的原始输出（`{ processed: 0 }`），证明库里存的没有被裁。
- 被否决：只有守卫测试。它证明「调了守卫」，证明不了「被拒时没调模型、没发通知、数据没动」，也证明不了安全视图。
- 被否决：mock 掉 `db`。仓库约定用真库；跨组织成员关系的判断正是要测的东西。

### D11 「改动前失败」怎么取证

先写两个测试、不改路由，各跑一遍把输出存下来。预期：

- 守卫测试只点名本次 6 个处理函数，其余处理函数全部通过（main `2ef4f9c8` 上是 245 个；开工时目录里新加了接口就按实际数，见 D9「以后新加的接口」），这就是真实目录上的零误报；检查器自测全部通过；
- 隔离库测试里：
  - 被拒用例拿到 200 / 500，情报或相似项目被改，任务被建，或假模型服务收到请求；
  - 安全视图用例里，非平台管理员看到价格标记串与原始报错标记串。

再改路由重跑。两份输出都贴进报告。

- 被否决：改完再 `git stash` 回去跑。顺序反了容易把「测试本身写错」当成「修好了」。

### D12 一键投标方案的两个接口：非平台管理员只拿安全视图（「留给 GATE」第 1 条，已定 C，Lucas 2026-11-22）

- 谁算平台管理员：
  - 守卫返回的用户是不是平台管理员（`isPlatformAdmin`，`src/lib/rbac/platform-admin.ts:14-22`），与 `/api/agent/tasks/:taskId` 同一判断（`agent/tasks/[taskId]/route.ts:50`）。
  - super_admin 以岗位预览身份访问时角色视同普通用户，同样只拿安全视图，与 `/api/agent/tasks` 一致。
- `GET …/ai-bid-package`，非平台管理员时：
  - 每一步的 `data` 为空对象；
  - `error` 与 `sanitizeListStepError`（`dto.ts:203-212`）同一口径：这一步失败或有报错时是固定提示，否则为 `null`；
  - 其余字段不变：步骤 ID、序号、技能、标题、动作标签、状态、是否成功、摘要、起止时间、耗时，以及任务级的状态、步骤数、完成数、时间。
  - 动作标签来自模板里的固定字面量（`bid-package.ts:46`），不是用户输入，保留。
  - 摘要保留：通用接口的业务视图也保留它（`dto.ts:114`）；四个技能写进摘要的只有条数、模板名、推荐结论与匹配度，没有价格（`quote.ts:153`、`email-draft.ts:135`、`intelligence-report.ts:37`、`document-summary.ts:45`）。
- `POST …/ai-bid-package/run-step`，非平台管理员时：
  - 正常执行分支响应的 `data` 为空对象（未知技能、技能抛错两条分支本来就不带 `data`，不加）；
  - 这一步失败时（含未知技能、技能抛错两条分支）`error` 是固定提示，成功时不带 `error`；
  - 其余字段不变：`done`、序号、技能、标题、是否成功、摘要、耗时。
  - 库里照旧写入完整输出与原始报错，平台管理员看得到。
- `POST …/ai-bid-package` 的响应只有任务 ID、类型、步骤的技能与标题，不含内幕，不动。
- 改口径影响谁：用脚本调这两个接口的负责人、组织管理员、项目成员。界面只对平台管理员挂载，**界面上没有人受影响**。
- 被否决：不裁（GATE 1 选项 A）。与 `dto.ts:1-9` 的约定不一致，且这两个接口是同一张表上唯一的例外。
- 被否决：按财务查看权只裁报价草稿那一步（选项 B）。新规则只在这一处生效，原始报错照样外露。
- 被否决：在前端删字段。`dto.ts` 头注释明令禁止「先返回完整对象再由前端删字段」。
- 被否决：新写一套投影函数。只在路由里照 `dto.ts` 的口径写两行（同一句固定提示、同一条「失败或带报错」判断），不另起投影模块。
- 实现时改：起草时写的是「直接导入 `dto.ts` 的固定提示与报错脱敏」。`src/lib/agent-tasks` 是 runtime-architecture 冻结面（`src/lib/runtime-architecture/guards.ts` 的 `FROZEN_IMPORT_TARGETS["agent-tasks-legacy"]`），新文件导入它会让 `bash scripts/test-runtime-architecture.sh` 以 `NEW_FROZEN_MODULE_IMPORTER_FORBIDDEN` 失败；改 baseline 等于给冻结面加消费者。所以两个路由各照抄一句固定提示（注释写明出处），对外行为不变；与 `dto.ts` 的 `SAFE_STEP_ERROR_MESSAGE` 一字不差由隔离库测试断言（测试文件导入 `dto.ts` 做比较，测试不在冻结面普查范围内）。

### D13 一键投标方案两个接口只认 `ai_bid_package` 任务（多维审查后加，修订清单第 2 条）

`GET …/ai-bid-package?taskId=…` 与 `run-step` 按 `id + projectId + taskType = "ai_bid_package"` 找任务；同项目里别的类型的 AgentTask（如 `custom_flow`）按「任务不存在」404，不返回、不执行、不发「AI 投标方案已生成」通知。

- 理由：这两个接口是一键投标方案的专用入口，界面只用它查看与执行 `ai_bid_package` 任务；不加类型条件时，能过写权限的人可以借这个入口执行同项目里别的 AgentTask 的下一步（跳过 `/api/agent/tasks/:taskId/execute` 自己的检查），读接口也会把别的任务的步骤按这里的口径返回。
- 改口径影响谁：没有人。界面只拿这两个接口查看与执行一键投标方案任务；`/api/agent/tasks` 的通用入口不变。
- 被否决：不加。审查（安全 3）实测可以借 `run-step` 执行同项目里的 `custom_flow` 任务。

## 与八条硬纪律的关系

1. 零 schema：遵守。不新增 model / 字段 / migration；测试只往隔离库写夹具并清理。
2. 出站动作先审批：不涉及。`run-step` 最后一步发的是站内通知，邮件草稿步骤只起草、不发送（`email-draft.ts` 只调模型，没有发送或建审批卡）；本次只是让无关的人触发不了它们。
3. 禁止第三套队列：遵守。不新增队列 / 调度 / lease；一键投标方案仍是前端逐步驱动既有的 AgentTask，本次只在前面加门。
4. 脱敏：不涉及 Muse 通道。与脱敏方向一致：
   - 被拒的响应不带报价草稿与审核结论；
   - 非平台管理员拿到的步骤输出整段换成空对象、原始报错整段换成固定提示（整段替换，不做局部遮盖）；
   - 规格里有对应的 SHALL NOT。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。不新增模型调用；权限判断是查成员关系。无关的人以后触发不了情报重算与技能执行，模型调用只会少。
8. 测试注册：遵守。两个新测试都注册进 `scripts/test-all.sh`（放在 FIX-17 两条之后）；守卫测试同时进 `scripts/test-ci-unit.sh`；`bash scripts/check-test-registry.sh` 通过，`ci/test-registry-baseline.txt` 不加行。

## 验证方式

- `npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts`：
  - 改动前退出码非 0，失败清单只有本次 6 个处理函数；其余处理函数（含 batch-followup 例外；main `2ef4f9c8` 上是 245 个，开工时按实际数）全部通过，也就是在真实目录上零误报。
  - 检查器自测（D9 第 12 条）与固定提示比较（第 13 条）全部通过；真实目录零误报（收紧后严格通过 + 守卫前预处理名单 + 例外 = 全部处理函数）。
  - 改动后退出码 0。
- `NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=… DIRECT_URL=… npx tsx src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts`：改动前被拒用例与安全视图用例失败，改动后全部通过；连跑 3 次结果一致。
- 变异：把 `run-step` 三处失败分支、正常分支的 `data`、`GET` 的 `data` 与报错判断（`|| s.error`、失败状态）、两处 `taskType` 条件分别改回去，隔离库测试都失败（「成功但带报错」那一边现有技能走不到，见报告「已知限制」）。
- 归档演练：在临时副本里 `openspec archive project-intel-bidpackage-access --yes` 后 `openspec validate --specs --strict` 不新增失败，每条要求正文 ≤ 500 字。
- `npx tsx src/lib/projects/__tests__/files-route-guard.test.ts`（FIX-17）仍通过。
- 其余门禁：
  - `npm test` 对照既有失败清单无新增；
  - `npm run test:ci` PASS；
  - `npm run typecheck` 退出码 0；
  - `npm run lint:baseline` PASS；
  - `bash scripts/check-test-registry.sh` OK；
  - `OPENSPEC_TELEMETRY=0 openspec validate project-intel-bidpackage-access --strict` valid。

## Risks / Trade-offs

- [有人正靠这个缺口干活] 合并后这些请求变 403：
  - 不是项目成员、却在读别人的投标方案 / 情报，或用脚本跑别人的一键投标方案的人；
  - 项目里不是管理者、却用脚本建任务或执行步骤的成员。
  - 界面上到不了这一步，只可能是脚本或手工请求。不保留兼容。
- [脚本看到的响应变了] 非平台管理员用脚本调 `GET …/ai-bid-package` 或 `run-step`，步骤 `data` 变成空对象、失败报错变成固定提示。要看原始输出的人找平台管理员，或在库里查。不保留兼容。
- [只读成员仍能清空审核结论] 见 D4 的已知后果。GATE 3 已定 A（读权限，Lucas 2026-11-22），本次不收紧；真正的修法另开任务，登记在 tasks 3.2 的后续任务第 1 条。
- [目录守卫测试以后误报] 新路由用了名单外的守卫（例如新写一个包装守卫），或者想按请求内容在 `if` 里选守卫级别，测试会失败并指出位置。处理办法：
  - 改用名单里的守卫，或把新守卫连同出处加进名单；
  - 按内容选级别时，先不带条件地调读权限守卫，再在分支里调写权限守卫，照 `join-brief/route.ts:104-111` 的写法。
  - 名单故意不认「任意名字里带 Access 的函数」。
- [守卫测试靠读源码判断，仍有认不出的写法（已知盲区）] 收紧后（第 3、5、8、11 条与交叉验证 F1–F6），守卫之前不 `await` 地调用导入的写库函数、`const { projectDocument } = db` 再用、解构默认值 / 计算键 / 参数默认值里藏调用、伪造第一个参数、拒绝页辅助函数里写库都会被指出。仍认不出的：
  - 名单里的守卫函数本身写错（测试只认来源，不查守卫内部）；守卫结果检查通过之后的行为（例如只按 `access.user` 再查一次别的项目）；
  - 按名字认的调用：守卫前预处理名单里的 `x.has(…)` / `x.includes(…)`、拒绝页辅助函数里的 `x.replace(…)` 只看方法名，接收者若是自己写的、带副作用的对象认不出；`String(x)` 触发的自定义 `toString`、常量表达式里属性读取触发的 getter 也认不出；
  - 名为 `prisma` 以外、也不从 `/db`、`/prisma`、`@prisma/client` 导入的数据库客户端（例如别的名字的包装模块），在守卫之前用到时只会被「做了取路由参数、读请求体以外的事」指出，不会点名「碰了数据库」——严格规则下仍判失败，只是说明不一样；
  - 不在 `src/app/api/projects/[id]/` 下、却按项目 ID 读写的接口（如 `/api/agent/tasks/recent`，后续任务 FIX-23）。
  行为由隔离库测试兜底（本次 6 个处理函数）。
- [依赖 FIX-17] FIX-17 没合并时，目录守卫测试会指出 `files/` 下那 2 个处理函数。FIX-17（#548）合并后把 main 合入本分支再开工（tasks 开头的开工前提与 1.1）。
- [每个请求多几次主键查询] 用户一次、项目与成员关系各一次。相对一次模型调用可以忽略。

## Migration Plan

没有数据迁移、没有开关。合并即在生产生效；回滚就是 revert 这一个 PR。合并后要人做的事写在 tasks 3.2 的报告要求里。

## 留给 GATE

### 1. 一键投标方案的步骤原始输出、报价草稿价格与原始报错给谁看（`GET …/ai-bid-package` 与 `run-step` 的响应）

**已定（Lucas 2026-11-22）：C**

本 change 按选项 C 实现（D12）。

先摆事实：同一批能读项目的人，今天从别的读接口就能拿到价格。

- `GET …/inquiries`（读权限，`inquiries/route.ts:10-16`）返回全部询价行项，含供应商单价 / 总价（`src/lib/inquiry/service.ts:191-199`）。
- 旧报价单 `GET …/quotes/:quoteId`（读权限，`quotes/[quoteId]/route.ts:9-25`）整条返回：行项含内部成本 `costPrice`（`prisma/schema.prisma:3169`），表头含 `internalCost` 与 `profitMargin`（`:2966-2967`）。
- 新报价引擎的「内部成本」级别对所有项目角色开放（`quote-engine/access.ts:31`、`:43`；只读角色也有 `PROJECT_COST_READ`，`src/lib/rbac/permissions.ts:187-193`）。不是项目成员、也不持财务管理键的组织管理员拿不到这一级，但他们能读上面两个旧接口。

所以只看价格，单裁这一个接口不减少组织内的暴露。步骤原始输出与原始报错不一样：同一张表有明文约定，普通业务用户不给（`dto.ts:1-9`）。

- **A. 只加项目读权限，不裁。**
  - 后果：
    - 项目的任何 active 成员（含只读），以及负责人、组织管理员，用脚本仍能读到每一步的原始输出：报价草稿行项的报价与成本价、询价邮件草稿、文档摘要与情报原文；
    - 也能读到原始报错，含模型原始输出的前 500 字（`quote.ts:144`）；
    - 与 `dto.ts:1-9` 的约定不一致：同一张表上 `/api/agent/tasks` 不给，这两个接口给。
- **B. 读权限，另按财务查看权裁报价草稿那一步。**
  - 做法：没有 `canReadAll` 的人看到的报价草稿步骤 `data` 整段换成一句固定提示。
  - 先例：
    - TI-4a 成本核算没有财务查看权给 403（`bid-workspace/cost-sheet/route.ts:22-23`）；
    - CHAIN-2 寻源建议里，没有财务查看权的人不给「我方落地价」一栏（`tender-intel/sourcing-suggestions.ts:143-156`）。
    - 任务里说的「CHAIN-2b / 2e」这两个编号我在 main 的 docs 与代码里没找到，按这两处已合并的做法写。
  - 后果：
    - 新规则只在这一个接口生效，上面三个读接口照样给价格；
    - 其余步骤的原始输出与原始报错照样外露；
    - 每次多两次岗位键查询；
    - 规格与测试要加财务岗位夹具；
    - `run-step` 自己的响应也带同一份 `data`，要不要一起裁也得定。
- **C. 照 AgentTask 的业务视图：非平台管理员只拿安全视图（推荐，已定）。**
  - 做法见 D12：步骤 `data` 为空对象，失败步骤的 `error` 换成固定提示；平台管理员照旧全看。
  - 先例：`/api/agent/tasks/:taskId` 对非平台管理员返回安全视图（`agent/tasks/[taskId]/route.ts:14-22`、`:50-55`；`dto.ts:102-130`）；列表也一样（`agent/tasks/route.ts:27`、`:63`）。
  - 后果：
    - 同一张表的读口子口径一致；
    - 非平台管理员在这个接口上拿不到报价草稿，价格问题对这个接口随之消失（他们照样能从上面三个读接口拿到价格，那是另一回事，登记在 tasks 3.2 后续任务第 8 条）；
    - 界面不受影响（面板只给平台管理员）；
    - 非平台管理员用脚本看到的响应形状变了；
    - 两个路由各多一个分支，隔离库测试多几个用例。
  - 我核实过，没有找到别的代价：
    - 这两个接口没有服务端调用方；
    - 界面只给平台管理员；
    - 完成通知点开落在项目详情页（`type-visibility.ts:37`），那里本来就不给非平台管理员显示这个面板。
- **D. 三个 ai-bid-package 处理函数都改成调试面守卫（平台管理员 + 项目权限）。**
  - 先例：`diagnostic-access.ts:15-31`，目录里 47 个处理函数在用。
  - 后果：
    - 与界面挂载条件一致；价格与内幕问题随之消失；
    - 负责人、组织管理员、项目管理员也不能再用接口发起、执行或查看；
    - 规格前两条 Requirement 与安全视图那一条都要改。

我的推荐：C。

- A 与 C 的差别只在「非平台管理员用脚本能不能拿到步骤原文与原始报错」，界面上谁都不受影响。C 补上的是一条仓库已有、明文写下的安全约定，代价只是两个分支和几个用例。
- B 是新规则，而且裁不干净。
- D 改的是谁能用这个内部工具，是产品口径；要收紧的话另开一个小 change。

### 2. `PATCH …/intelligence/review`（改情报审核结论）用读还是写

**已定（Lucas 2026-11-22）：A**

本 change 按选项 A 实现（D3），不改界面。

- **A. 读权限（推荐）。**
  - 后果：
    - 所有项目成员（含只读）都能把情报标成「已通过」「已交付」，审核人记的是本人；界面不改。
    - 不论这一处用哪一级，只读成员都能经「重新分析」（GATE 3 选 A 时）或「上传新文件 + 逐步处理」（FIX-17，读权限）把审核结论重置为「AI 已生成」，并清空审核人与备注。
  - 先例：`progress-summary/review` 的 `PATCH`。
- **B. 写权限。**
  - 后果：
    - 只有负责人、组织所有者 / 管理员、项目有所属组织时的项目管理员能改。只读成员、操作员等点审核按钮会静默失败。
    - 要另加界面任务：把 `canManage` 传进情报卡，隐藏或禁用审核按钮。规格第一条与测试相应调整。
    - **挡不住经重算抹掉审核**，除非 regenerate 一起改写权限（GATE 3 选 B）；即便两处都改，上传新文件后逐步处理仍会重算并清空审核结论（FIX-17 分支 `files/process-next/route.ts:200-205`）。
  - 先例：招标分析的批准（`tender-analysis/runs/[runId]/approve/route.ts:22`）。

我的推荐：A。

- 它与同类的进度摘要审核一致，也不需要动界面。
- B 单独选只收紧了「标通过」这一半，「清空」那一半还开着。
- 如果 Evan 认为「已交付」这类状态只应由管理者标：选 B，同时 GATE 3 选 B，界面改动（把 `canManage` 传进情报卡、隐藏或禁用按钮）并进 tasks 2.3，tasks 仍是 8 条；另开任务让重算不再清空人工审核结论。

### 3. `POST …/intelligence/regenerate`（重新分析）用读还是写

**已定（Lucas 2026-11-22）：A**

本 change 按选项 A 实现（D4），不改界面；「重新分析会清掉人工审核结论」另开任务修（tasks 3.2 后续任务第 1 条）。

- **A. 读权限（推荐）。**
  - 后果：
    - 「重新分析」按钮对所有能打开项目的成员照常可用；
    - 任何 active 成员（含只读）点一次，都会重置审核结论、清空审核人 / 时间 / 备注 / 评分（找不回、无审计），并按自己的可见范围重建相似项目；
    - 与 `POST …/similarities` 用写权限不一致。
  - 先例：`ai-summary` / `progress-summary` / `checklist` 的 `POST`（读）；FIX-17 后的 `process-next` 调同一个情报生成函数（读）。
- **B. 写权限。**
  - 后果：
    - 只有负责人、组织所有者 / 管理员、项目有所属组织时的项目管理员能点；
    - 其余成员点按钮静默失败，要另加界面任务（把 `canManage` 传进情报卡、隐藏按钮）；
    - 规格里 regenerate 从读权限那条挪到写权限那条，测试相应调整；
    - 与 `POST …/similarities` 一致；
    - 仍挡不住「上传新文件 + 逐步处理」重算并清空审核结论。
  - 先例：`POST …/similarities`（写）；重新分析招标文件（写，`tender-analysis/runs/[runId]/reanalyze/route.ts:16`）。

我的推荐：A。

- 本次要堵的是项目以外的人，A 已经做到。
- B 要连带改界面，还关不住上传那条路。
- 「清空人工审核结论」该在重算本身修（重算时保留已有的审核结论，或先留痕）：另开任务改 `src/lib/files/intelligence-extractor.ts`，那样两条路一起关上。
