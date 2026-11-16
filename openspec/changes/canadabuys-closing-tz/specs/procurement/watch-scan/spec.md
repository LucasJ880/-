## ADDED Requirements

### Requirement: CanadaBuys 截标时间的时区
解析 CanadaBuys 招标公告时，不带时区的截标时间 SHALL 按 `America/Toronto` 当地时间换算成 UTC 存储（夏令时自动处理），SHALL NOT 依赖运行进程的时区；带 `Z` 或时区偏移的 SHALL 照原样解析；只有日期的照旧为该日 UTC 零点。已入库的公告 SHALL 在下一次扫描到时按新口径更新截标时间。

#### Scenario: 冬令时
- **WHEN** CSV 里截标时间是 `2026-12-15T14:00:00`
- **THEN** 存为 `2026-12-15T19:00:00.000Z`（多伦多下午 2 点）（`npx tsx src/lib/procurement-records/__tests__/closing-tz-pure.test.ts`）

#### Scenario: 夏令时
- **WHEN** CSV 里截标时间是 `2027-06-02T11:00:00`
- **THEN** 存为 `2027-06-02T15:00:00.000Z`（多伦多上午 11 点 EDT）（`closing-tz-pure.test.ts`）

#### Scenario: 已入库的错误时间
- **WHEN** 一条在招公告已按旧口径存成 `2026-12-15T14:00:00.000Z`，下一次扫描再次读到它
- **THEN** 截标时间改为 `2026-12-15T19:00:00.000Z`，记一条证据变化（`npx tsx src/lib/procurement-records/__tests__/closing-tz-db.isolated.test.ts`）
