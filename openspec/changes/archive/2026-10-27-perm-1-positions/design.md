# Design: perm-1-positions

## Context

见 proposal.md「Why」。现状：`SYSTEM_ROLE_PROFILES`（8 个系统模板）由 `seedOrgAuthorizationProfiles(orgId)` 对每个企业无差别落地；`resolveEffectiveBindings` 有绑定走绑定，无绑定按 `OrganizationMember.role` + 平台角色兼容回退；`authorize` 只在报价详情与销售上下文两处接入，且调用前用 `isAdmin(user.role)` 跳过。没有任何写绑定的入口（UI / API / 脚本都没有）。`Organization.industryPackId` 已存在，Sunny 为 `window_covering_services_v1`。

## Goals / Non-Goals

**Goals:**
- 窗饰企业的岗位模板集按行业包落地，不污染梦馨。
- 一个受控脚本成为写绑定的唯一入口，幂等、可审计、可 dry-run。
- super_admin 的全权从"各处 `isAdmin` 跳过"统一为"有效权限来源 platform_admin"，为 PERM-2 删除直批分支做准备。

**Non-Goals:**
- 不改 `src/app/api/**` 任一路由的判定；不改 `src/lib/blinds/discount-permissions.ts`。
- 不改 `src/lib/authorization/authorize.ts` 的 DENY 语义与 scope 匹配顺序。
- 不改 `seedOrgAuthorizationProfiles` 里 org_owner / org_admin / 平台 sales 的自动绑定逻辑。
- 不动 `src/lib/tenancy/tool-auth.ts`、`workspace-rbac.ts`、`nav-role-policy.ts`。
- 不实现 `CATEGORY` 数据范围；`DataScope` 枚举不加值。

## 八条硬纪律对照

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守。只写既有表 RoleProfile / RolePermissionBinding / PositionTemplate / PrincipalRoleBinding / AuditLog；无 migration |
| 2 | 出站先审批 | 不涉及。无任何对外发送 |
| 3 | 禁止第三套队列 | 不涉及。脚本一次性执行，无 scheduler / queue |
| 4 | 脱敏 | 不涉及 Muse 通道。脚本输出不打印连接串 / 密码哈希 / token |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守。模板与差异计划全是常量与纯函数，无 LLM |
| 8 | 测试注册 | 遵守。新测试 `position-binding.test.ts` 与扩充的 `authorize.test.ts` 均在 `scripts/test-all.sh` |

## Decisions

### D1 模板集按 industryPackId 选择，不按企业 code
`role-defaults.ts` 导出 `POSITION_PROFILE_SETS: Record<string, DefaultRoleProfile[]>`，键为行业包 id，`window_covering_services_v1` 对应窗饰集；`seedOrgAuthorizationProfiles` 读企业 `industryPackId`，命中则追加落地（与系统模板同一 upsert 路径）。
- 否决：按企业 code（`sunny-shutter-bid-lead`）硬编码。理由：`openspec/config.yaml` 与 `tenancy/modules.ts` 都禁止在代码里写死企业名；第二家窗饰企业接入时不用改代码。
- 否决：把窗饰岗位并进 `SYSTEM_ROLE_PROFILES` 对所有企业落地。理由：梦馨会多出 `fulfillment_*` 等无意义岗位，且违反"非窗饰企业不落地"要求。

### D2 老板是岗位 `owner`，不是 `org_owner` 成员角色
`owner` 模板 key 与现有系统模板 `org_owner` 并存；`org_owner` 保留给唯一兜底账号（成员角色），`owner` 可绑多人。两者权限内容在本 change 相同减去成员 / 岗位管理（`identity.member.manage`、`identity.role.manage`、`authorization.policy.manage`）。
- 否决：放开唯一 org_owner 保护让四人都当 org_owner。理由：`members/[memberId]/route.ts` 的唯一 owner 保护是 Security-1 的安全不变量，且设计稿 §4-1 规定成员管理只有平台管理员，老板岗不应继承 `org_owner` 的成员管理权。

### D3 绑定脚本的纯逻辑放 `src/lib/authorization/position-binding.ts`
`parseBindingFile(text)`、`validateBindings({file, knownProfileKeys, membersByEmail})`、`planBindingDiff({desired, existing, prune})` 三个纯函数，脚本只做 IO 与落库。
- 否决：全部写在 `scripts/bind-positions.ts` 里。理由：纯函数才能在无 Postgres 的沙箱与 CI 子集里测（仓库现状：带 DB 的测试在沙箱 MISSING_DATABASE_URL）。

### D4 执行者校验靠 `--actor` 邮箱 + DB 里的 `User.role === "super_admin"`
脚本离线运行无会话，只能靠显式声明执行者并与库核对；同时要求 `ALLOW_POSITION_BINDING=true`，与 `safe-migrate-deploy.ts` 的双闸风格一致。
- 否决：不校验执行者、只靠环境变量。理由：审计记录需要 actorUserId；设计稿 §4-1 要求只有平台管理员能换岗位，脚本是唯一入口，必须在入口校验。

### D5 super_admin 全权在 `resolveEffectiveBindings` 里产生，不在 `authorize` 里短路
查 `User.role`，等于 `super_admin` 时返回 Registry 全部 key × ORG，`source = "platform_admin:<key>"`，然后仍走 `decideFromBindings`（保留 ORG_CONTEXT_MISMATCH 与 UNKNOWN_PERMISSION 检查）。
- 否决：在 `authorize` 开头 `if super_admin return allowed`。理由：会绕过企业上下文一致性检查；来源标记也拿不到，PERM-2 的"平台管理员自批"审计需要它。
- 否决：平台 `admin` 也给全权。理由：设计稿 §2.1 平台只留 super_admin 与 user；`admin` 是待收口的历史角色。

### D6 占位邮箱整文件拒绝
`config/positions/sunny.json` 允许 `TODO:<姓名>` 占位以便先提交设计稿里的人岗对应；脚本遇到任一占位即退出 2，不做部分写入。
- 否决：跳过占位行只绑已知邮箱。理由：会造成"以为绑完了"的半截状态，与幂等差异计划的可读性冲突。

## Risks / Trade-offs

- [`seedOrgAuthorizationProfiles` 的 org_owner 自动绑定会把 Sunny 的唯一 org_owner 绑到系统 `org_owner` 模板，与岗位 `owner` 并存] → 并集语义下该人权限 = 两者之和，`org_owner` 多出的只是成员 / 岗位管理，与设计稿 §4-1（平台管理员管成员）冲突 → PERM-2 处理成员管理守卫时一并把 `org_owner` 模板的 `identity.member.manage` 移除；本 change 在 REPORT 里记录。
- [super_admin 全权后，已接入 `authorize` 的两处行为变化] → 两处调用前仍有 `isAdmin` 短路，结果不变；用 `authorize.test.ts` 新增断言覆盖。
- [Sunny 11 人邮箱大部分未知] → 文件用占位，脚本拒绝；真实绑定由 Lucas 本机补邮箱后执行（REPORT 写明命令）。
- [`--prune` 误停用] → 只停用本行业包模板集内的岗位，不碰系统模板绑定（org_owner / org_admin / sales_rep 兼容绑定）；且 `--dry-run` 先看。

## Migration Plan

1. 合并后在生产对 Sunny 跑 `seedOrgAuthorizationProfiles`（现有 `scripts/` 入口或 `seedAllOrgAuthorizationProfiles`）落地模板。
2. Lucas 本机补齐 `config/positions/sunny.json` 邮箱 → `ALLOW_POSITION_BINDING=true npx tsx scripts/bind-positions.ts --org <code> --file config/positions/sunny.json --actor lucas@sunnyshutter.ca --dry-run` → 去掉 `--dry-run` 执行。
3. 回滚：`--prune` 配空岗位列表可停用全部窗饰岗位绑定；模板行保留无害。

## 验证方式

- `npx tsx src/lib/authorization/__tests__/authorize.test.ts`：模板快照、多岗并集、super_admin 来源标记、平台 admin 无全权。
- `npx tsx src/lib/authorization/__tests__/position-binding.test.ts`：解析 / 校验（占位、未知 key、非成员、重复邮箱）/ 差异计划（幂等、prune、dry-run）。
- `npx tsx scripts/bind-positions.ts`（无参数）退出 2；`ALLOW_POSITION_BINDING` 未设退出 1（两者不需要 DB 即可触发）。
- `npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`npm run test:ci`。
