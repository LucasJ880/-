# Design：采购监控的「新标」视图与每天排期（P2-1 收尾）

## Context

- 排期：`ProcurementWatch.scheduleJson`（`{ weekdays: 0–6[], hour, minute }`，多伦多本地墙钟）；`PUT /api/procurement/watch` 的 `watchConfigInputSchema` 已收 `schedule`（weekdays 1–7 个、hour 0–23、minute 0–59），没传就保留原值；`describeSchedule` 生成说明文字。设置页现在只发 filters 与 limits。
- 候选：`listCandidates(orgId, { triage, q })` 取最近更新的 100 条（不分类别），再按 PROC-1 的「资料申请优先级」排；带出关联与证据计数。证据表 `ProcurementSourceEvidence.sourceUrl` 存公告链接（CanadaBuys 招标公告来源是 `CANADABUYS_TENDER_NOTICES`）。
- P2-3a 已有纯函数从证据挑公告链接（`projectFieldsFromInstrument` 内部）。

## Goals / Non-Goals

**Goals**：管理员在页面上能改扫描时间（一键每天）；成员能一眼看到还能投的新标并打开公告。

**Non-Goals（具体到文件）**：不改 `src/lib/procurement-records/scan-run.ts`、`source-fetch.ts`、`sources-pure.ts`、`priority.ts`、`watch-service.ts`；不改 `watch-config.ts` 的校验与默认值；不改 `prisma/schema.prisma`。

## Decisions

### D1 新标视图在服务端筛

`view=new` 时 `listCandidates` 的查询条件：`instrumentClass = SOLICITATION`、`triageStatus` 不是 IGNORED / ARCHIVED / HISTORY、`closingAt` 为空或晚于现在；排序 `publishedAt` 降序（空的排后）、再 `firstSeenAt` 降序；不再按优先级重排。

- 否决：页面拿全部候选自己筛。现在只取最近更新的 100 条，筛完可能漏掉新标；也会把「已截标」的老公告先拉下来。
- 否决：新开一个接口。返回的每一行与候选完全一样（按钮、关联、跟标都要复用），多一个参数就够。

### D2 公告链接与跟标同一规则

把 P2-3a 里挑公告链接的规则抽成 `pickNoticeEvidence`（最新一条有链接的，优先 CanadaBuys 招标公告来源），跟标预填与候选列表都用它。候选列表一次性查这批候选的有链接证据（按抓取时间降序）。

- 否决：候选列表另写一套。两处挑出的链接会不一样。

### D3 排期编辑：多选星期 + 时刻 + 三个快捷按钮

快捷按钮只是填表（每天 = 0–6、工作日 = 1–5、默认 = 1、4，时刻不动）；保存时排期与打开时不同才放进请求（与 W-2 的「只发改过的」同理），至少选一天、时刻合法才发。只有组织管理员能改（与其它配置一致）。

- 否决：固定只给「每天 / 默认」两档。已有组织可能要工作日或别的组合，接口本来就支持。
- 否决：每次保存都带上排期。别人刚改过排期时，你只改关键词也会把排期改回你打开时的值。

### D4 说明文字

`describeSchedule`：七天都选 → 「每天」；周一到周五 → 「每个工作日」；其它照旧列出星期几。

- 否决：保持「每周日、周一、周二…」。七天都列出来读不出是每天。

## 与八条硬纪律的关系

1. 零 schema：只读写已有的 `ProcurementWatch.scheduleJson`（经现有接口）与只读查询；不改 schema。
2. 出站先审批：不涉及（拉取频率变了，仍是只读公开数据；不对外发送）。
3. 禁止第三套队列：不涉及（排期仍由既有 `tender-watch` cron 按槽位执行，不加 cron、不加表）。
4. 脱敏：不涉及。
5. 不爬登录页：不涉及（拉的仍是 CanadaBuys 开放数据 CSV）。
6. 邮箱分离：不涉及。
7. 确定性优先：确定性筛选与排序，不调模型。
8. 测试注册：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/procurement-records/__tests__/new-notices-pure.test.ts`
- 隔离库 `npx tsx src/lib/procurement-records/__tests__/new-notices-db.isolated.test.ts`
- PROC-1 原有 `procurement-pure.test.ts`、`procurement-records-db.isolated.test.ts`，P2-3a `tender-follow-*.test.ts` 仍通过
- 门禁：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate tender-notice-daily-view --strict`、本地 `next build --webpack`
- 真实浏览器截图 `docs/acceptance/p2-1/*.png`

## Risks / Trade-offs

- **改成每天会多拉几次 CSV**：每次两个 CSV（上限 60 MB、30 秒超时），由既有 cron 在槽位后执行；每轮新建候选仍受上限约束。
- **新标视图最多 100 条**：沿用候选列表的上限；超过时最新的 100 条在前。
