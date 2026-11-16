## Purpose

规定早上的「今日新标」站内通知：发给谁、列哪些公告、什么时候不发、点开去哪。

## ADDED Requirements

### Requirement: 早上 7 点发今日新标
已有的早报定时任务在组织当地 07:00 SHALL 对已启用采购监控的组织取首次发现时间在前一天当地 07:00（含）到当天当地 07:00（不含）之间、未截标（或截标未知）、未被忽略 / 归档 / 标为历史记录的招标公告；有的话 SHALL 给监控的开启人与创建人（去重，且须仍是该组织在用成员、账号未停用）各发一条站内通知，标题写总数，正文按发布日期新到旧列前 5 条（标题与多伦多时间的截标时间，截标未知写明）。同一组织同一当地日期每人 SHALL 只发一次；相邻两天的窗口 SHALL 首尾相接（夏令时切换日也不重不漏）。

#### Scenario: 昨天有 7 条新标
- **WHEN** 监控已启用，昨天 07:00 到今天 07:00 首次发现 7 条未截标的招标公告
- **THEN** 开启人收到一条「今日新标 7 条」，正文列最新的 5 条与截标时间；同一天重跑不再发（`npx tsx src/lib/procurement-records/__tests__/notice-brief-pure.test.ts`；`npx tsx src/lib/procurement-records/__tests__/notice-brief-db.isolated.test.ts`）

### Requirement: 不发的情况
没有符合条件的新标、监控未启用、采购监控未启用（暗合并闸关闭）时 SHALL NOT 发通知；收件人已不是该组织在用成员、或账号已停用的 SHALL NOT 收到。通知 SHALL NOT 含任何价格、毛利、估值或报价，只含公开的公告标题、编号与截标时间。

#### Scenario: 夏令时切换日
- **WHEN** 多伦多 11 月第一个周日回拨（两次 07:00 相隔 25 小时）或 3 月第二个周日拨快（相隔 23 小时）
- **THEN** 窗口相应为 25 / 23 小时，前一天 07:00–08:00 发现的既不漏也不重复（`notice-brief-pure.test.ts`）

#### Scenario: 都是旧的或已截标的
- **WHEN** 窗口内没有新发现的公告，或新发现的都已截标、被忽略或是合同
- **THEN** 不发（`notice-brief-db.isolated.test.ts`）

#### Scenario: 监控未启用
- **WHEN** 组织的采购监控未启用
- **THEN** 不发（`notice-brief-db.isolated.test.ts`）

### Requirement: 点开进新标视图
这条通知 SHALL 跳到采购监控并直接选中「新标」筛选（`/projects/intelligence/monitor?view=new`），打开前记住通知所属组织；铃铛、通知页与邮件 SHALL 用同一跳转。

#### Scenario: 点通知
- **WHEN** 在铃铛或通知页点「今日新标」
- **THEN** 打开采购监控，筛选是「新标（未截标的招标公告）」（`notice-brief-pure.test.ts`）
