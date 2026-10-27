# 权限重设计 — 交接（HANDOFF）

> 任何新会话从这里进。先读本文件，再按"下一步"执行，不凭记忆重写。

| 项 | 值 |
|---|---|
| 最后更新 | 2026-10-27（会话 1） |
| 主线文档 | `docs/QINGYAN_PERMISSION_TASKFLOW.md`（状态列）、`docs/QINGYAN_PERMISSION_REDESIGN_DESIGN.md`（设计与已决定） |
| 任务书 | `docs/QINGYAN_PERM-1-2_POSITIONS_DISCOUNT_TASKBRIEF.md` |
| 工作分支 | `claude/youthful-davinci-8n1we3`（每个 change 合并后从 main 重建同名分支） |
| OpenSpec CLI | 未装进依赖，用 `OPENSPEC_TELEMETRY=0 npx -y @fission-ai/openspec@1.15.0 <cmd>` |

## 当前进度

| change | 状态 | PR |
|---|---|---|
| `perm-1-positions` | 代码完成、8/8 tasks 打勾、测试全绿；待 PR → 合并 → archive | 待开 |
| `perm-2-discount-by-position` | 未开始 | — |

## 下一步（按顺序）

1. PERM-1：若 PR 还没开，在分支 `claude/youthful-davinci-8n1we3` 上 `git log` 确认提交后开 PR；CI 绿合并；再 `/opsx:archive perm-1-positions --yes`（独立小 PR），TASKFLOW PERM-1 改 `[x]`。
2. 合并后生产动作（Lucas 本机）：对 Sunny 跑 `seedOrgAuthorizationProfiles` 落地模板；补 `config/positions/sunny.json` 邮箱；`--dry-run` 后执行绑定脚本（命令见 `docs/QINGYAN_PERM-1_REPORT.md` §4）。
3. PERM-2：`/opsx:propose perm-2-discount-by-position`（任务书 PERM-2 部分 + 设计稿 §4、§5 C2 / C3 / C7；另加：从 `org_owner` 系统模板移除 `identity.member.manage` / `identity.role.manage` / `authorization.policy.manage`，见 PERM-1 报告 §4-1）→ 自审 → `/opsx:apply` → `npm test` → `/opsx:verify` → PR → 合并 → archive。
4. 交叉测试与报告 `docs/QINGYAN_PERM-1-2_REPORT.md`。

## 环境注意

- 沙箱 Node 是 22，仓库要 24：`source ~/.nvm/nvm.sh && nvm use 24`（若 nvm 不在，`node -v` 为 22 也能跑 tsx，但 `tsc` 要 `NODE_OPTIONS=--max-old-space-size=8192`）。
- 沙箱无 Postgres：带 DB 的测试在 `npm test` 里会因 MISSING_DATABASE_URL 失败，属环境性；CI 子集 `npm run test:ci` 不含它们。
- 生产库迁移是手工受控的（见 `docs/DEPLOY_VERCEL.md`）；本主线零 schema，不应再有迁移。
- 沙箱访问不到 qingyan.ca 与 Neon；线上核对由 Lucas 做。

## 已知陷阱

- `resolveEffectiveBindings` 无绑定时按 `OrganizationMember.role` 兼容回退；PERM-1 绑定后 Sunny 全员应走绑定，别再依赖回退。
- `seedOrgAuthorizationProfiles` 会把 org_owner / org_admin / 平台 sales 自动绑到系统模板；新模板加入后要确认它不会给梦馨绑 Sunny 岗位。
- 唯一 org_owner 保护在 `organizations/[orgId]/members/[memberId]/route.ts`；老板做成岗位 `owner`，不改这条保护。
