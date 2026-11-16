# Design：CanadaBuys 截标时间按东部当地时间解析（P2-1b）

## Context

- `sources-pure.ts` `parseCanadaBuysNoticesCsv`：`closingAt: toIsoInstant(get(row, "closingDate"))`，`toIsoInstant` 是 `new Date(s).toISOString()`——不带时区的 ISO 日期时间按**运行进程的时区**解析（生产 UTC，本机开发多为 UTC）。
- 2026-11-16 只读核对 `openTenderNotice-ouvertAvisAppelOffres.csv` 前 537 行：`tenderClosingDate-appelOffresDateCloture` 全部是 `YYYY-MM-DDTHH:MM:SS`、无时区；时刻集中在 14:00、13:00、17:00、16:00、15:00（东部当地时间的常见截标时刻）。
- 搜索到的官方说明转述「截标时间以 UTC-0500 表示」；公告页面显示 EST / EDT。两者在冬令时（11 月初到 3 月中）一致；夏令时期间会差 1 小时。官方说明页（`donnees-data.tpsgc-pwgsc.gc.ca`）不在本会话的网络放行范围，未能直接核对原文。
- `schedule.ts` 已有 `zonedWallTimeToUtc(date, hour, minute, timeZone)`（Intl 求本地墙钟对应 UTC，处理夏令时跳变）。
- `instruments.ts` 更新已存在的公告时 `if (r.closingAt) data.closingAt = d(r.closingAt)`：下一次扫描到即改正。证据内容哈希包含截标时间，改正时会记一条新证据、`lastChangedAt` 更新；运行结束的通知是每次扫描汇总一条（「证据变化 N 处」）。

## Goals / Non-Goals

**Goals**：CanadaBuys 公告的截标时间按东部当地时间存对；新标视图、跟标、项目截标日随之正确。

**Non-Goals（具体到文件）**：不改 `scan-run.ts`、`source-fetch.ts`（扫描筛选不变）、`views.ts`、`tender-follow*.ts`；不改其它来源的解析（`parseCkanContractRows` 等）；不改 `prisma/schema.prisma`。`instruments.ts` 只加 D3 的项目截标日同步；`priority.ts` 只改理由里的日期写法（D4）。

## Decisions

### D1 不带时区 → 按 America/Toronto 当地时间

新函数 `canadaBuysInstant(s)`：`YYYY-MM-DDTHH:MM(:SS)?` 且无 `Z` / 偏移 → `zonedWallTimeToUtc(日期, 时, 分, "America/Toronto")` 加上秒；带 `Z` 或 `±HH:MM` → `new Date(s)`；只有日期 → 照旧（UTC 零点，日历日期）；解析不了 → null。只用于截标时间。

- 否决：固定 UTC-5。冬令时与本方案相同；夏令时期间若 CSV 其实是固定 UTC-5，本方案会晚 1 小时。公告页面显示 EDT（跟夏令时走），而且当前（11 月）两者无差别——选跟页面一致的读法，并在 Risks 记下明年 4 月前要用一条夏季截标的公告页核对一次。
- 否决：设置进程时区 `TZ=America/Toronto`。影响全站所有时间计算。
- 否决：维持现状、只在显示时加 5 小时。存下的时间仍错，新标视图与跟标的截标判断仍早。

D1 补充（独立审查 L1 / L2）：日历日期必须真实存在（`2026-13-01` 不再顺延成次年）；不带时区、又不是 ISO 写法的（如 `2026/12/15 14:00`）→ 空，不退回 `new Date()`（否则结果仍随进程时区变）。

### D2 不做一次性数据修正

在招公告每次扫描都在 CSV 里，**通过扫描筛选的**（回看天数内发布、命中关键词 / 机构 / 地区）会被更新（D1 后自动改对）。不再通过筛选的老公告（如发布超过 120 天仍在招的长期供应安排）保持旧值——截标当天可能提前约 5 小时被当成已截标（独立审查 M2）；不为此改扫描筛选（不在范围）。改生产数据需要 Lucas 明确同意，这里不需要。

- 否决：写迁移脚本批量改。没有必要，且属于生产数据变更。

### D3 关联项目的截标日跟着改

「跟这个标」在建项那一刻把公告截标时间复制成项目截标日（独立审查 M1：P2-3a 上线后、本 change 上线前跟出的项目截标日会一直早 4–5 小时）。扫描更新公告时，若截标时间变了：关联为「本项目」、且项目截标日仍等于公告旧截标时间的项目，改成新值并同步里程碑日程；截标日已被人改成别的值的不动。这同时覆盖公告延期。

- 否决：一次性脚本改已有项目。属于生产数据变更，且以后公告延期还会再错。
- 否决：凡关联的都改。会覆盖人手改过的截标日。

### D4 优先级理由的截标日期

`priority.ts` 理由里写 `closingAt.slice(0,10)`（UTC 日期）；按东部存对之后，晚上 7 点（EST）以后截标的会写成次日。改成按多伦多日期写。

- 否决：保持 UTC 日期。改正之前碰巧对，改正之后反而错。

## 与八条硬纪律的关系

1. 零 schema：只改解析的纯函数；不改 schema。
2. 出站先审批：不涉及（仍是只读拉取公开数据）。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及。
5. 不爬登录页：不涉及（只读开放数据 CSV；本次核对也只读 CSV）。
6. 邮箱分离：不涉及。
7. 确定性优先：确定性换算，不调模型。
8. 测试注册：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/procurement-records/__tests__/closing-tz-pure.test.ts`（冬令时、夏令时、带 Z / 偏移、只有日期、跳变时刻、整段 CSV 解析）
- 隔离库 `npx tsx src/lib/procurement-records/__tests__/closing-tz-db.isolated.test.ts`（已入库的错误时间被下一次扫描改正、只记一条变化）
- PROC-1 原有 `procurement-pure.test.ts`、`procurement-records-db.isolated.test.ts`，P2-1 / P2-3a 测试仍通过
- 门禁：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate canadabuys-closing-tz --strict`

## Risks / Trade-offs

- **夏令时口径未经原文核对**：明年 4 月前用一条夏季截标、公告页在 canadabuys.canada.ca 上的公告，比对 CSV 时刻与页面时刻（页面 13:00 EDT ↔ CSV 13:00 则本方案对；CSV 12:00 则是固定 UTC-5，需改 D1）。写进交接文档。
- **上线后第一次扫描**：每条命中的在招公告记一条「证据变化」、`lastChangedAt` 更新、重算优先级；监控开启人收到一条汇总通知（「证据变化 N 处」）。只发生一次；回滚会再来一次。
- **不再通过筛选的老公告**：见 D2，保持旧值。
- **服务器时区**：换算不再依赖进程时区（本机与生产结果一致）。
