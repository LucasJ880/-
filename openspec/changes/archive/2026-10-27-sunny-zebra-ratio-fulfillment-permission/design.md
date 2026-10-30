# Design: sunny-zebra-ratio-fulfillment-permission

## Context

#266 的对照表保存判定是 `canEditOrgTable`：平台管理员，或组织成员角色 ≥ org_admin。PERM-1 之后，「谁出工艺单」由岗位表达：出单·Vinyl / 出单·布帘 / 出单·Roller/Zebra/Roman 三个岗位共用 `FULFILLMENT_BINDINGS`，含 `orders.fulfillment.update`（ORG 范围）。

## Decisions

### D1. 用权限而不是岗位 key 判定
判定为 `authorize({ principal: humanPrincipal(user, orgId), orgId, permission: "orders.fulfillment.update" }).allowed`，不写死岗位 key。以后新增出单岗位、或把权限绑给别的岗位，不用改这里。
- 否决：判断岗位 key 是否以 `fulfillment_` 开头——绕过统一授权，岗位改名就失效。

### D2. 保留管理员
平台管理员与 org_admin 及以上继续可保存（老板岗位默认不含 `orders.fulfillment.update`，但 Lucas 等企业负责人的成员角色是 org_owner）。三者取"或"。

### D3. 种子只改备注
SC-ZD-XZ74-1 数值本来就取 W17，本次只把"请核对"改成拍板记录；不改其它种子，不回写已保存的组织表（已保存的表以组织数据为准）。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守：不改 schema，不改权限目录 / 岗位模板。 |
| 2 | 出站先审批 | 不涉及（无对外发送）。 |
| 3 | 禁止第三套队列 | 不涉及。 |
| 4–6 | 脱敏 / 不爬登录页 / 邮箱分离 | 不涉及。 |
| 7 | 确定性优先 | 遵守：纯权限判定，零 LLM。 |
| 8 | 测试注册 | 遵守：只改已注册测试的断言。 |

## 验证方式

- `npx tsx src/lib/sunny-process/__tests__/zebra-ratios.test.ts` 退出 0（种子备注断言）。
- 隔离库 `autogen-db.isolated.test.ts` [5b]：出单岗位成员 PUT 200 / `canEdit: true`；无岗位普通成员 PUT 403 / `canEdit: false`；外部组织不受影响。
- `npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`；`openspec validate sunny-zebra-ratio-fulfillment-permission --strict`。
