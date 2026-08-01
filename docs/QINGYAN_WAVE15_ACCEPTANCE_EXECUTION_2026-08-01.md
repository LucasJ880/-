# Wave 1.5 — 人工验收执行记录（2026-08-01）

**性质：** 执行副本（非模板原文）  
**模板来源：** `docs/QINGYAN_WAVE15_PRODUCTION_ACCEPTANCE.md`（未改写模板）  
**代码基准：** 稳定 Tag `qingyan-stable-wave1-2026-08-01` → `bc132fd`；当前 main tip `dbcd73a`（含 Wave1.5 #46）  
**纪律：** 不伪造结果；生产写操作/真邮件/真微信/生产 cron 业务 **禁止**

---

## 0. 执行元数据

| 项 | 值 |
|---|---|
| 验收环境 | _待填_ |
| 验收人 | _待填_ |
| 开始日期 | 2026-08-01 |
| 证据目录 | `docs/evidence/wave15/`（可选） |
| Wave2 | **未批准** |

### 已知环境阻塞（真实证据）

| ID | 场景 | 实际结果摘要 | 状态 |
|---|---|---|---|
| SMOKE-PREVIEW | 匿名 Preview 只读 smoke（health / pending-actions / trade cron） | Vercel Deployment Protection 返回 **302**；脚本严格模式 exit 1（非假绿） | **BLOCKED_BY_DEPLOYMENT_PROTECTION** |

说明：此项**不是**产品功能 PASS/FAIL；解除保护或提供可匿名探活环境后，再改为 PASS/FAIL。

---

## 1. 基础访问（P0/P1）

| ID | 场景 | 预期 | 实际结果 | 状态 | 证据 | 严重度 | 阻塞生产？ |
|---|---|---|---|---|---|---|---|
| A1 | 首页打开 | 可渲染，无白屏/5xx | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| A2 | 登录成功 | Session 建立 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| A3 | 登录失败 | 拒绝，无有效 Session | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| A4 | 退出 | Session 清除 | | MANUAL_VERIFICATION_REQUIRED | | P1 | 否 |
| A5 | Session 过期 | 401 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| A6 | `/api/health` 匿名 | 200/503；无 Secret | Preview 匿名见 SMOKE-PREVIEW | BLOCKED_BY_DEPLOYMENT_PROTECTION | wave15 smoke 日志 | P1 | 否 |

---

## 2. 组织与权限（P0）

| ID | 场景 | 预期 | 实际结果 | 状态 | 证据 | 严重度 | 阻塞生产？ |
|---|---|---|---|---|---|---|---|
| O1 | 当前工作企业 | 正确 org 上下文 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| O2 | 企业切换 | 无串数据 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| O4 | 非成员访问 | 403/404 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| O5 | 跨组织资源 | 403/404，无枚举 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| O6 | 管理员 vs 成员 | 无越权 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |

---

## 3. 销售（关键 P0 + 只读）

| ID | 场景 | 预期 | 实际结果 | 状态 | 证据 | 严重度 | 阻塞生产？ |
|---|---|---|---|---|---|---|---|
| S1 | 客户列表 | 仅本 org | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| S2 | 客户详情 | 正确；跨 org 拒绝 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| S5 | 报价列表 | 仅本 org | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| S7 | 报价详情 | 正确 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| S8 | 分享链接有效 token | 可访问 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| S9 | 错误 share token | 404 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |

（S3/S6 创建类：禁止生产执行；仅 Preview/本地另开时填写。）

---

## 4. 项目（关键 P0）

| ID | 场景 | 预期 | 实际结果 | 状态 | 证据 | 严重度 | 阻塞生产？ |
|---|---|---|---|---|---|---|---|
| P1 | 项目列表 | 仅本 org | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| P2 | 项目详情 | 正确 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| P5 | 成员权限 | 拒绝越权写 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| P6 | 跨组织项目 | 404/403 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |

---

## 5. AI / Pending Action（启用时 P0）

| ID | 场景 | 预期 | 实际结果 | 状态 | 证据 | 严重度 | 阻塞生产？ |
|---|---|---|---|---|---|---|---|
| I2 | Pending Action 列表 | org/用户隔离 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 视启用 |
| I6 | 批准（Preview） | 经审批入口；有终态 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 视启用 |
| I7 | 拒绝（Preview） | rejected，无副作用 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 视启用 |
| I8 | 重复执行保护 | 幂等/拒绝 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 视启用 |

---

## 6. 外贸 / Cron / Webhook（P0）

| ID | 场景 | 预期 | 实际结果 | 状态 | 证据 | 严重度 | 阻塞生产？ |
|---|---|---|---|---|---|---|---|
| T4 | Webhook 无凭据 | 401/403 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| T5 | Webhook 错凭据 | 401/403 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| T6 | Worker Token 错/无 | 401 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| T7 | trade/cron 无 Auth | 401/503 | Preview 匿名见 SMOKE-PREVIEW | BLOCKED_BY_DEPLOYMENT_PROTECTION | wave15 smoke | P0 | 是 |
| T9 | trade/cron 错 Bearer | 401/503；无 secret 回显 | Preview 匿名见 SMOKE-PREVIEW | BLOCKED_BY_DEPLOYMENT_PROTECTION | wave15 smoke | P0 | 是 |

（T10 正确 Bearer：**禁止**对生产执行业务。）

---

## 7. 错误与可观测性（P0）

| ID | 场景 | 预期 | 实际结果 | 状态 | 证据 | 严重度 | 阻塞生产？ |
|---|---|---|---|---|---|---|---|
| E1 | 401 | 未登录受保护 API | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| E2 | 403 | 无权限 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| E5/E6 | P2021/P2022 | 503+code+requestId | 依赖 CI 单元；生产不人造漂移 | MANUAL_VERIFICATION_REQUIRED | CI schema-drift | P0 | 是 |
| E7 | 503 体无泄露 | 无 SQL/表名/Secret | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |

---

## 8. 签字

| 角色 | 姓名 | 日期 | GO / NO-GO |
|---|---|---|---|
| 产品负责人 | | | |
| 技术负责人 | | | |

**NO-GO 示例：** 跨组织泄露、cron/webhook fail-open、登录不可用。  
**本文件不构成 Wave2 批准。**
