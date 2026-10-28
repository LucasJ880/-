# Tasks

## 1. 契约

- [x] 1.1 `contract.ts` 追加 `ask_colleague` / `reply_inquiry`、三个 `inquiry.*` 事件、信封可选 `opportunityId` / `inquiryId`、三个错误码；`router-pure.ts` 标签与 Phase S 文案；`muse-bridge-pure.test.ts` 意图数 14 → 16。verify：`npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts` 通过。

## 2. 纯逻辑

- [x] 2.1 新建 `inquiry-pure.ts`：问题与回复的规整、默认问题查表、Task 标题 / 描述 / 评论文本、活动记录 JSON、事件信封输入、员工确认视图；新建 `inquiry-pure.test.ts` 并注册。verify：测试通过；`bash scripts/check-test-registry.sh` 不新增欠账。

## 3. 服务与分发

- [x] 3.1 新建 `inquiry.ts`（发起、回复、按商机列询问），`router.ts` 加两个 case，`events.ts` 为询问事件设 `entityType=muse_inquiry` 与标题，`sales.ts` / `sales-pure.ts` 填 `employeeConfirmations`、`openInquiries` 与管理者下一步。verify：`tsc --noEmit` 退出 0。

## 4. 网页入口

- [x] 4.1 `GET/POST /api/sales/inquiries/[id]`、页面 `/sales/inquiries/[id]`、`header.tsx` 通知跳转。verify：`tsc --noEmit` 退出 0；服务层由 5.1 隔离库测试覆盖。浏览器内登录后打开页面的人工检查未做（需要本机登录态），见报告 §4。

## 5. 隔离库端到端

- [x] 5.1 新建 `inquiry-db.isolated.test.ts`（发起 → Task / 事件 → 非收件人被拒 → Muse 回复 → 重复回复被拒 → 发起人事件 → 商机状态员工确认 → 网页回复服务 → 重放）并注册。verify：本地隔离库全部通过；无库时跳过。

## 6. 收尾

- [x] 6.1 回归 muse-bridge 全部测试、`tsc --noEmit`、`npm run lint:baseline`。verify：全部退出 0。
- [x] 6.2 写 `docs/QINGYAN_S2_REPORT.md` 并把 TASKFLOW S2 状态列改为实际值。verify：报告存在；`grep -n "| S2 " docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示新状态。
