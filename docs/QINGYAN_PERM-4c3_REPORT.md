# PERM-4c3 报告：平台角色压扁工具 + 窗饰企业关闭兼容回退

- change：`openspec/changes/perm-4c3-collapse-platform-roles/`（proposal / specs ×3 / design / tasks 7/7）
- 任务书：`docs/QINGYAN_PERM-4_PLATFORM_ROLE_CLOSEOUT_TASKBRIEF.md` PERM-4c 段 What-4 / What-5（拍板见"拍板结果 · PERM-4c3"）
- 零 schema：前后角色存既有 AuditLog。

## 1. 做了什么

### 1.1 压扁工具（写库被闸门挡住）

| 项 | 内容 |
|---|---|
| 规划（纯） | `src/lib/authorization/platform-role-collapse.ts`：<br>• `planCollapse`：范围 + 三类前置校验；<br>• `planRestore`：每人取最新一条，当前非 `user` 跳过；<br>• 输出行只含邮箱与角色名。 |
| 执行器 | `src/lib/authorization/platform-role-collapse-run.ts` `runPlatformRoleCollapse`：<br>• 执行者须 super_admin；<br>• 校验顺序：前置校验 → dry-run 返回 → 写库闸门；<br>• 整批写入在一个事务内；<br>• 每人一条审计 `authorization.platform_role.collapse`（`fromRole` / `toRole`）；<br>• `--restore` 写 `authorization.platform_role.restore`；<br>• 输出提醒相关成员重新登录。 |
| 脚本 | `scripts/collapse-platform-roles.ts`：<br>• `ALLOW_ROLE_COLLAPSE=true` 闸在连库前；<br>• 参数 `--org`、`--actor`、`--dry-run`、`--restore`；<br>• 退出码 0 成功 / 1 拒绝 / 2 输入或前置校验错误（同 `bind-positions`）。 |
| 范围 | 目标企业 active 成员里 `boss / manager / operations / sales` → `user`；<br>`super_admin / admin / trade / user` 与非 active 成员不动。 |
| 前置拒绝（整批不写，列名） | • 企业非岗位模式；<br>• 待改的人在该企业无 active 人类岗位绑定；<br>• 待改的人同时是旧模式企业（无岗位模板，如梦馨）的 active 成员——`User.role` 跨企业共用。 |
| **写库闸门** | 常量 `PLATFORM_ROLE_COLLAPSE_READY = false`：只允许 `--dry-run` 与 `--restore`，写入退出 1 并指向残留清单。没有命令行绕过参数。 |

### 1.2 兼容回退收口（合并即生效）

- `resolveEffectiveBindings`：人类主体无 active 绑定时先查企业行业包。
  - 岗位模式企业返回空，不再把 `org_owner` / `org_admin` / `org_viewer` / 平台 `sales` 回退到系统模板；
  - 旧模式企业照旧。
- 新纯函数 `compatFallbackAllowed(industryPackId)`。
- super_admin 全权、数字员工路径都在收口之前，不受影响。

### 1.3 残留清单

`docs/QINGYAN_PERM-4c3_RESIDUAL_ROLE_READS.md`：
- A / B / C / D / E 五组，逐条写 file:line、门槛、压扁前后差异、建议改法与归属（4c4 / 4c5 / PERM-6）；
- 末尾是"打开闸门的条件"。

## 2. 怎么验

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS；新文件 eslint 0 问题 |
| `npm run test:ci` | PASS，含新 `platform-role-collapse.test` |
| `bash scripts/check-test-registry.sh` | OK（453） |
| `openspec validate perm-4c3-collapse-platform-roles --strict` | valid |
| `platform-role-collapse.test`（新，纯） | **36 / 36**，见下方说明 |
| `platform-role-collapse-db.isolated.test`（新，本地 Postgres 16） | **38 / 38**，见下方说明 |
| 回归：既有隔离库 e2e 全部用窗饰企业（兼容回退收口直接相关） | 签约改价 20、销售记录 15、项目财务 18、会计 27、数字员工 34、运营 32，**全过** |
| 回归：纯测试 | authorize 150、finance-access 27 |

`platform-role-collapse.test` 覆盖：
- 范围与跳过原因；
- 幂等；
- 三类阻断（另一家也是岗位模式不阻断；旧模式企业成员关系非 active 不阻断；不在范围的人不参与校验）；
- 还原取最新一条、跳过非 `user`；
- `compatFallbackAllowed`；
- 源码断言：`ALLOW` 闸在连库前、闸门取常量且无 `--force` / `--ack`、`--restore` 在闸门前、先校验再 dry-run 再闸门、整批事务、兼容回退前先判岗位模式且 super_admin / 数字员工在收口之前。

`platform-role-collapse-db.isolated.test` 覆盖：
- 兼容回退：岗位模式无绑定 `org_owner` / 平台 `sales` 无权限、有绑定照常、旧模式照旧 `compat:`、super_admin 全权；
- 拒绝路径：平台 admin 执行退出 1、旧模式企业 / 企业不存在退出 2；
- 前置阻断：缺绑定 + 跨企业，列名且整批未写；
- dry-run 打印且不写；
- 闸门关闭写入退出 1、无人被改、无审计；
- 闸门打开（测试内 `ready: true`）：5 人压扁、其余不变、5 条审计含前后角色与执行者、再跑无变化；
- `--restore` 在闸门关闭时可执行，还原 4 人、跳过压扁后被改为 `trade` 的人、4 条还原审计。

`sunny-process/autogen-db.isolated` 仍失败，与 main 相同：签约一步 `NO_BINDING`，是测试本身早于 PERM-4a。已另提任务卡，与本 change 无关。

## 3. 判断与实施中的变更

- **propose 前盘点改变了范围**：约 25 处导航之外的平台角色读点，压扁后立即失效（清单 A–E）。
  - 用户拍板：拆出 `perm-4c4-ai-tools-by-position`、`perm-4c5-management-reads-by-position`；
  - Sunny 暂不需要外贸，外贸通道留 PERM-6；
  - Sunny 需要招投标，交接与运营项目在 4c5 收口。
- 闸门做成代码常量而非命令行开关：随代码状态走，合并记录可查，不能临场绕过。
- `--restore` 不受闸门限制：出问题时可立即回退。

## 4. 已知限制与上线

- **BREAKING（Sunny，合并即生效）**：没有任何 active 岗位绑定的 Sunny 成员失去原本靠兼容回退得到的系统模板权限。
  - `seedOrgAuthorizationProfiles` 已把 `org_owner` / `org_admin` / 平台 `sales` 成员真实绑定，不受影响。
  - 受影响的是 seed 之后加入、尚未绑定的人，以及 `org_viewer`。
- 压扁本身**未执行**、也执行不了（闸门关闭）。生产可先跑 dry-run 核对名单。
- 被压扁的人要重新登录：中间件读 JWT 里的角色，接口读库。
- **上线（Lucas）**：
  1. 合并前后对 Sunny 跑 `ALLOW_POSITION_BINDING=true npx tsx scripts/bind-positions.ts --org <sunny> --file config/positions/sunny.json --actor <lucas> --dry-run`，确认全员有绑定（`TODO:` 占位要先填）。
  2. 可跑 `ALLOW_ROLE_COLLAPSE=true npx tsx scripts/collapse-platform-roles.ts --org <sunny> --actor <lucas> --dry-run`，核对待压扁名单与阻断项（尤其是否有人同时在梦馨）。

## 5. 合并后

- `/opsx:archive perm-4c3-collapse-platform-roles --yes`，独立小 PR；`openspec list --specs` 应出现 `authorization/platform-role-collapse`；TASKFLOW PERM-4c3 → `[x]`。
- 下一个 `perm-4c4-ai-tools-by-position`，先 propose。
