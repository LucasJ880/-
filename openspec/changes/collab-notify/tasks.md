# Tasks

每条任务都按同一个顺序做：先写失败测试，运行确认失败，再实现到通过。新测试文件在同一条任务里注册进 `scripts/test-all.sh`；纯逻辑的同时注册进 `scripts/test-ci-unit.sh`。

## 1. 通知类型与偏好

- [x] 1.1 先写 `src/lib/notifications/__tests__/collab-preferences.test.ts`，覆盖：
  - 五个新类型进了注册表、设置页名称表与两处图标表（源码断言）；
  - 门禁判定：
    - 没有 `knownTypes` 的清单：五个新类型为开，`install_*` 仍按时间规则；
    - 有 `knownTypes` 的清单：不在 `knownTypes` 里的类型为开，在 `knownTypes` 里但不在清单里的为关；
  - 模拟四处偏好写入之后，原先视为开启的类型仍然开启；
  - 邮件偏好的生效值：没有 `emailChoiceAt` 时为开，有时按列取值；
  - 设置页文案（源码断言）：名称、说明、分组标题、页面说明，且不含"当前未连接发信"。

  运行确认失败。再按 design D12、D13 修改：`src/lib/notifications/{constants,delivery-gate,preferences}.ts`、`src/lib/proactive/automation-prefs.ts`、`src/app/api/notifications/preferences/me/route.ts`、通知设置页、`notification-type-toggle-list.tsx`、`notification-list-item.tsx` 与 `header.tsx` 的图标表。
  verify：该测试全过，`delivery-gate.test.ts`、`mark-all-read.test.ts` 仍全过。

## 2. 公共层：脱敏、投递入口、跳转与登录回跳

- [x] 2.1 先写三个测试：
  - `collab-redact.test.ts`：spec 里四类命中的用例与"不误伤"的用例；
  - `collab-events.test.ts` 的公共部分：收件人过滤（在职、active 成员、排除操作人、去重）；去重键；P2002 当作已存在；门禁不通过时不写；写入出错只记日志、不外抛。数据库与门禁都从参数注入。
  - `notification-href.test.ts`：取用顺序与三条规则的每一行、URL 编码、没有跳转目标的情况；`next` 的合法值与非法值；中间件生成的登录地址；源码断言铃铛与通知页都调用共用函数、项目页处理 `#project-discussion`。

  运行确认失败。再新增 `src/lib/notifications/collab/{redact,deliver,recipients}.ts`、`src/lib/notifications/href.ts`、`src/lib/auth/safe-next.ts`，并修改 `header.tsx`、通知页、项目页、`src/middleware.ts`、登录页与选择组织页。
  verify：三个测试全过；改了中间件与登录页，所以 `src/lib/marketing/__tests__/marketing-middleware-access.test.ts` 与 `src/components/wechat-entry/__tests__/wechat-entry-render.test.tsx` 仍全过。

## 3. 讨论区 @

- [x] 3.1 先写 `collab-mentions.test.ts`，覆盖：
  - 名单格式：不是数组、缺 `userId`、超过 20 人时返回 `MENTION_INVALID`；按 `userId` 去重；`name` 截到 50 个字符；不保存多余字段；
  - 三个接收条件与 @ 自己；`invalidUserIds` 里不含姓名；
  - 重发判定：讨论区只有带 @ 才判、名单要相同；任务评论不论带不带 @；10 分钟边界；比较前去掉首尾空白；
  - 标题与 80 字摘要，含脱敏。

  再写 `collab-wiring.test.ts` 的讨论区部分（源码断言）：创建成功之后才调用入口；调用不外抛；重发分支不发通知；锁与查重在同一个事务里；成员卡片的头像 @ 只对 active 成员提供。运行确认失败。
  然后新增 `src/lib/notifications/collab/mentions.ts`，修改 `src/app/api/projects/[id]/discussion/messages/route.ts`、`src/lib/project-discussion/service.ts` 与工作台成员卡片。
  verify：两个测试全过。

## 4. 任务：@、评论、指派与状态

- [x] 4.1 先写测试：
  - `collab-mention-input.test.ts`：
    - 在行首或空白后输入 `@` 才触发；按姓名包含过滤；在光标处插入 `@姓名 `；发送名单只含正文里仍出现的人；
    - 源码断言：任务抽屉的评论框与讨论区输入框都接了共用 hook 与 `MentionDropdown`；候选列表打开时，回车选中候选、不发送；4xx 时显示错误并保留草稿。
  - 在 `collab-events.test.ts` 加任务三类事件的收件人、标题、摘要与事件区分键用例：改派与取消指派、创建时指派、批量 A/A/B、评论排除已被 @ 的人、截止日期按组织时区。
  - 在 `collab-wiring.test.ts` 加任务各接口的接线断言：
    - `POST /api/tasks`、`PATCH /api/tasks/[id]`、`POST /api/tasks/batch`；
    - 评论 POST 先做 404 校验，并写 `comment.mentioned` 活动记录；
    - `mention-candidates` 路由做 404 校验。

  运行确认失败。再新增 `src/lib/tasks/access.ts`（移入 `canAccessTask`）、`src/lib/notifications/collab/{events,mention-input}.ts`、`src/app/api/tasks/[id]/mention-candidates/route.ts`，并修改任务各路由、`task-drawer.tsx` 与 `project-discussion-composer.tsx`。
  verify：三个测试全过，`npx tsx src/lib/tasks/__tests__/status-transition.test.ts` 仍全过。

## 5. 工艺单阶段与项目文件上传

- [x] 5.1 先在 `collab-events.test.ts` 加用例：
  - 工艺单：
    - 四个阶段的标题、摘要（已排期带安装日期）与事件区分键；
    - 下一阶段负责角色：按品类键或 `install.task.assign` 取人；只持全品类键的人不收；没有组织时只通知创建人与商机负责人；没有商机时不含商机负责人；
    - 变为已安装等其他状态时不发；
  - 文件上传：标题；摘要取前 3 个文件名，超过 3 个加"等"，文件名脱敏；事件区分键；收件人为 active 项目成员与负责人，上传人除外。

  再在 `collab-wiring.test.ts` 加 `/transition`、`PUT /api/blinds-orders/[id]`、`POST /api/projects/[id]/files` 的接线断言。运行确认失败。
  然后在 `src/lib/notifications/collab/recipients.ts` 实现工艺单取人，并在两个工艺单路由与文件上传路由里调用入口。
  verify：两个测试全过；`src/lib/fulfillment/__tests__/{category,order-access}.test.ts` 仍全过。

## 6. 未读升级邮件

- [ ] 6.1 先写 `collab-email-escalation.test.ts`（注入当前时间、通知、偏好、用户与发送函数），覆盖：
  - 发送条件：15 分钟与 24 小时两个边界；只限两种类型；已读、已完成、稍后提醒中的不发；
  - 防重：已发的不再发；认领的条件更新没命中时不发；10 分钟内正在发送的跳过；
  - 跳过：偏好关、免打扰（不论优先级）、账号停用或不是 active 成员、地址不可投递；跳过之后不再试；
  - 失败：重试到第 3 次为止；`metadata` 合并保留原内容，状态不变；
  - 内容：主题；正文五段；事项行（`｜` 替换为 `/`、截止按组织时区、绝对链接、没有跳转目标时回落 `/notifications`）；邮件脱敏；
  - 收件地址过滤；非生产只记日志并标 `emailDryRun`；
  - 缺 `RESEND_API_KEY` 或 `NEXT_PUBLIC_APP_URL` 时整轮跳过；单轮 100 封与截止时刻。

  再在 `collab-wiring.test.ts` 断言：`sales-actions` 路由的最后一步调 `runTrackedAutomation("notify-email-escalation"`，并自带 `.catch`；`collab/email.ts` 不导入 `EmailProvider` 与 LLM 客户端。运行确认失败。
  然后：
  - 新增 `src/lib/notifications/collab/{email,escalation}.ts`，修改 `sales-actions` 路由；
  - 把 `notify-email-escalation` 登记进 `AUTOMATION_REGISTRY`、`AUTOMATION_SCHEDULES` 与岗位注册表（`ops_knowledge`）；
  - `schedule.test.ts` 补最长间隔 15 分钟的用例。

  verify：该测试全过；`src/lib/cockpit/__tests__/{schedule,posts,posts-read-model}.test.ts` 仍全过；`src/lib/sales/__tests__/action-loop-contract.test.ts` 与基线一致（基线 3 过 1 败，失败项断言的是销售行动扫描代码的写法，与本 change 无关；该文件在 `ci/test-registry-baseline.txt` 里，`npm test` 不跑）；`npm run typecheck` 通过。

## 7. 每日未读汇总与纪律第 2 条

- [ ] 7.1 先写 `collab-email-digest.test.ts`（注入时间，模拟组织当地 7 点），覆盖：
  - 收件人：到点组织的在职 active 成员，跨组织去重；没有未读不发；两类简报不计入；不受免打扰影响；
  - 内容：分组顺序与组内排序；50 条上限与"另有 M 条"；主题里的计数；其他功能写的通知标题也脱敏；
  - 每人每天一封：同一本地日期已有审计记录时不发；两个同时区组织只发一封；发送失败当天不补发；
  - 审计记录的内容，且不带组织 id；单轮 300 封。

  再在 `collab-wiring.test.ts` 断言：`daily-brief` 路由在既有响应算出之后调 `runTrackedAutomation("notify-email-digest"`，并自带 `.catch`。运行确认失败。
  然后：
  - 新增 `src/lib/notifications/collab/digest.ts`，修改 `daily-brief` 路由；
  - 把 `notify-email-digest` 登记进注册表、调度表与岗位注册表（`ops_knowledge`）；
  - `schedule.test.ts` 的组织门控清单加 `notify-email-digest`，并补最长间隔 1440 分钟的用例；
  - 把任务书 §5.4 的原句追加到 `openspec/config.yaml` 第 2 条末尾。

  verify：该测试全过；`src/lib/cockpit/__tests__/{schedule,daily-digest,posts}.test.ts` 仍全过；`grep -c '属于站内通知的补位，不算对外发送' openspec/config.yaml` 输出 `1`。

## 8. 收尾

- [ ] 8.1 门禁、报告与 TASKFLOW：
  - 提交后，跑 design「验证」里的不动项 diff，以及 `bash scripts/check-test-registry.sh`、`npm run typecheck`、`npm run lint:baseline`、`npm test`、`openspec validate collab-notify --strict`。
  - 写 `docs/QINGYAN_COLLAB-2_REPORT.md`，内容包括：改动、与任务书的出入、测试与门禁的真实输出、运维前置（`NEXT_PUBLIC_APP_URL=https://qingyan.ca`）、在 staging 走 GATE 1–8 的步骤。
  - 更新 TASKFLOW：COLLAB-2 状态列改为 `[G]`；GATE-C 下补一行运维前置；Evan 在审核中拍板的决定记进「已决定」。

  verify：diff 输出为空，其余命令全部通过；报告文件存在；`grep -n 'COLLAB-2' docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 显示该行状态为 `[G]`。

## Workflow follow-up

- 开 PR 前贴出 `openspec validate collab-notify`、`npm run typecheck`、`npm run lint:baseline`、`npm test` 的真实输出。一个 change 对应一个 PR，不自动合并。
- GATE 1–8 在 staging 预览上用两个测试账号验收；要收到真实邮件，需临时开 `QINGYAN_ALLOW_REAL_EMAIL_NON_PROD`（由 Evan 操作）。
- 合并后看合并提交上 Vercel 生产与 staging 两个构建的状态。
- 合并后用独立的小 PR 执行 `/opsx:archive collab-notify --yes`：specs 增量合入 `openspec/specs/notifications/{mentions,activity-events,email-reminders,preferences,click-targets}/` 与 `openspec/specs/cockpit/{post-registry,posts-overview}/`，TASKFLOW COLLAB-2 改为 `[x]`。
