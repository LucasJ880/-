# Tasks

## 1. TASKFLOW 状态对齐

- [ ] 1.1 改写 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：Phase 0 P0-1…P0-9 状态列补 PR（P0-9 另注 #241）；Phase 1 表 P1-1…P1-8 按 proposal 改写描述并统一为 `[x]（待 GATE-1 联调）` + PR 编号（P1-6 并入 `price_scenario` 与决定 A，P1-8 改为建议式回复 / `next_step` / 个人偏好，P1-4 改为 history 游标轮询）；P3-4 改为 `[x]` 并注明随 P1-8（#236）交付、存于 `Organization.settingsJson.museBridge.userPrefs`。verify：`grep -n "^| P1-.*price_scenario" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 只命中 P1-6 一行；`grep -n "^| P3-4" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 含 `[x]` 与 `#236`；`grep -c "webhook" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 输出 0。
- [ ] 1.2 改写「GATE-1 联调前置（运维）」与「已决定」节（mailboxEmail + compose/readonly、Gmail「以此地址发送」、11 个意图、`PUT tender-rfq-settings` body、staging 2026-10-27 已同步；第 3 条改为 history 游标轮询；新增决定 A #237、邮箱分离 #238、text/plain #240）。verify：对 Phase 0 / Phase 1 / P3-4 行与「已决定」节里出现的每个 `#<数字>` 跑 `git log --oneline --merges origin/main | grep -c "#<数字> "`，全部 ≥ 1；`grep -En "token=|postgres(ql)?://|CRON_SECRET=" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 无输出。

## 2. 测试注册

- [ ] 2.1 在 `scripts/test-all.sh` 第 79 行"WhatsApp/微信来信进 Revenue Spine DB 端到端(isolated)"之后追加 2 条 `run_test`（中文名，DB 测试带 `NODE_ENV=test`），不改既有行。verify：`bash -n scripts/test-all.sh` 通过；`bash scripts/check-test-registry.sh` 打印 OK 行并退出 0；`npx tsx src/lib/trade/__tests__/inbound-org.test.ts` 与 `NODE_ENV=test npx tsx src/lib/trade/__tests__/channel-inbound-id-db.isolated.test.ts` 均退出 0。
- [ ] 2.2 在 `scripts/test-ci-unit.sh` 的 `echo "CI unit subset PASS"` 之前加一行 `bash scripts/check-test-registry.sh`（前加一行注释说明来源）。verify：`npm run test:ci` 输出含注册校验 OK 行并以 `CI unit subset PASS` 结束、退出 0；临时删掉 2.1 新加的 `inbound-org` 一行再跑 `npm run test:ci`，输出列出 `src/lib/trade/__tests__/inbound-org.test.ts` 且非零退出；恢复后再跑退出 0。

## 3. 收尾

- [ ] 3.1 全量回归与规格校验。verify：`npm test` 中"测试注册校验"项与新增 2 项 PASS（其余失败项若有，逐条确认与本 change 无关并记录在 PR 描述）；`NODE_OPTIONS=--max-old-space-size=7168 npm run typecheck` 退出 0；`npx -y @fission-ai/openspec@1.15.0 validate fix-taskflow-status-drift` 通过。

## Workflow follow-up

- PR 合并到 main 后再 `/opsx:archive fix-taskflow-status-drift --yes`（独立小 PR）；确认 `openspec list --specs` 列出 `qa/taskflow-status`，且 `openspec/specs/qa/test-registry/spec.md` 含"注册校验在 CI 子集中执行"。
