# Tasks：限制谁能更换项目负责人（CHAIN-2c）

## 1. 判定

- [ ] 1.1 新增 `src/lib/projects/owner-change.ts`：纯函数 `decideOwnerChange`（D1 / D2 / 不变即通过）、新负责人条件的检查（D3）、读取调用人组织角色与组织范围 `project.finance.manage` 的函数、两句 403 与一句 400 的固定文字；新增 `src/lib/projects/__tests__/owner-change.test.ts` 并同时登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`npx tsx src/lib/projects/__tests__/owner-change.test.ts` 各身份 × 换给别人 / 换给自己 / 不变；`bash scripts/check-test-registry.sh` 通过）

## 2. 三个入口

- [ ] 2.1 `src/app/api/projects/[id]/route.ts` PATCH：`ownerId` 与当前不同时先判权限再判新负责人，被拒整个请求返回；换了负责人时审计前后带 `ownerId`（verify：隔离库用例「换给别人」「换给自己」「不合格的新负责人」「被拒时整个请求不写」「审计」的 PATCH 部分）
- [ ] 2.2 `src/app/api/projects/[id]/members/route.ts` POST（`duty: "owner"`）与 `src/app/api/projects/[id]/members/[memberId]/route.ts` PATCH（`duty: "owner"`）：同一判定，写库前调用；GET 返回 `ownerChange`（verify：隔离库用例的成员接口部分与「选项」）

## 3. 界面

- [ ] 3.1 `src/components/project-detail/tabs/workbench-tab.tsx`：按 `ownerChange` 决定「项目身份」下拉里给不给「主负责人」（verify：`owner-change.test.ts` 的源码断言）

## 4. 测试与门禁

- [ ] 4.1 新增 `src/lib/projects/__tests__/owner-change-db.isolated.test.ts`（五种身份、三个入口、审计、成员接口标记）并同时登记进两个脚本（verify：`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts` 通过）
- [ ] 4.2 全量门禁（verify：`npm test` 只有 main 上同样的既有失败；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`openspec validate project-owner-change-guard --strict`；`git diff origin/main -- prisma/ vercel.json` 为空）
- [ ] 4.3 写 `docs/QINGYAN_CHAIN-2c_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含多维审查与门禁结果、「谁能更换负责人」与执行项目接口两个 GATE 问题；TASKFLOW 新增 CHAIN-2c 一行为 `[~]`）
