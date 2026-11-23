# FIX-21 报告：项目情报与一键投标方案的六个接口补上项目权限检查

> **白话说明（合并后谁会发现什么变了）**：这次只给后台六个接口补上了「是不是这个项目的人」的检查，界面一个字没改。项目成员、负责人、组织管理员和平台管理员在界面上用起来和以前完全一样：情报卡的「重新分析」和审核按钮照常能点；「一键投标方案」面板本来就只给平台管理员看，平台管理员照旧看到全部内容。以前别的组织或与项目无关的账号，只要知道项目编号就能读到报价草稿（含报价和成本价）、询价邮件草稿和情报审核结论，能用这个项目的数据跑模型、把审核结论改成「已通过」或清空、清空相似项目、给全组发通知；现在会被直接拒绝。唯一可能有人察觉的变化：用脚本调一键投标方案接口的负责人、组织管理员或项目成员，看到的步骤内容变成空的、失败原因变成一句固定提示；项目里的操作员、只读成员用脚本建一键投标方案任务或执行步骤会被拒绝。

| 项 | 值 |
|---|---|
| change | `project-intel-bidpackage-access`（新能力 `projects/intel-bidpackage-access` 11 条要求、`projects/route-access-guard` 6 条要求） |
| TASKFLOW | FIX-21（Phase F（续）— 情报串联表，FIX-17 之后），另登记 8 条「编号待定」后续任务 |
| 来源 | 2026-11-22 审查 FIX-17 时逐个核对 `src/app/api/projects/[id]/` 下全部路由发现；Evan 2026-11-22 批准开这个 change |
| GATE | 「留给 GATE」三条，Lucas 2026-11-22 定：第 1 条 **C**（一键投标方案两个接口对非平台管理员只给安全视图）、第 2 条 **A**（`PATCH …/intelligence/review` 用读权限）、第 3 条 **A**（`POST …/intelligence/regenerate` 用读权限） |
| PR | #554，2026-11-23 合并（合并提交 `212613ec`）；归档 `openspec/changes/archive/2026-11-23-project-intel-bidpackage-access/`；归档后 `openspec validate --specs --strict` 151 / 151 |
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
- 多维审查后加（design D13）：`GET …/ai-bid-package?taskId=…` 与 `run-step` 只认本项目的 `ai_bid_package` 任务。同项目里别的类型的 AgentTask（如 `custom_flow`）按「任务不存在」404，不返回、不执行、不发通知；审查实测原来能借 `run-step` 执行同项目里的 `custom_flow` 任务。

### 2.2 安全视图给了谁、裁掉了什么（GATE 1 = C）

- 谁算平台管理员：守卫返回的用户 `isPlatformAdmin`（super_admin），与 `/api/agent/tasks/:taskId` 同一判断；super_admin 以岗位预览身份访问时角色视同普通用户，同样只拿安全视图。
- `GET …/ai-bid-package`，非平台管理员：每一步 `data` 为空对象；`error` 在这一步失败或带报错时是固定提示「处理失败，请稍后重试或联系管理员」，否则 `null`。其余字段不变（步骤 ID、序号、技能、标题、动作标签、状态、是否成功、摘要、起止时间、耗时，任务级状态、步骤数、完成数、时间）。
- `POST …/ai-bid-package/run-step`，非平台管理员：正常执行分支的 `data` 为空对象；三处返回步骤结果的响应（未知技能、技能抛错、正常执行）在失败或带报错时 `error` 是同一句固定提示，成功时不带 `error`；其余字段不变。**库里照旧写入完整输出与原始报错**，平台管理员看得到。
- 平台管理员：两个接口照旧拿到原始输出与原始报错。
- `POST …/ai-bid-package` 的响应只有任务 ID、类型、步骤的技能与标题，不含内幕，没动。
- 固定提示与 `src/lib/agent-tasks/dto.ts` 的 `SAFE_STEP_ERROR_MESSAGE` 一字不差，但**没有导入**：`src/lib/agent-tasks` 是 runtime-architecture 冻结面，新文件导入它会让 `scripts/test-runtime-architecture.sh` 失败（§4 第 3 条）。两个路由各照抄一句（注释写明出处）。一字不差由目录守卫测试按源码文本比较，测试在 CI 子集里跑，不导入冻结面；隔离库测试也拿响应和 `dto.ts` 比。

### 2.3 新增测试

- `src/lib/projects/__tests__/project-routes-guard.test.ts`（不用数据库，进 CI 子集），共 98 项（交叉验证 F1–F6 补齐后；多维审查后是 74 项）。它用 TypeScript 编译器按语法树检查整个 `src/app/api/projects/[id]/` 下每个 `route.ts` / `route.tsx` 的每个处理函数，规则见 design D9 第 1–13 条，多维审查后收紧：
  - **取路由参数、读请求体之后的第一步就是守卫**：
    - 守卫之前只允许取路由参数、读请求体（含 `.catch(() => 常量)` 与 `join-brief` 的 `try` / 400）、取文件常量的别名；
    - 任何表达式语句、提前 `return`、`if`、`await` 别的调用都判失败；
    - `db` 及其别名导入出现在守卫之前就点名「碰了数据库」。
  - **拒绝分支**只能返回守卫结果，或 401 / 403 / 404 的常量响应（含 `tender-intel/sourcing` 的三元、`tender-rfq/attachment` 的 `messagePage`）；返回 200、先调用别的函数都判失败。
  - **按导入来源认定**：
    - 守卫、`isAccessError`、`NextResponse` 都按导入来源认，处理函数里同名的局部声明判失败；
    - 包装函数只认 `withAuth`；解构导出判失败。
  - **项目 ID**：
    - 必须是 `const` 解构路由参数里 `id` 得到的变量，或 `p.id`；
    - 不得重新赋值；守卫之后不得再取路由参数；
    - 返回响应的守卫，第一个参数必须是处理函数收到的请求。
  - **名单**：
    - 守卫名单 13 个（按来源模块 + 原始导出名认，带出处行号与判定说明）；
    - 例外名单 1 个（已下线的 `inquiries/batch-followup` `POST`）；
    - **守卫前预处理名单 3 个**（§3、§4 第 5 条），名单只减不增。
  - **自测与比较**：
    - 检查器自测 86 项；真实目录 9 项；
    - 一键投标方案两个路由照抄的固定提示与 `dto.ts` 按源码文本比较 3 项。
  - **交叉验证补的**（F1–F6，只改测试与文档，没有改路由）：
    - 守卫之前的解构不许带默认值或计算键，处理函数参数不许带默认值；碰了数据，不论严格还是名单都判失败；
    - 守卫前预处理名单冻结成 3 项集合（新接口加进去就失败），名单里的处理函数守卫前只许调用运行环境闸、`String`、`new Set`、`.has`、`.includes`，守卫前只许返回闸的结果或 4xx / 5xx；
    - 命名空间导入 `db`、别的模块的 prisma 客户端、`PrismaClient` 都算数据库；
    - 导出的处理函数必须 `const`，模块顶层不许重新赋值；
    - 拒绝页辅助函数查正文（不碰数据、不调别的函数、只返回 401 / 403 / 404）；
    - 守卫之后不以任何方式再用路由参数（含 `.then(…)`、把 `ctx` 交给别的函数）；
    - 枚举 `route.ts / .tsx / .js / .jsx / .mjs`。
  - **以后新加的接口写法合规就通过，不用改测试里的任何名单**：测试每次现场枚举目录，数目只断言下限（≥ 170 个文件、≥ 240 个处理函数）。
    - 认 `{ params }` 解构后 `await params` 的写法（`src/app/api/projects/[id]/route.ts`）。FIX-17 那份检查器会把它误判成「第一个 await 不是守卫」；那份只扫 `files/`，这份扫全目录，没有这个误报。
    - 认 BIDPAGE `bid-page-summary` 现行版本（`9b0828ac`）的写法：守卫第一步，之后才判开关。
    - 「先判开关再调守卫」现在是反例。
- `src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts`（隔离库执行，否则跳过），共 148 项，覆盖规格 `projects/intel-bidpackage-access` 的每条 Scenario。
  - **做法**：直接调路由导出的处理函数（带 `createSession` 签的会话 cookie）；本机 OpenAI 兼容假服务计数；逐字段快照；通知按 `projectId` + `sourceKey` 前缀轮询。夹具见 design D10。
  - **多维审查后补的用例**：
    - 同项目里的 `custom_flow` 任务：404，不执行，不发通知；
    - `run-step` 的两条失败路径，用专用项目「模」走假模型服务：
      - 报价草稿回一段不是 JSON 的原文，技能返回 `success=false`，报错里夹带模型原文；
      - 询价邮件草稿回 400，技能抛错；
      - 两条路径都是：非平台管理员拿固定提示、响应里没有标记串，super_admin 拿原文，库里存原文；
    - 未知报价动作（失败但技能没给报错）；
    - 「带报错但状态是已完成」与「状态是失败但没有报错」的边界步骤；
    - 以岗位预览身份访问的 super_admin 只拿安全视图（另建一个按岗位模式的组织，签了真的预览 cookie）；
    - super_admin 对未分发项目放行（`GET` 与 `run-step`）；
    - 没有组织的项目里，只读成员有读权限；
    - 测试、财务审核两个角色建任务 / 执行被拒（403）；
    - 别的组织的人执行一个只剩最后一步的任务：403，不发通知。改动前这一步会让任务完成，并发出 7 条通知。
  - **模型请求**：被拒用例 0 次；整个测试只有项目「模」的 4 次。
- 两个测试都注册进 `scripts/test-all.sh`（FIX-17 两条之后）；守卫测试同时进 `scripts/test-ci-unit.sh`。`ci/test-registry-baseline.txt` 不加行。
- FIX-17 的 `files-route-guard.test.ts` 保留不改，与新的目录守卫并存（design D9）。

## 3. 需要你知道的取舍

- **只读成员能经「重新分析」清空审核结论（GATE 3 = A 的已知后果，design D4）**：项目里任何 active 成员（含只读）点一次「重新分析」，情报的审核结论会被重置为「AI 已生成」，审核人、审核时间、备注、评分一起清空，找不回、没有审计；项目成员但不是该组织成员的人点，相似项目名单会按他的可见范围重建、变短。这两条今天对任何登录账号都成立，本次之后缩小到项目成员。真正的修法在重算本身（后续任务第 1、3 条）。
- **审核追溯性有限（GATE 2 = A）**：所有项目成员（含只读）都能把情报标成「已通过」「已交付」，审核人记的是本人；只改备注、评分或改成 `in_review` 不记人；没有审计（后续任务第 6 条）。
- **价格仍能从别处读到**：非平台管理员在一键投标方案接口上拿不到报价草稿了，但能读项目的人仍能从询价与旧报价单接口读到价格与内部成本（后续任务第 8 条，design「留给 GATE」第 1 条的事实部分）。
- **写权限改口径影响谁**：项目里的操作员、测试、财务审核、只读成员，以及没有所属组织的项目里的项目管理员，不能再用脚本或手工请求建一键投标方案任务、执行步骤；他们在界面上本来就看不到这个面板。
- **守卫测试收紧后，新接口必须「取完参数第一步就是守卫」**：先判开关、先校验请求体再按内容选守卫级别、先过运行环境闸，都会被指出。
  - 新路由用了名单外的守卫（例如新写一个包装守卫），测试会失败并指出位置。处理办法：改用名单里的守卫，或把新守卫连同出处加进名单。
  - 新路由想按请求内容选守卫级别时，测试同样会失败。处理办法：先不带条件地调读权限守卫，再在分支里调写权限守卫（`join-brief` 的写法）。
- **守卫前预处理名单 3 个**：目录里已有 3 个处理函数在守卫之前先做了不碰数据、不 `await` 的预处理，审查时以为是 0 个：
  - `[id]` `PATCH`：运行环境隔离闸；
  - `finance/expenses/[expenseId]` `PATCH`：按请求体选权限；
  - `quote-engine/[quoteId]/status` `POST`：校验请求体，无效回 400，再选级别。
  - 不顺手改别的接口，所以列进名单（design D9 第 11 条）。名单里的处理函数在守卫之前仍然不能 `await`、不能碰数据。它们改成守卫第一步后，测试会提示删掉对应条目；新接口不进名单。改它们登记为后续任务第 13 条。
- **仍认不出的写法**见 design Risks「已知盲区」：
  - 名单里的守卫函数本身写错；
  - 守卫检查通过之后的行为；
  - 预处理名单里的不 `await` 调用里藏副作用；
  - 有副作用的 getter；
  - 目录以外按项目 ID 读写的接口。
  - 本次 6 个处理函数的行为由隔离库测试兜底。

## 4. 与四件套不一致、已改四件套的地方

1. **design D9 第 5 条**：原文要求拒绝时 `return x`（原样返回守卫结果）。实测这会对两个已有守卫的处理函数误报：`tender-intel/sourcing` `GET` 与 `tender-rfq/attachment` `GET` 在拒绝时把非 401 换成 404 / 提示页（`return access.status === 401 ? access : …`）。它们符合规格「不通过时处理函数返回拒绝响应，中间不做别的事」。改为：`if` 分支里只有一条 `return`，返回语句里不 `await`、不碰第 3 条列的东西，返回的可以是 `x` 或换成的另一个拒绝响应；自测加了「拒绝分支里先读写库再返回」的反例与「换成另一个拒绝响应」的正例。起草时的原型用的是 FIX-17 的正则（`return\s+access\b` 恰好匹配 `return access.status …`），所以当时 0 误报。
2. **design D9 第 4 条**：写清「取路由参数」认的是处理函数第二个参数的 `.params`（名字不限）或第二个参数解构出的 `params`；「读请求体」认的是第一个参数上的 `json / formData / text`。
3. **design D12、Non-Goals，tasks 2.1 / 2.2**：原文是「直接导入 `dto.ts` 的固定提示与报错脱敏」。`bash scripts/test-runtime-architecture.sh` 因此失败：`NEW_FROZEN_MODULE_IMPORTER_FORBIDDEN [agent-tasks-legacy]`（`src/lib/runtime-architecture/guards.ts` 的 `FROZEN_IMPORT_TARGETS`；baseline 里这个冻结面只有 1 个既有消费者）。没有改 baseline（那等于给冻结面加消费者），改成两个路由各照抄一句固定提示、按 `sanitizeListStepError` 同一口径判断，对外行为不变；提交 `617b1185`。
4. design D9「起草与复审时的核对」补一行实现时的数字（176 / 251，只有本次 6 个不过；BIDPAGE 的新接口按合规通过）。

多维审查后（修订清单 A1–A3，协调会话核实后定）又改了：

5. **规格 `projects/route-access-guard` 与 design D9 收紧**：
   - 改动：
     - 由「检查之前等待的异步调用只有两种」改成「取路由参数、读请求体之后的第一步就是项目守卫」，拆成 6 条要求；
     - 补「守卫之前提前 return」「守卫之前不等待完成的写库调用」「拒绝分支返回 200 或另调函数」「项目 ID 可被改写或重新取」等 Scenario；
     - design D9 第 1–13 条重写。
   - **和修订清单的前提不一样的地方**：清单说「这样收紧不新增任何一个不过的」，实测新增 3 个：
     - `src/app/api/projects/[id]/route.ts` `PATCH`：鉴权前先过运行环境隔离闸；
     - `finance/expenses/[expenseId]/route.ts` `PATCH`：守卫前按请求体算权限；
     - `quote-engine/[quoteId]/status/route.ts` `POST`：守卫前校验请求体、无效回 400。
   - 处理：按「不顺手改别的接口」，不改这 3 个文件。在守卫测试里加了一份「守卫前预处理名单」，规格加对应一条要求：
     - 名单逐条写理由，只减不增；
     - 名单里的处理函数在守卫之前额外只允许不含 `await`、不碰数据的 `const` 与 `if (…) return …`；
     - 它们改成守卫第一步后，测试会提示删掉对应条目；
     - 新接口不进名单。
   - 被否决：
     - 照字面收紧、让测试一直红；
     - 本 change 去改这 3 个接口（超范围）；
     - 对所有处理函数放宽（新接口又能先判开关再调守卫）。
   - 改这 3 个接口登记为后续任务第 13 条。**这一处请协调会话确认。**
6. **规格 `projects/intel-bidpackage-access`**：
   - 「其余字段照旧」补全：`action`、`taskType`、`totalSteps`、`completedSteps`、任务级 `success`、`run-step` 的 `done`；
   - 「一键投标方案只认本项目的任务」加「或不是一键投标方案任务」；
   - 补的 Scenario：
     - super_admin 对未分发项目放行；
     - 无组织项目的只读成员；
     - 测试 / 财务审核写权限 403；
     - 执行失败的四种情况；
     - 带报错未失败 / 失败无报错；
     - 岗位预览 super_admin；
     - 平台管理员执行失败拿原文；
     - 同项目里别的类型的任务；
     - 被拒执行只剩最后一步的任务不发通知。
   - 每条要求正文 ≤ 500 字（最长 462）。
7. **design D13（新）**：一键投标方案两个接口只认 `ai_bid_package` 任务。
8. **design D10、Risks、验证方式**：按新夹具、已知盲区、变异与归档演练改写。tasks 3.2 的后续任务第 6、7 条行号改成改动后的（`review/route.ts:84`、`:133-140`，`ai-bid-package/route.ts:29-35`），并新增第 9–13 条。

9. **交叉验证（F1–F6）后又改了**：
   - 守卫测试按 F1–F6 收紧（只改测试文件）；
   - 规格 `route-access-guard` 措辞对齐检查器真正做到的：
     - 守卫之前的解构不带默认值 / 计算键、参数不带默认值；
     - 拒绝页辅助函数本身不读写数据、只返回 401 / 403 / 404；
     - 检查之后不以任何方式再用路由参数；
     - 导出必须 `const`；
     - 命名空间导入与别的 prisma 客户端算数据库；
     - 预处理名单是那 3 个的子集，名单里守卫前只调用列明的函数、只返回闸的结果或 4xx / 5xx；
     - 补了 4 个 Scenario。
   - design D9 与「已知盲区」改写。盲区里新写了这几种：按方法名认的 `.has` / `.includes` / `.replace`、`toString` / getter 副作用、别的名字的数据库包装模块（严格规则下仍判失败，只是不点名「碰了数据库」）。

除第 5 条的预处理名单（不改对外行为，但和清单的前提不一样，已标出）外，都不改变范围或对外行为。`OPENSPEC_TELEMETRY=0 openspec validate project-intel-bidpackage-access --strict` 仍 valid。

## 5. 验证

### 5.0 将要触碰模块的基线（tasks 1.1）

- `git log --oneline --merges origin/main` 里有 `68bc4133 Merge pull request #548`；`git merge-base --is-ancestor origin/main HEAD` 退出码 0；`npx tsx src/lib/projects/__tests__/files-route-guard.test.ts` 17 / 0。
- `scripts/test-all.sh` 里 `src/lib/projects/`、`src/lib/agent-core/`、`src/lib/agent-tasks/`、`src/lib/files/` 的已注册测试共 33 条，改动前 **33 条全部通过**（隔离库 `qy_iso_d`；其中 FIX-17 隔离库测试 60 / 0、AgentTask DTO 安全投影 23 / 0）。改动后：见 §5.3。

### 5.1 目录守卫测试（`npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts`）

**改动前**：
- 怎么跑的：最终版测试文件，对 origin/main 版本的 4 个路由文件跑（临时换回、跑完还原）。
- 结果：退出码 1，**95 通过、3 失败**（交叉验证补齐后；多维审查后那一版是 71 / 3）；检查器自测 86 项全部通过。
- 真实目录 176 个文件、251 个处理函数：
  - 失败清单**只点名本次 6 个**；
  - 严格通过 241 个，守卫前预处理名单 3 个，例外 1 个，零误报。
- 另 2 项失败是「照抄的固定提示与 dto.ts 一字不差」：改动前路由里没有这句。

```
  ✗ 每个处理函数都先过项目级权限检查（严格通过 241 个，守卫前预处理名单 3 个，例外 1 个，不过 6 个） 6
  - src/app/api/projects/[id]/ai-bid-package/route.ts POST：没有调用名单里的项目权限守卫（守卫按导入它的模块与原始导出名认定）
  - src/app/api/projects/[id]/ai-bid-package/route.ts GET：没有调用名单里的项目权限守卫（守卫按导入它的模块与原始导出名认定）
  - src/app/api/projects/[id]/ai-bid-package/run-step/route.ts POST：没有调用名单里的项目权限守卫（守卫按导入它的模块与原始导出名认定）
  - src/app/api/projects/[id]/intelligence/regenerate/route.ts POST：没有调用名单里的项目权限守卫（守卫按导入它的模块与原始导出名认定）
  - src/app/api/projects/[id]/intelligence/review/route.ts GET：没有调用名单里的项目权限守卫（守卫按导入它的模块与原始导出名认定）
  - src/app/api/projects/[id]/intelligence/review/route.ts PATCH：没有调用名单里的项目权限守卫（守卫按导入它的模块与原始导出名认定）
  ✗ src/app/api/projects/[id]/ai-bid-package/route.ts 照抄的 SAFE_STEP_ERROR_MESSAGE 与 dto.ts 一字不差 {"copied":null,…}
  ✗ src/app/api/projects/[id]/ai-bid-package/run-step/route.ts 照抄的 SAFE_STEP_ERROR_MESSAGE 与 dto.ts 一字不差 {"copied":null,…}
FIX-21 project routes guard: 95 passed, 3 failed
```

**改动后**：
- 结果：退出码 0，**98 通过、0 失败**（多维审查后那一版是 74 / 0）；
- 真实目录：`✓ 每个处理函数都先过项目级权限检查（严格通过 247 个，守卫前预处理名单 3 个，例外 1 个，不过 0 个）`。

**收紧前的版本**（第一轮，提交 `f462a463` 及以前）：改动前 44 / 1，改动后 45 / 0。

**收紧时在真实目录上的核对**：
- 照修订清单字面收紧，多出 3 个不过（§4 第 5 条）；
- 加上守卫前预处理名单后零误报；
- BIDPAGE 现行写法、`{ params }` 解构写法、`const p = await ctx.params` 再传 `p.id` 的写法，都有合成正例并通过。

### 5.2 隔离库 + HTTP 测试

命令：`NODE_ENV=test DATABASE_ENVIRONMENT=isolated DATABASE_URL=…/qy_iso_d DIRECT_URL=… npx tsx src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts`

**改动前**：
- 怎么跑的：最终版测试文件，4 个路由文件临时换回 origin/main 版本跑，跑完还原。
- 结果：退出码 1，**63 通过、85 失败**。
- 失败的是：全部被拒用例、安全视图用例，以及多维审查后补的用例。节选：

```
  ✗ 别的组织的管理员调 getBidPackage → 403「无权查看该项目」 — {"status":200,"body":{"taskId":"…","status":"completed",…
  ✗ 别的组织的管理员调 patchReview → 403「无权查看该项目」 — {"status":200,"body":{"reportStatus":"approved","reviewedBy":"f21_outsider …","reviewNotes":"hijack",…
  ✗ 被拒的重新生成：情报记录（含审核状态、备注、评分、审核人）与请求前一致 — {…"recommendation":"review_carefully",…   ← 已审核通过的情报被重算、审核结论被清空
  ✗ 别的组织的管理员执行一个只剩最后一步的任务 → 403 — {"status":200,"body":{"done":true,"stepIndex":3,"skillId":"document_summary",…
  ✗ 被拒的执行（只剩最后一步）：没有「AI 投标方案已生成」通知，项目甲没有任何新通知 — 7
  ✗ 测试建任务 → 403「无权修改该项目」 — {"status":200,"body":{"taskId":"…","taskType":"ai_bid_package",…
  ✗ 同项目里的 custom_flow 任务：run-step → 404「任务不存在」 — {"status":200,"body":{"done":true,"stepIndex":1,"skillId":"document_summary",…
  ✗ 以岗位预览身份访问的 super_admin：每一步 data 是空对象 — [{"draft":{"lineItems":[{"productName":"PRICE_MARK_…",…
  ✗ 只读成员：每一步的 data 都是空对象 — [{"processed":0},…,{"draft":{"lineItems":[{"productName":"PRICE_MARK_…","unitPrice":731984.27,"costPrice":512340.11}],…
  ✗ 整个测试只有项目「模」的 4 次模型请求；被拒用例 0 次 — ["other POST /v1/chat/completions", …]
FIX-21 project intel / bid package access (DB + HTTP): 63 passed, 85 failed
```

**改动后**：
- 结果：退出码 0，**148 通过、0 失败**；连跑 3 次结果一致（3 × 148 / 0）。
- 模型请求：被拒用例 0 次；整个测试只有项目「模」的 4 次。
- 清理后，隔离库里没有残留夹具（用户、项目、供应商、组织都是 0 行）。

**第一轮**（提交 `f462a463` 及以前）：改动前 50 / 64，改动后 114 / 0。

FIX-17 两个测试改动后仍通过：守卫 17 / 0，隔离库 60 / 0。

### 5.2b 变异（审查员的测试质量维度，本轮补测后复核）

把路由里的一处改回去，跑隔离库测试：

| 变异 | 结果 |
|---|---|
| `run-step` 技能抛错分支返回原始报错 | 147 / 1（「技能抛错：error 是固定提示」失败） |
| `run-step` 正常分支返回原始报错 | 146 / 2（模型原文、未知报价动作两条失败） |
| `run-step` 未知技能分支返回原始报错 | 146 / 2 |
| `stepError` 去掉 `failed` | 147 / 1（未知报价动作：失败但没给报错） |
| `stepError` 去掉 `raw`（成功但带报错） | 148 / 0：**没杀死**——现有技能走不到「成功但带 error」，见 §6b 已知限制 |
| `run-step` 正常分支 `data` 不裁 | 147 / 1 |
| `GET` 报错判断去掉 `\|\| s.error` | 147 / 1（「已完成但带报错」失败） |
| `GET` 报错判断去掉失败状态 | 147 / 1（「失败但没有报错」失败） |
| `GET` `data` 不裁 | 140 / 8 |
| `GET` 去掉 `taskType` 条件 | 147 / 1 |
| `run-step` 去掉 `taskType` 条件 | 145 / 3 |

### 5.2c 归档演练

在临时副本里依次跑 `openspec archive project-intel-bidpackage-access --yes`、`openspec validate --specs --strict`：
- 归档前 149 / 0，归档后 151 / 0，没有新增失败；
- 两份新主规格共 17 条要求，正文最长 462 字（≤ 500）。

### 5.3 门禁

| 门禁 | 命令 | 结果 |
|---|---|---|
| 全量 | `npm test`（删掉重建的空库 `qy_full_fix21`，`prisma migrate deploy` 后跑；`> /home/user/full-project-intel-bidpackage-access.log`；多维审查修订后在 `dcf9f9a3` 上跑） | **713 / 723 通过，10 失败**，失败清单与本机 main 基线逐条相同（见下）。FIX-21 两条：守卫 74 / 0、隔离库 148 / 0；FIX-17 两条：17 / 0、60 / 0 |
| CI 子集 | `env -u DATABASE_ENVIRONMENT DATABASE_URL=…/ci DIRECT_URL=…/ci JWT_SECRET=ci-only-jwt-secret-not-for-production NODE_ENV=test npm run test:ci` | PASS（`CI unit subset PASS`；目录守卫 74 / 0） |
| 类型 | `npm run typecheck` | 退出码 0 |
| lint | `npm run lint:baseline` | PASS（无新增 error fingerprint）；6 个改动 / 新增文件单独跑 `npx eslint`，0 条 |
| 测试注册 | `bash scripts/check-test-registry.sh` | OK：已注册 690 个；历史欠账基线剩余 66 条（不变） |
| 运行时架构 | `bash scripts/test-runtime-architecture.sh` | PASS |
| OpenSpec | `OPENSPEC_TELEMETRY=0 openspec validate project-intel-bidpackage-access --strict` | valid；归档演练见 §5.2c |
| 模块测试 | §5.0 的 33 条 | 33 条仍全部通过，加上本次两条共 35 / 35。只有 `tender-doc-html` 从 23 项变成 11 项：main 上 RFQ-PDF-1（`7cc9b77d`）改了这个测试，删掉了技术确认表的用例，与本 change 无关；其余各条通过数与改动前相同 |

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

- **全量库的建法**：按 impl 约定，全量库应先跑 `prisma migrate reset --force --skip-seed`。Prisma 对 AI 代理执行 `migrate reset` 要求人当面同意，所以改为删掉并重建这个只给本 change 用的库 `qy_full_fix21`，再跑 `prisma migrate deploy`（42 个迁移全部应用）。效果等同于 reset 后的空库。
- **第一轮全量**：在 `5d3032b9` 上 709 / 719，失败的同样是这 10 项。
- **交叉验证（F1–F6）后**：只改了守卫测试文件与文档，路由代码自 `dcf9f9a3` 起没有变，按协调会话的口径不重跑全量。合入 main `f332dd91`（`882f696f`）后重跑：
  - 目录守卫 98 / 0（176 个文件、251 个处理函数：严格 247 + 名单 3 + 例外 1，不过 0）；
  - 隔离库 148 / 0（`qy_iso_d`）；FIX-17 守卫 17 / 0；
  - `npm run test:ci` PASS（目录守卫 98 / 0）；`npm run typecheck` 0；`npm run lint:baseline` PASS；
  - `check-test-registry` OK（已注册 691 个，基线 66 条不变）；`test-runtime-architecture` PASS；
  - `openspec validate --strict` valid；归档演练 149 / 0 → 151 / 0，要求正文最长 462 字。
- **多维审查修订后的全量**：
  - 先合入 main `22a87fb7`（`56e91b05`），再在 `dcf9f9a3` 上跑；
  - 之后只改了文档（报告、proposal），没有再改代码或测试。

## 6. 没验证到的

- 生产库上的「合并后只读查询」没跑。要有生产只读权限的人跑，见 §9 第 1 条。
- 真实模型：
  - 测试里调到的只是本机假模型服务（项目「模」的 4 次执行，故意让技能失败 / 抛错）；
  - 有权限的人执行报价 / 邮件草稿成功时调真模型的行为，本次没改，也没跑。
- 界面：没有起应用点。界面不改，两个返回步骤内容的接口在界面上只对平台管理员挂载（design Context「界面上谁在调」）。合并后的点检见 §9 第 3 条。

## 6b. 已知限制（多维审查后核实，本次不改）

- **run-step「成功但带 error」**：非平台管理员拿到固定提示，随后 `GET` 里这一步的 `error` 为 `null`（库里没写报错）。这是既有路径，现有技能都走不到（技能成功时都不带 `error`），所以 §5.2b 里去掉 `raw` 那一边的变异杀不死。
- **「无权修改该项目」用在 run-step 上不贴切，也没说该找谁**：这是 `src/lib/projects/access.ts` 的既有文案，全站共用，本次不改。
- **运行时架构守卫看不出某些新增依赖**：
  - 已在基线里的文件，按名字新增的依赖它看不出；
  - 用模板字符串写的 `import` 它也看不出。
  - FIX-21 本身没有新增这两类依赖（多维审查：安全 4）。
- **组织身份 inactive、项目成员关系仍 active 的人照样能访问**：这是 `access.ts` 的既有语义，已登记为后续任务第 4 条。

## 7. 回退办法

没有开关、没有数据迁移。回退就是 revert 这一个 PR；本 change 不改任何数据，revert 后不需要任何数据修复。

## 8. 后续任务（已登记进 TASKFLOW；第 9 条编号 FIX-23，其余编号「待定」）

1. 重新生成情报会清掉人工审核结论（Lucas 2026-11-22 点名）：`src/lib/files/intelligence-extractor.ts:346-369` 重算写库时把 `reportStatus` 改回 `ai_generated`，清空审核人 / 时间 / 备注 / 评分，不留痕。「重新分析」与「上传新文件 + 逐步处理」（`files/process-next`）都走这里。
   - 修法：改成保留已有审核结论，或先留痕。
   - 并入（多维审查）：情报卡「重新分析」点了就跑，没有确认框。修之前先加确认框，建议文案：「重新分析会用当前的文件重新生成情报，并清空现有的审核结论（审核状态、审核人、备注、评分），清空后找不回来。确定重新分析吗？」
2. 技能与情报生成调模型不带组织，月度 AI 费用预检对一键投标方案 `run-step` 与情报生成都不生效：技能上下文没有 `orgId`（`src/lib/agent/types.ts:72-78`），`src/lib/agent/skills/quote.ts:135`、`src/lib/agent/skills/email-draft.ts:117`、`src/lib/files/intelligence-extractor.ts:96` 调模型不传，预检（`src/lib/ai/client.ts:173-184`）要 `orgId` 与 `userId` 都在才查。
3. 重新生成情报按调用者的可见范围重建全项目共享的相似项目：先删后建（`src/lib/projects/similarity.ts:204-217`），候选只取调用者能看到的同组织项目（`:35-49`）。
4. 已离开组织、但项目成员关系仍 active 的人照样过项目读权限，仍是项目负责人的还过写权限：`src/lib/projects/access.ts:81`、`:152`、`:160` 不看组织成员身份，影响全部项目接口。
5. 没有所属组织的项目里，项目管理员不过写权限：`src/lib/projects/access.ts:93-106` 只在项目有 `orgId` 时认项目管理员；要不要放开待定。
6. 情报审核结论的修改不写审计：`PATCH /api/projects/:id/intelligence/review`（`src/app/api/projects/[id]/intelligence/review/route.ts:84`）改状态 / 备注 / 评分不留记录，只在改成通过 / 需修改 / 已交付时记审核人（`:133-140`）。
7. 删掉 `POST /api/projects/:id/ai-bid-package` 里守卫之后不会再命中的「项目不存在」查询（`src/app/api/projects/[id]/ai-bid-package/route.ts:29-35`）。
8. 能读项目的人（含只读成员、不是项目成员的组织管理员）能从询价与报价接口拿到价格与内部成本：`GET …/inquiries`（`src/lib/inquiry/service.ts:191-199`）、旧报价单 `GET …/quotes/:quoteId`（`src/app/api/projects/[id]/quotes/[quoteId]/route.ts:9-25`），新报价引擎的「内部成本」级别对所有项目角色开放（`src/lib/quote-engine/access.ts:31`、`:43`）；要不要按财务查看权裁剪待定。
9. **FIX-23**（协调会话另开 change）：`GET /api/agent/tasks/recent`（`src/app/api/agent/tasks/recent/route.ts`）给非平台管理员原始报错与价格，而且不重查项目权限（多维审查：安全 1、权限 1）。
10. 问青砚工具 `project_get_tender_summary`（`src/lib/agent-core/tools/enterprise-readonly.ts:348`）只要求组织 active 成员就能读情报推荐、风险与 `ourBidPrice`，和本 change 的项目读权限口径不一致（权限 2）。
11. 项目 ID 带 U+0000 时，所有项目接口都 500：`findProjectForAccess`（`src/lib/projects/access.ts:11-25`）把 ID 原样交给 Postgres，报 22021。应该按「项目不存在」返回 404（安全 5）。
12. 「AI 投标方案已生成」高优先级通知发给全体项目成员，但一键投标方案面板只给平台管理员看，成员点开看不到内容。要不要只发给发起人或平台管理员，待定（权限 可选）。
13. 守卫前预处理名单里的 3 个处理函数改成「取完参数第一步就是守卫」（§4 第 5 条）：
    - `src/app/api/projects/[id]/route.ts` `PATCH`；
    - `finance/expenses/[expenseId]/route.ts` `PATCH`；
    - `quote-engine/[quoteId]/status/route.ts` `POST`。
    - 改完删掉 `project-routes-guard.test.ts` 里 `PRE_GUARD_PREP` 的对应条目。

TASKFLOW 后续任务的行数：
- 改动前：「| 待定 |」0 行；
- 第一轮：「| 待定 |」8 行；
- 多维审查后：「| 待定 |」12 行，另有「| FIX-23 |」1 行。

## 9. 合并后要人做的事

1. **只读查询**：交给有生产只读权限的人跑 `docs/acceptance/fix-21/prod-check.sql`（`psql "<生产只读连接串>" -f docs/acceptance/fix-21/prod-check.sql`）。整段在 `BEGIN READ ONLY … ROLLBACK` 里跑，不改数据。
   - **①** 一键投标方案任务里，发起人（`AgentTask.createdById`）对项目没有读权限的任务。看的是合并前「建任务」这个缺口有没有被用过。执行步骤、查看、重新分析都不记调用者，查不到。
   - **②** 情报审核人（`ProjectIntelligence.reviewedBy`）对不上任何一个对项目有读权限的人的记录。审核人存的是姓名，没有姓名时是邮箱或用户 ID；按姓名对不上任何用户的（改过名 / 已删除）也列出来。看的是合并前「改审核结论」这个缺口有没有被用过。
   - 「有读权限」按 `requireProjectReadAccess` 的口径判断，即下面四种人之一：
     - super_admin；
     - 项目负责人；
     - active 项目成员；
     - 项目所在组织 active 的所有者或管理员。
   - 判断用的是**现在**的成员关系：查到的行，要人看一眼当时是不是成员。
   - 有结果，就把任务 ID / 项目与人报给 Evan，定要不要通知；没结果，就在本节补「0 行」。
   - 已核对：
     - 在隔离库上跑过，语法正确（两条都 0 行）；
     - 又在一个最后回滚的事务里造了数：一个外人建的任务、一个外人审的情报，另有一个成员建的任务、一个成员审的情报。两条查询都只查出外人那一行。

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
| `5d3032b9` | tasks 3.1–3.2：报告与 TASKFLOW（FIX-21 一行 `[~]` + 8 条「待定」后续任务）；守卫测试补「例外文件不存在」自测（44 → 45） |
| `64323002` | 合入 main `451bb0d3`（#549 / #532 / #550 / #551），TASKFLOW 冲突两边都保留 |
| `f462a463` | 报告补合入后的复跑结果 |
| `56e91b05` | 合入 main `22a87fb7`（#544、#552、#553 等），没有冲突 |
| `9ad0b8d8` | 多维审查修订 A1–A3：目录守卫收紧；守卫前预处理名单；一键投标方案只认 `ai_bid_package` 任务；固定提示一致性挪进守卫测试；隔离库测试 114 → 148；规格与 design 改写 |
| `dcf9f9a3` | 多维审查修订 A4 / A2-13 / B：生产只读核查 SQL；tasks 3.2 后续任务第 9–13 条与行号；TASKFLOW 登记 |
| `8da9e2d5` | 报告按多维审查修订改写，门禁复跑结果 |
| `882f696f` | 合入 main `f332dd91`（#555 等），没有冲突 |
| （本提交） | 交叉验证 F1–F6：守卫测试补洞（74 → 98 项），规格 `route-access-guard` 与 design D9 / 已知盲区措辞对齐；没有改路由代码，按协调会话的口径不重跑全量 |

## 12. 多维审查

（由协调会话补）
