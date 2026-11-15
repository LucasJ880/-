# Spec Delta

## Purpose
规定投标工作区里行明细（拟投品牌型号、产品尺寸、证书）与补遗的录入、保存校验，以及补遗对已核对结论的影响。只涉及保存与显示，不提供任何对外动作。

## ADDED Requirements

### Requirement: 逐行录入拟投产品与产品尺寸
面板 SHALL 让有项目写权限的人对价格表的每一行录入拟投品牌、型号与产品尺寸并保存；没有写权限的人 SHALL NOT 看到录入入口。保存一行 SHALL NOT 改动其它行已存的明细。保存后面板 SHALL 按接口返回的结果显示该行的尺寸对照（相符、不符或无法判断）。三项都清空并且没有证书时，该行的明细 SHALL 被移除。

#### Scenario: 录入一行的产品尺寸
- **WHEN** 第 1 行要求 `39 x 77.5 x 9-15`，录入产品尺寸 `39 x 77.5 x 12` 并保存
- **THEN** 该行显示「尺寸相符」，阻断项里不再有「第 1 行尺寸尚未核对」，其它行已存的明细不变（`npx tsx src/lib/tender-bid-workspace/__tests__/line-entry.test.ts`；截图 `docs/acceptance/ti-4c/line-entry.png`）

#### Scenario: 产品尺寸不符
- **WHEN** 第 18 行要求 `36 x 38`，录入 `36 x 39`
- **THEN** 该行显示「尺寸不符」，阻断项里出现「第 18 行尺寸不符」

### Requirement: 证书录入与出处
带认证要求的行 SHALL 可以录入证书：编号、状态（供应商声称、已核验、核验未通过、已过期）、覆盖范围（整机、部件、未确认）、发证机构、发证机构是否在加拿大受认可（是、否、未确认）、所列型号、到期日、出处。保存接口 SHALL 拒绝状态为「已核验」而出处为空的证书，并 SHALL NOT 保存该次请求里的任何内容。面板 SHALL 在录入处写明「已核验」是人工确认，系统不核验证书真伪。

#### Scenario: 已核验却没有出处
- **WHEN** 保存一张状态为「已核验」、出处为空的证书
- **THEN** 接口返回 400，已存内容不变（`npx tsx src/lib/tender-bid-workspace/__tests__/line-entry.test.ts`；隔离库用例 `bid-workspace-db.isolated.test.ts`）

#### Scenario: 只有供应商声称
- **WHEN** 第 13 行已填品牌型号，录入一张状态为「供应商声称」的整机证书
- **THEN** 该行仍显示「认证未过」，原因里有「只是供应商声称，未经核验」

#### Scenario: 六个条件齐全
- **WHEN** 第 13 行已填品牌型号，录入一张已核验、覆盖整机、发证机构在加拿大受认可、所列型号与拟投型号一致、未过期、带出处的证书
- **THEN** 该行显示「认证通过」，阻断项里不再有第 13 行的强制认证（截图 `docs/acceptance/ti-4c/certificate.png`）

### Requirement: 补遗的录入
面板 SHALL 显示已存的补遗（号、日期、影响的行、说明）。有项目写权限的人 SHALL 可以新增与删除补遗；新增时「影响的行」SHALL 接受逗号分隔的行号与区间（如 `13-15, 18`），写不成行号的内容 SHALL 被提示并 SHALL NOT 被保存。同一个号再次保存 SHALL 替换原有的那一条。

#### Scenario: 影响的行写成区间
- **WHEN** 新增第 1 号补遗，影响的行填 `13-15, 18`
- **THEN** 保存的影响行为 13、14、15、18（`npx tsx src/lib/tender-bid-workspace/__tests__/line-entry.test.ts`）

### Requirement: 补遗之后已核对的行需要复核
保存一行的明细时，系统 SHALL 记下当时影响该行的最新补遗号。之后保存了号更大、且影响该行的补遗，可投标判定 SHALL 对该行已录入的尺寸对照与认证判定报「补遗之后需要复核」，并 SHALL 因此为「不可投标」；重新保存该行的明细后 SHALL 不再报。客户端提交的补遗号 SHALL NOT 能超过实际影响该行的最新补遗号。

#### Scenario: 核对之后来了新补遗
- **WHEN** 第 13 行的认证已通过，之后保存了影响第 13 行的第 2 号补遗
- **THEN** 阻断项里出现「第 13 行的认证判定……第 2 号补遗之后需要复核」（截图 `docs/acceptance/ti-4c/stale-after-addendum.png`）

#### Scenario: 重新保存该行
- **WHEN** 接上一场景，重新保存第 13 行的明细
- **THEN** 该条阻断项消失

#### Scenario: 客户端虚报补遗号
- **WHEN** 保存行明细时带上比实际最新补遗号更大的号
- **THEN** 存下的号等于实际影响该行的最新补遗号
