# Proposal：询盘收件箱里「谁回复了谁」说清楚，不能回复的人不出现回复操作（NAV-6）

TASKFLOW：NAV-6（Phase N；来源是 `docs/QINGYAN_NAV-1c_REPORT.md` §4 第 4、6 条与 §7 的后续队列，Lucas 2026-11-15「3.要做」）。没有单独的任务书，本 proposal 即任务口径。核对基线：main `59ab1837`（2026-11-15，含 NAV-1a / 1b / 1c 及其归档）。四件套待审，审核通过前不动业务代码。

## Why

询盘收件箱的同一张卡片上，「已回复」现在有两个相反的意思：买家名字旁的灰色标签指「买家来信了」（线索阶段），卡片下方的绿色文字指「我方回复了」；一张还在等我们回复的卡片会同时写着「已回复」和「写回复」。另外 NAV-1c 给每张卡片加了回复按钮，却没有区分当前成员能不能回复。

## What Changes

**线索阶段的显示名**
- 把外贸线索阶段 `replied`（买家来过信）的显示名由「已回复」改为「买家已来信」。只改显示名，阶段取值、流转与统计口径不变。
- 让写着这个阶段名字的另外四处与它同源：外贸获客首页的概览卡、外贸看板接口的漏斗、活动漏斗统计接口、外贸助手的阶段分布文字。

**询盘收件箱 `/trade/inbox`**
- 把已由我方回复的会话卡片上的状态文字由「已回复」改为「我方已回复」。
- 给 `GET /api/trade/inbox` 与 `GET /api/trade/inbox/focus` 的响应加一个能力标记 `capabilities.reply`（布尔）：当前成员在该企业持 `trade.manage`（或是平台 super_admin）时为真。
- 让回复操作只对能回复的成员出现：`reply` 为假时不显示「写回复」「再写一封」「已回复，标记」；「查看回复草稿」仍可打开，但窗口只读，没有「发送邮件」「已在别处发送，标记」，并写明「你的岗位只能查看询盘，不能回复」。
- 让带线索或商机的深链在 `reply` 为假时不打开空白回复窗口，改为提示「你的岗位只能查看询盘，不能回复」。

## Capabilities

### New Capabilities
- `trade/prospect-stage-labels`: 外贸线索阶段在界面、接口与助手文字里的显示名（本次只定 `replied` 一个阶段）。

### Modified Capabilities
- `trade/inquiry-reply-entry`: 改「每张会话卡片都有回复按钮」（限定为能回复的成员）；新增「我方已回复」的说法、回复能力标记、不能回复的成员看不到回复操作三条要求。

## Impact

- 接口：`GET /api/trade/inbox`、`GET /api/trade/inbox/focus`（`capabilities` 多一个布尔字段，其余不变）；`GET /api/trade/dashboard`、`GET /api/trade/campaigns/[id]/stats`（漏斗里这一档的 `label` 文字变化，`stage` / `key` 与数字不变）。
- 页面：`src/app/(main)/trade/inbox/page.tsx`、`src/app/(main)/trade/page.tsx`（概览卡一个标签）。线索详情、活动详情、驾驶舱漏斗随阶段名自动变化，不改文件。
- 库：`src/lib/trade/stage.ts`（一个显示名）、`src/lib/trade/chat-assistant.ts`（阶段分布一行）。
- 助手读到的文字：外贸助手、数字员工的外贸工具、秘书跟进引擎里出现的这个阶段名由「已回复」变为「买家已来信」。不新增任何模型调用。
- 测试：新增 `src/lib/trade/__tests__/reply-clarity.test.ts`（纯函数 + 源码断言），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；`reply-entry-db.isolated.test.ts` 加一组「只持 `trade.read` 的成员」；`reply-entry.test.ts` 随按钮出现条件调整。
- 数据库、权限键、岗位模板、路由门映射表、回复接口 `POST /api/trade/inbox/[prospectId]/reply`（仍要求 `trade.manage`）、发信、Muse 桥接：不动。
- 没有开关，合并即生效；回滚 = revert。BREAKING · 文案：所有开了外贸模块的企业都会看到这个阶段改名。

## Out of scope

- 按钮「已回复，标记」与使用说明里引用它的那一行：名字不改。
- 其他阶段的显示名，以及看板漏斗与阶段表之间既有的不一致（例如漏斗写「已联系」、阶段表写「已触达」）。
- 询盘收件箱以外的外贸页面对只读成员的按钮显隐（线索详情、外贸报价、寄样等）；卡片上「新建报价」「开寄样单」两个跳转链接。
- 新增只读外贸岗位模板，或改任何岗位模板的权限键。
- 今日询盘、商机详情里「去询盘收件箱自己写」两处链接的出现条件（仍只看询盘收件箱是否放行）。
- 招投标询价、展会卡、询盘（`inquiry`）等其他模块里同样叫「已回复」的状态。
- 英文界面。
