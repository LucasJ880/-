# Spec Delta

## REMOVED Requirements

### Requirement: 斑马帘布纱比对照表
**Reason**: 原要求描述 535 字，超过 `openspec validate --strict` 的 500 字上限；它同时说了两件事（对照表的存储 / 读写入口 / 保存权限，与生成 / 退回自产时按 SKU 查表的口径），按"一条要求一个行为"拆成两条。
**Migration**: 原文第一句与场景「组织隔离」「出单岗位可以保存」「无出单权限的普通成员只读」「只持其他品类出单键」原样移入「斑马帘布纱比对照表维护」；原文第二句与场景「系列名命中」「未命中」原样移入「斑马帘布纱比查表」。行为不变，无需任何代码或数据迁移。

## ADDED Requirements

### Requirement: 斑马帘布纱比对照表维护
系统 SHALL 维护组织级的斑马帘「面料编码 → 布:纱」对照表（存于 `Organization.settingsJson.sunnyProcess.zebraRatios`，组织从未保存时以原件《Blinds 工艺单》Sheet1 W 列 24 条为种子），经 `GET/PUT /api/sunny-process/zebra-ratios` 与页面 `/blinds-orders/zebra-ratios` 查看与整表编辑；组织成员可读，保存 SHALL 需要持 `orders.fulfillment.update.shades`（出单·Roller/Zebra/Roman 岗位；斑马帘属 shades 品类）或全品类键 `orders.fulfillment.update`、或 org_admin 及以上组织角色、或平台管理员，否则 403；每次保存记一条 AuditLog。

#### Scenario: 组织隔离
- **WHEN** 另一组织的用户读取对照表
- **THEN** 读到的是该用户自己组织的表（未保存则为种子），看不到本组织的条目（`autogen-db.isolated.test.ts` 第 [5b] 段）

#### Scenario: 出单岗位可以保存
- **WHEN** 一个组织角色为 org_member、但绑定了出单·Roller/Zebra/Roman 岗位（持 `orders.fulfillment.update.shades`）的用户保存对照表
- **THEN** 返回 200；`GET` 返回 `canEdit: true`（`autogen-db.isolated.test.ts` 第 [5b] 段）

#### Scenario: 无出单权限的普通成员只读
- **WHEN** 一个 org_member、未绑定出单岗位的用户保存对照表
- **THEN** 返回 403，`GET` 返回 `canEdit: false`

#### Scenario: 只持其他品类出单键
- **WHEN** 只绑定出单·Vinyl 岗位（持 `orders.fulfillment.update.vinyl`）的 org_member 保存对照表
- **THEN** 返回 403

### Requirement: 斑马帘布纱比查表
生成工艺单与退回自产时，斑马帘 SHALL 按报价 SKU 查表：编码与 SKU 完全相同优先，否则编码作为完整一段出现在 SKU 中即命中（空格 / 下划线 / 斜杠视同连字符），多条命中取最长编码；命中时用表中布纱比并在待核对写明来源，未命中时默认 3:2 并提示核对。

#### Scenario: 系列名命中
- **WHEN** 对照表有 `AQUAWIDE3 → 3 4/16 : 2 3/16`，报价斑马帘 SKU 为 `AQUAWIDE3-GRAY-LF`
- **THEN** 工艺单该行布纱比为 3.25 : 2.1875，待核对提示含"对照表「AQUAWIDE3」"

#### Scenario: 未命中
- **WHEN** 报价斑马帘 SKU 不在对照表中
- **THEN** 布纱比为 3 : 2，待核对提示"不在布纱比对照表里…请按面料核对"
