# Tasks

## 1. 服务与回灌

- [x] 1.1 `awards.ts` 新增 `retractAwardRecord`（人工 actor、原因必填、metadata 留痕、幂等）；`awards.test.ts` T4-11a–h；verify：32 passed
- [x] 1.2 `own-result-backfill.ts` 遇到已撤回记录改用后继键（未中标中标方与我方中标两条路径）；verify：`outcome-winner-db` 18、`award-dedupe-db` 6 仍全过

## 2. 接口与页面

- [x] 2.1 `POST /api/organizations/[orgId]/tender-awards/[awardId]/review`（org_admin；confirm / retract；同事务审计；409 / 404 / 400）；`GET /api/org/tender-awards` 返回 `canReview` 与 `possibleDuplicateOfId`
- [x] 2.2 「历史中标」页处理列（确认属实 / 不是重复，确认 / 行内填原因撤回）；结果表单"已记录过中标方"提示更正方法；verify：隔离库 + `next dev` 截图 `docs/acceptance/p2-0d/01–04`，成员视图无按钮
- [x] 2.3 新增 `award-review-db.isolated.test.ts`（权限、确认、撤回、审计、更正、我方中标更正、开关关闭）；注册；verify：20 passed，无库跳过

## 3. 收尾

- [x] 3.1 `check-test-registry.sh`、typecheck、`lint:baseline`、`test-runtime-architecture.sh`、`openspec validate award-record-review --strict`
- [x] 3.2 `docs/QINGYAN_P2-0d_REPORT.md` + TASKFLOW P2-0d 行（`[G]`）

## Workflow follow-up

- 一个 change = 一个 PR；依赖 #384、#386 先合并；不自动合并；合并后 `/opsx:archive award-record-review --yes`。
