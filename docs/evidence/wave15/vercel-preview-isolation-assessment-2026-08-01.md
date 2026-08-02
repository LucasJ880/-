# Wave1.5 — Vercel Preview 隔离评估（脱敏）

**日期（UTC）：** 2026-08-01  
**项目：** Vercel `lucas-9039s-projects / -`（Production URL `qingyan.ca`）  
**方法：** `vercel env pull` Production / Preview；仅比对 endpoint 前缀与变量是否存在；本地 pull 已删除  
**禁止内容：** 无连接串、用户名、密码、Secret、OAuth Secret、Token 值  

---

## 1. 数据库 endpoint（非敏感）

| 环境 | `DATABASE_URL` endpoint 前缀 | `DIRECT_URL` endpoint 前缀 | 库名 | 分类 |
|---|---|---|---|---|
| Production | `ep-super-field-antfibsl-pooler` | `ep-super-field-antfibsl` | `neondb` | Production 主库 |
| Preview（默认） | `ep-super-field-antfibsl-pooler` | `ep-super-field-antfibsl` | `neondb` | **与 Production 相同** |

| 检查 | 结果 |
|---|---|
| `HOSTS_EQUAL` | **true** |
| Preview 独立于 Production | **false** |
| 环境定性 | **production-adjacent environment** |

说明：仅分支 `feature/visualizer-real-room-hd-mask-fix` 存在独立 Preview DB 覆盖；**默认 Preview（含 Wave1.5 相关部署）不适用该覆盖。**

---

## 2. 相关变量是否存在（值不记录）

| 变量 | Production | Preview（默认） | 备注 |
|---|---|---|---|
| `DATABASE_URL` | 存在 | 存在 | endpoint 前缀相同 |
| `DIRECT_URL` | 存在 | 存在 | endpoint 前缀相同 |
| `CRON_SECRET` | 存在 | 存在 | **跨环境相同**（内容相等，值未记录） |
| `GOOGLE_CLIENT_ID` | 存在 | 存在 | 未隔离 |
| `GOOGLE_CLIENT_SECRET` | 存在 | 存在 | 未隔离 |
| `GMAIL_DRAFT_ENABLED` | 不存在 | 存在 | Preview 侧开启草稿能力 |
| `POSTFLOW_WORKER_TOKEN` | 存在 | 不存在 | 不足以构成整体隔离 |
| `NEXT_PUBLIC_WECHAT_PUBLIC_ORIGIN` | 存在 | 不存在 | 不足以证明微信副作用关闭 |

---

## 3. YES / NO 结论

| # | 确认项 | 结论 |
|---|---|---|
| 1 | Preview 使用独立非生产数据库 | **NO** |
| 2 | Preview 写操作不会写入生产数据库 | **NO** |
| 3 | Preview 不会发送真实邮件 | **NO**（无法确认隔离） |
| 4 | Preview 不会发送真实微信/企微 | **NO**（无法确认隔离） |
| 5 | Preview 不会触发生产 cron/worker 副作用 | **NO**（`CRON_SECRET` 相同；同库） |

---

## 4. 对 Wave1.5 验收的影响

- 当前默认 Preview **禁止任何写验收**
- `P5` / `I2` / `I6`–`I9` / `T4`–`T6` = **BLOCKED_BY_ENVIRONMENT**
- Product Owner = **NO-GO**
- Technical Owner = **NO-GO**
- 须新建独立 Staging（不同 Neon endpoint + 不同 Secret + 副作用关闭）后再恢复写验收
