# Proposal：授标去重——不同招标编号不判疑似重复（P2-0c）

TASKFLOW：P2-0c（P2-0 / P2-0b 做截图时发现的数据质量问题）。

## Why

- 写授标事实时，若同一中标方在同一买家已有记录，新记录一律标为「疑似重复」（NEEDS_REVIEW），不看招标编号。
- 同一在位供应商在同一机构反复中标（周期采购）正是竞争情报最想看到的事实；我方在同一机构第二次中标也会被这样标记。
- 系统没有裁决疑似重复的界面，这些记录会一直停在"线索"：不计入已确认次数、金额不进数字层、买家采购周期缺样本。
- 隔离库复现：我方在同一机构两次中标（编号不同），第二条落 NEEDS_REVIEW；同机构同范围 5 次真实中标，周期只用上 3 次。

## What Changes

- `createOrObserveAwardRecord` 的弱信号规则加一个例外：两条记录都有招标编号、且规范化后（大写、去空白与标点）不同 → 视为另一次招标，新记录正常 ACTIVE。
- 编号缺一方、或只差大小写 / 空白 / 标点 → 保持原规则（NEEDS_REVIEW + possibleDuplicateOfId，人工裁决）。
- 新增导出 `normalizeSolicitationKey` / `isDistinctSolicitation`（只用于判断，不改存储值）。
- 强匹配（同编号 + 同中标方 → 挂到同一条）与幂等规则不变。

## Capabilities

### New Capabilities
- `tender/award-records`：授标事实写入的去重口径。

### Modified Capabilities
- 无（T4 写路径此前没有归档规格）。

受影响的 Muse 意图：无。

## Impact

- 修改：`src/lib/tender-intel/awards.ts`、`src/lib/tender-intel/__tests__/awards.test.ts`（+T4-01d..g）、测试注册脚本。
- 新增：`src/lib/tender-intel/__tests__/award-dedupe-db.isolated.test.ts`。
- 硬纪律：零 schema、零出站、零 LLM；仍是确定性规则（只比较编号字面规范化），不做 fuzzy 合并。

## Out of scope

- 已经落成 NEEDS_REVIEW 的历史记录不自动改状态（属数据修正，走 Owner Gate；报告给出只读统计查询）。
- 疑似重复裁决界面。
