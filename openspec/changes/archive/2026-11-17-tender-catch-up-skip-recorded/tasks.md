# Tasks：带了发生时间或预期状态的推进不补招投标状态

## 1. 实现

- [x] 1.1 移植 `373f0579` 的检查到 `src/lib/tender/stage-transition.ts`；verify：`npx tsx src/lib/tender/__tests__/stage-status-catch-up.test.ts` 通过
- [x] 1.2 补回两条测试；verify：`stage-status-catch-up-db.isolated.test.ts` 本地隔离库 33 项通过，删掉检查后失败 2 项

## 2. 验收

- [x] 2.1 门禁；verify：`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`openspec validate tender-catch-up-skip-recorded --strict` valid
