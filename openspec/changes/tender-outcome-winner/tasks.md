# Tasks

每条带测试与验证命令；结果写进报告。

## 1. 投影排除我方

- [x] 1.1 `deriveAwardIntelligence` 加可选 `ownWinnerNames`，竞争对手已确认 / 线索排除我方，新增 `ownAwardCount`；`/api/org/tender-awards` 传组织名；"历史中标"页显示排除条数。`award-semantics.test.ts` 加 SEM-T4-09a–d；verify：该测试全过，`intel-slots-p1p2.test.ts` 仍全过

## 2. 结果表单中标方

- [x] 2.1 `tender-result.ts` 新增 `parseOutcomeWinner` / `isOwnOrgWinner`，`markProjectTenderResult` 接 `winnerName`（我方 → 抛错且不改状态；备注追加中标方）；路由校验并返回 `winner`；`own-result-backfill.ts` 加 lost + 中标方分支（幂等键 `tender-result-winner:{projectId}`，换名不覆盖）；结果表单在未中标时显示输入框与保存说明。`tender-result.test.ts` 加 10 例；verify：该测试全过，`npm run typecheck` 通过
- [x] 2.2 新增 `src/lib/tender-intel/__tests__/outcome-winner-db.isolated.test.ts`（写入 / 幂等 / 换名不覆盖 / 我方被拒 / 未填不写 / 开关关只写备注 / 我方中标被排除），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（无隔离库自动跳过）；verify：隔离库 18 passed，无库时跳过

## 3. 收尾

- [x] 3.1 门禁：`bash scripts/check-test-registry.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-outcome-winner --strict`；verify：全部通过，输出写进报告
- [x] 3.2 写 `docs/QINGYAN_P2-0_REPORT.md` + TASKFLOW 新增 P2-0 行（`[G]`）；verify：报告存在，`grep -n 'P2-0' docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示该行

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive tender-outcome-winner --yes`（独立小 PR）。
