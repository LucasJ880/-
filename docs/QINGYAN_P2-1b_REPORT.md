# P2-1b 报告：CanadaBuys 截标时间按东部当地时间解析

| 项 | 值 |
|---|---|
| change | `canadabuys-closing-tz` |
| TASKFLOW | P2-1b（P2-1 数据口径修正） |
| 来源 | P2-1 独立审查 M1；2026-11-16 只读核对 CanadaBuys 在招公告 CSV；Lucas 2026-11-16「继续按照你推荐的做」 |
| 分支 | `claude/canadabuys-closing-tz`（从 main 开） |
| 性质 | 改一个解析纯函数。零 schema、零模型调用、没有开关、不改数据（下次扫描自愈） |

## 1. 问题

CanadaBuys 开放数据的截标时间写成 `2026-12-15T14:00:00`、不带时区，是东部当地时间。PROC-1 按服务器时区解析（生产 UTC），多伦多下午 2 点被存成多伦多上午 9 点：页面显示的截标时间早 4–5 小时，新标视图与「跟这个标」会提前约 5 小时把当天截标的公告当成已截标，跟标建出的项目截标日与日程提醒也早。

**只读核对**（2026-11-16，`openTenderNotice-ouvertAvisAppelOffres.csv` 前 537 行，固定只读 User-Agent，未写库）：截标时间全部是 `YYYY-MM-DDTHH:MM:SS`、无时区；时刻集中在 14:00、13:00、17:00、16:00、15:00。

## 2. 做了什么

- 新增 `canadaBuysInstant`：不带时区的日期时间按 `America/Toronto` 换算成 UTC（夏令时由已有的 `zonedWallTimeToUtc` 处理），与进程时区无关；带 `Z` / 偏移的照原样；只有日期的照旧；越界或乱写 → null。CanadaBuys 截标时间改用它。
- 已入库的在招公告：扫描本来就会用来源值更新截标时间，下一次扫描到即改正，不改数据。

## 3. 交付清单

| 位置 | 改动 |
|---|---|
| `src/lib/procurement-records/sources-pure.ts` | `canadaBuysInstant`、截标时间改用它 |
| `src/lib/procurement-records/__tests__/closing-tz-pure.test.ts`（新） | 18 项（UTC / 上海 / 温哥华三种进程时区结果相同） |
| `src/lib/procurement-records/__tests__/closing-tz-db.isolated.test.ts`（新） | 6 项 |

## 4. 证据

| 测试 | 项数 | 内容 |
|---|---|---|
| `closing-tz-pure.test.ts` | 18 | 冬令时、夏令时、没有秒、23:59:59 跨日、空格分隔、夏令时开始（跳变后）与结束（重复时刻取第一次）、带 Z、带偏移、只有日期、空 / 乱写 / 越界、整段 CSV 解析（截标时间、空截标、发布日期不变）、接线 |
| `closing-tz-db.isolated.test.ts` | 6 | 旧口径存的 14:00Z，下一次扫描改为 19:00Z；记一次证据变化；再扫一次不再算变化 |

两个新测试在 main 上都失败（纯函数测试找不到新函数；隔离库测试 3 项失败）。PROC-1 原有 `procurement-pure`（95）、`procurement-records-db`（158）、`disclosure-analysis-pure`（50）、`records-request-pure`（180），P2-3a `tender-follow-db`（41）仍全部通过。

变异 5 处（时区改 UTC、截标仍用旧解析、丢掉秒、去掉越界检查、秒变成必填）：**全部被发现**。

**门禁**：见 PR。

## 5. 已知限制

- **夏令时口径未经原文核对**：搜索到的官方说明转述截标时间以「UTC-0500」表示，公告页面显示 EST / EDT。冬令时（现在到 2027-03-14）两者一致；夏令时期间若 CSV 其实是固定 UTC-5，本方案会晚 1 小时。官方说明页（`donnees-data.tpsgc-pwgsc.gc.ca`）不在本会话网络放行范围。**2027 年 4 月前**用一条夏季截标、公告页在 canadabuys.canada.ca 上的公告比对一次（页面 13:00 EDT ↔ CSV 13:00 则本方案对；CSV 12:00 则改成固定 UTC-5）。已写进交接文档。
- **上线后第一次扫描**：每条命中的在招公告记一条「证据变化」，监控开启人收到一条汇总通知（「证据变化 N 处」）。只发生一次。
- 已截标、不再出现在 CSV 的老公告保持原值（不影响新标视图与跟标）。

## 6. 上线

合并后照常部署；下一次采购监控扫描即改正在招公告的截标时间。回滚 = 回滚代码（之后的扫描会按旧口径再写回）。
