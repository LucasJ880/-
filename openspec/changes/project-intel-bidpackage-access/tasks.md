# Tasks：项目情报与一键投标方案的六个接口补上项目权限检查（FIX-21）

**开工前提：FIX-17（#548）合并后把 main 合入本分支再开工。** FIX-21 排在 FIX-17 之后马上实现。

「留给 GATE」三条已定（Lucas 2026-11-22）：第 1 条 C（非平台管理员只拿安全视图）、第 2 条 A（`PATCH …/intelligence/review` 用读权限）、第 3 条 A（`POST …/intelligence/regenerate` 用读权限）。下面各条按这个结论写，界面不改，没有分支。

## 1. 前置与测试先行（不改路由）

- [x] 1.1 确认 main 已含 FIX-17（`project-files-access-guard`，#548）的合并，把 main 合入本分支（`git merge origin/main`）；跑一遍将要触碰模块已注册的测试，记下各自通过数（`scripts/test-all.sh` 里 `src/lib/projects/`、`src/lib/agent-core/`、`src/lib/agent-tasks/`、`src/lib/files/` 的条目）。verify：`git log --oneline --merges origin/main` 里有 #548 的合并；`git merge-base --is-ancestor origin/main HEAD` 退出码 0；`npx tsx src/lib/projects/__tests__/files-route-guard.test.ts` 退出码 0；基线通过数写进报告
- [x] 1.2 写目录守卫测试 `src/lib/projects/__tests__/project-routes-guard.test.ts`，按 design D9 实现：枚举 `route.ts` 与 `route.tsx`，第 1–10 条规则（含 `.catch` 的读请求体写法、第一个守卫是顶层语句、紧接着检查结果、项目参数取自路由参数），守卫名单（带出处注释）与例外名单（`inquiries/batch-followup`），第 11 条列出的全部检查器自测（反例与正例）。注册进 `scripts/test-all.sh`（FIX-17 两条之后）与 `scripts/test-ci-unit.sh`。verify：在改动前的代码上退出码非 0，失败清单只有本次 6 个处理函数（`ai-bid-package/route.ts` 的 `GET` / `POST`、`run-step/route.ts` 的 `POST`、`intelligence/regenerate/route.ts` 的 `POST`、`intelligence/review/route.ts` 的 `GET` / `PATCH`），其余处理函数全部通过（真实目录零误报；main `2ef4f9c8` 上是 245 个，开工时目录里有新加的接口——例如并行的 BIDPAGE 会话加的——按实际数），检查器自测全部通过；失败清单多出本次 6 个以外的处理函数时停下回报，不在本 change 里改（design D9「以后新加的接口」）；输出存进报告
- [x] 1.3 写隔离库 + HTTP 测试 `src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts`。人、项目、任务夹具，本机假模型服务，逐字段快照，通知的数法（按项目与 `sourceKey` 前缀、轮询到预期条数），安全视图用例，都按 design D10；用例覆盖规格 `projects/intel-bidpackage-access` 的每条 Scenario。注册进 `scripts/test-all.sh`（隔离库执行，否则跳过）。verify：在改动前的代码上用隔离库跑，被拒、「数据不变 / 0 次模型请求 / 没有新通知」与「非平台管理员只拿安全视图」的用例失败；输出存进报告

## 2. 加守卫与安全视图

- [x] 2.1 `src/app/api/projects/[id]/ai-bid-package/route.ts`：`GET` 第一步调 `requireProjectReadAccess`，`POST` 第一步调 `requireProjectWriteAccess`，返回的是响应就原样返回；`POST` 原有的项目查询保留。`GET` 对不是平台管理员的调用者（按守卫返回的用户判断）每一步 `data` 给空对象、`error` 与 `src/lib/agent-tasks/dto.ts` 的报错脱敏同一口径（design D12，GATE 1 已定 C；`src/lib/agent-tasks` 是冻结面，不导入，固定提示在路由里照抄），平台管理员照旧。verify：守卫测试对这个文件通过；隔离库测试里 `GET` / `POST …/ai-bid-package` 的用例（含安全视图与平台管理员全看）全部通过
- [x] 2.2 `src/app/api/projects/[id]/ai-bid-package/run-step/route.ts`：`POST` 第一步调 `requireProjectWriteAccess`，在读请求体之前；调技能时不传组织（design D8）。不是平台管理员时，正常执行分支的响应 `data` 给空对象；三处返回步骤结果的响应（未知技能、技能抛错、正常执行）失败时 `error` 给与 `dto.ts` 一字不差的固定提示，成功时不带 `error`；写库照旧（design D12）。verify：守卫测试对这个文件通过；隔离库测试里 `run-step` 的用例全部通过：被拒时假模型服务 0 次请求、没有新通知；项目管理员执行后响应 `data` 为空对象，super_admin 随后看到这一步的原始输出
- [x] 2.3 `src/app/api/projects/[id]/intelligence/regenerate/route.ts` 的 `POST`（守卫在 `try` 之外）、`src/app/api/projects/[id]/intelligence/review/route.ts` 的 `GET` / `PATCH`（`PATCH` 的守卫在读请求体之前），第一步调 `requireProjectReadAccess`（GATE 2、GATE 3 已定 A；界面不改）。verify：守卫测试退出码 0；隔离库测试全部通过，连跑 3 次结果一致，输出存进报告

## 3. 验收

- [ ] 3.1 全部门禁。verify：
  - `npm test` 对照既有失败清单无新增；
  - `npm run test:ci` PASS；
  - `npm run typecheck` 退出码 0；
  - `npm run lint:baseline` PASS；
  - `bash scripts/check-test-registry.sh` OK；
  - `OPENSPEC_TELEMETRY=0 openspec validate project-intel-bidpackage-access --strict` valid；
  - 1.1 记下的模块测试通过数不减。
- [ ] 3.2 写 `docs/QINGYAN_FIX-21_REPORT.md` 并更新 TASKFLOW 状态列。报告包含：
  - 六个处理函数的级别与先例表；
  - 安全视图给了谁、裁掉了什么；
  - 改动前 / 改动后的两份测试输出；
  - 门禁结果；
  - 「留给 GATE」三条的结论：Lucas 2026-11-22 定第 1 条 C、第 2 条 A、第 3 条 A；
  - 已知后果：只读成员能经「重新分析」清空审核结论（design D4），修法是下面后续任务第 1 条；
  - 合并后谁会发现什么变了的白话说明；
  - **没有开关，合并即在生产生效**；回滚只能 revert 这一个 PR；
  - **合并后要人做的事**：
    - 只读查询（Lucas 在生产库跑，SQL 写进报告）：列出 `taskType = 'ai_bid_package'` 的任务里，建任务的人（`AgentTask.createdById`）既不是 super_admin、也不是该项目负责人、该项目 active 成员、项目所在组织的 active 所有者或管理员的那些，看合并前建任务这个缺口有没有被用过（执行步骤、查看、审核、重新分析都不记调用者，查不到）。查到就把任务 ID 与人报给 Evan 定怎么处理；查不到就在报告里写「0 行」。
    - 重新分析的项目名单：没有。本 change 不改任何数据；情报审核与「重新分析」没有审计记录，查不出过去谁改过、谁点过，所以不出名单。
    - 合并后点一遍（Lucas）：用 super_admin 打开一个项目的「内部 · AI 任务运行时」面板，一键投标方案照常显示全部内容、能执行一步；用该项目的只读成员打开情报页签，审核按钮与「重新分析」照常可用。「重新分析」会清掉审核结论，挑一个情报还没人审过的项目点。

  TASKFLOW：`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的「Phase F（续）— 情报串联」表，在 FIX-17 一行之后加 FIX-21 一行，状态 `[~]`。同时登记 8 条后续任务，各一行，编号写「待定」，状态 `[ ]`：
    1. 重新生成情报会清掉人工审核结论（Lucas 2026-11-22 点名）：`src/lib/files/intelligence-extractor.ts:346-369` 重算写库时把 `reportStatus` 改回 `ai_generated`，清空审核人 / 时间 / 备注 / 评分，不留痕；「重新分析」与「上传新文件 + 逐步处理」（`files/process-next`）都走这里。改成保留已有审核结论，或先留痕。
    2. 技能与情报生成调模型不带组织，月度 AI 费用预检对一键投标方案 `run-step` 与情报生成都不生效：技能上下文没有 `orgId`（`src/lib/agent/types.ts:72-78`），`src/lib/agent/skills/quote.ts:135`、`src/lib/agent/skills/email-draft.ts:117`、`src/lib/files/intelligence-extractor.ts:96` 调模型不传，预检（`src/lib/ai/client.ts:173-184`）要 `orgId` 与 `userId` 都在才查。
    3. 重新生成情报按调用者的可见范围重建全项目共享的相似项目：先删后建（`src/lib/projects/similarity.ts:204-217`），候选只取调用者能看到的同组织项目（`:35-49`）；项目成员但不是组织成员的人点一次「重新分析」，所有人看到的相似项目名单都变短。
    4. 已离开组织、但项目成员关系仍 active 的人照样过项目读权限，仍是项目负责人的还过写权限：`src/lib/projects/access.ts:81`、`:152`、`:160` 不看组织成员身份，影响全部项目接口。
    5. 没有所属组织的项目里，项目管理员不过写权限：`src/lib/projects/access.ts:93-106` 只在项目有 `orgId` 时认项目管理员；要不要放开待定。
    6. 情报审核结论的修改不写审计：`PATCH /api/projects/:id/intelligence/review`（`src/app/api/projects/[id]/intelligence/review/route.ts:77`）改状态 / 备注 / 评分不留记录，只在改成通过 / 需修改 / 已交付时记审核人（`:124-131`）。
    7. 删掉 `POST /api/projects/:id/ai-bid-package` 里守卫之后不会再命中的「项目不存在」查询（`src/app/api/projects/[id]/ai-bid-package/route.ts:14-20`）。
    8. 能读项目的人（含只读成员、不是项目成员的组织管理员）能从询价与报价接口拿到价格与内部成本：`GET …/inquiries`（`src/lib/inquiry/service.ts:191-199`，供应商单价 / 总价）、旧报价单 `GET …/quotes/:quoteId`（`src/app/api/projects/[id]/quotes/[quoteId]/route.ts:9-25`，`costPrice`、`internalCost`、`profitMargin`），新报价引擎的「内部成本」级别对所有项目角色开放（`src/lib/quote-engine/access.ts:31`、`:43`）；要不要按财务查看权裁剪待定（design「留给 GATE」第 1 条的事实部分）。

  verify：报告文件存在，含上面每一项；TASKFLOW 里 FIX-21 状态为 `[~]`；`grep -c "| 待定 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 不少于「改动前的数 + 8」（改动前先数一次写进报告；main `01e444b9` 上是 0）

## Workflow follow-up

- `/opsx:verify project-intel-bidpackage-access`。
- 开 PR 前多维审查：正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案，再加「权限口径」一个维度。逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- PR 合并后 `/opsx:archive project-intel-bidpackage-access --yes`：独立小 PR；TASKFLOW FIX-21 改 `[x]`；至少一个子 agent 核对主规格与 delta 一致。
- GATE 三条已定 C / A / A（Lucas 2026-11-22），不再有按选项分支的改动。
- 另开任务（不在本 change）：8 条，登记在 3.2，各自另开 change 处理。
