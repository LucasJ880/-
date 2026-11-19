# Tasks：批准分析后自动给出寻源建议（CHAIN-2）

开工前跑一遍要触碰模块的已注册测试并记下基线（`tender-rfq/__tests__/auto-draft-pure`、隔离库 `auto-draft-db` / `supplier-groups-db`、供应商情报的纯函数测试），写进报告。

## 1. 自动建候选池

- [ ] 1.1 新增 `src/lib/tender-intel/sourcing-flags.ts`（开关）与 `src/lib/tender-intel/auto-supplier-run.ts`（`maybeAutoSupplierRun`：条件、`allowLlm: false` 建运行、只用内部来源执行、并发只留最早、审计、出错只记日志）；四个审核接口在 `maybeAutoDraftRfq` 之前调用；verify：`npm run typecheck` 通过，`auto-draft-pure.test.ts` 不改期望通过

## 2. 寻源建议

- [ ] 2.1 新增 `src/lib/tender-intel/sourcing-suggestions-pure.ts`（推荐与三栏的组装与文案）与 `src/lib/tender-intel/sourcing-suggestions.ts`（取数：排名、强制要求证据、授标分组、市场基准、落地价与财务权限）；新增 `src/lib/tender-intel/__tests__/sourcing-suggestions.test.ts` 并注册（test-all + test-ci-unit）；verify：该测试通过
- [ ] 2.2 新增 `src/app/api/projects/[id]/tender-intel/sourcing/route.ts` 与 `src/components/tender-intel/sourcing-suggestions-card.tsx`，挂到 `src/components/project-detail/tabs/intel-tab.tsx`；verify：`npm run typecheck` 与 `npm run lint:baseline` 通过

## 3. 情报推荐并入自动起草

- [ ] 3.1 新增 `src/lib/tender-rfq/intel-recipients-flags.ts` 与 `src/lib/tender-rfq/intel-recipients.ts`（合并规则）；`auto-draft-service.ts` 合并、`auto-draft-pure.ts` 摘要与结果说明加一句、`service.ts` 把来源传进卡摘要；新增 `src/lib/tender-rfq/__tests__/intel-recipients.test.ts` 并注册（test-all + test-ci-unit）；verify：该测试通过，`auto-draft-pure.test.ts` 通过

## 4. 端到端与收尾

- [ ] 4.1 新增隔离库 `src/lib/tender-intel/__tests__/sourcing-suggestions-db.isolated.test.ts` 并注册（test-all + test-ci-unit）；verify：本机隔离库全部通过；`auto-draft-db`、`supplier-groups-db` 隔离库不改期望通过
- [ ] 4.2 全量门禁：`npm test`（与 main 对照失败名单）、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-auto-supplier-run --strict`；`git diff origin/main -- prisma/ vercel.json` 为空；verify：输出写进报告
- [ ] 4.3 写 `docs/QINGYAN_CHAIN-2_REPORT.md` + 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` CHAIN-2 状态列；verify：两个文件在 PR diff 里

## Workflow follow-up

- `/opsx:verify` → 多维度交叉审查 → PR → 合并 → `/opsx:archive tender-auto-supplier-run --yes`（独立小 PR）。
- 生产：`SUPPLIER_INTEL_ENABLED` 已对 Sunny 打开（CHAIN-0 第 6 项）后再开 `TENDER_AUTO_SUPPLIER_RUN_ENABLED`；情报推荐并入收件人等评估做起来再开（需要 Vercel 权限）。
