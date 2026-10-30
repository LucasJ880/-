# Design: fix-taskflow-status-drift

## Context

- TASKFLOW 最后一次整体对齐是 SDD-0（#241），此后又合并了 #236–#240、#258，而 P1-8 行从一开始就写的是 Phase 1 计划稿里的 `price_scenario`（实际随 #235 交付）。
- 注册校验 `scripts/check-test-registry.sh` 只在 `scripts/test-all.sh` 里执行；CI（`.github/workflows/ci.yml` → `npm run test:ci` → `scripts/test-ci-unit.sh`，`set -euo pipefail`）不跑它。`a1d951dd` 把 `inbound-org.test.ts` 与 `channel-inbound-id-db.isolated.test.ts` 只加进了 `test-ci-unit.sh` 第 131–132 行，CI 绿，`npm test` 红。
- 两个测试在本地都能跑：`inbound-org` 4 通过；`channel-inbound-id-db.isolated` 无隔离库时打印"跳过"并退出 0，与 `test-all.sh` 里其它 `*-db.isolated` 条目行为相同。

## Goals / Non-Goals

**Goals:**
- TASKFLOW 每个 `[x]` 行都能从 PR 编号追到 `git log --merges origin/main`；描述与实际交付一一对应。
- `bash scripts/check-test-registry.sh` 在 main 上退出 0；以后同类漂移在 CI 上直接失败。

**Non-Goals:**
- `src/**` 任何文件；`src/lib/trade/__tests__/*.test.ts` 的内容。
- `scripts/check-test-registry.sh` 的逻辑与 `ci/test-registry-baseline.txt` 的条目。
- `scripts/test-all.sh` 的分组结构、`run_test` 函数与汇总逻辑；`scripts/test-ci-unit.sh` 既有各行。
- TASKFLOW 的 Phase 0 任务描述 / 产物列、P0-10、Phase 2 表、P3-1…P3-3、度量表；`docs/` 下其它文件。
- 任何部署环境配置（Vercel 环境变量、tender-rfq-settings、Gmail 别名）。

## Decisions

### D1：TASKFLOW 按"实际交付"改写，而不是按原计划补注释
- 做法：P1-8 行整行改成 #236 的内容；`price_scenario` 并入 P1-6 行（#235 同时交付了 `compare` 与 `price_scenario`）；P3-4 标 `[x]` 并写明随 P1-8 交付。
- 被否决：保留原 P1-8 行、在状态列写"实际见 #236"——同一 ID 下描述与交付不符，下一个读 TASKFLOW 的会话照样会被误导，违反 `qa/taskflow-status`"任务描述与实际交付一致"。
- 被否决：新增 P1-9 行承载 #236 的内容——#236 的任务书本身就叫 P1-8，代码注释、报告文件名（`docs/QINGYAN_TENDER_P1-8_REPORT.md`）都用 P1-8，改 ID 会制造新的漂移。

### D2：P1 行状态统一为 `[x]（待 GATE-1 联调）`
- 现状：P1-2 / P1-3 写了"待 GATE-1 联调"，P1-4…P1-8 没写，但 GATE-1 一条都还没跑，P1-4…P1-8 同样依赖它。
- 被否决：P1-4…P1-8 维持 `[x]`——读者会以为它们已通过 GATE-1。
- 被否决：退回 `[G]`（等 Claude 审）——代码审核已在各 PR 完成，等的是联调而不是审核，`[G]` 语义不符。

### D3：在 CI 子集里执行注册校验，而不是只补注册
- 做法：`scripts/test-ci-unit.sh` 在最后一行 `echo "CI unit subset PASS"` 之前加 `bash scripts/check-test-registry.sh`。
- 被否决：只把 2 个文件补进 `test-all.sh`——根因（CI 不跑注册校验）还在，下一个只改 `test-ci-unit.sh` 的提交会再次让 `npm test` 变红。
- 被否决：让 CI 直接跑完整 `npm test`——`test-all.sh` 里有大量需要 `DATABASE_URL` / 外部服务的条目，CI 当前不具备，等于把 CI 弄红。
- 代价：校验只读文件、不连库，实测 < 1 秒。

### D4：两个 trade 测试注册在 `test-all.sh` 的 WhatsApp / 微信来信组旁
- 做法：放在第 79 行"WhatsApp/微信来信进 Revenue Spine DB 端到端(isolated)"之后；DB 测试沿用该组 `NODE_ENV=test npx tsx …` 的写法。
- 被否决：追加到第一组末尾——它们和第 78–79 行同属 `a1d951dd` 那一批"通道入站"改动，放一起便于按模块查找；末尾已经是 Muse / tender-rfq 一组。
- 被否决：加进 `ci/test-registry-baseline.txt`——基线规定只减不增。

## 八条硬纪律

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 不涉及（不改 `prisma/`、不改代码） |
| 2 | 出站先审批 | 不涉及；TASKFLOW 只记录现状（询价 / 催单都经 PendingAction） |
| 3 | 禁止第三套队列 | 不涉及；P1-4 描述写的是复用既有 cron `tender-rfq-inbound`，不新增 scheduler |
| 4 | 脱敏（决定 A） | 触碰文字：P1-6 行与「已决定」节写入决定 A 的内容，口径与 `openspec/config.yaml` 第 4 条一致（只不出毛利率、项目估值、我方最终报价） |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 触碰文字：GATE-1 前置改写为 `fromEmail`（project@）显示 / `mailboxEmail`（lucas@）授权，与 `openspec/config.yaml` 第 6 条一致 |
| 7 | 确定性优先 | 不涉及；P1-8 行如实写 `next_step` 为查表 |
| 8 | 测试注册 | 直接执行：补注册 2 个文件，并把校验接进 CI |

## Risks / Trade-offs

- [CI 新增一道门，会让现有其它未注册文件立刻暴露] → 基线已冻结全部历史欠账，补注册这 2 个之后 main 上 `check-test-registry.sh` 退出 0（tasks 2.1 先验证），不会凭空变红。
- [TASKFLOW 改写可能误写 PR 编号] → spec 场景要求每个编号都能在 `git log --oneline --merges origin/main` 中找到；tasks 1.2 用命令逐个核对。
- [`channel-inbound-id-db.isolated` 在没有隔离库的环境里只是"跳过"] → 与 `test-all.sh` 现有 `*-db.isolated` 条目一致；本 change 只保证它被执行，不改变它的跳过策略。

## 验证方式

- `bash scripts/check-test-registry.sh` → OK 行、退出 0。
- `npm run test:ci` → 输出含注册校验 OK 行，结尾 `CI unit subset PASS`，退出 0。
- 反向：临时从 `test-all.sh` 删掉新加的 `inbound-org` 一行后跑 `npm run test:ci` → 列出该路径、非零退出；恢复后再跑退出 0。
- `npx tsx src/lib/trade/__tests__/inbound-org.test.ts` 与 `NODE_ENV=test npx tsx src/lib/trade/__tests__/channel-inbound-id-db.isolated.test.ts` → 退出 0。
- TASKFLOW：对 Phase 0 / Phase 1 / P3-4 行抽出 `#<数字>`，逐个 `git log --oneline --merges origin/main | grep "#<数字> "`，全部命中；`grep -E "token=|postgres(ql)?://|CRON_SECRET=" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 无输出。
- `npx -y @fission-ai/openspec@1.15.0 validate fix-taskflow-status-drift` 通过。
