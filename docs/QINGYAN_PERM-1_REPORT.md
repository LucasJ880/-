# PERM-1 完成报告：Sunny 岗位模板与人员绑定

| 项 | 值 |
|---|---|
| 日期 | 2026-10-27 |
| change | `perm-1-positions`（`openspec/changes/perm-1-positions/`） |
| 任务书 | `docs/QINGYAN_PERM-1-2_POSITIONS_DISCOUNT_TASKBRIEF.md` PERM-1 部分 |
| 状态 | 代码完成，待 GATE 审 → PR → 合并 → archive |

## 1. 做了什么

- **权限目录**：`src/lib/authorization/permissions.ts` 追加 9 个键（合价、超限提交 / 审批、销售设置、建订单、出单修改、库存管理、财务只读、岗位管理）；`identity.position.manage` 只允许 HUMAN。
- **岗位模板集**：`src/lib/authorization/role-defaults.ts` 新增窗饰行业包（`window_covering_services_v1`）的 8 个追加模板（owner / pricing_lead / ops_lead / accounting / bids / fulfillment_vinyl / fulfillment_drapery / fulfillment_shades）与 `sales_rep` 的两条补充绑定（发报价、建订单），按行业包选择，非窗饰企业为空；导出 `profilesForIndustryPack`、`mergedProfileBindings`、`profileKeysForIndustryPack`。
- **落库**：`seed-org-profiles.ts` 读企业 `industryPackId`，命中则与系统模板一起 upsert（岗位、权限绑定、PositionTemplate）；现有 org_owner / org_admin / 平台 sales 自动绑定逻辑未动。
- **平台管理员全权**：`resolve-effective-permissions.ts` 先查 `User.role`，`super_admin` 返回 Registry 全部权限 × ORG，来源 `platform_admin:<key>`；其余人走绑定 / 兼容回退不变。
- **绑定脚本**：`scripts/bind-positions.ts`（IO）+ `src/lib/authorization/position-binding.ts`（纯函数：解析 / 校验 / 差异计划 / 汇总）。双闸：`ALLOW_POSITION_BINDING=true` + `--actor` 必须是 super_admin；幂等；`--prune` 只停用行业包岗位集内的绑定；`--dry-run`；每条新增 / 停用写 AuditLog（`authorization.position.bind` / `unbind`）；退出码 0 / 1 / 2；拒绝路径不连库。
- **Sunny 绑定文件**：`config/positions/sunny.json`，已知邮箱 lucas（owner, bids）、alex（sales_rep），其余 8 人 `TODO:<姓名>` 占位。
- **测试**：`authorize.test.ts` 20 → 51 条；新增 `position-binding.test.ts` 18 条并注册进 `scripts/test-all.sh`。

## 2. 怎么验的

| 检查 | 结果 |
|---|---|
| `npx tsx src/lib/authorization/__tests__/authorize.test.ts` | 51 passed |
| `npx tsx src/lib/authorization/__tests__/position-binding.test.ts` | 18 passed |
| `scripts/bind-positions.ts` 无参数 / 未设 ALLOW / 文件不存在 | 退出 2 / 1 / 2，输出含用法 / ALLOW 提示 |
| 既有：security1-sales-authz、security1-owner-manager、sales-digital-employee-access | 全通过 |
| `bash scripts/check-test-registry.sh` | OK，415 已注册，基线剩 73 |
| `npm run typecheck` / `npm run lint:baseline` / `npm run test:ci` | 全通过 |
| `openspec validate perm-1-positions --strict` | valid |

## 3. 判断点

- **老板做成岗位 `owner`，不放开唯一 org_owner**：四个老板都绑 `owner`；`org_owner` 成员角色只留兜底一人。`owner` 不含成员 / 岗位 / 策略管理（设计稿 §4-1：只有平台管理员）。
- **`sales_rep` 用并集补充而不改系统模板**：梦馨的 sales_rep 不受影响；窗饰企业落库后是系统 + 补充的并集。
- **super_admin 全权放在有效权限解析而不是 `authorize` 短路**：保留企业上下文一致性检查，来源标记供 PERM-2 审计"自批"。
- **占位整文件拒绝**：避免半截绑定。

## 4. 已知限制与后续

1. **org_owner 自动绑定与 `owner` 岗位并存**：Sunny 的唯一 org_owner 同时持有系统 `org_owner` 模板（含 `identity.member.manage` 等）。PERM-2 收成员管理守卫时一并把 `org_owner` 模板的成员 / 岗位管理键移除。
2. **8 人邮箱待 Lucas 补**：补齐 `config/positions/sunny.json` 后在本机执行（需生产 `.env`）：
   ```bash
   ALLOW_POSITION_BINDING=true npx tsx scripts/bind-positions.ts --org <Sunny 的 Organization.code> --file config/positions/sunny.json --actor lucas@sunnyshutter.ca --dry-run
   ```
   确认计划后去掉 `--dry-run`。Sunny 的 code 在库里确认（仓库脚本里出现过 `sunny-shutter-bid-lead` 与 `sunny-home-deco` 两个）。
3. **模板落库**：合并后需对 Sunny 跑一次 `seedOrgAuthorizationProfiles`（或 `seedAllOrgAuthorizationProfiles`），否则绑定脚本会报"未知岗位 key"。现有入口：`scripts/security1-acceptance-check.ts` 一类脚本里调用；也可临时 `npx tsx -e`。
4. **本 change 不改任何路由判定**：Alex / Lynn 的"只看本人"在已接入 `authorize` 的两处已生效，其余接口到 PERM-2 / PERM-4 才换。
5. **沙箱无 Postgres**：带 DB 的脚本路径（成员校验、落库、审计）未在沙箱实跑，由纯函数测试覆盖逻辑；生产首跑用 `--dry-run`。
