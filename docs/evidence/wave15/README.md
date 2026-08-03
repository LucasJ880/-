# Wave1.5 验收证据（脱敏）

本目录只保存状态码摘要与安全元数据，**不含**密码、Cookie、Authorization、连接串或客户隐私。

## 验收执行（PR #47）

| 文件 | 说明 |
|---|---|
| `anonymous-prod-probe-summary.json` | 对 `qingyan.ca` 等主机的匿名探活状态码 |
| `anonymous-prod-share-auth-summary.json` | 错误 share token / 未登录 API 状态码 |
| `preview-anonymous-smoke-2026-08-01.log` | Preview 匿名 smoke（302 → Deployment Protection） |
| `phase1-prod-login-readonly-summary.json` | 生产只读登录态 Phase1（已脱敏；探针原始标记保留） |
| `vercel-preview-isolation-assessment-2026-08-01.md` | Preview vs Production DB/副作用隔离评估（仅 endpoint 前缀与 YES/NO） |
| `preview-write-path-audit-2026-08-01.md` | 历史 Preview 写路径只读审计（无 Secret/客户数据） |
| `staging-acceptance-resume-2026-08-03.md` | #48 合并后恢复写验收：门禁与阻塞（无 Secret） |

执行记录：`docs/QINGYAN_WAVE15_ACCEPTANCE_EXECUTION_2026-08-01.md`

## Staging isolation（PR #48，已合并 main）

| 文件 | 说明 |
|---|---|
| `staging-isolation-proof-2026-08-01.md` | Staging 隔离证明 + Browser / 持久 Staging health（脱敏） |
| `persistent-staging-target-2026-08-02.md` | 持久 Staging 目标与 `qingyan-staging` 验证（非敏感） |

写验收必须在持久 Staging（`qingyan-staging` / 分支 `staging`）上执行；默认 Preview 为 production-adjacent，禁止写验收。
