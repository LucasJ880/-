# Tasks

## 1. 基线

- [x] 1.1 在干净的 main 上跑将要触碰模块的已注册测试与全量测试，记下基线。verify：`npx tsx src/lib/revenue-spine/__tests__/scoring-draft.test.ts` 与 `commercial-facts.test.ts` 的通过数；`npm test` 的失败项清单。
  - 实测（2026-10-26，main @ 51cc62c，无 Postgres 的执行环境）：scoring-draft 21 passed、commercial-facts 23 passed；`npm test` 410/425，15 个失败：10 项 Phase3A / Governance / Agent Trace 缺 DATABASE_URL、T4 Postgres 矩阵、Gmail Draft OAuth、Quote PDF 分页（Chromium）、TypeScript 类型检查（默认 2 GB 堆 OOM）、测试注册校验（#242 带进来的 `src/lib/trade/__tests__/channel-inbound-id-db.isolated.test.ts`、`inbound-org.test.ts` 未注册）。

## 2. 中文口径 / 单位对照

- [x] 2.1 在 `src/lib/revenue-spine/reply-draft.ts` 新增口径 → 中文、单位 → 中文量词两张表与查表函数（去首尾空格、转小写，表外原样），中文分支起订量一句改用查表；英文分支不动。verify：`git diff src/lib/revenue-spine/reply-draft.ts` 只动中文分支的起订量一句与新增常量；`npm run typecheck` 通过。
- [x] 2.2 在 `src/lib/revenue-spine/__tests__/scoring-draft.test.ts` 新增测试"中文参考原句：起订量口径与单位写成中文…"：`per = color / size / style / order` 四种口径的中英文原句、未知口径原样保留（含 `constructor` / `toString`）、大小写与首尾空格、整封中文草稿含"每色 500 件"且守卫通过、英文草稿审批预览的中文对照含"每色 500 件"。verify：对未修改的 `reply-draft.ts` 运行该测试失败（得到"每color 500 件"）；修改后 `npx tsx src/lib/revenue-spine/__tests__/scoring-draft.test.ts` 全部通过，`commercial-facts.test.ts` 通过数与基线相同。

## 3. 集成检查

- [x] 3.1 跑门禁。verify：`npm test` 与 1.1 基线比较新增失败为 0；`npm run lint:baseline` 通过；`bash scripts/check-test-registry.sh` 退出 0；`openspec validate fix-zh-moq-per-unit --strict` 通过；`git diff --stat origin/main` 不含 `prisma/`、`openspec/specs/`。
  - 实测（2026-10-26）：`npm test` 410/425，失败清单与 1.1 基线逐项相同（新增失败 0）；`npm run test:ci` PASS；`npm run typecheck`（6 GB 堆）退出 0；`npm run lint:baseline` PASS；`openspec validate --strict` valid；diff 不含 `prisma/`、`openspec/specs/`。
  - `bash scripts/check-test-registry.sh` 退出 1，但输出与干净 main 逐字相同：两个未注册文件来自 #242（commit a1d951d），不是本 change 引入，按"一个 change = 一个 PR"不在此修。

## Workflow follow-up

- B-3 `fde-preferences-in-draft` 的金样本 `src/lib/revenue-spine/__tests__/fixtures/draft-golden-pre-b3.json` 目前尚未生成；若 B-3 在合并本 change 之前生成了金样本，B-3 合并本 change 后按 `draft-golden-cases.ts` 写明的命令重新生成。
- PR 合并到 main 后 `/opsx:archive fix-zh-moq-per-unit --yes`（独立小 PR）；确认 `openspec list --specs` 列出 `revenue-spine/draft-reference-lines`。本 change 无 TASKFLOW ID，archive 时不改 TASKFLOW 状态列。
