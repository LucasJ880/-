# P2-1b 报告：CanadaBuys 截标时间按东部当地时间解析

| 项 | 值 |
|---|---|
| change | `canadabuys-closing-tz` |
| TASKFLOW | P2-1b（P2-1 数据口径修正） |
| 来源 | P2-1 独立审查 M1；2026-11-16 只读核对 CanadaBuys 在招公告 CSV；Lucas 2026-11-16「继续按照你推荐的做」 |
| 分支 | `claude/canadabuys-closing-tz`（从 main 开） |
| 性质 | 改解析纯函数 + 扫描更新时同步关联项目截标日。零 schema、零模型调用、没有开关、不做一次性数据修正 |

## 1. 问题

CanadaBuys 开放数据的截标时间写成 `2026-12-15T14:00:00`、不带时区，是东部当地时间。PROC-1 按服务器时区解析（生产 UTC），多伦多下午 2 点被存成多伦多上午 9 点：页面显示的截标时间早 4–5 小时，新标视图与「跟这个标」会提前约 5 小时把当天截标的公告当成已截标，跟标建出的项目截标日与日程提醒也早。

**只读核对**（2026-11-16，`openTenderNotice-ouvertAvisAppelOffres.csv` 前 537 行，固定只读 User-Agent，未写库）：截标时间全部是 `YYYY-MM-DDTHH:MM:SS`、无时区；时刻集中在 14:00、13:00、17:00、16:00、15:00。

## 2. 做了什么

- 新增 `canadaBuysInstant`：不带时区的日期时间按 `America/Toronto` 换算成 UTC（夏令时由已有的 `zonedWallTimeToUtc` 处理），与进程时区无关；带 `Z` / 偏移的照原样；只有日期的照旧；越界、不存在的日历日期、不带时区的非标准写法 → null。CanadaBuys 截标时间改用它。
- 已入库、仍通过扫描筛选的在招公告：扫描本来就会用来源值更新截标时间，下一次扫描即改正。
- 公告截标时间变了（改正或延期）：关联为「本项目」、截标日仍等于旧值的项目跟着改并同步日程；被人改过的不动。P2-3a 上线后跟出的项目因此也会被改正。
- 优先级理由里的截标日期按多伦多日期写。

## 3. 交付清单

| 位置 | 改动 |
|---|---|
| `src/lib/procurement-records/sources-pure.ts` | `canadaBuysInstant`、截标时间改用它 |
| `src/lib/procurement-records/instruments.ts` | 截标时间变了 → `syncLinkedProjectCloseDates` |
| `src/lib/procurement-records/priority.ts` | 理由里的截标日期按多伦多日期 |
| `src/lib/procurement-records/__tests__/closing-tz-pure.test.ts`（新） | 26 项（UTC / 上海 / 温哥华进程时区结果相同） |
| `src/lib/procurement-records/__tests__/closing-tz-db.isolated.test.ts`（新） | 9 项 |

## 4. 证据

| 测试 | 项数 | 内容 |
|---|---|---|
| `closing-tz-pure.test.ts` | 26 | 冬令时、夏令时、没有秒、23:59:59 跨日、空格分隔、跳变中间的 02:30 顺延、跳变后、重复时刻取第一次、带 Z、带偏移、只有日期、小数秒、秒 60、不存在的日历日期、不带时区的非标准写法、空 / 乱写 / 越界、整段 CSV 解析、优先级理由的多伦多日期、接线 |
| `closing-tz-db.isolated.test.ts` | 9 | 旧口径存的 14:00Z 下一次扫描改为 19:00Z；记一次证据变化；关联的跟标项目截标日跟着改、日程同步；被人改过的项目不动；再扫一次不再算变化 |

两个新测试在 main 上都失败（纯函数测试找不到新函数；隔离库测试 3 项失败）。PROC-1 原有 `procurement-pure`（95）、`procurement-records-db`（158）、`disclosure-analysis-pure`（50）、`records-request-pure`（180），P2-3a `tender-follow-db`（41）仍全部通过。

变异 5 处（时区改 UTC、截标仍用旧解析、丢掉秒、去掉时 / 分 / 秒越界检查、秒变成必填）全部被发现；独立审查另做的变异里存活 3 处（只去掉 `second > 59`、去掉小数秒分组、跳变分支换偏移）——补了秒 60、小数秒、跳变中间 02:30 的用例。

**门禁**

| 门禁 | 结果 |
|---|---|
| `npm run test:ci` | `CI unit subset PASS`（本机，CI 的环境变量） |
| `npm run typecheck` | 通过 |
| `npm run lint:baseline` | PASS |
| `bash scripts/check-test-registry.sh` | OK |
| `bash scripts/test-runtime-architecture.sh` | PASS |
| `openspec validate canadabuys-closing-tz --strict` | valid |

## 4b. 独立审查

| 编号 | 发现 | 处理 |
|---|---|---|
| M1 | 「跟这个标」建出的项目截标日是建项时的复制，扫描只改公告，P2-3a 上线后跟出的项目会一直早 4–5 小时 | 修。截标时间变了 → 截标日仍等于旧值的关联项目跟着改并同步日程（也覆盖延期） |
| M2 | 「下次扫描自愈」只覆盖仍通过扫描筛选的公告（发布超过 120 天或不再命中关键词的不会再处理） | 文档写准；不改扫描筛选（见已知限制） |
| L1 | 不存在的日历日期被顺延（`2026-13-01` → 次年） | 修。→ null |
| L2 | 不带时区的非标准写法仍走 `new Date()`，随进程时区变 | 修。→ null；只有带 Z / 偏移的照原样 |
| L3 | 小数秒没测 | 补用例 |
| L4 | 优先级理由的截标日期用 UTC 日期，晚上截标会写成次日 | 修。按多伦多日期 |
| L5 | 报告里的变异说法不准、跳变用例标题、proposal 的 Why 超过两句 | 修 |

## 5. 已知限制

- **夏令时口径未经原文核对**：搜索到的官方说明转述截标时间以「UTC-0500」表示，公告页面显示 EST / EDT。冬令时（现在到 2027-03-14）两者一致；夏令时期间若 CSV 其实是固定 UTC-5，本方案会晚 1 小时。官方说明页（`donnees-data.tpsgc-pwgsc.gc.ca`）不在本会话网络放行范围。**2027 年 4 月前**用一条夏季截标、公告页在 canadabuys.canada.ca 上的公告比对一次（页面 13:00 EDT ↔ CSV 13:00 则本方案对；CSV 12:00 则改成固定 UTC-5）。已写进交接文档。
- **上线后第一次扫描**：每条命中的在招公告记一条「证据变化」，监控开启人收到一条汇总通知（「证据变化 N 处」）。只发生一次。
- 不再通过扫描筛选的老公告保持原值：发布超过回看天数（默认 120 天）仍在招的、或不再命中关键词 / 机构 / 地区的，截标当天可能提前约 5 小时被当成已截标、不能跟。可以手动「跟这个标」之前先确认截标时间，或把回看天数调大后扫描一次。
- 已截标、不再出现在 CSV 的老公告保持原值（不影响新标视图与跟标）。

## 6. 上线

合并后照常部署；下一次采购监控扫描即改正在招公告的截标时间。回滚 = 回滚代码（之后的扫描会按旧口径再写回）。
