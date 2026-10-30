# PERM-1 / PERM-2 交叉测试报告

| 项 | 值 |
|---|---|
| 日期 | 2026-10-27 |
| 范围 | change `perm-1-positions`（#264 已合并）+ `perm-2-discount-by-position`（#265） |
| 执行环境 | Claude Code 云沙箱：Node 24.22、无 Postgres、无外网（qingyan.ca / Neon / Vercel 预览均不可达） |
| 分报告 | `docs/QINGYAN_PERM-1_REPORT.md`、`docs/QINGYAN_PERM-2_REPORT.md` |

## 1. 自动化

| 检查 | 结果 | 说明 |
|---|---|---|
| `npm test`（全量，435 项） | 422 通过 / 13 失败 | 13 项与 `docs/QINGYAN_SDD-0_REPORT.md` §3 用例 4 记录的环境性基线逐项一致：10 项 `MISSING_DATABASE_URL`（Agent Trace / Phase3A-2…5 / Governance Hygiene）、`T4 授标情报真实 Postgres 矩阵` 需 DATABASE_URL、`Gmail Draft OAuth Compose Scope`、`Quote Operations 客户报价 PDF 分页布局`（页脚断言，与干净 main 相同）。**无新增失败**；`TypeScript 类型检查` 本次通过（8GB 堆） |
| `npm run test:ci`（CI 子集） | PASS | 含 runtime-architecture 守卫 9/9、release-safety 27 |
| `npm run typecheck` | 通过 | |
| `npm run lint:baseline` | PASS | 相对基线少 14 处 error |
| `bash scripts/check-test-registry.sh` | OK | 已注册 418，基线剩 72（只减不增） |
| `npm run build`（生产构建） | 退出 0 | 385 个静态页生成；既有 global-error 警告 |
| `openspec validate --strict` | perm-1 / perm-2 / install-1 均 valid | |

新增测试（均已注册）：`authorize.test.ts` 20 → 52；`position-binding.test.ts` 18；`pricing-policy.test.ts` 10；`discount-tier.test.ts` 14；`quote-settings-approval.test.ts` 18。

## 2. 按岗位走查（决策表级，纯函数实跑）

| 场景 | 输入 | 结果 |
|---|---|---|
| 销售 Alex 20% | 销售上限 25% | within_limit → not_required |
| 销售 Alex 30% | 无超限提交权 | approval_required → required；发送 / 分享 409 |
| 合价 Miki 30% | 持 over_limit.submit，合价上限 35% | lead_direct → approved，审计 via pricing_lead |
| 合价 Miki 40% | 同上 | approval_required → 提交审批 |
| Miki 自批自己提交的 40% | 持 approve 权 | 拒绝："不能批准自己提交的审批" |
| Bob 批 Miki 的 40% | 持 approve 权 | 通过 |
| 平台 admin（非 super_admin）30% | 无能力位 | approval_required（不再直批） |
| Lucas（super_admin）40% | — | platform_self_approved，审计 selfApproved |
| Bob 改折扣表 | 持 settings.manage | 202 已提交审批；payload 含哈希不含明文 |
| Bill 批 Bob 的设置修改 | 持 settings.manage | 落库、版本 +1、审计含提交人与批准人 |
| org_admin 改成员角色 | — | 403（requirePlatformAdmin） |
| 企业无人持审批权（PERM-1 绑定未跑） | 过渡态 | 只拒自批，其余放行 |

## 3. 未在沙箱实跑、需线上核对

1. 路由级 HTTP 行为（409 / 403 / 202）需要数据库：按 `docs/QINGYAN_PERM-2_REPORT.md` §4-3 的步骤在 preview 或生产走一遍。
2. Sunny 岗位绑定：补齐 `config/positions/sunny.json` 邮箱后 `--dry-run` → 执行（`docs/QINGYAN_PERM-1_REPORT.md` §4-2）。绑定前系统处于"过渡态"（审批人回退 ownerId + org_admin，执行器只拒自批）。
3. 现网 `User.role = 'admin'` 账号核对（PERM-2 报告 §4-1）。
4. 老板岗位但非 org ownerId / org_admin 的人在审批中心点"批准"的放行留 PERM-4（`canDecideTeamApproval`）。

## 4. 结论

PERM-1 / PERM-2 的全部自动化检查在本环境通过，全量测试无新增失败，生产构建成功。可以合并；线上生效前先跑岗位绑定脚本，并按 §3 走查一次。
