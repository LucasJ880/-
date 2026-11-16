# Design：早上 7 点的「今日新标」通知（P2-3b）

## Context

- `src/app/api/cron/daily-brief/route.ts`：每小时唤醒，只处理当地 07:00 的组织（`orgsAtLocalHour`），逐组织跑几步（展会小结、老板询盘早报、返修提醒、秘书早报），每步各自 try/catch；最后对同一批组织发 COLLAB-2 每日未读汇总邮件（未读通知都算，只排除 `daily_briefing` / `sales_daily_briefing`）。
- 早报写法参照 `owner-brief.ts`：收件人逐个、`sourceKey = <前缀>:<orgId>:<当地日期>:<userId>`，已存在就跳过。
- 采购监控：`ProcurementWatch`（每组织一份，`enabled`、`enabledById`、`createdById`）；PROC-1 扫描结果通知发给开启人与创建人。新标 = `ProcurementInstrument` 中 `instrumentClass = SOLICITATION`、未截标、未忽略 / 归档 / 历史（与 P2-1 新标视图同一口径），`firstSeenAt` 记首次发现时间。
- 通知跳转统一走 `src/lib/notifications/href.ts` 的 `entityHref` 对照表（铃铛、通知页、邮件共用）。
- 采购监控页 `ProcurementMonitor` 的筛选下拉初始值是「全部」。

## Goals / Non-Goals

**Goals**：每天早上看得到昨天新出、还能投的标，点一下进新标视图。

**Non-Goals（具体到文件）**：不改 `scan-run.ts`（含扫描结果通知）、`source-fetch.ts`、`watch-config.ts`、`schedule.ts`；不改 `src/lib/notifications/collab/**`（邮件汇总规则）；不改 `src/lib/secretary/**`（秘书早报，会调模型）；不改 `prisma/schema.prisma`。

## Decisions

### D1 挂在已有的 07:00 早报任务里

在 `daily-brief` 的逐组织循环里加一步 `sendNoticeBrief`，与其它几步一样各自 try/catch、结果计入返回。

- 否决：新加 cron。纪律 3 不加第三套调度；07:00 这一步本来就在。
- 否决：并进秘书早报。秘书早报调模型（纪律 7），而且只覆盖销售 / 外贸。

### D2 选哪些新标

`firstSeenAt` 在 [前一天当地 07:00, 当天当地 07:00) 之间（按组织时区的墙钟算），且符合新标口径（招标公告、`closingAt` 为空或晚于现在、分诊不是 IGNORED / ARCHIVED / HISTORY），按发布日期新到旧（与新标视图一致）。正文列前 5 条，标题写总数。

- 否决：「上次早报之后」。要额外存上次时刻（零 schema 下只能塞设置 JSON）；按墙钟锚定的窗口相邻两天首尾相接，效果相同。
- 否决：「现在往前 24 小时」（初稿）。夏令时切换那天两次 07:00 相隔 23 / 25 小时，回拨日会漏掉前一天 07:00–08:00 发现的、拨快日会重复列一小时；cron 每天启动的秒数不同也会留缝或重叠（独立审查 M1）。墙钟锚定后切换日窗口自然是 23 / 25 小时；cron 晚跑几分钟，07:00 之后发现的留到第二天。
- 否决：列全部在招新标。每天重复列同样的标，看不出「新」。

### D3 发给谁

与 PROC-1 扫描结果通知同一批人：监控的开启人与创建人，去重，且须仍是该组织在用成员。监控未启用、或采购监控暗合并闸关闭 → 不发。

- 否决：组织全员。新标是招投标团队的事，全员推送会变成噪音；以后要扩到项目组可另做。

### D4 通知内容与跳转

`type = procurement_notice_brief`，`category = procurement_watch`，标题「今日新标 N 条」，正文每条「· 标题（截标 MM-DD HH:mm）」，截标按多伦多时间；截标未知写「截标未知」。`entityType = procurement_new_notices`、`entityId = 当地日期`，`href.ts` 映射到 `/projects/intelligence/monitor?view=new`，监控页读 `?view=new` 初始选中「新标」。只用公告标题、编号、截标时间（公开信息），不出现任何价格。

- 否决：每条公告一条通知。一早一堆通知；汇总一条，点开看列表。

## 与八条硬纪律的关系

1. 零 schema：只写已有的 `Notification`；不改 schema。
2. 出站先审批：通知与汇总邮件只发给本组织在用成员，不对外发送。
3. 禁止第三套队列：挂在已有的 `daily-brief` 定时任务里，不加 cron、不加表。
4. 脱敏：只含公开的公告标题、编号、截标时间；不含毛利、估值、报价。
5. 不爬登录页：不涉及（不发外部请求，只读已入库的公告）。
6. 邮箱分离：不涉及。
7. 确定性优先：确定性查询与排版，不调模型。
8. 测试注册：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/procurement-records/__tests__/notice-brief-pure.test.ts`（窗口、排版、跳转、接线）
- 隔离库 `npx tsx src/lib/procurement-records/__tests__/notice-brief-db.isolated.test.ts`（选哪些、发给谁、只发一次、不发的情况）
- 门禁：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate tender-notice-brief --strict`、本地 `next build --webpack`
- 真实浏览器截图 `docs/acceptance/p2-3b/*.png`

## Risks / Trade-offs

- **截标时间**：依赖 P2-1b（东部当地时间）；P2-1b 合并前跑出的早报截标时间早 4–5 小时。
- **排期是周一、周四时**：周二到周日的早报多半没有新标（不发）；改成每天才每天有。
