# Proposal: sunny-zebra-ratio-fulfillment-permission

**TASKFLOW：** 无（Sunny FDE 业务线，不在 Muse 招投标主线；不改 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`）。
**受影响的 Muse 意图：** 无。本 change 不触碰 `src/lib/muse-bridge/**`。
**口径来源：** Lucas 2026-10-27 对 #266 遗留四项的回复：布纱比对照表维持按报价 SKU 匹配；SC-ZD-XZ74-1 先用前者（W17）；G1024 历史单不处理；对照表权限给出工艺单的人。

## Why

斑马帘布纱比对照表决定之后所有斑马帘的裁剪位，维护它的应该是出工艺单的人（出单岗位），而 #266 只放给了组织管理员；种子里 SC-ZD-XZ74-1 的原件冲突已由 Lucas 拍板，需要落到表里。

## What Changes

- 修改对照表保存权限：持 `orders.fulfillment.update`（出单修改，出单·Vinyl / 出单·布帘 / 出单·Roller/Zebra/Roman 岗位默认持有）的组织成员可以保存；组织管理员及以上、平台管理员保持可保存；其余成员只读。
- 修改 `GET /api/sunny-process/zebra-ratios` 返回的 `canEdit` 与页面只读提示，与新的保存权限一致。
- 修改种子 SC-ZD-XZ74-1 的备注：写明原件 W17 / W22 不一致、2026-10-27 Lucas 确认用 W17（3 9/16 : 2 5/16），数值不变。

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `sunny/process-order-autogen`：Requirement「斑马帘布纱比对照表」的保存权限由"org_admin 及以上"改为"出单岗位（`orders.fulfillment.update`）或 org_admin 及以上"。

## Impact

- `src/app/api/sunny-process/zebra-ratios/route.ts`（权限判定）
- `src/app/(main)/blinds-orders/zebra-ratios/page.tsx`（只读提示文案）
- `src/lib/sunny-process/zebra-ratios.ts`（种子备注）
- `src/lib/sunny-process/__tests__/zebra-ratios.test.ts`、`autogen-db.isolated.test.ts`（断言）
- 数据：零 schema；不改岗位模板与权限目录（`orders.fulfillment.update` 已存在）。

## Out of scope

- 不改布纱比匹配规则（Lucas：对照表编码与报价 SKU 是两套，维持按报价 SKU 匹配，工厂在页面补）。
- 不改 G1024 历史单（Lucas：暂不处理）。
- 不按品类细分权限（出单·Vinyl 也能改斑马帘表）：权限目录里 `orders.fulfillment.update` 本身尚未按品类拆分。
- 不改岗位绑定配置 `config/positions/sunny.json`。
