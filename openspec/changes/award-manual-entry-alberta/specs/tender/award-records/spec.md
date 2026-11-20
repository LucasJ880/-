## ADDED Requirements

### Requirement: 按日期金额挂到既有时不跨不同的招标编号
写入授标事实时，挂到既有的强匹配 SHALL 先于疑似重复判断。按招标编号与中标方没找到同一条记录、改按中标方、授标日期、金额都相同去找时，若两条都有招标编号且规范化后（大写、去空白与标点）不同，系统 SHALL NOT 把它挂到那条记录上；没有别的疑似重复时，新记录 SHALL 标为疑似重复（NEEDS_REVIEW，指向那条记录），留人工裁决——同一笔授标可能有两套编号，SHALL NOT 悄悄算成两次。编号缺一方、或只差大小写 / 空白 / 标点时 SHALL 照旧挂上。规范化 SHALL NOT 改变存储的编号。

#### Scenario: 编号不同、中标方日期金额相同
- **WHEN** 同一中标方已有编号 PW-2024-001、授标日期 2024-05-01、金额 120,000.50 的记录，再写入编号 PW-2024-002、日期与金额都相同的记录（采购方相同或不同）
- **THEN** 不挂上；新记录状态为 NEEDS_REVIEW、疑似原记录指向那条（`npx tsx src/lib/tender-intel/__tests__/awards.test.ts` T4-01h；`NODE_ENV=test npx tsx src/lib/tender-intel/__tests__/award-manual-entry-db.isolated.test.ts`）

#### Scenario: 编号缺一方或只差写法
- **WHEN** 同上的原记录，再写入没有编号、或编号写成 "pw 2024 001" 的记录，日期与金额都相同
- **THEN** 都挂到原记录上（`npx tsx src/lib/tender-intel/__tests__/awards.test.ts` T4-01h）
