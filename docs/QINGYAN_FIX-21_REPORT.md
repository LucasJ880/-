# FIX-21 报告：项目情报与一键投标方案的六个接口补上项目权限检查

> **白话说明（合并后谁会发现什么变了）**：这次只给后台六个接口补上了「是不是这个项目的人」的检查，界面一个字没改。项目成员、负责人、组织管理员和平台管理员在界面上用起来和以前完全一样：情报卡的「重新分析」和审核按钮照常能点；「一键投标方案」面板本来就只给平台管理员看，平台管理员照旧看到全部内容。以前别的组织或与项目无关的账号，只要知道项目编号就能读到报价草稿（含报价和成本价）、询价邮件草稿和情报审核结论，能用这个项目的数据跑模型、把审核结论改成「已通过」或清空、清空相似项目、给全组发通知；现在会被直接拒绝。唯一可能有人察觉的变化：用脚本调一键投标方案接口的负责人、组织管理员或项目成员，看到的步骤内容变成空的、失败原因变成一句固定提示；项目里的操作员、只读成员用脚本建一键投标方案任务或执行步骤会被拒绝。

| 项 | 值 |
|---|---|
| change | `project-intel-bidpackage-access`（新能力 `projects/intel-bidpackage-access` 11 条要求、`projects/route-access-guard` 2 条要求） |
| TASKFLOW | FIX-21（Phase F（续）— 情报串联表，FIX-17 之后），另登记 8 条「编号待定」后续任务 |
| 来源 | 2026-11-22 审查 FIX-17 时逐个核对 `src/app/api/projects/[id]/` 下全部路由发现；Evan 2026-11-22 批准开这个 change |
| GATE | 「留给 GATE」三条，Lucas 2026-11-22 定：第 1 条 **C**（一键投标方案两个接口对非平台管理员只给安全视图）、第 2 条 **A**（`PATCH …/intelligence/review` 用读权限）、第 3 条 **A**（`POST …/intelligence/regenerate` 用读权限） |
| 分支 | `claude/zen-turing-azudvx-fix21`；开工时合入 main `07c02358`（含 FIX-17 #548） |
| 性质 | 修既有的越权。零 schema、零新模型调用、没有新增出站、没有新队列。**没有开关——合并即在生产生效** |

## 1. 问题

`src/app/api/projects/[id]/` 下 176 个路由文件、251 个处理函数里，FIX-17 合并后还有 6 个只查「已登录」（`withAuth`）：

| 路由文件 | 方法 | 做什么 | 界面上谁在调 |
|---|---|---|---|
| `ai-bid-package/route.ts` | `GET` | 返回一键投标方案任务的全部步骤输出（文档摘要、情报、报价草稿含报价与成本价、询价邮件草稿）与原始报错 | 只有平台管理员能看到这个面板 |
| `ai-bid-package/route.ts` | `POST` | 在项目下建一个 4 步的 AgentTask | 同上 |
| `ai-bid-package/run-step/route.ts` | `POST` | 执行下一步（调模型生成摘要 / 情报 / 报价 / 邮件草稿），把输出与原始报错放进响应；最后一步给全体成员发高优先级通知 | 同上 |
| `intelligence/regenerate/route.ts` | `POST` | 调模型重算情报（同时把审核结论重置为「AI 已生成」、清空审核人 / 时间 / 备注 / 评分），刷新结构化摘要，按调用者的可见范围重建相似项目 | 情报卡「重新分析」，所有能打开情报页签的成员 |
| `intelligence/review/route.ts` | `GET` | 读情报审核状态、备注、评分、审核人、推荐、风险、匹配分、报告元数据 | 没有界面调用 |
| `intelligence/review/route.ts` | `PATCH` | 改审核状态（含「已通过」「已交付」）、备注、评分，记下审核人 | 情报卡审核面板，所有能打开情报页签的成员 |

改动前的代码上用隔离库实测（§5.2）：另一个组织的管理员、同组织非成员、inactive 项目成员、inactive 原组织管理员都拿到 200——读到了报价草稿里的价格标记串与审核人、把审核结论改成 `approved`、让情报被重算并清空审核结论、把相似项目清空、建了新任务、让假模型服务收到请求。

## 2. 做了什么

### 2.1 每个处理函数的检查级别

| 路由文件 | 方法 | 级别 | 守卫 | 先例 |
|---|---|---|---|---|
| `ai-bid-package/route.ts` | `GET` | 读，非平台管理员只拿安全视图 | `requireProjectReadAccess` | `/api/agent/tasks` 列表与详情（读，非平台管理员只拿安全视图）；招标分析结果（读） |
| `ai-bid-package/route.ts` | `POST` | 写 | `requireProjectWriteAccess` | `/api/agent/tasks` 建任务（管理 = 写）；发起招标分析（写） |
| `ai-bid-package/run-step/route.ts` | `POST` | 写，非平台管理员只拿安全视图 | `requireProjectWriteAccess` | `/api/agent/tasks/:taskId/execute`（管理 = 写）；重新分析（写） |
| `intelligence/regenerate/route.ts` | `POST` | 读（GATE 3 = A） | `requireProjectReadAccess` | FIX-17 后的 `process-next`（读，同一个情报生成函数）；`ai-summary` / `progress-summary` / `checklist` 的 `POST`（读） |
| `intelligence/review/route.ts` | `GET` | 读 | `requireProjectReadAccess` | 项目详情 `GET`（读）本来就整行返回情报 |
| `intelligence/review/route.ts` | `PATCH` | 读（GATE 2 = A） | `requireProjectReadAccess` | `progress-summary/review` `PATCH`（读） |

- 读权限放行：平台 super_admin、项目负责人、项目所在组织 active 的所有者或管理员、active 项目成员（不论角色）；其余登录用户 403「无权查看该项目」。
- 写权限放行：平台 super_admin、项目负责人、组织 active 所有者或管理员；项目有所属组织时再加项目管理员；其余登录用户（含操作员、只读等普通成员）403「无权修改该项目」。
- 两者共同：未登录或账号已停用 401「未登录」；项目不存在、或非 super_admin 遇到未分发项目 404「项目不存在」。
- 每处检查都是处理函数的第一步：`regenerate` 放在 `try` 之外（否则守卫抛错会被吞成 500）；`run-step` 与 `PATCH review` 在读请求体之前。`withAuth` 外壳保留（统一异常兜底与 `x-request-id`）。
- `POST …/ai-bid-package` 原有的「项目不存在」查询保留不删（后续任务第 7 条）；`run-step` 调技能仍不传组织（design D8）。

### 2.2 安全视图给了谁、裁掉了什么（GATE 1 = C）

- 谁算平台管理员：守卫返回的用户 `isPlatformAdmin`（super_admin），与 `/api/agent/tasks/:taskId` 同一判断；super_admin 以岗位预览身份访问时角色视同普通用户，同样只拿安全视图。
- `GET …/ai-bid-package`，非平台管理员：每一步 `data` 为空对象；`error` 在这一步失败或带报错时是固定提示「处理失败，请稍后重试或联系管理员」，否则 `null`。其余字段不变（步骤 ID、序号、技能、标题、动作标签、状态、是否成功、摘要、起止时间、耗时，任务级状态、步骤数、完成数、时间）。
- `POST …/ai-bid-package/run-step`，非平台管理员：正常执行分支的 `data` 为空对象；三处返回步骤结果的响应（未知技能、技能抛错、正常执行）在失败或带报错时 `error` 是同一句固定提示，成功时不带 `error`；其余字段不变。**库里照旧写入完整输出与原始报错**，平台管理员看得到。
- 平台管理员：两个接口照旧拿到原始输出与原始报错。
- `POST …/ai-bid-package` 的响应只有任务 ID、类型、步骤的技能与标题，不含内幕，没动。
- 固定提示与 `src/lib/agent-tasks/dto.ts` 的 `SAFE_STEP_ERROR_MESSAGE` 一字不差，但**没有导入**：`src/lib/agent-tasks` 是 runtime-architecture 冻结面，新文件导入它会让 `scripts/test-runtime-architecture.sh` 失败（§4 第 3 条）。两个路由各照抄一句（注释写明出处），一致性由隔离库测试导入 `dto.ts` 比较。

### 2.3 新增测试

- `src/lib/projects/__tests__/project-routes-guard.test.ts`（不用数据库，进 CI 子集）：用 TypeScript 编译器按语法树检查整个 `src/app/api/projects/[id]/` 下每个 `route.ts` / `route.tsx` 的每个处理函数（design D9 第 1–10 条），守卫名单 13 个（按来源模块 + 原始导出名认，带出处行号与判定说明），例外名单 1 个（已下线的 `inquiries/batch-followup` `POST`，按「只导入 next/server、没有 db、没有 await、返回 410」检查）；检查器自测 39 项（反例 30、正例 9，含例外名单的 6 项）。
  - **以后新加的接口写法合规就通过，不用改测试里的任何名单**：测试每次现场枚举目录；数目只断言下限（≥ 170 个文件、≥ 240 个处理函数）。认 `{ params }` 解构后 `await params` 的写法（`src/app/api/projects/[id]/route.ts`，FIX-17 那份的检查器会把它误判成「第一个 await 不是守卫」，那份只扫 `files/`，这份扫全目录、没有这个误报）；认先判开关（不 await、不碰数据）再取参数、再不带条件地调守卫并紧接着检查的写法——把并行 BIDPAGE 分支的 `bid-page-summary/route.ts` 临时放进目录跑过一次，按合规通过，没进仓库。
- `src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts`（隔离库执行，否则跳过）：直接调路由导出的处理函数（带 `createSession` 签的会话 cookie），本机 OpenAI 兼容假服务计数，逐字段快照，通知按 `projectId` + `sourceKey` 前缀轮询；114 项，覆盖规格 `projects/intel-bidpackage-access` 的每条 Scenario。夹具见 design D10；比 design 多了两类：「下一步是未知技能」的任务（看执行失败时报错给谁看，不调模型），以及 super_admin 自己执行最后一步（响应带原文）。
- 两个测试都注册进 `scripts/test-all.sh`（FIX-17 两条之后）；守卫测试同时进 `scripts/test-ci-unit.sh`。`ci/test-registry-baseline.txt` 不加行。
- FIX-17 的 `files-route-guard.test.ts` 保留不改，与新的目录守卫并存（design D9）。

## 3. 需要你知道的取舍

- **只读成员能经「重新分析」清空审核结论（GATE 3 = A 的已知后果，design D4）**：项目里任何 active 成员（含只读）点一次「重新分析」，情报的审核结论会被重置为「AI 已生成」，审核人、审核时间、备注、评分一起清空，找不回、没有审计；项目成员但不是该组织成员的人点，相似项目名单会按他的可见范围重建、变短。这两条今天对任何登录账号都成立，本次之后缩小到项目成员。真正的修法在重算本身（后续任务第 1、3 条）。
- **审核追溯性有限（GATE 2 = A）**：所有项目成员（含只读）都能把情报标成「已通过」「已交付」，审核人记的是本人；只改备注、评分或改成 `in_review` 不记人；没有审计（后续任务第 6 条）。
- **价格仍能从别处读到**：非平台管理员在一键投标方案接口上拿不到报价草稿了，但能读项目的人仍能从询价与旧报价单接口读到价格与内部成本（后续任务第 8 条，design「留给 GATE」第 1 条的事实部分）。
- **写权限改口径影响谁**：项目里的操作员、测试、财务审核、只读成员，以及没有所属组织的项目里的项目管理员，不能再用脚本或手工请求建一键投标方案任务、执行步骤；他们在界面上本来就看不到这个面板。
- **守卫测试靠读源码判断先后**：处理函数把读写藏进一个在守卫之前、且不需要 `await` 的本地函数里，它认不出来；行为由隔离库测试兜底。新路由用了名单外的守卫（例如新写一个包装守卫），或想按请求内容在 `if` 里选守卫级别，测试会失败并指出位置——改用名单里的守卫、把新守卫连同出处加进名单，或先不带条件地调读权限守卫再在分支里调写权限守卫（`join-brief` 的写法）。

## 4. 与四件套不一致、已改四件套的地方

1. **design D9 第 5 条**：原文要求拒绝时 `return x`（原样返回守卫结果）。实测这会对两个已有守卫的处理函数误报：`tender-intel/sourcing` `GET` 与 `tender-rfq/attachment` `GET` 在拒绝时把非 401 换成 404 / 提示页（`return access.status === 401 ? access : …`）。它们符合规格「不通过时处理函数返回拒绝响应，中间不做别的事」。改为：`if` 分支里只有一条 `return`，返回语句里不 `await`、不碰第 3 条列的东西，返回的可以是 `x` 或换成的另一个拒绝响应；自测加了「拒绝分支里先读写库再返回」的反例与「换成另一个拒绝响应」的正例。起草时的原型用的是 FIX-17 的正则（`return\s+access\b` 恰好匹配 `return access.status …`），所以当时 0 误报。
2. **design D9 第 4 条**：写清「取路由参数」认的是处理函数第二个参数的 `.params`（名字不限）或第二个参数解构出的 `params`；「读请求体」认的是第一个参数上的 `json / formData / text`。
3. **design D12、Non-Goals，tasks 2.1 / 2.2**：原文是「直接导入 `dto.ts` 的固定提示与报错脱敏」。`bash scripts/test-runtime-architecture.sh` 因此失败：`NEW_FROZEN_MODULE_IMPORTER_FORBIDDEN [agent-tasks-legacy]`（`src/lib/runtime-architecture/guards.ts` 的 `FROZEN_IMPORT_TARGETS`；baseline 里这个冻结面只有 1 个既有消费者）。没有改 baseline（那等于给冻结面加消费者），改成两个路由各照抄一句固定提示、按 `sanitizeListStepError` 同一口径判断，对外行为不变；提交 `617b1185`。
4. design D9「起草与复审时的核对」补一行实现时的数字（176 / 251，只有本次 6 个不过；BIDPAGE 的新接口按合规通过）。

都不改变范围或对外行为。`OPENSPEC_TELEMETRY=0 openspec validate project-intel-bidpackage-access --strict` 仍 valid。

## 5. 验证

### 5.0 将要触碰模块的基线（tasks 1.1）

- `git log --oneline --merges origin/main` 里有 `68bc4133 Merge pull request #548`；`git merge-base --is-ancestor origin/main HEAD` 退出码 0；`npx tsx src/lib/projects/__tests__/files-route-guard.test.ts` 17 / 0。
- `scripts/test-all.sh` 里 `src/lib/projects/`、`src/lib/agent-core/`、`src/lib/agent-tasks/`、`src/lib/files/` 的已注册测试共 33 条，改动前 **33 条全部通过**（隔离库 `qy_iso_d`；其中 FIX-17 隔离库测试 60 / 0、AgentTask DTO 安全投影 23 / 0）。改动后：见 §5.3。

### 5.1 目录守卫测试（`npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts`）

改动前（最终版测试文件，对 `git archive origin/main "src/app/api/projects/[id]"` 解出的路由目录副本跑；在提交 `742eb68a` 上第一次跑是 43 / 1，之后补了一条「例外文件不存在」的自测）：退出码 1，**44 通过、1 失败**；检查器自测 39 项全部通过；真实目录 176 个文件、251 个处理函数，**只点名本次 6 个**，其余 244 个通过、1 个按例外通过（真实目录零误报）：

```
  ✗ 每个处理函数都先过项目级权限检查（通过 244 个，例外 1 个，不过 6 个） 6

漏了项目权限检查（或检查写得不牢）的处理函数：
  - src/app/api/projects/[id]/ai-bid-package/route.ts POST：没有调用名单里的项目权限守卫（守卫按导入它的模块与原始导出名认定）
  - src/app/api/projects/[id]/ai-bid-package/route.ts GET：没有调用名单里的项目权限守卫（守卫按导入它的模块与原始导出名认定）
  - src/app/api/projects/[id]/ai-bid-package/run-step/route.ts POST：没有调用名单里的项目权限守卫（守卫按导入它的模块与原始导出名认定）
  - src/app/api/projects/[id]/intelligence/regenerate/route.ts POST：没有调用名单里的项目权限守卫（守卫按导入它的模块与原始导出名认定）
  - src/app/api/projects/[id]/intelligence/review/route.ts GET：没有调用名单里的项目权限守卫（守卫按导入它的模块与原始导出名认定）
  - src/app/api/projects/[id]/intelligence/review/route.ts PATCH：没有调用名单里的项目权限守卫（守卫按导入它的模块与原始导出名认定）

FIX-21 project routes guard: 44 passed, 1 failed
```

改动后：退出码 0，**45 通过、0 失败**（`✓ 每个处理函数都先过项目级权限检查（通过 250 个，例外 1 个，不过 0 个）`）。

### 5.2 隔离库 + HTTP 测试

命令：`NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=…/qy_iso_d DIRECT_URL=… npx tsx src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts`

改动前（路由未改）：退出码 1，**50 通过、64 失败**。失败的是全部被拒用例与安全视图用例，节选：

```
  ✗ 别的组织的管理员调 getBidPackage → 403「无权查看该项目」 — {"status":200,"body":{"taskId":"…","status":"completed",…
  ✗ 别的组织的管理员调 patchReview → 403「无权查看该项目」 — {"status":200,"body":{"reportStatus":"approved","reviewedBy":"f21_outsider …","reviewNotes":"hijack",…
  ✗ 别的组织的管理员调 runStep → 403「无权修改该项目」 — {"status":200,"body":{"done":false,"stepIndex":0,"skillId":"document_summary",…,"summary":"文档摘要完成：1/1 篇成功",…
  ✗ 被拒的执行（下一步是文档摘要、项目里有待摘要文件）与被拒的重新生成：假模型服务收到 0 次请求 — ["POST /v1/chat/completions","POST /v1/chat/completions"]
  ✗ 被拒的重新生成：情报记录（含审核状态、备注、评分、审核人）与请求前一致 — {…"recommendation":"review_carefully",…   ← 已审核通过的情报被重算、审核结论被清空
  ✗ 被拒的重新生成：相似项目记录没被删、没被重建 — []
  ✗ 没有所属组织、已分发的项目里，项目管理员调 POST …/ai-bid-package → 403「无权修改该项目」 — {"status":200,…
  ✗ 项目负责人对未分发的项目调 run-step → 404「项目不存在」 — {"status":200,…
  ✗ 只读成员：每一步的 data 都是空对象 — [{"processed":0},…,{"draft":{"lineItems":[{"productName":"PRICE_MARK_…","unitPrice":731984.27,"costPrice":512340.11}],…
  ✗ 项目管理员执行失败的一步（未知技能）：error 是固定提示 — {…"error":"未知技能: no_such_skill_…"}
  ✗ 整个测试假模型服务一共收到 0 次请求 — ["POST /v1/chat/completions", …]
FIX-21 project intel / bid package access (DB + HTTP): 50 passed, 64 failed
```

改动后：退出码 0，**114 通过、0 失败**；连跑 3 次结果一致（3 × 114 / 0）；假模型服务整个测试 0 次请求；清理后隔离库里没有残留夹具。

FIX-17 两个测试改动后仍通过：守卫 17 / 0，隔离库 60 / 0。

### 5.3 门禁

| 门禁 | 命令 | 结果 |
|---|---|---|
| 全量 | `npm test`（新建的空库 `qy_full_fix21`，`prisma migrate deploy` 后跑；`> /home/user/full-project-intel-bidpackage-access.log`） | **709 / 719 通过，10 失败**，失败清单与本机 main 基线逐条相同（见下）；FIX-21 两条：守卫 45 / 0、隔离库 114 / 0；FIX-17 两条：17 / 0、60 / 0 |
| CI 子集 | `env -u DATABASE_ENVIRONMENT DATABASE_URL=…/ci DIRECT_URL=…/ci JWT_SECRET=ci-only-jwt-secret-not-for-production NODE_ENV=test npm run test:ci` | PASS（`CI unit subset PASS`，含新的目录守卫测试） |
| 类型 | `npm run typecheck` | 退出码 0 |
| lint | `npm run lint:baseline` | PASS（current errors=38，baseline 53；无新增 error fingerprint）；6 个改动 / 新增文件单独 `npx eslint` 0 条 |
| 测试注册 | `bash scripts/check-test-registry.sh` | OK：已注册 686 个；历史欠账基线剩余 66 条（不变） |
| 运行时架构 | `bash scripts/test-runtime-architecture.sh` | PASS（repo conformance 9 / 0；改成照抄固定提示之前是 8 / 1，§4 第 3 条） |
| OpenSpec | `OPENSPEC_TELEMETRY=0 openspec validate project-intel-bidpackage-access --strict` | valid |
| 模块测试 | §5.0 的 33 条 | 改动后 33 条仍全部通过、各自通过数与改动前相同；加上本次两条共 35 / 35 |

全量的 10 项失败（`grep "⚠️ .* 失败$"`），与本机 main 基线的 10 项逐条相同，没有多出：

```
  ⚠️  来信观察 DB 端到端（MAIL-2；隔离库执行，否则跳过） 失败
  ⚠️  Sunny 工艺单 签字→草稿→门禁→确认→导出 DB 端到端（隔离库执行，否则跳过） 失败
  ⚠️  Phase3A-3 Approvals Smoke 失败
  ⚠️  Phase3A-4 Governance Smoke 失败
  ⚠️  Phase3A-4 Acceptance 失败
  ⚠️  Autopilot A2-P0 Isolated E2E 失败
  ⚠️  Phase3A-5 Overview Acceptance 失败
  ⚠️  T4 授标情报真实 Postgres 矩阵 失败
  ⚠️  Quote Operations 客户报价 PDF 分页布局（Chromium；缺失则 SKIP） 失败
  ⚠️  招标询价 自动起草第 1 轮 DB 端到端（隔离库执行，否则跳过，RFQ-AUTO-2） 失败
```

说明：

- 全量库按 impl 约定应先 `prisma migrate reset --force --skip-seed`；Prisma 对 AI 代理执行 `migrate reset` 要求人当面同意，所以改为删掉并重建这个只给本 change 用的库 `qy_full_fix21`、再 `prisma migrate deploy`（42 个迁移全部应用），效果等同于 reset 后的空库。
- 第一次全量在「固定提示从冻结面导入」的版本上开跑后中途停掉（§4 第 3 条改代码），整库重建后在最终代码上重跑，上面是重跑的结果。
- 「被拒的执行：项目成员没有新通知」这一条在改动前的代码上也通过：只有最后一步发通知，别的组织的管理员那一次执行的是第一步；被拒后不发通知由守卫在最前面（守卫测试）与全部被拒用例之后的整体快照（含项目甲的通知数，改动前失败）共同证明。

## 6. 没验证到的

- 生产库上的「合并后只读查询」没跑（§9 第 1 条，要 Lucas 在生产库跑）。
- super_admin 以岗位预览身份访问时只拿安全视图：没有单独的测试用例（要造岗位预览的夹具）。实现上判断的是守卫返回的用户，岗位预览期间 `getCurrentUser` 把平台角色换成 `user`（`src/lib/auth/index.ts:48-57`），与 `/api/agent/tasks` 同一路径。
- 真实模型路径：放行用例都挑了不调模型的路径（项目丙没有可用文档、执行的是无事可做的文档摘要或未知技能）；被拒用例证明的是「不调模型」。有权限的人执行报价 / 邮件草稿步骤时调模型的行为本次没改，也没在测试里跑。
- 界面：没有起应用点；界面不改，两个返回步骤内容的接口在界面上只对平台管理员挂载（design Context「界面上谁在调」）。合并后的点检见 §9 第 3 条。

## 7. 回退办法

没有开关、没有数据迁移。回退就是 revert 这一个 PR；本 change 不改任何数据，revert 后不需要任何数据修复。

## 8. 后续任务（已登记进 TASKFLOW，编号「待定」）

1. 重新生成情报会清掉人工审核结论（Lucas 2026-11-22 点名）：`src/lib/files/intelligence-extractor.ts:346-369` 重算写库时把 `reportStatus` 改回 `ai_generated`，清空审核人 / 时间 / 备注 / 评分，不留痕；「重新分析」与「上传新文件 + 逐步处理」（`files/process-next`）都走这里。改成保留已有审核结论，或先留痕。
2. 技能与情报生成调模型不带组织，月度 AI 费用预检对一键投标方案 `run-step` 与情报生成都不生效：技能上下文没有 `orgId`（`src/lib/agent/types.ts:72-78`），`src/lib/agent/skills/quote.ts:135`、`src/lib/agent/skills/email-draft.ts:117`、`src/lib/files/intelligence-extractor.ts:96` 调模型不传，预检（`src/lib/ai/client.ts:173-184`）要 `orgId` 与 `userId` 都在才查。
3. 重新生成情报按调用者的可见范围重建全项目共享的相似项目：先删后建（`src/lib/projects/similarity.ts:204-217`），候选只取调用者能看到的同组织项目（`:35-49`）。
4. 已离开组织、但项目成员关系仍 active 的人照样过项目读权限，仍是项目负责人的还过写权限：`src/lib/projects/access.ts:81`、`:152`、`:160` 不看组织成员身份，影响全部项目接口。
5. 没有所属组织的项目里，项目管理员不过写权限：`src/lib/projects/access.ts:93-106` 只在项目有 `orgId` 时认项目管理员；要不要放开待定。
6. 情报审核结论的修改不写审计：`PATCH /api/projects/:id/intelligence/review` 改状态 / 备注 / 评分不留记录，只在改成通过 / 需修改 / 已交付时记审核人。
7. 删掉 `POST /api/projects/:id/ai-bid-package` 里守卫之后不会再命中的「项目不存在」查询。
8. 能读项目的人（含只读成员、不是项目成员的组织管理员）能从询价与报价接口拿到价格与内部成本：`GET …/inquiries`（`src/lib/inquiry/service.ts:191-199`）、旧报价单 `GET …/quotes/:quoteId`（`src/app/api/projects/[id]/quotes/[quoteId]/route.ts:9-25`），新报价引擎的「内部成本」级别对所有项目角色开放（`src/lib/quote-engine/access.ts:31`、`:43`）；要不要按财务查看权裁剪待定。

TASKFLOW「| 待定 |」行数：改动前 0，改动后 8。

## 9. 合并后要人做的事

1. **只读查询（Lucas 在生产库跑）**：看合并前「建一键投标方案任务」这个缺口有没有被用过。执行步骤、查看、审核、重新分析都不记调用者，查不到；建任务记了发起人（`AgentTask.createdById`）。下面列出发起人既不是 super_admin、也不是该项目负责人、该项目 active 成员、项目所在组织 active 所有者或管理员的任务（按**现在**的成员关系判断，查到的行要人看一眼当时是不是成员）。查到就把任务 ID 与人报给 Evan 定怎么处理；查不到就在本节补「0 行」。

   ```sql
   SELECT t.id AS task_id, t."projectId" AS project_id, t."createdById" AS created_by_id,
          u.email, u.role, t.status, t."createdAt" AS created_at
   FROM "AgentTask" t
   JOIN "Project" p ON p.id = t."projectId"
   JOIN "User" u ON u.id = t."createdById"
   WHERE t."taskType" = 'ai_bid_package'
     AND u.role <> 'super_admin'
     AND p."ownerId" <> t."createdById"
     AND NOT EXISTS (
       SELECT 1 FROM "ProjectMember" pm
       WHERE pm."projectId" = p.id AND pm."userId" = t."createdById" AND pm.status = 'active')
     AND NOT EXISTS (
       SELECT 1 FROM "OrganizationMember" om
       WHERE p."orgId" IS NOT NULL AND om."orgId" = p."orgId" AND om."userId" = t."createdById"
         AND om.status = 'active' AND om.role IN ('org_owner', 'org_admin'))
   ORDER BY t."createdAt";
   ```

   在隔离库上跑过一次，语法正确（0 行）。

2. **重新分析的项目名单**：没有。本 change 不改任何数据；情报审核与「重新分析」没有审计记录，查不出过去谁改过、谁点过，所以不出名单。
3. **合并后点一遍（Lucas）**：用 super_admin 打开一个项目的「内部 · AI 任务运行时」面板，一键投标方案照常显示全部内容、能执行一步；用该项目的只读成员打开情报页签，审核按钮与「重新分析」照常可用。「重新分析」会清掉审核结论，挑一个情报还没人审过的项目点。

## 10. 与八条硬纪律的关系

1. 零 schema：遵守。没有新 model / 字段 / migration；测试只往隔离库写夹具并清理。
2. 出站先审批：不涉及。`run-step` 最后一步发的是站内通知；邮件草稿步骤只起草不发送；本次只让无关的人触发不了它们。
3. 禁止第三套队列：遵守。没有新队列 / 调度 / lease；runtime-architecture 门禁 PASS，没有给冻结面加消费者。
4. 脱敏：不涉及 Muse 通道。被拒的响应不带报价草稿与审核结论；非平台管理员拿到的步骤输出整段换成空对象、原始报错整段换成固定提示（整段替换，不做局部遮盖）。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。没有新增模型调用；无关的人以后触发不了情报重算与技能执行，模型调用只会少。
8. 测试注册：遵守。两个新测试注册进 `scripts/test-all.sh`，守卫测试同时进 `scripts/test-ci-unit.sh`；`check-test-registry.sh` OK，基线不加行。

## 11. 提交

| 提交 | 内容 |
|---|---|
| `046c0e35` | 合入 main `07c02358`（含 FIX-17 #548） |
| `742eb68a` | tasks 1.1–1.3：两个测试先行，路由未改；design D9 第 4、5 条按实现写清 |
| `c28d1cab` | tasks 2.1–2.3：六个处理函数补守卫；一键投标方案两个接口的安全视图 |
| `617b1185` | 固定提示不再从冻结面 `src/lib/agent-tasks` 导入（runtime-architecture 门禁）；design D12 / tasks 2.1、2.2 按实现改写 |
| （本提交） | tasks 3.1–3.2：报告与 TASKFLOW（FIX-21 一行 `[~]` + 8 条「待定」后续任务）；守卫测试补「例外文件不存在」自测（44 → 45） |

## 12. 多维审查

（由协调会话补）
