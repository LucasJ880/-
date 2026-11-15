# Spec Delta

## REMOVED Requirements

### Requirement: 斑马帘布纱比对照表
**Reason**：需求正文 535 字，超过 500 字（`openspec validate --specs --strict` 告警）。它写了两件事：对照表本身的存放、读写与保存权限，以及工艺单怎样按表取布纱比。按这两件事拆成「斑马帘布纱比对照表的维护」「斑马帘按对照表取布纱比」两条；行为不变。
**Migration**：无。原有 6 个场景按内容分到这两条下（4 + 2），由 `src/lib/sunny-process/__tests__/zebra-ratios.test.ts` 与 `autogen-db.isolated.test.ts` 第 [5b] 段照旧覆盖。

## ADDED Requirements

### Requirement: 斑马帘布纱比对照表的维护
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

### Requirement: 斑马帘按对照表取布纱比
生成工艺单与退回自产时，斑马帘 SHALL 按报价 SKU 查组织的布纱比对照表（见「斑马帘布纱比对照表的维护」）：编码与 SKU 完全相同优先，否则编码作为完整一段出现在 SKU 中即命中（空格 / 下划线 / 斜杠视同连字符），多条命中取最长编码；命中时用表中布纱比并在待核对写明来源，未命中时默认 3:2 并提示核对。

#### Scenario: 系列名命中
- **WHEN** 运行 `npx tsx src/lib/sunny-process/__tests__/zebra-ratios.test.ts`，对照表有 `AQUAWIDE3 → 3 4/16 : 2 3/16`，报价斑马帘 SKU 为 `AQUAWIDE3-GRAY-LF`
- **THEN** 工艺单该行布纱比为 3.25 : 2.1875，待核对提示含"对照表「AQUAWIDE3」"，测试通过

#### Scenario: 未命中
- **WHEN** 报价斑马帘 SKU 不在对照表中
- **THEN** 布纱比为 3 : 2，待核对提示"不在布纱比对照表里…请按面料核对"（同一测试覆盖）
