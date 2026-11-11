## MODIFIED Requirements

### Requirement: 可选供应商与默认条款
entry SHALL 返回本组织 active 供应商与操作者常用供应商的并集，每家标明 `ready` 与不可选原因（`no_email` / `inactive`），`ready` 的判定 SHALL 与送审时的供应商就绪规则逐条一致；操作者常用供应商 SHALL 标 `isDefault: true` 并排在前面；SHALL 返回默认贸易条款及其是否来自个人偏好。Web 提交的贸易条款 SHALL 按用户显式选择生效，选「不指定」时 SHALL NOT 回退到个人默认。操作者有生效的供应商分组时，entry 返回的可选供应商 SHALL 另外包含各分组里的供应商（同样标明 `ready` 与不可选原因），抽屉的预先勾选 SHALL 改由分组决定（见 `tender/rfq-supplier-groups`），常用供应商仍标 `isDefault: true` 并排在前面但 SHALL NOT 被预先勾选；操作者没有分组或分组功能未开启时，预先勾选的 SHALL 仍是可选的常用供应商。

#### Scenario: 常用供应商默认勾选、没邮箱的不可选
- **WHEN** 操作者常用供应商里有一家没有联系邮箱
- **THEN** 该供应商 `isDefault: true`、`ready: false`、`blockedReason: "no_email"`，前端灰显并给出「补邮箱」链接到该供应商页

#### Scenario: 入口可选与送审就绪一致
- **WHEN** 供应商邮箱为 `"sales@x.com "`（末尾空格）、`"a@b"`、空串或已停用
- **THEN** 入口判为不可选的集合与送审时判为不就绪的集合完全相同；`web-entry-pure.test.ts` 用送审规则做对照

#### Scenario: 选「不指定」贸易条款
- **WHEN** 操作者个人默认为 DDP，在抽屉里选「不指定」后提交
- **THEN** 询价单不写贸易条款，结果页显示「贸易条款：不指定」

#### Scenario: 有分组时常用供应商不预先勾选
- **WHEN** 操作者有 2 家可选的常用供应商，也有一个分组，项目名称没有对上任何一组
- **THEN** 这 2 家仍标 `isDefault: true`、排在前面，但抽屉没有预先勾选任何供应商（`npx tsx src/lib/tender-rfq/__tests__/supplier-groups.test.ts`）

#### Scenario: 分组里的供应商在可选列表里
- **WHEN** 分组里有一家供应商已停用（不在 active 供应商里，也不是常用供应商）
- **THEN** entry 的可选供应商里有这一家，`ready: false`、`blockedReason: "inactive"`（`npx tsx src/lib/tender-rfq/__tests__/supplier-groups-db.isolated.test.ts`）
