# Tasks

前置：MAIL-1（change `mail-read-tools`，PR #455）已合并进 main，从合并后的 main 开分支。开工前先跑将要触碰模块的已注册测试并记下基线通过数：`calendar-watch-pure`、`calendar-change-push-pure`、`type-visibility`、`notification-href`、`settings-write-guard`、`muse-bridge-pure`、MAIL-1 的四个测试、`bash scripts/test-runtime-architecture.sh`。待拍板 C 对应 3.1 里「标题固定文字、主题放内容」；待拍板 D 对应 3.1 里 Muse 事件 `mail.inbound`；待确认 E 对应 1.1 的 `senderAddress`。拍板结果与当前写法不同时先改 specs 再动对应条目。

## 1. 读接口、纯函数与开关

- [ ] 1.1 `src/lib/google-email.ts` 新增收件箱增量读取（`history.list`，`messageAdded`、`labelId=INBOX`，至多 50 封，返回处理到的历史记录 id；无游标只取当前位置；404 报过期）与单封元数据读取（`format=metadata`，头只取 `From` / `Subject` / `Date` / `Message-ID` / `Reply-To`），都经 MAIL-1 的本人邮箱读取入口；`GmailReadApi` 补 `history.list` 的 `labelId` 与历史记录 `id`；既有函数不改。新增 `src/lib/mail-watch/types.ts`、`pure.ts`（三道开关、跳过原因、`senderAddress`、归类、主题处理、通知与推送文案、收件人、页面状态、预填文字）；`src/lib/env/runtime-isolation.ts` 加 `MAIL_WATCH_ENABLED` 的解析；`.env.example` 登记。新增并在 `scripts/test-all.sh`、`scripts/test-ci-unit.sh` 注册 `src/lib/mail-watch/__tests__/mail-watch-pure.test.ts`。verify：`npx tsx src/lib/mail-watch/__tests__/mail-watch-pure.test.ts` 通过；`npx tsx src/lib/mail-read/__tests__/mail-read-pure.test.ts` 与 `npx tsx src/lib/__tests__/google-email-oauth.test.ts` 通过数不低于基线；`git grep -nE "gmail\.modify|mail\.google\.com" -- src` 与 main 相同

## 2. 配置与两个接口

- [ ] 2.1 `src/lib/mail-watch/settings.ts`：读取 `settingsJson.mailWatch`；组织开关保存（只改 `enabled`，写审计 `mail.watch.settings`）；成员勾选 / 取消（只动本人那一项，取消即删游标）；全部经 `mutateOrgSettings`。新增 `src/app/api/organizations/[orgId]/mail-watch-settings/route.ts`（GET / PUT，企业管理员或平台 super_admin）与 `src/app/api/sales/mail-watch/opt-in/route.ts`（GET / PUT，只认登录态的本人，另要求邮箱绑定页放行）；平台开关关闭时都返回 404。`settings-write-guard.test.ts` 补对 `mail-watch` 写入方的断言。新增并在 `scripts/test-all.sh` 注册 `src/lib/mail-watch/__tests__/mail-watch-db.isolated.test.ts`，本条先写配置与接口的场景（销售不能开组织开关、不能替别人勾选、取消勾选删游标、邮箱绑定页不放行的人 403）。verify：本机隔离库下该测试通过；`npx tsx src/lib/organizations/__tests__/settings-write-guard.test.ts` 通过

## 3. 编排

- [ ] 3.1 `src/lib/mail-watch/run.ts`（依赖注入：增量读取、元数据读取、线程成员、时钟、微信推送、截止时刻、组织范围）：按组织读出已勾选的在职成员 → 逐邮箱读增量 → 跳过 / 归类（在途询价线程集合、客户邮箱索引、可见性按邮箱主人的派生角色）→ 命中的按「查账本 → 通知或 Muse 事件 → 微信 → 互动 → 写账本」处理 → 每邮箱一条 `mail.watch.run` 汇总 → 锁内确认仍勾选后回写游标；游标过期写 `mail.watch.cursor_reset`；单封失败写 `mail.watch.failed`；未绑定 / 缺读信权限 / 授权失效时跳过并按 24 小时一次建重新授权提醒。互动标题固定「客户来信（邮件）」、内容「主题：…」、`analysisStatus: "skipped"`、不挂商机、`analysisResult.sourceRef` 记 `Message-ID`。通知类型 `mail_inbound` 登记进 `notifications/constants.ts`、`type-visibility.ts`、`components/header.tsx`。Muse 事件类型 `mail.inbound` 登记进 `muse-bridge/contract.ts` 与 `events.ts`。扩 `mail-watch-db.isolated.test.ts`（specs 里引用它的全部场景）。verify：本机隔离库下 `mail-watch-db.isolated.test.ts` 通过；`type-visibility`、`notification-href`、`muse-bridge-pure`、`calendar-change-push-pure` 通过数不低于基线；`git diff --stat main -- src/lib/calendar-watch src/lib/tender-rfq src/lib/notifications/href.ts` 为空

## 4. 挂进定时任务

- [ ] 4.1 `src/app/api/cron/sales-actions/route.ts` 在 `calendar-watch` 之后、`notify-email-escalation` 之前加 `mail-watch` 步骤（截止为请求开始后 265 秒，自带收错；平台开关关闭或没有满足条件的邮箱时记为跳过并写明原因）。`mail-watch-pure.test.ts` 补路由的源码断言（步骤顺序、截止毫秒数、收错）。verify：`npx tsx src/lib/mail-watch/__tests__/mail-watch-pure.test.ts` 通过；隔离库测试里「开关关闭」「截止时刻」两个场景通过；`git diff --stat main -- vercel.json` 为空

## 5. 页面

- [ ] 5.1 `src/app/(main)/settings/email/page.tsx`：「客户来信提醒」勾选项（成员本人）与组织开关（企业管理员），状态由 `pure.ts` 的页面状态函数决定；`src/app/(main)/sales/customers/[id]/interaction-timeline.tsx` 与 `types.ts`：来信观察建的条目显示「让助手读这封信」（`/assistant?prompt=…`，预填文字不含主题；读信开关关闭时不显示）。扩 `mail-watch-pure.test.ts`（页面与时间线的源码断言）。verify：`npx tsx src/lib/mail-watch/__tests__/mail-watch-pure.test.ts` 通过；本地隔离库 + `next dev` 截图存 `docs/acceptance/mail-2/`：勾选项三种状态（平台关不显示、组织关置灰、可勾选）、管理员的组织开关、客户时间线上的来信条目与入口

## 6. 验证与报告

- [ ] 6.1 全量验证，并写本地验收脚本 `scripts/mail-2-local-acceptance.ts`（真实的定时任务路由与两个接口 + 本机隔离库，Gmail 与微信推送用假实现）覆盖任务书 MAIL-2 验收的各条，输出存 `docs/acceptance/mail-2/`。verify：`npm test`（与 main 的失败集合逐项对照）、`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`openspec validate mail-watch --strict` 通过；`git diff --stat main -- vercel.json prisma/` 为空；`git grep -n "mailboxEmail" -- src/lib/mail-watch/pure.ts src/lib/mail-watch/run.ts src/lib/mail-watch/settings.ts` 无结果
- [ ] 6.2 写 `docs/QINGYAN_MAIL-2_REPORT.md`（三处拍板 / 确认的最终取值、与任务书对不上的地方、任务书 MAIL-2 验收逐条的验证方式与结果、没能验证的条目单列、测试通过数与基线对比、「最近互动时间」的影响、上线顺序与运维前置）+ 更新 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 MAIL-2 状态列。verify：报告文件存在且各节齐全；TASKFLOW 的 MAIL-2 行状态为 `[G]`

## Workflow follow-up

- 开 PR（一个 change = 一个 PR），PR 描述写明三处拍板 / 确认的取值与没能验证的条目；合并时 `MAIL_WATCH_ENABLED` 不设。
- 合并后在 staging 打开三道开关，用一个测试邮箱走任务书 MAIL-2 的验收；拿到一封真实的 `sales@` 来信的原始头，确认 `senderAddress` 的取法。
- 生产先只让 Lucas 勾选，观察一周 `mail.watch.run` 里客户来信与未匹配的比例，再放开给 Marty 与销售。
- PR 合并后 `/opsx:archive mail-watch --yes`（独立小 PR），TASKFLOW 的 MAIL-2 改成 `[x]（#PR 号）`，确认 `openspec list --specs` 列出 `mail/inbound-watch`。
