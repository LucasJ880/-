## MODIFIED Requirements

### Requirement: 不同招标编号不判疑似重复
写入授标事实时，若同一中标方在同一买家已有未撤回的记录，系统 SHALL 把新记录标为疑似重复（NEEDS_REVIEW，指向疑似原记录），除非两条记录都有招标编号且规范化后（大写、去空白与标点）不同——此时新记录 SHALL 作为另一次招标正常写为 ACTIVE；例外：两条的授标日期与金额也都相同时，新记录 SHALL 仍标为疑似重复（同一笔授标可能有两套编号，见「按日期金额挂到既有时不跨不同的招标编号」）。编号缺一方、或只差大小写 / 空白 / 标点时 SHALL 仍标为疑似重复。规范化 SHALL 只用于判断，SHALL NOT 改变存储的编号。

#### Scenario: 同一机构再次中标
- **WHEN** 同一中标方在同一买家已有编号为 PW-2024-001 的记录，再写入编号为 PW-2025-014 的记录（授标日期或金额与原记录不同）
- **THEN** 新记录为 ACTIVE、没有疑似原记录；`npx tsx src/lib/tender-intel/__tests__/awards.test.ts`（T4-01d）与 `award-dedupe-db.isolated.test.ts` 覆盖

#### Scenario: 编号写法不同或缺失
- **WHEN** 新记录编号为 "pw 2024 001"（与 PW-2024-001 规范化相同），或任一方没有编号
- **THEN** 新记录为 NEEDS_REVIEW 并指向原记录；T4-01e / T4-01f 与 DB 测试覆盖

#### Scenario: 周期统计
- **WHEN** 同一买家、同一采购范围有 5 次不同编号的真实中标（含同一中标方的重复中标）
- **THEN** 买家采购周期使用全部 5 个样本；DB 测试覆盖

#### Scenario: 编号不同但授标日期与金额也相同
- **WHEN** 同一中标方在同一买家已有编号 PW-2024-001、授标日期 2024-05-01、金额 120,000.50 的记录，再写入编号 PW-2024-002、日期与金额都相同的记录
- **THEN** 新记录为 NEEDS_REVIEW 并指向原记录，不作为另一次招标写为 ACTIVE（`npx tsx src/lib/tender-intel/__tests__/awards.test.ts` T4-01h 同采购方一支）

## ADDED Requirements

### Requirement: 按日期金额挂到既有时不跨不同的招标编号
写入授标事实时，挂到既有的强匹配 SHALL 先于疑似重复判断。按招标编号与中标方没找到同一条记录、改按中标方、授标日期、金额都相同去找时，若两条都有招标编号且规范化后（大写、去空白与标点）不同，系统 SHALL NOT 把它挂到那条记录上；没有别的疑似重复时，新记录 SHALL 标为疑似重复（NEEDS_REVIEW），指向这样的记录里最早建档的一条，留人工裁决——同一笔授标可能有两套编号，SHALL NOT 悄悄算成两次。编号缺一方、或只差大小写 / 空白 / 标点时 SHALL 照旧挂上。规范化 SHALL NOT 改变存储的编号。

#### Scenario: 编号不同、中标方日期金额相同
- **WHEN** 同一中标方已有编号 PW-2024-001、授标日期 2024-05-01、金额 120,000.50 的记录，再写入编号 PW-2024-002、日期与金额都相同的记录（采购方相同或不同）
- **THEN** 不挂上；新记录状态为 NEEDS_REVIEW、疑似原记录指向那条（`npx tsx src/lib/tender-intel/__tests__/awards.test.ts` T4-01h；`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`）

#### Scenario: 编号缺一方或只差写法
- **WHEN** 同上的原记录，再写入没有编号、或编号写成 "pw 2024 001" 的记录，日期与金额都相同
- **THEN** 都挂到原记录上（`npx tsx src/lib/tender-intel/__tests__/awards.test.ts` T4-01h）

#### Scenario: 这样的记录不止一条
- **WHEN** 同一中标方、同一授标日期、同一金额先后写入编号 PW-2024-101、PW-2024-103、PW-2024-102 三条（采购方各不相同）
- **THEN** 后两条都是 NEEDS_REVIEW，疑似原记录都指向最早建档的 PW-2024-101（`npx tsx src/lib/tender-intel/__tests__/awards.test.ts` T4-01i）

### Requirement: 人工确认的写入不让疑似重复转正
写入授标事实以人工确认（HUMAN_CONFIRMED）挂到一条既有记录、而那条是疑似重复（NEEDS_REVIEW 且指向疑似原记录）时，系统 SHALL 把它的信任级升为人工确认并挂上这条来源，SHALL NOT 改变它的状态与疑似原记录：它仍待组织管理员在「历史中标」页裁决，裁决前 SHALL NOT 计入统计。挂到不是疑似重复的记录时 SHALL 照旧提升为 ACTIVE + 人工确认。

#### Scenario: 项目里人工确认挂到疑似重复
- **WHEN** 已有一条 CanadaBuys 记录（编号 CB-F1-001）和一条人工录入的疑似重复（编号 AB-2025-6001，中标方、授标日期、金额与前者相同、指向前者）；随后项目里的授标历史以人工确认写入编号 AB-2025-6001、同一中标方的授标，项目结果回灌（未中标、填了这个中标方、项目编号 AB-2025-6001）也写入一次
- **THEN** 那条疑似重复信任级为 HUMAN_CONFIRMED、状态仍是 NEEDS_REVIEW、仍指向 CanadaBuys 那条、来源多一个，权威统计与疑似重复数都不变；回灌结果为 `needs_review`；组织管理员「不是重复，确认」后才变为 ACTIVE 并计入（`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`；`npx tsx src/lib/tender-intel/__tests__/awards.test.ts` T4-01j）

#### Scenario: 不是疑似重复的照旧提升
- **WHEN** 一条 AI 提取的 ACTIVE 记录被人工确认的写入按编号与中标方挂上
- **THEN** 它变为 ACTIVE + HUMAN_CONFIRMED（`npx tsx src/lib/tender-intel/__tests__/awards.test.ts` T4-01j）
