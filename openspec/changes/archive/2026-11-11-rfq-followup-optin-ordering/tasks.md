# Tasks：个人开关的写入加锁并明确给记录时间（RFQ-AUTO-3a）

## 1. 实现

- [x] 1.1 `auto-followup-optin-service.ts`：`setAutoDraftFollowUpOptIn` 改为一个短事务——取本人的事务级锁 → 读最近一条（连同时间）→ 状态已是想要的就不写 → 否则写一条，时间取 max(现在, 上一条 + 1 毫秒)；写入的字段与原来相同，返回值不变；verify：`npx tsx src/lib/tender-rfq/__tests__/auto-followup-optin.test.ts` 全部通过（含「先取锁再读再写」「时间至少比上一条晚」两条新断言）
- [x] 1.2 确认读取函数、路由、界面、`src/lib/audit/**` 没有改动；verify：`git diff --stat origin/main` 里代码只有 `auto-followup-optin-service.ts` 一个非测试文件

## 2. 测试

- [x] 2.1 `auto-draft-db.isolated.test.ts` 加第 17 段：同时到达的两次开启只写一条、已是开时不写；同时到达四开四关，记录严格交替、时间严格递增、最终状态就是最后一条；上一条记录时间拨后 30 秒 → 关闭生效 → 之后自动起草的卡不带授权 → 再开启；verify：本地隔离库跑该文件，76 passed, 0 failed（连跑三次）
- [x] 2.2 确认新用例测得到这个问题；verify：同一份测试在 `main` 的旧实现上跑，第 17 段有 4 条失败（四开四关写出「开关关关关」；关闭后状态仍是开；随后的卡带着授权；记录不再递增交替）
- [x] 2.3 既有断言不被破坏；verify：该文件原有的 68 项、`web-entry-pure.test.ts` 151 项不改断言即通过；`auto-followup-optin.test.ts` 19 → 21（一条源码断言原来写的是「用 writeAuditLog」，随实现改为「事务里的一次追加」）

## 3. 验收与收尾

- [x] 3.1 开 PR 前请一个不带结论的独立审查并处理其发现；verify：报告 §5 逐条写明
- [x] 3.2 全部门禁；verify：`npm run test:ci` 输出 `CI unit subset PASS`、`npm run typecheck` 退出码 0、`npm run lint:baseline` PASS、`bash scripts/check-test-registry.sh` OK、`bash scripts/test-runtime-architecture.sh` PASS、`openspec validate rfq-followup-optin-ordering --strict` valid
- [x] 3.3 写 `docs/QINGYAN_RFQ-AUTO-3a_REPORT.md` + 更新 TASKFLOW 状态列；verify：TASKFLOW 里有 RFQ-AUTO-3a 一行，状态 `[G]`
