# PERM-7 报告：岗位绑定界面；成员增删改只认 super_admin

- change：`openspec/changes/perm-7-position-binding-ui/`（proposal / specs ×2 / design / tasks 6/6）
- 任务书：`docs/QINGYAN_PERM-7_POSITION_BINDING_UI_TASKBRIEF.md`
- 拍板："拍板结果 · PERM-7"——按推荐：方案 A、数字员工同页、成员增删改只认 super_admin、AI 平台 admin 档另立 7b。用户 2026-10-28 审四件套后确认："Perm-7可以。按照这个去做吧"。
- 零 schema；无新权限键；无新队列

## 1. 做了什么

| 项 | 改动 |
|---|---|
| 共用绑定服务 | 新 `src/lib/authorization/position-binding-service.ts`：<br>• `loadBindingContext`：读 active RoleProfile 与该主体类型的绑定；<br>• `executeBindingPlan`：写入 + 审计，审计字段与脚本原有一致，`via` 区分来源 |
| 脚本 | `scripts/bind-positions.ts` 改调服务：校验 / 差异 / 输出 / 退出码不变，审计 `via: "scripts/bind-positions.ts"` |
| 护栏 | `position-binding.ts` 新增 `wouldRemoveLastOwnerBinding` 与 `OWNER_POSITION_KEY` |
| 守卫 | `guards.ts` 新增 `requirePlatformSuperAdmin`（403 `PLATFORM_ADMIN_REQUIRED`）。`requirePlatformAdmin` 不改：还有 10 个文件在用，归 7b |
| 绑定接口 | 新 `/api/organizations/[orgId]/positions`：<br>• GET：岗位模式、可绑岗位（分行业包 / 系统模板）、成员与数字员工的 active 绑定（含 sponsor）、数字员工可绑岗位；<br>• PUT：单主体完整集合，校验复用脚本纯函数；`dryRun` 只返回差异；400 列全部原因；岗位模式最后一个 owner 返回 409 `LAST_OWNER_BINDING`（预览也会提示）；`via: "console"` |
| 界面 | 企业详情页新"岗位"一节（`positions-section.tsx`），只对平台 super_admin 渲染：<br>• 成员岗位表；<br>• 编辑勾选 → 预览差异 → 确认保存；<br>• 数字员工子节只列四个允许岗位、显示 sponsor |
| 成员增删改 | `POST /members`、`PATCH` / `DELETE /members/[memberId]` 改用 `requirePlatformSuperAdmin`。<br>原来的 `requirePlatformAdmin` 会放行平台 `admin`，与 spec `identity/member-management` 不一致。<br>GET 不变。页面成员编辑控件也改为只对 super_admin 显示（原来对 `org_admin` 显示、点了 403） |

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS；改动文件 eslint 0 problem |
| `npm run test:ci` | PASS（含新 `position-binding-console.test`） |
| `bash scripts/check-test-registry.sh` | OK（463） |
| `openspec validate perm-7-position-binding-ui --strict` | valid |
| `position-binding-console.test`（新，纯） | **30 / 30**，覆盖见下方说明 |
| `position-binding-console-db.isolated.test`（新，本地 Postgres 16，真实路由 + 子进程跑脚本） | **35 / 35**，覆盖见下方说明 |
| `digital-employee.test` / `digital-employee-db.isolated.test` | 50 / 50、34 / 34。脚本源码断言改为指向共用服务；隔离库测试用子进程跑脚本，验证重构后行为不变 |
| 回归：test-all 中 authorization / rbac / navigation / organizations / auth / trade / revenue-spine / sales / agent-core 目录 83 个测试文件（起隔离库） | **83 / 83** |

`position-binding-console.test` 覆盖：
- 完整集合差异：加、换、清空含系统模板、无变化、重新勾选 inactive、不碰他人；
- 最后一个 owner 护栏矩阵；
- 数字员工四岗；
- 源码断言：守卫、完整集合、`via`、409、dryRun 顺序、成员路由守卫、页面只对 super_admin、脚本改调服务。

`position-binding-console-db.isolated.test` 覆盖：
- **权限**：super_admin 读 200；平台 admin / 老板岗位 / `org_admin` 403；老板岗位提交变更 403。
- **写入**：
  - 预览不写库 / 审计；换岗位立即生效（`loadPermissionKeys` 变化）；
  - 审计 bind / unbind 带 `via: "console"`；
  - 换回时重新启用旧行、不重复建行。
- **校验**：非成员、未知岗位、非法主体类型都返回 400。
- **最后一个 owner**：停用返回 409（预览也是 409）；有第二位老板后可停用。
- **数字员工**：`owner` 400，`sales_rep` 200，不影响人类绑定，审计含 Agent 名称。
- **成员接口**：平台 admin 与 `org_admin` 的增删改都返回 403；super_admin 新增 / 修改成功；成员读目录不变。
- **脚本**：dry-run 输出格式不变；写入后审计 `via` 为脚本路径。

## 3. 判断与实施中的变更

- **完整集合语义**：界面勾选的是"此人在本企业的全部岗位"，集合外的 active 绑定都会停用，包括 seed 自动绑的系统模板（如 `org_owner`）。脚本 `--prune` 只动行业包岗位，保持不变。界面只有 super_admin 可用，且每次先预览差异。
- **护栏放在预览之前**：预览时就返回 409，避免确认那一步才失败。
- **其他老板的计数**：只算仍是 active 成员、且持未过期 active `owner` 绑定的人。已离开企业的人的残留绑定不算。

## 4. 已知限制与上线

- **BREAKING（合并即生效）**：平台 `admin`（非 super_admin）不能再增删改企业成员。生产上受影响的是梦馨老板账号 `lucas@sunnyshutter.ca`，此前已给出改为 super_admin 的 SQL。
- **生产动作**：无数据动作。之后调岗在企业详情页"岗位"一节完成，验收清单里"跑 bind-positions"的步骤都可改用界面。
- `authorization/position-binding` 的 Purpose 仍写"唯一写入口"。Purpose 只在能力创建时写入；新能力 `authorization/position-binding-console` 的 Purpose 写明自己是第二个入口。

## 5. 合并后

- `/opsx:archive perm-7-position-binding-ui --yes`，独立小 PR；TASKFLOW PERM-7 → `[x]`。
- 下一个：PERM-6b（四件套已获确认，合并前需 Lucas 先对梦馨跑 seed）；PERM-7b（AI 工具策略平台 admin 档、企业列表 / 新建企业的平台 admin 入口）。
