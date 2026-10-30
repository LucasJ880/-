# Design

## Context

- **绑定脚本**（`scripts/bind-positions.ts`）一条龙写在 `main()` 里：
  - 读 active RoleProfile（`profileIdByKey`）和该主体类型的全部绑定；
  - 校验（人：`validateBindings`，按邮箱查成员；数字员工：`validateDigitalEmployeeBindings`，按 Agent id 查 Agent）；
  - `planBindingDiff`（`prune` 只停用行业包岗位集内的 key，系统模板不动）；
  - 逐条写入（已有 inactive 行则重新启用）并 `logAuthorizationChange`（`authorization.position.bind` / `.unbind`，`via: "scripts/bind-positions.ts"`）。
  - 纯函数都在 `src/lib/authorization/position-binding.ts`。
- **成员接口**：
  - `POST /members`、`PATCH` / `DELETE /members/[memberId]` 用 `requirePlatformAdmin`；
  - 它内部是 `isPlatformAdmin` → `isSuperAdmin` = `admin || super_admin`；
  - spec `identity/member-management` 写的是"只认 super_admin"，代码与 spec 不一致；
  - `guards.ts` 的 `requireSuperAdmin` 也只是 `requirePlatformAdmin` 的别名。
- **企业详情页**（`src/app/(main)/organizations/[orgId]/page.tsx`）：
  - 成员编辑控件按 `canManageOrg = org.myRole === "org_admin" || isSuperAdmin(platformRole)` 显示，与接口（PERM-2 起只认平台管理员）也不一致；
  - 页面没有岗位信息。
- **数字员工主体**：sponsor = `Agent.createdById`（5b）；允许岗位 `DIGITAL_EMPLOYEE_POSITION_KEYS`。
- **权限解析**：每次请求读库（无缓存），绑定写入后下一次请求即生效。

## Goals / Non-Goals

**Goals**：
- super_admin 在界面上完成"看岗位 / 改岗位"，不再需要本机跑脚本；
- 界面与脚本同一套校验、差异与审计；
- 防止把岗位模式企业的老板岗位停光；
- 成员增删改与 spec 一致。

**Non-Goals**：
- 老板自助绑岗位或审批（方案 B / C）；
- 岗位模板管理；
- 邀请；
- AI 平台 admin 档（7b）。

## Decisions

### D1 共用服务，脚本行为不变
新 `src/lib/authorization/position-binding-service.ts`：
- `loadBindingContext(orgId, principalType)` → `{ org, profileIdByKey, existingRows }`；
- `executeBindingPlan({ orgId, actorUserId, principalType, plan, existingRows, profileIdByKey, via })`：逐条写入 + 审计，返回计数；审计 payload 与脚本现有字段一致，只多 `via`。

脚本改为：调 `loadBindingContext` 取上下文，校验 / 差异 / 输出照旧，写入调 `executeBindingPlan(…, via: "scripts/bind-positions.ts")`。纯测试断言脚本仍输出同样的行；隔离库测试比较改动前后 `--dry-run` 输出。

### D2 接口：一个主体、完整集合
`/api/organizations/[orgId]/positions`：
- `GET`：
  - 企业（`positionMode`）；
  - `profiles`：active RoleProfile 的 key / name / `group`（`pack` = 行业包岗位，`system` = 系统模板）；
  - `members`：active 成员的 userId / 姓名 / 邮箱 / 企业角色 / 岗位 key；
  - `digitalEmployees`：本企业项目下 active Agent 的 id / 名称 / sponsor 姓名 / 岗位 key；
  - `digitalAllowedKeys`。
- `PUT`：body `{ principalType, principalId, keys, dryRun? }`：
  1. 合成单主体的绑定文件 `{ bindings: { <邮箱或 Agent id>: keys } }`，走与脚本相同的校验函数（人按 userId 反查邮箱）；
  2. `planBindingDiff({ prune: true, prunableKeys: 全部 active 岗位 key })`——界面编辑的是该主体的完整集合（含系统模板），这一点与脚本的 `--prune`（只动行业包岗位）不同，脚本不变；
  3. 护栏（D3）；
  4. `dryRun` 返回计划，否则 `executeBindingPlan(…, via: "console")`。
- 响应：`{ plan: { create, keep, deactivate }, applied?: { created, deactivated } }`；校验失败 `400 { errors }`。
- 守卫：新 `requirePlatformSuperAdmin(request)`（403 `PLATFORM_ADMIN_REQUIRED`），企业不存在 404。
- 否决：
  - 批量 PUT 多主体：界面一次只改一个人，单主体更容易做差异确认与护栏；批量仍用脚本。
  - 按岗位模板（PositionTemplate）key 编辑：脚本与绑定表都用 RoleProfile key，保持一致。

### D3 最后一个 owner 护栏
- 只在岗位模式企业、人类主体、计划停用了 `owner` 时检查：本企业其他 active 成员是否还有 active `owner` 绑定。没有 → 409 `LAST_OWNER_BINDING`。
- 旧模式企业没有 `owner` 岗位，不适用。
- 纯函数 `wouldRemoveLastOwnerBinding({ positionMode, principalType, plan, otherOwnerCount })` 便于测试。

### D4 界面
- 企业详情页新"岗位"一节（`positions-section.tsx`，客户端组件），只在 `isPlatformSuperAdmin(platformRole)` 时渲染：
  - 成员表：姓名 / 企业角色 / 岗位标签；"编辑"打开弹窗（按 pack / system 分组的复选框）→"预览"调 `dryRun` 显示新增 / 停用 → "确认保存"；
  - 409 / 400 显示原因；
  - "数字员工岗位"子节同样交互，只列四个允许岗位，显示 sponsor。
- 同页成员编辑控件的显示条件改为 `isPlatformSuperAdmin(platformRole)`，与接口一致（`org_admin` 原本看得到按钮、点了 403）。

### D5 成员增删改只认 super_admin
`members/route.ts` POST 与 `members/[memberId]/route.ts` PATCH / DELETE 的 `requirePlatformAdmin` 换成 `requirePlatformSuperAdmin`。GET 不变（spec"成员目录读取不变"）。`requirePlatformAdmin` 本身不改：它还有 10 个文件在用（企业新建等），归 7b 盘点。

## 与八条硬纪律的关系

1. **零 schema**：不涉及（PrincipalRoleBinding / AuditLog 既有表）。
2. **出站先审批**：不涉及（无对外发送）。
3. **第三套队列**：不涉及。
4. **脱敏**：触碰。只有平台 super_admin 能看到成员邮箱，与成员接口 `canSeePii` 一致；审计不含密码哈希 / token。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：触碰。全部查表，无 LLM。
8. **测试注册**：触碰。纯测试注册 `test-all` 与 `test-ci-unit`，隔离库测试注册 `test-all`。

## Risks / Trade-offs

- **BREAKING**：平台 `admin`（非 super_admin）不能再增删改企业成员；企业详情页对 `org_admin` 不再显示成员编辑按钮（原本也会 403）。
- 界面能停用系统模板绑定（如 seed 自动绑的 `org_owner`），比脚本 `--prune` 范围大。只有 super_admin 可用，且每次先预览差异。
- 脚本抽服务有回归风险：用隔离库测试固定"同一文件前后 `--dry-run` 输出一致"与"写入后审计字段一致"。

## 验证方式

- `npx tsx src/lib/authorization/__tests__/position-binding-console.test.ts`（新，纯）：
  - 完整集合差异（加 / 换 / 清空）；
  - 护栏判定；
  - 数字员工四岗限制；
  - 接口与成员路由源码断言（守卫为 `requirePlatformSuperAdmin`）；
  - 页面只对 super_admin 渲染；
  - 脚本改调服务。
- `position-binding-console-db.isolated.test.ts`（新，隔离库，真实路由）：
  - 权限：super_admin GET / PUT 200，平台 admin / 老板岗位 / org_admin 403；
  - 写入：加岗位后 `loadPermissionKeys` 立即含新键；换岗位停用旧绑定；`dryRun` 不写库；
  - 校验：非成员 400；数字员工 `owner` 400；
  - 护栏：唯一 owner 409；
  - 审计：bind / unbind、`via: "console"`；
  - 成员接口：平台 admin POST / PATCH / DELETE 403，super_admin 200；
  - 脚本：同一绑定文件 `--dry-run` 输出与改动前一致（`runBindPositions` 或子进程）。
- 回归：`position-binding`、`digital-employee*`、`authorize`、成员相关测试、`platform-role-collapse`。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate perm-7-position-binding-ui --strict`。
