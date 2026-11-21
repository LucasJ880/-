# Tasks：项目文件的删除与逐步处理接口补上项目权限检查（FIX-17）

## 1. 测试先行（不改路由）

- [ ] 1.1 记基线：跑一遍将要触碰模块已注册的测试（`scripts/test-all.sh` 里 `src/lib/files/`、`src/lib/projects/`、`src/lib/tender-auto-analysis/` 的条目），记下各自通过数；verify：通过数写进报告
- [x] 1.2 写守卫测试 `src/lib/projects/__tests__/files-route-guard.test.ts`（按目录枚举 `src/app/api/projects/[id]/files/**/route.ts`，每个导出的处理函数先过项目守卫再碰数据库 / Blob / 解析 / 模型 / 入队；至少找到三个路由文件）并注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：在改动前的代码上 `npx tsx src/lib/projects/__tests__/files-route-guard.test.ts` 退出码非 0，输出点名 `process-next/route.ts` 的 `POST` 与 `[fileId]/route.ts` 的 `DELETE`，输出存进报告
- [x] 1.3 写隔离库 + HTTP 测试 `src/lib/projects/__tests__/files-access-db.isolated.test.ts`（夹具与用例按 design D6：未登录 / 已停用账号 401；别的组织、同组织非成员、inactive 成员 403；不存在与未分发项目 404；跨项目文件 ID 404；被拒后文件行逐字段不变、本地 Blob 文件还在、响应不带 `documentId` / `documentTitle` / `parseError`；成员、负责人、组织管理员、super_admin 200；成员 `retry=1` 重置失败文件；成员删除后行与 Blob 都没了；列表与上传的被拒用例）并注册进 `scripts/test-all.sh`（隔离库执行，否则跳过）；verify：在改动前的代码上用隔离库跑，403 与「数据未变」的用例失败，输出存进报告

## 2. 加守卫

- [x] 2.1 `src/app/api/projects/[id]/files/process-next/route.ts` 的 `POST` 第一步调 `requireProjectReadAccess`，返回的是响应就原样返回；`withAuth` 外壳、其余逻辑与响应不动；verify：守卫测试对这个文件通过；隔离库测试里 `process-next` 的全部用例通过
- [x] 2.2 `src/app/api/projects/[id]/files/[fileId]/route.ts` 的 `DELETE` 第一步调 `requireProjectReadAccess`，在查文件之前；verify：守卫测试退出码 0；隔离库测试全部通过，连跑 3 次结果一致，输出存进报告

## 3. 验收

- [ ] 3.1 全部门禁；verify：`npm test` 对照既有失败清单无新增、`npm run test:ci` PASS、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/check-test-registry.sh` OK、`OPENSPEC_TELEMETRY=0 openspec validate project-files-access-guard --strict` valid；1.1 记下的模块测试通过数不减
- [ ] 3.2 写 `docs/QINGYAN_FIX-17_REPORT.md`（目录下每个路由的守卫清单、改动前 / 改动后的测试输出、门禁结果、`DOCUMENT_PARSE_FAILED` 字符串去向的结论）+ `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 在 FIX 序列末尾加 FIX-17 一行；verify：报告文件存在，TASKFLOW 里 FIX-17 状态为 `[~]`

## Workflow follow-up

- `/opsx:verify project-files-access-guard`。
- 开 PR 前多维审查：至少四个维度（正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案），本次加「权限」一个维度；逐条核实后修，重跑测试；PR 正文写「多维审查」一节。
- PR 合并后 `/opsx:archive project-files-access-guard --yes`（独立小 PR；TASKFLOW FIX-17 改 `[x]`；至少一个子 agent 核对主规格与 delta 一致）。
