# Tasks：项目情报与一键投标方案的六个接口补上项目权限检查（FIX-21）

## 1. 前置与测试先行（不改路由）

- [ ] 1.1 确认 main 已含 FIX-17（`project-files-access-guard`）的合并，把本分支 rebase 上去；跑一遍将要触碰模块已注册的测试，记下各自通过数（`scripts/test-all.sh` 里 `src/lib/projects/`、`src/lib/agent-core/`、`src/lib/files/` 的条目）。verify：`git log --oneline --merges origin/main` 里有 FIX-17 的合并；`npx tsx src/lib/projects/__tests__/files-route-guard.test.ts` 退出码 0；基线通过数写进报告
- [ ] 1.2 写目录守卫测试 `src/lib/projects/__tests__/project-routes-guard.test.ts`，按 design D9 的 8 条规则、守卫名单（带出处注释）与例外名单（`inquiries/batch-followup`）实现。注册进 `scripts/test-all.sh`（FIX-17 两条之后）与 `scripts/test-ci-unit.sh`。verify：在改动前的代码上退出码非 0，输出只点名本次 6 个处理函数（`ai-bid-package/route.ts` 的 `GET` / `POST`、`run-step/route.ts` 的 `POST`、`intelligence/regenerate/route.ts` 的 `POST`、`intelligence/review/route.ts` 的 `GET` / `PATCH`），检查器自测全部通过；输出存进报告
- [ ] 1.3 写隔离库 + HTTP 测试 `src/lib/projects/__tests__/intel-bidpackage-access-db.isolated.test.ts`。夹具、本机假模型服务、逐字段快照按 design D10，用例覆盖规格 `projects/intel-bidpackage-access` 的每条 Scenario。注册进 `scripts/test-all.sh`（隔离库执行，否则跳过）。verify：在改动前的代码上用隔离库跑，被拒与「数据不变 / 0 次模型请求 / 没有新通知」的用例失败；输出存进报告

## 2. 加守卫

- [ ] 2.1 `src/app/api/projects/[id]/ai-bid-package/route.ts`：`GET` 第一步调 `requireProjectReadAccess`，`POST` 第一步调 `requireProjectWriteAccess`，返回的是响应就原样返回；其余逻辑与响应不动（`POST` 原有的项目查询保留）。verify：守卫测试对这个文件通过；隔离库测试里 `GET` / `POST …/ai-bid-package` 的用例全部通过
- [ ] 2.2 `src/app/api/projects/[id]/ai-bid-package/run-step/route.ts`：`POST` 第一步调 `requireProjectWriteAccess`，在读请求体之前；调技能时不传组织（design D8）。verify：守卫测试对这个文件通过；隔离库测试里 `run-step` 的用例全部通过，被拒时假模型服务 0 次请求、没有新通知
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
  - 改动前 / 改动后的两份测试输出；
  - 门禁结果；
  - 「留给 GATE」两条的结论；
  - 合并后谁会发现什么变了的白话说明。

  TASKFLOW：`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的「Phase F（续）— 情报串联」表，在 FIX-17 一行之后加 FIX-21 一行。verify：报告文件存在；TASKFLOW 里 FIX-21 状态为 `[~]`

## Workflow follow-up

- `/opsx:verify project-intel-bidpackage-access`。
- 开 PR 前多维审查：正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案，再加「权限口径」一个维度。逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- PR 合并后 `/opsx:archive project-intel-bidpackage-access --yes`：独立小 PR；TASKFLOW FIX-21 改 `[x]`；至少一个子 agent 核对主规格与 delta 一致。
