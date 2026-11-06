# Tasks

## 1. 规则

- [x] 1.1 `awards.ts` 弱信号改为扫描同中标方 + 同买家候选，跳过"两条都有编号且规范化后不同"的记录；新增 `normalizeSolicitationKey` / `isDistinctSolicitation`；verify：`awards.test.ts` 24 passed（含 T4-01c 原规则与新增 T4-01d..g）

## 2. 测试

- [x] 2.1 新增 `award-dedupe-db.isolated.test.ts`（我方两次中标、对手再次中标、写法不同、缺编号、周期样本）；注册 `test-all.sh` / `test-ci-unit.sh`；verify：新规则 6 passed，旧规则同一测试 3 failed（复现）
- [x] 2.2 回归：`award-semantics` 12、`intel-slots-p1p2` 13、`intel-auto-flow` 16、`awards-db`（隔离库）16 passed / 2 failed（T4-DB-08/09 需生产快照调查室行，与本改动无关）

## 3. 收尾

- [x] 3.1 `check-test-registry.sh`、typecheck、`lint:baseline`、`openspec validate award-dedupe-solicitation --strict`
- [x] 3.2 `docs/QINGYAN_P2-0c_REPORT.md` + TASKFLOW P2-0c 行（`[G]`）

## Workflow follow-up

- 一个 change = 一个 PR；不自动合并；合并后 `/opsx:archive award-dedupe-solicitation --yes`。
