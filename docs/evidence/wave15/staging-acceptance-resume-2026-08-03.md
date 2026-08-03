# Wave1.5 Staging 验收恢复尝试（2026-08-03）

**性质：** 门禁与探针摘要（脱敏）  
**PR：** #47  
**纪律：** 不伪造 PASS；不输出密码 / Secret / Cookie；Production 只读；Wave2 未批准

## 1. 前置（已满足）

| 项 | 值 |
|---|---|
| #48 合并 commit | `4e28b98a2b1dc8e7ffcf260222fd15318d2f6b01` |
| 持久 Staging 项目 | `qingyan-staging` |
| Git 分支 | `staging` |
| Staging health（既有证据） | `runtimeEnv=staging` · `dbPlane=staging` · `isolation=ok` · `dbFingerprint=e0d93a32b6a2` |
| Production | 本轮未写 |
| Wave2 | 未批准 |
| PR #24 | 未触碰 |

## 2. #47 与 main 同步

| 项 | 值 |
|---|---|
| 合并 commit | `3457eaf979d25baadf13e98b9f4a0e4f4462d8e6` |
| 冲突文件 | 仅 `docs/evidence/wave15/README.md`（add/add） |
| 处理 | 保留 #47 验收证据索引 + #48 Staging isolation 证据索引；不删除 #48 证据 |
| Draft | 保持 |

> 注：首次 merge 提交中 README 曾残留冲突标记；后续提交已清除。

## 3. 合成测试数据（仅 ID / 邮箱，无密码）

| 角色 | 邮箱 | 组织 |
|---|---|---|
| Admin | `wave15-admin@test.qingyan.local` | Org A + Org B |
| Member | `wave15-member@test.qingyan.local` | Org A only |
| Outsider | `wave15-outsider@test.qingyan.local` | Org B only |

| 资源 | 存在 |
|---|---|
| `org_a_id` / `org_b_id` | YES |
| Org A/B 客户与项目 ID | YES |
| Pending Action 测试 ID | YES |
| Staging endpoint 前缀 | `ep-floral-sea-au07ycff`（非生产 `ep-super-field*`） |
| 真实客户 PII | 未使用 |

Agent shell 中：`WAVE15_*_PASSWORD` = **MISSING**（未打印任何口令）。

## 4. Staging 探针（Deployment Protection）

目标 deploy（`qingyan-staging` Preview，commit `c0f4302…`）：

`https://qingyan-staging-knmq5gbfu-lucas-9039s-projects.vercel.app`

| 探针 | HTTP | 说明 |
|---|---:|---|
| `GET /api/health` | 302 | Vercel SSO / Deployment Protection |
| `POST /api/cron/followup` 无 Authorization | 401 | body=`Protected deployment`（**未到达应用 cron auth**） |
| `POST /api/cron/followup` 错误 Bearer | 401 | 同上 |
| `POST /api/operations/worker/claim` 无 token | 401 | 同上 |
| `POST /api/operations/worker/claim` 错误 token | 401 | 同上 |

**判定：** T4/T5/T6 **未能**在应用层验证 fail-closed；SSO 先于应用返回 401。  
**未使用** Production `CRON_SECRET` / Production worker token。

## 5. 剩余验收项状态（本轮）

| ID | 状态 | 原因 |
|---|---|---|
| O2 | **未执行** | 缺 Staging 登录凭据 + API 需绕过 Deployment Protection |
| O4 | **未执行** | 同上 |
| O5 | **未执行** | 同上 |
| P5 | **未执行** | 同上（无 mutation 前后证明） |
| P6 | **未执行** | 同上 |
| I2 | **未执行** | 同上 |
| I6 | **未执行** | 同上 |
| I7 | **未执行** | 同上 |
| I8 | **未执行** | 同上 |
| I9 | **未执行** | 同上 |
| T4 | **BLOCKED_BY_ENVIRONMENT** | SSO 401，非应用 cron fail-closed 证据 |
| T5 | **BLOCKED_BY_ENVIRONMENT** | 同上 |
| T6 | **BLOCKED_BY_ENVIRONMENT** | 同上 |

停止条件：**未触发**（无跨 org 泄漏实测、无 Member 写入、无外部消息、无 Production 写、无 Secret 泄漏）。

## 6. 继续条件（须同时满足）

1. 提供 Staging 合成账号密码（交互注入环境变量；**不得**提交仓库 / 写入证据文件）  
2. 提供 `VERCEL_AUTOMATION_BYPASS_SECRET`（或等价 SSO 会话），使探针到达应用层  
3. 在到达应用层后重跑 O2/O4/O5/P5/P6/I2/I6–I9/T4–T6  
4. 全部真实通过后才更新 PASS/FAIL/BLOCKED 与双 GO，并将 #47 标 Ready

## 7. 本轮结论

- PASS / FAIL / BLOCKED **统计不改**（剩余项未真实通过）  
- Product Owner **NO-GO** · Technical Owner **NO-GO**  
- #47 **Draft** · **未合并** · Wave2 **未批准**  
- Production **未写** · 真实外部通道 **未开启**
