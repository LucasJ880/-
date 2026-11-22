# Proposal：项目情报与一键投标方案的六个接口补上项目权限检查

TASKFLOW：FIX-21（Evan 2026-11-22 批准开这个 change：「FIX-21 开吧，先给我四件套」）
来源：2026-11-22 审查 FIX-17（`project-files-access-guard`）时逐个核对了 `src/app/api/projects/[id]/` 下 176 个路由文件，发现除 FIX-17 那两个接口以外，还有 4 个文件、6 个处理函数只检查「已登录」。FIX-17 的 Out of scope 已经点了这四个文件的名。
依赖：FIX-17 先合并（它补的是 `files/` 下的两个处理函数；本 change 的目录守卫测试要求整个目录都已过检查）。

## Why

这 6 个处理函数（见下文的表）只检查「已登录」：任何一个登录账号，包括别的组织的，拿到项目 ID 就能读到这个项目的报价草稿与询价邮件草稿、情报审核结论，能用该项目的数据调模型，能改写情报和审核结论，还能给该项目全体成员发通知。同目录下其余处理函数都先过了项目级权限检查（main 上 242 个，FIX-17 合并后 244 个），而且同一张任务表的通用接口只给平台管理员看步骤原始输出与原始报错（`src/lib/agent-tasks/dto.ts:1-9`），一键投标方案的两个接口却原样给所有调用者。

## What Changes

- 给 `GET /api/projects/:id/ai-bid-package` 加上项目读权限检查。放行平台 super_admin、项目负责人、项目所在组织的所有者或管理员、项目的 active 成员；其余登录用户 403「无权查看该项目」；项目不存在或未分发 404；未登录 401。
- 给 `POST /api/projects/:id/ai-bid-package`（建任务）与 `POST /api/projects/:id/ai-bid-package/run-step`（执行下一步）加上项目写权限检查。放行平台 super_admin、项目负责人、组织所有者或管理员、项目有所属组织时的项目管理员；其余登录用户（包括项目里的其它成员）403「无权修改该项目」；404 / 401 同上。
- 给 `POST /api/projects/:id/intelligence/regenerate` 加上项目读权限检查。
- 给 `GET` 与 `PATCH /api/projects/:id/intelligence/review` 加上项目读权限检查。
- 把每处检查放在处理函数的第一步，先于任何数据库读写、建任务、模型调用、改写情报与相似项目、发通知、读请求体。
- 让被拒的请求一律不改任何任务、步骤、情报、项目、相似项目记录，不调模型，不发通知。被拒的响应只带 `error`，不带任务 ID、步骤输出、报价草稿、邮件草稿、审核结论。
- 让 `GET …/ai-bid-package` 与 `POST …/ai-bid-package/run-step` 对非平台管理员只返回安全视图：每一步的 `data` 为空对象，失败步骤的 `error` 换成固定提示「处理失败，请稍后重试或联系管理员」；平台管理员照旧拿到全部内容（「留给 GATE」第 1 条的选项 C，本 change 默认按它实现）。
- 新增目录守卫测试（不用数据库，进 CI 子集），覆盖整个 `src/app/api/projects/[id]/` 下的 `route.ts` 与 `route.tsx`：每个处理函数都必须在第一步、不带条件地调用名单里的一个项目级守卫，紧接着检查结果，检查的就是地址里的那个项目；否则测试失败并点名文件与方法。名单写在测试里，并注明每个守卫的出处。已下线、固定返回 410 的 `inquiries/batch-followup` 列入例外，由测试校验它仍然不读写任何数据。
- 新增隔离库 + HTTP 测试，覆盖下面这些情况：
  - 被拒的调用者：别的组织的用户、同组织但不是项目成员的用户、项目成员身份 inactive 的用户、组织成员身份 inactive 的原组织管理员、未登录、已停用账号。
  - 写权限接口额外覆盖：项目里的只读成员与操作员也被拒。
  - 被拒后数据库各行不变、本机假模型服务收到 0 次请求、没有新通知。
  - 有权限的人照常可用；非平台管理员拿到安全视图，平台管理员拿到全部内容。

### 每个处理函数的检查级别（逐个读过代码与界面）

| 路由文件 | 方法 | 做什么 | 界面上谁在调 | 推荐级别 | 先例 |
|---|---|---|---|---|---|
| `ai-bid-package/route.ts` | `GET` | 返回最近一次一键投标方案任务的全部步骤输出：文档摘要、情报、报价草稿（含成本价与报价）、询价邮件草稿、原始报错 | 只有平台管理员能看到这个面板 | 读，非平台管理员只拿安全视图 | `/api/agent/tasks` 列表与详情（读，非平台管理员只拿安全视图）；招标分析结果（读） |
| `ai-bid-package/route.ts` | `POST` | 在项目下建一个 4 步的 AgentTask | 同上 | 写 | `/api/agent/tasks` 建任务（管理 = 写）；发起招标分析（写） |
| `ai-bid-package/run-step/route.ts` | `POST` | 执行下一步：调模型生成摘要 / 情报 / 报价草稿 / 邮件草稿，并把这一步的输出与原始报错放进响应；最后一步给全体成员发高优先级通知 | 同上 | 写，非平台管理员只拿安全视图 | `/api/agent/tasks/:taskId/execute`（管理 = 写）；重新分析（写） |
| `intelligence/regenerate/route.ts` | `POST` | 调模型重算情报（同时把审核结论重置为「AI 已生成」、清空审核人 / 时间 / 备注 / 评分），刷新结构化摘要，按调用者的可见范围重建相似项目 | 情报卡「重新分析」按钮，所有能打开情报页签的成员 | 读 | FIX-17 后的 `process-next`（读，同一个情报生成函数）；`ai-summary` / `progress-summary` / `checklist` 的 `POST`（读）。反例：`POST …/similarities` 重算相似项目用写 |
| `intelligence/review/route.ts` | `GET` | 读情报审核状态、备注、评分、审核人、推荐、风险、匹配分、报告元数据 | 没有界面调用 | 读 | 项目详情 `GET`（读）本来就整行返回情报 |
| `intelligence/review/route.ts` | `PATCH` | 改审核状态（含「已通过」「已交付」）、备注、评分，记下审核人 | 情报卡审核面板，所有能打开情报页签的成员 | 读 | `progress-summary/review` `PATCH`（读；审核状态相同，只少「草稿」「已交付」两个） |

三条要拍板的事放在 design 的「留给 GATE」：
- 第 1 条：`GET …/ai-bid-package`（以及 `run-step` 的响应）里的步骤原始输出、报价草稿价格与原始报错给谁看。推荐 C：非平台管理员只拿安全视图，本 change 默认按 C 实现。
- 第 2 条：`PATCH …/intelligence/review` 用读还是写。推荐读。
- 第 3 条：`POST …/intelligence/regenerate` 用读还是写。推荐读；代价是只读成员能经「重新分析」清空审核结论。

## 受影响的 Muse 意图

无。不改 `src/lib/muse-bridge/` 下任何文件。

## Out of scope

- 按财务查看权裁掉报价草稿价格（GATE 1 选项 B）；把三个 ai-bid-package 接口改成只给平台管理员（GATE 1 选项 D）：本次不做。
- 重新生成情报时重置审核结论、按调用者的可见范围重建相似项目：都是既有行为（`src/lib/files/intelligence-extractor.ts:346-369`、`src/lib/projects/similarity.ts:35-49`、`:204-217`），本次不改；谁能触发由 GATE 3 定。
- `run-step` 调技能时传组织：不传（design D8）。技能里的模型调用不带组织，所以月度 AI 费用预检对这条路径不生效（`src/lib/ai/client.ts:173-184`）；情报生成也一样。这个问题涉及 `src/lib/agent/skills/**` 与 `src/lib/files/intelligence-extractor.ts`，另开任务。
- 已离开组织、但项目成员关系仍是 active 的人（或仍是项目负责人）；没有所属组织的项目里，项目管理员不过写权限：都是 `src/lib/projects/access.ts` 的既有判定（`:81-107`），影响全部项目接口；本次不改。
- 情报审核结论的修改不写审计记录：现状如此，本次不加。
- 界面：不改。界面上看到的不变：两个返回步骤内容的接口，界面只对平台管理员挂载，平台管理员照旧拿全部内容，也本来就过写权限。
- FIX-17 的 `src/lib/projects/__tests__/files-route-guard.test.ts`：保留不改，与新的目录守卫测试并存（design D9）。
- `src/app/api/projects/[id]/` 以外的路由（如 `/api/agent/tasks/**`、`/api/supplier-intel/**`）：不查不改。
- schema 变更、新的队列 / 调度、新的模型调用、新开关：没有。**没有开关，合并即生效。**

## Capabilities

### New Capabilities

- `projects/intel-bidpackage-access`：项目情报（重新生成、审核结论的读与改）与一键投标方案（建任务、逐步执行、查看）接口谁能调用、被拒时返回什么、被拒时不发生什么、不返回什么，以及非平台管理员看到的步骤内容。
- `projects/route-access-guard`：`/api/projects/:id/` 下的每个接口都必须先过项目级权限检查，由不用数据库的守卫测试看住。

### Modified Capabilities

无。

## Impact

- 代码：4 个路由文件各加守卫调用（共 6 处）；其中 2 个文件另加「非平台管理员只拿安全视图」：
  - `src/app/api/projects/[id]/ai-bid-package/route.ts`（守卫 2 处；`GET` 的安全视图）
  - `src/app/api/projects/[id]/ai-bid-package/run-step/route.ts`（守卫 1 处；响应的安全视图）
  - `src/app/api/projects/[id]/intelligence/regenerate/route.ts`
  - `src/app/api/projects/[id]/intelligence/review/route.ts`
- 测试：两个新测试 `src/lib/projects/__tests__/project-routes-guard.test.ts`、`src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts`；注册进 `scripts/test-all.sh`，守卫测试同时进 `scripts/test-ci-unit.sh`。
- 接口：
  - 「登录但与项目无关」的调用者：6 个处理函数从照常执行变成 403（项目不存在或未分发时 404）。
  - 两个写权限接口：项目里不是管理者的成员也从照常执行变成 403。
  - 非平台管理员（负责人、组织管理员、项目成员）调 `GET …/ai-bid-package` 与 `run-step`：步骤 `data` 变成空对象，失败步骤的 `error` 变成固定提示。界面上没有人受影响，只有用脚本调接口的人会看到。
  - 其余放行的调用者：请求、返回、副作用都不变。
- 依赖、数据库、环境变量：不变。
- 文档：`docs/QINGYAN_FIX-21_REPORT.md`；TASKFLOW 情报串联表在 FIX-17 之后加 FIX-21 一行。
