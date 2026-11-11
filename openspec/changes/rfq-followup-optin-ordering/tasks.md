# Tasks：个人开关的写入加锁并明确给记录时间（RFQ-AUTO-3a）

## 1. 实现

- [x] 1.1 `auto-followup-optin-service.ts`：`setAutoDraftFollowUpOptIn` 改为一个短事务——取本人的事务级锁 → 读最近一条（连同时间）→ 状态已是想要的就不写 → 否则 `tx.auditLog.create`，时间取 max(现在, 上一条 + 1 毫秒)；写入的字段与原来相同；返回值不变
- [x] 1.2 确认读取函数、路由、界面、`src/lib/audit/**` 没有改动（`git diff --stat` 核对）

## 2. 测试

- [x] 2.1 `auto-draft-db.isolated.test.ts` 补：把最近一条「开启」记录的时间拨后 30 秒 → 关闭 → 状态为关、之后自动起草的卡不带授权 → 再开启 → 状态为开；同时到达的一开一关：两次都成功，最终状态与时间最晚的记录一致，各条记录时间严格递增；开关是关时同时到达两次开启只写一条，已经是开时不写
- [x] 2.2 该文件既有的 68 项断言不改即通过（现 75 项）；`auto-followup-optin.test.ts` 19 → 21：其中一条源码断言原来写的是「用 writeAuditLog」，随实现改为「事务里的一次追加」，另加两条（先取锁再读再写、时间至少比上一条晚）
- [x] 2.3 先在修复之前的代码上跑 2.1：新加的 7 条里 6 条失败（关闭后状态仍是开、随后自动起草的卡带了授权、同时到达的两次开启一条都没多写或写了两条），修复后连跑三次 75 项全过

## 3. 验收与收尾

- [ ] 3.1 门禁：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、测试注册、架构守卫、`??` 混用检查、`openspec validate rfq-followup-optin-ordering --strict`
- [ ] 3.2 `docs/QINGYAN_RFQ-AUTO-3a_REPORT.md`；`docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 加一行 RFQ-AUTO-3a
