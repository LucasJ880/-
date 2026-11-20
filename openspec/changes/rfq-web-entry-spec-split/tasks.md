# Tasks：拆短 `tender/rfq-web-entry`「原地审批与待批轮次保护」（CHAIN-4c）

## 1. 规格增量

- [x] 1.1 写 `specs/tender/rfq-web-entry/spec.md`：REMOVED「原地审批与待批轮次保护」（Reason / Migration），ADDED「询价卡的原地审批与待批轮次保护」与「询价单 PDF 对不上时只给驳回」，正文与场景从主规格逐字搬（verify：`npx openspec validate rfq-web-entry-spec-split --strict` valid）

## 2. 等价核对

- [x] 2.1 用脚本比对：主规格原条的正文按句切分、场景逐个取出，与两条新增要求合起来逐字相同（差别只有新条开头补的那两处与原条末尾加的那句指引），场景数 5 = 4 + 1，两条新正文都 ≤ 500 字（verify：一次性 python 脚本（放 scratchpad，不入库）输出贴进报告，差异 0）
- [x] 2.2 新条场景引用的测试照旧通过（verify：`npx tsx src/lib/tender-rfq/__tests__/attachment.test.ts`；`NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/attachment-db.isolated.test.ts`）

## 3. 归档演练

- [x] 3.1 在临时 worktree 里跑 `openspec archive rfq-web-entry-spec-split --yes`，确认合并后主规格 14 条要求、场景总数不变（verify：`npx openspec validate tender/rfq-web-entry --type spec --strict` valid；`npx openspec validate --specs --strict` 全过）

## 4. 门禁与报告

- [ ] 4.1 全量门禁（本 change 不改代码，结果应与 main 相同）（verify：`npm test` 与 main 上同样的 11 项既有失败、其余通过；`npm run test:ci` PASS；`npm run typecheck`；`npm run lint:baseline` PASS；`git diff origin/main --stat` 只有 `openspec/changes/rfq-web-entry-spec-split/**`、报告与 TASKFLOW）
- [ ] 4.2 写 `docs/QINGYAN_CHAIN-4c_REPORT.md` + 更新 TASKFLOW 状态列（verify：报告含等价核对输出、归档演练输出、门禁结果，并写明归档 PR 要改交接文档 §0.5h「之后还有什么」第 4 条那句（旧名与「超过 500 字」都会过时）；TASKFLOW 新增 CHAIN-4c 一行为 `[~]`）
