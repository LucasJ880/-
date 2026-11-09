# Spec Delta

## Purpose

授标事实（AwardRecord）写入时的去重口径：何时挂到既有记录、何时标为疑似重复留人工、何时作为新的一次招标。

## ADDED Requirements

### Requirement: 不同招标编号不判疑似重复
写入授标事实时，若同一中标方在同一买家已有未撤回的记录，系统 SHALL 把新记录标为疑似重复（NEEDS_REVIEW，指向疑似原记录），除非两条记录都有招标编号且规范化后（大写、去空白与标点）不同——此时新记录 SHALL 作为另一次招标正常写为 ACTIVE。编号缺一方、或只差大小写 / 空白 / 标点时 SHALL 仍标为疑似重复。规范化 SHALL 只用于判断，SHALL NOT 改变存储的编号。

#### Scenario: 同一机构再次中标
- **WHEN** 同一中标方在同一买家已有编号为 PW-2024-001 的记录，再写入编号为 PW-2025-014 的记录
- **THEN** 新记录为 ACTIVE、没有疑似原记录；`npx tsx src/lib/tender-intel/__tests__/awards.test.ts`（T4-01d）与 `award-dedupe-db.isolated.test.ts` 覆盖

#### Scenario: 编号写法不同或缺失
- **WHEN** 新记录编号为 "pw 2024 001"（与 PW-2024-001 规范化相同），或任一方没有编号
- **THEN** 新记录为 NEEDS_REVIEW 并指向原记录；T4-01e / T4-01f 与 DB 测试覆盖

#### Scenario: 周期统计
- **WHEN** 同一买家、同一采购范围有 5 次不同编号的真实中标（含同一中标方的重复中标）
- **THEN** 买家采购周期使用全部 5 个样本；DB 测试覆盖
