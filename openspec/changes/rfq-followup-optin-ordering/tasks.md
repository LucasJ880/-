# Tasks：个人开关的写入加锁并明确给记录时间（RFQ-AUTO-3a）

## 1. 实现

- [ ] 1.1 `auto-followup-optin-service.ts`：`setAutoDraftFollowUpOptIn` 改为一个短事务——取本人的事务级锁 → 读最近一条（连同时间）→ 状态已是想要的就不写 → 否则 `tx.auditLog.create`，时间取 max(现在, 上一条 + 1 毫秒)；写入的字段与原来相同；返回值不变
- [ ] 1.2 确认读取函数、路由、界面、`src/lib/audit/**` 没有改动（`git diff --stat` 核对）

## 2. 测试

- [ ] 2.1 `auto-draft-db.isolated.test.ts` 补：把最近一条「开启」记录的时间拨后 30 秒 → 关闭 → 状态为关、之后自动起草的卡不带授权 → 再开启 → 状态为开；同时到达的一开一关：两次都成功，最终状态与时间最晚的记录一致，各条记录时间严格递增；同时到达的两次相同设置不多写记录
- [ ] 2.2 该文件既有的 68 项断言不改即通过；`auto-followup-optin.test.ts` 19 项照旧
- [ ] 2.3 先在修复之前的代码上跑 2.1 的第一个用例，确认它确实会失败（证明用例测得到这个问题）

## 3. 验收与收尾

- [ ] 3.1 门禁：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、测试注册、架构守卫、`??` 混用检查、`openspec validate rfq-followup-optin-ordering --strict`
- [ ] 3.2 `docs/QINGYAN_RFQ-AUTO-3a_REPORT.md`；`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 加一行 RFQ-AUTO-3a
