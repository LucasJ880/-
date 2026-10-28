# Design: unify-notification-href

## Context

- 两份映射（动机见 proposal.md「Why」）：
  - `src/components/header.tsx` 第 553–574 行 `handleNotificationNavigate`：处理 `task`（`/tasks?open=<id>`）、`muse_inquiry`、`blinds_order`、`sales_quote`、`trade_booth_summary`，然后项目 / 项目活动兜底；用 `window.location.href` 整页跳转；`sales_quote`、`trade_booth_summary` 跳转前 `persistSelectedOrgId(orgId)`。
  - `src/app/(main)/notifications/page.tsx` 第 140–184 行 `handleItemClick`：先把未读标已读，再处理 `task`（`/tasks/<id>`）、`project`、`blinds_order`、`sales_quote`、`approval`、`trade_prospect`、`trade_booth_summary`、`revenue_opportunity`、`sales_customer`、`sales_actions`、`visualizer_session`，然后兜底；用 `router.push`；`sales_quote`、`approval`、`trade_booth_summary`、`revenue_opportunity`、`sales_customer`、`sales_actions`、`visualizer_session` 跳转前 `persistSelectedOrgId(orgId)`。
- 任务路由：`src/app/(main)/tasks/[id]/page.tsx` 只做一件事——`router.replace(\`/tasks?open=${id}\`)`；`/tasks` 默认的工作队列（`src/components/tasks/work-queue.tsx` 第 87 行读 `focus` 或 `open`）与经典视图（`tasks-classic.tsx` 第 313 行读 `open`）都按 `open` 打开任务抽屉。
- 目标页面均已存在：`/sales/inquiries/[id]`、`/blinds-orders/[id]`、`/sales/quote-sheet`、`/trade/booth-cards`、`/projects/[id]`、`/capabilities/approvals/[approvalId]`、`/trade/prospects/[id]`、`/revenue/[id]`、`/sales/customers/[id]`、`/sales`、`/sales/visualizer/[sessionId]`、`/tasks`。
- `persistSelectedOrgId`（`src/lib/org-selection.ts`）写 `localStorage` 并派发 `qingyan-org-storage` 事件，是浏览器副作用。
- 并发：INSTALL-2b/2c 分支 `claude/vigilant-edison-73bk9i` 截至 `origin/main` = `ed3b55f` 未合并，且相对 main 没有改这两个组件。

## Goals / Non-Goals

**Goals:**
- 一处定义 `entityType` → 地址与"是否记住企业"，两个组件只负责副作用（标已读、记住企业、导航）。
- 解析器是纯函数，`npx tsx` 直接跑表驱动测试，不依赖 DOM、React、数据库。

**Non-Goals:**
- `src/app/(main)/tasks/[id]/page.tsx`、`src/components/tasks/**`、`src/lib/org-selection.ts`。
- `src/components/notification/**`（`NotificationItem` 类型、列表项、下拉组件）与 `/api/notifications/**`。
- 任何通知生产方（`src/lib/**` 中调用 `createNotification` / `notify` 的模块），包括 `src/lib/sunny-process/autogen.ts` 写的 `metadata.href`。
- `header.tsx` 中 `handleNotificationNavigate` 以外的部分（搜索、用户菜单、待办下拉第 143 行的 `/tasks?open=` 链接）；`notifications/page.tsx` 中 `handleItemClick` 以外的部分。

## Decisions

### D1：纯函数解析器放 `src/lib/notifications/href.ts`，返回 `{ href, orgScoped }`
- 做法：导出 `notificationTarget(item)` → `{ href: string; orgScoped: boolean } | null` 与便捷函数 `notificationHref(item)` → `string | null`。入参只取 `entityType`、`entityId`、`projectId`、`activityId`、`orgId`（`NotificationItem` 的子集，结构类型兼容）。组件里：`const t = notificationTarget(item); if (!t) return; if (t.orgScoped && item.orgId) persistSelectedOrgId(item.orgId);` 然后各自用原来的方式导航。
- 被否决：在解析器里直接调用 `persistSelectedOrgId`——它写 `localStorage`，解析器就不再是纯函数，`npx tsx` 测试要伪造 `window`。
- 被否决：抽一个 React hook `useNotificationNavigate` 给两个组件共用——铃铛下拉用 `window.location.href`、通知中心页用 `router.push`，hook 要么改掉其中一个的导航方式（超出本 change），要么再传入导航函数，最终还是要一个纯映射；而且 hook 不能用 `npx tsx` 直接测。
- 被否决：只返回 `string | null`，"是否记住企业"由组件按 `entityType` 再判断一次——又出现第二份类型清单，正是本次要消除的分叉。

### D2：任务通知统一为 `/tasks?open=<id>`
- 被否决：`/tasks/<id>`——它是客户端重定向过渡页，先渲染一次加载态再 `router.replace` 到 `/tasks?open=<id>`，最终地址相同但多一跳；铃铛下拉还是整页跳转，会多走一次完整的页面加载。

### D3：映射取两份的并集；类型都需要 `entityId`，`sales_actions` 例外；缺 `entityId` 时落到项目兜底
- 做法：照搬两份现有分支的判定顺序与条件，合并后两边结果唯一不同处是 `task`（D2）与铃铛下拉此前缺失的类型。
- 被否决：缺 `entityId` 的已知类型直接返回 `null`——现在两边都会落到项目兜底，改成 `null` 会让这类通知从"能跳"变成"不跳"。

### D4：地址中的 ID 一律 `encodeURIComponent`
- 现状：`muse_inquiry`、`blinds_order`、`sales_quote`、`trade_booth_summary`、`approval`、`revenue_opportunity`、`sales_customer`、`visualizer_session` 已编码；`task`、`project`、`trade_prospect` 与项目兜底未编码。
- 被否决：保持逐分支原样——同一个解析器里两种写法，下一个加类型的人照哪条抄都可能错；且现有 ID 为 cuid（字母数字），编码后输出与现在完全相同，不改变任何现有跳转。

### D5：不读 `metadata.href`
- 被否决：没有映射时回退到 `metadata.href`——唯一写它的生产方同时写了 `entityType=blinds_order`，回退永远走不到；而把 metadata 里的任意字符串当导航地址，需要先限定为站内相对路径（排除 `//host`、`javascript:` 等），这是另一件事，按 proposal「Out of scope」另开 change。

### D6：测试同时注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`
- 做法：`test-all.sh` 在第一组末尾、"测试注册校验（SDD-0）"那条之前加一行（带中文测试名与来源注释）；`test-ci-unit.sh` 在 `delivery-gate.test.ts` 那行之后加一行。
- 被否决：只注册 `test-all.sh`——CI 只跑 `npm run test:ci`，映射回归不会在 PR 上被拦下；这个测试是纯函数、毫秒级。
- 被否决：加进 `ci/test-registry-baseline.txt`——基线只减不增。

## 八条硬纪律

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 不涉及：不改 `prisma/`，不读写数据库；只读 `Notification` 已有字段 |
| 2 | 出站先审批 | 不涉及：点击跳转是站内导航，无对外发送 |
| 3 | 禁止第三套队列 | 不涉及：不新增 scheduler / queue / worker |
| 4 | 脱敏 | 不涉及：地址只含实体 ID 与企业 ID，不含金额、毛利、报价 |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守：跳转目标是查表，无 LLM 调用 |
| 8 | 测试注册 | 直接执行：新测试注册进 `scripts/test-all.sh`（并加入 CI 子集），`bash scripts/check-test-registry.sh` 退出 0 |

## Risks / Trade-offs

- [铃铛下拉里原先被兜底带去项目页的七类通知，现在改去实体页] → 这是本 change 要修的行为，与通知中心页一致；spec「两个入口跳到同一地址」覆盖。
- [INSTALL-2b/2c 若先合并并在任一组件里新增类型分支] → 实施前 `git fetch origin main` 检查这两个文件；若有新分支，把它们并进解析器与测试表，再删组件里的分支（proposal「Out of scope」已写明）。
- [没有组件级自动化测试：组件改动只靠类型检查与人工点验] → 组件里只剩"调用解析器 → 记住企业 → 导航"三行，逻辑全部在被测的纯函数里；tasks 2.x 的 verify 用 grep 确认组件中不再出现 `entityType ===` 分支。

## 验证方式

- `npx tsx src/lib/notifications/__tests__/href.test.ts` → 全部断言通过，退出 0。
- `bash scripts/check-test-registry.sh` → OK 行，退出 0。
- `npm run test:ci` → 输出含新测试的运行与 `CI unit subset PASS`，退出 0。
- `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` → 退出 0。
- `npm run lint:baseline` → 不新增 ESLint 错误。
- `grep -c 'entityType ===' src/components/header.tsx "src/app/(main)/notifications/page.tsx"` → 两个文件都输出 0。
- `npx -y @fission-ai/openspec@1.15.0 validate unify-notification-href --strict` → 通过。
