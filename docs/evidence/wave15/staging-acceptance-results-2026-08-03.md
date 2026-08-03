# Wave1.5 Staging 剩余验收结果（2026-08-03）

**性质：** 脱敏执行证据  
**PR：** #47  
**Base：** `https://qingyan-staging-7uk7skle6-lucas-9039s-projects.vercel.app`  
**Git branch：** `staging`  
**captured_at_utc：** `2026-08-03T03:40:19.005Z`

## Health

| 项 | 值 |
|---|---|
| HTTP | 200 |
| runtimeEnv | staging |
| dbPlane | staging |
| isolation | ok |
| dbFingerprint | e0d93a32b6a2 |

## 结果摘要

| ID | 状态 | HTTP / 备注 |
|---|---|---|
| O2 | PASS | 200；activeOrgId A→B；pending 列表 2→0；Org B 客户可见且不含 Org A 客户 |
| O4 | PASS | 404；Outsider→Org A customer |
| O5 | PASS | 404；Member→Org B customer |
| P6 | PASS | 403；Member→Org B project |
| P5 | PASS | 403；Member PATCH Org A project；`mutationConsistent=true`；updatedAt 前后相同 |
| I2 | PASS | 403 `ORG_CONTEXT_MISMATCH`；仍 pending；Outsider 列表不可见 |
| I6 | PASS | 200；终态 `executed`；sideEffectCountDelta=1 |
| I7 | PASS | 200；终态 `rejected`；sideEffectCountDelta=0 |
| I8 | PASS | 首次 delta=1；重复批准 delta=0；`duplicateFlag=true`；终态 `executed` |
| I9 | PASS | 终态 `failed`；`leak=false`；failureReason 无 Secret/SQL/DSN |
| T4 | PASS | 503 `CRON_DISABLED_NON_PROD`（无 Authorization） |
| T5 | PASS | 503 `CRON_DISABLED_NON_PROD`（错误 Authorization） |
| T6 | PASS | 401 / 401（无 token / 错 token） |

**本轮关键项：** PASS **13** / FAIL **0** / BLOCKED **0**（另含 HEALTH/LOGIN/HEALTH_END 门禁 PASS）

## Mutation / 幂等

| 证明 | 结果 |
|---|---|
| P5 前后 `updatedAt` | 均为 `2026-08-02T01:23:28.720Z`（未变） |
| I8 副作用 | 第一次 +1 note；第二次 +0；duplicate=true |

## 未记录

密码、Cookie、bypass secret、DATABASE_URL/DIRECT_URL、CRON_SECRET、worker token、Authorization 头。

## 边界

- Production：**未写**
- 真实邮件 / 微信 / 企微 / webhook：**未开**
- 未使用正确 CRON_SECRET 执行业务 Cron
- Wave2：**未批准**
