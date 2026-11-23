# Tasks：限制谁能更换项目负责人（CHAIN-2c）

## 1. 判定

- [x] 1.1 新增 `src/lib/projects/owner-change.ts`（`decideOwnerChange`、`checkNewOwner`、`ownerChangeFlags`、`ownerChangeHint`、固定文字）与 `src/lib/projects/owner-change-access.ts`（调用人身份用 `resolveFinancePrivilege(user, orgId, null).privileged`、新负责人检查、`guardOwnerChange`、带条件写入 `writeOwnerIfUnchanged`）；新增 `src/lib/projects/__tests__/owner-change.test.ts` 并同时登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（verify：`npx tsx src/lib/projects/__tests__/owner-change.test.ts` 各身份 × 换给别人 / 换给自己 / 不变 × 有组织 / 个人项目；`bash scripts/check-test-registry.sh` 通过）

## 2. 四个入口

- [x] 2.1 新增 `src/lib/projects/__tests__/owner-change-db.isolated.test.ts`（五种身份 + 只读成员、个人项目）并同时登记进两个脚本；`src/app/api/projects/[id]/route.ts` PATCH：先判权限再判新负责人，被拒整个请求返回，带条件写入（409），审计前后带 `ownerId`（verify：`NODE_ENV=test npx tsx src/lib/projects/__tests__/owner-change-db.isolated.test.ts` 的 PATCH 部分）
- [x] 2.2 `src/app/api/projects/[id]/members/route.ts` POST 与 `src/app/api/projects/[id]/members/[memberId]/route.ts` PATCH（`duty: "owner"`）：同一判定、带条件写入；GET 返回 `ownerChange`（verify：同一隔离库测试的成员接口部分与「标记」）
- [x] 2.3 `src/app/api/ops/projects/[id]/route.ts` PATCH：既有「能管理执行项目」门槛之后同一判定（管理者）、新负责人检查、带条件写入、写审计（verify：同一隔离库测试的执行项目部分）

## 3. 界面

- [x] 3.1 `src/app/(main)/projects/[id]/page.tsx` 把成员接口的 `ownerChange` 传给工作台；`src/components/project-detail/tabs/workbench-tab.tsx` 两个身份下拉按标记给「主负责人」、卡片说明一句（verify：`owner-change.test.ts` 的源码断言与说明文字）

## 4. 门禁与报告

- [x] 4.1 既有不改期望与门禁（verify：成员、执行项目相关的既有测试原样通过；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`openspec validate project-owner-change-guard --strict`；`git diff origin/main -- prisma/ vercel.json` 为空；全量 `npm test` 由会话统一跑）
- [x] 4.2 写 `docs/QINGYAN_CHAIN-2c_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含多维审查与门禁结果、「谁能更换负责人」与「中标后转执行」两个 GATE 问题；TASKFLOW 在 CHAIN-2 一行后新增 CHAIN-2c 一行为 `[~]`）
