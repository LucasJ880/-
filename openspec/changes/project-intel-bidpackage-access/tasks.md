# Tasks：项目情报与一键投标方案的六个接口补上项目权限检查（FIX-21）

## 1. 前置与测试先行（不改路由）

- [ ] 1.1 确认 main 已含 FIX-17（`project-files-access-guard`）的合并，把本分支 rebase 上去；跑一遍将要触碰模块已注册的测试，记下各自通过数（`scripts/test-all.sh` 里 `src/lib/projects/`、`src/lib/agent-core/`、`src/lib/agent-tasks/`、`src/lib/files/` 的条目）。verify：`git log --oneline --merges origin/main` 里有 FIX-17 的合并；`npx tsx src/lib/projects/__tests__/files-route-guard.test.ts` 退出码 0；基线通过数写进报告
- [ ] 1.2 写目录守卫测试 `src/lib/projects/__tests__/project-routes-guard.test.ts`，按 design D9 实现：枚举 `route.ts` 与 `route.tsx`，第 1–10 条规则（含 `.catch` 的读请求体写法、第一个守卫是顶层语句、紧接着检查结果、项目参数取自路由参数），守卫名单（带出处注释）与例外名单（`inquiries/batch-followup`），第 11 条列出的全部检查器自测（反例与正例）。注册进 `scripts/test-all.sh`（FIX-17 两条之后）与 `scripts/test-ci-unit.sh`。verify：在改动前的代码上退出码非 0，失败清单只有本次 6 个处理函数（`ai-bid-package/route.ts` 的 `GET` / `POST`、`run-step/route.ts` 的 `POST`、`intelligence/regenerate/route.ts` 的 `POST`、`intelligence/review/route.ts` 的 `GET` / `PATCH`），其余 245 个处理函数全部通过（真实目录零误报），检查器自测全部通过；输出存进报告
- [ ] 1.3 写隔离库 + HTTP 测试 `src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts`。人、项目、任务夹具，本机假模型服务，逐字段快照，通知的数法（按项目与 `sourceKey` 前缀、轮询到预期条数），安全视图用例，都按 design D10；用例覆盖规格 `projects/intel-bidpackage-access` 的每条 Scenario。注册进 `scripts/test-all.sh`（隔离库执行，否则跳过）。verify：在改动前的代码上用隔离库跑，被拒、「数据不变 / 0 次模型请求 / 没有新通知」与「非平台管理员只拿安全视图」的用例失败；输出存进报告

## 2. 加守卫与安全视图

- [ ] 2.1 `src/app/api/projects/[id]/ai-bid-package/route.ts`：`GET` 第一步调 `requireProjectReadAccess`，`POST` 第一步调 `requireProjectWriteAccess`，返回的是响应就原样返回；`POST` 原有的项目查询保留。`GET` 对不是平台管理员的调用者（按守卫返回的用户判断）每一步 `data` 给空对象、`error` 走 `src/lib/agent-tasks/dto.ts` 的报错脱敏（design D12），平台管理员照旧。verify：守卫测试对这个文件通过；隔离库测试里 `GET` / `POST …/ai-bid-package` 的用例（含安全视图与平台管理员全看）全部通过
- [ ] 2.2 `src/app/api/projects/[id]/ai-bid-package/run-step/route.ts`：`POST` 第一步调 `requireProjectWriteAccess`，在读请求体之前；调技能时不传组织（design D8）。不是平台管理员时，正常执行分支的响应 `data` 给空对象；三处返回步骤结果的响应（未知技能、技能抛错、正常执行）失败时 `error` 给 `dto.ts` 的固定提示，成功时不带 `error`；写库照旧（design D12）。verify：守卫测试对这个文件通过；隔离库测试里 `run-step` 的用例全部通过：被拒时假模型服务 0 次请求、没有新通知；项目管理员执行后响应 `data` 为空对象，super_admin 随后看到这一步的原始输出
- [ ] 2.3 `src/app/api/projects/[id]/intelligence/regenerate/route.ts` 的 `POST`（守卫在 `try` 之外）、`src/app/api/projects/[id]/intelligence/review/route.ts` 的 `GET` / `PATCH`（`PATCH` 的守卫在读请求体之前），第一步调 `requireProjectReadAccess`。verify：守卫测试退出码 0；隔离库测试全部通过，连跑 3 次结果一致，输出存进报告

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
  - 「留给 GATE」三条的结论；
  - 已知后果：只读成员能经「重新分析」清空审核结论（design D4），以及另开任务的去向；
  - 合并后谁会发现什么变了的白话说明。

  TASKFLOW：`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的「Phase F（续）— 情报串联」表，在 FIX-17 一行之后加 FIX-21 一行。verify：报告文件存在；TASKFLOW 里 FIX-21 状态为 `[~]`

## Workflow follow-up

- `/opsx:verify project-intel-bidpackage-access`。
- 开 PR 前多维审查：正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案，再加「权限口径」一个维度。逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- PR 合并后 `/opsx:archive project-intel-bidpackage-access --yes`：独立小 PR；TASKFLOW FIX-21 改 `[x]`；至少一个子 agent 核对主规格与 delta 一致。
- GATE 2 或 GATE 3 选 B 时：在 2.3 里一并改级别与界面（把 `canManage` 传进情报卡、隐藏或禁用对应按钮），不新增 task，tasks 仍是 8 条；规格与 1.3 的用例相应调整。GATE 1 选 A 时去掉 2.1 / 2.2 里的安全视图与对应规格、用例；选 D 时 2.1 / 2.2 改用调试面守卫。
- 另开任务（不在本 change）：重新生成情报时不清空已有的人工审核结论（`src/lib/files/intelligence-extractor.ts`）；技能与情报生成的模型调用带上组织，让月度 AI 费用预检生效（design D8）。
