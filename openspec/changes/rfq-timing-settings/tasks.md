# Tasks：询价节奏三项可以在组织页上改（W-2b）

## 1. 接口

- [x] 1.1 `landed-cost.ts`：PUT 的 zod 与 `applyTenderRfqSettingsUpdate` 收 `replyLeadDays` / `roundLockDays` / `chaseAfterDays`（1–60 整数，null 清空）；`route.ts` 的 GET 多返回 `timing`、`timingDefaults` 与 `stored` 三项；verify：`npx tsx src/lib/tender-rfq/__tests__/rfq-timing-settings.test.tsx` 与 `npx tsx src/lib/tender-rfq/__tests__/rfq-timing-settings-db.isolated.test.ts` 通过

## 2. 页面

- [x] 2.1 `settings-form.ts` / `settings-section-state.ts` / `tender-rfq-settings-section.tsx`：「询价节奏」三项，只发改过的项，说明文字；verify：纯逻辑测试通过；真实浏览器截图 `docs/acceptance/w-2b/*.png`
- [x] 2.2 走真实接口的往返，且新的读取结果被建轮次 / 催单用到；verify：隔离库测试通过，且在改动之前的代码上失败

## 3. 测试注册与验收

- [x] 3.1 新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；verify：`bash scripts/check-test-registry.sh` 输出 OK
- [x] 3.2 变异核对；独立审查并处理其发现；全部门禁；verify：`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate rfq-timing-settings --strict` valid
- [x] 3.3 写 `docs/QINGYAN_W-2b_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里 W-2b 一行状态 `[G]`
