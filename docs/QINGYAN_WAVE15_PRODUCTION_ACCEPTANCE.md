# Wave 1.5 — 生产验收清单

**日期：** 2026-08-01  
**基准：** `main@bc132fd8e9306e6f9905facf17f6ab4c8a280e8b`  
**原则：** 只验收当前 main 已存在能力；不恢复实验 Agent Runtime；不伪造生产结果  

**状态约定：**

| 状态 | 含义 |
|---|---|
| PASS | 已在安全环境验证通过并留证 |
| FAIL | 已验证且不符合预期 |
| BLOCKED | 环境/权限阻止执行 |
| MANUAL_VERIFICATION_REQUIRED | 须人工在 Preview/生产只读方式执行；本文件不预填虚假结果 |

本波自动化仅覆盖只读 smoke（见 `scripts/wave15-smoke-readonly.ts`）。下列业务矩阵默认均为 **MANUAL_VERIFICATION_REQUIRED**，直至人工填写。

---

## 0. 执行环境与证据

| 项 | 填写 |
|---|---|
| 验收环境（Preview URL / 指定 staging） | _待填_ |
| 验收人 | _待填_ |
| 日期 | _待填_ |
| 证据目录（截图/日志相对路径） | 建议 `docs/evidence/wave15/`（本 PR 不强制创建） |
| 生产写操作 | **禁止** |
| 真实邮件/微信发送 | **禁止** |
| 生产 cron 业务执行 | **禁止**（可测鉴权拒绝） |

---

## 1. 基础访问

| ID | 场景 | 测试步骤 | 预期结果 | 实际结果 | 状态 | 证据 | 严重度 | 阻塞生产？ |
|---|---|---|---|---|---|---|---|---|
| A1 | 首页打开 | 打开站点根路径 | 可渲染登录或主壳，无白屏/5xx | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| A2 | 登录成功 | 有效账号密码登录 | 进入已登录态，Session cookie 建立 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| A3 | 登录失败 | 错误密码 | 401/错误提示，不建立有效 Session | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| A4 | 退出 | 点击退出 | Session 清除，受保护页跳转登录 | | MANUAL_VERIFICATION_REQUIRED | | P1 | 否 |
| A5 | Session 过期 | 清除/伪造 cookie 后访问受保护 API | 401，`x-auth-reason=session`（若适用） | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| A6 | `/api/health` | `GET /api/health`（可匿名） | 200 或聚合 503；无业务数据行；无 Secret | 可由 smoke 辅助 | MANUAL_VERIFICATION_REQUIRED | | P1 | 否 |

---

## 2. 组织和权限

| ID | 场景 | 测试步骤 | 预期结果 | 实际结果 | 状态 | 证据 | 严重度 | 阻塞生产？ |
|---|---|---|---|---|---|---|---|---|
| O1 | 当前工作企业 | 登录后查看 active org | 显示正确企业上下文 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| O2 | 企业切换 | 切换到另一成员企业 | 列表/数据随 org 切换，无串数据 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| O3 | 无组织用户 | 无 activeOrg 账号访问业务页 | 引导选择/创建或安全拒绝，无裸数据 | | MANUAL_VERIFICATION_REQUIRED | | P1 | 视产品 |
| O4 | 非成员访问组织数据 | 用外组织用户猜 URL/API | 403/404，无数据泄露 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| O5 | 跨组织资源访问 | 替换他组织 resource id | 403/404，错误信息不枚举他组织 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| O6 | 管理员 vs 成员 | 对比关键管理入口 | 权限差符合 RBAC，无越权 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |

---

## 3. 销售业务

| ID | 场景 | 测试步骤 | 预期结果 | 实际结果 | 状态 | 证据 | 严重度 | 阻塞生产？ |
|---|---|---|---|---|---|---|---|---|
| S1 | 客户列表 | 打开客户列表 | 仅本 org 客户 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| S2 | 客户详情 | 打开已知客户 | 字段正确；他 org id → 404/403 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| S3 | 创建客户 | Preview/本地创建测试客户 | 成功且归属当前 org（**禁止生产**） | | MANUAL_VERIFICATION_REQUIRED | | P1 | 否* |
| S4 | 商机 | 打开商机列表/详情 | 本 org 隔离 | | MANUAL_VERIFICATION_REQUIRED | | P1 | 视业务 |
| S5 | 报价列表 | 打开报价列表 | 本 org 隔离 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| S6 | 创建报价 | 仅 Preview/本地 | 成功（**禁止生产**） | | MANUAL_VERIFICATION_REQUIRED | | P1 | 否* |
| S7 | 报价详情 | 打开报价 | 数据正确 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| S8 | 报价分享链接 | 有效 share token 访问 | 可看分享内容，无需登录 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| S9 | 错误 share token | 随机 token | 404；无跨 org 枚举文案 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |

\* 创建类用例不得在生产执行；生产封版可仅验列表/详情/分享只读。

---

## 4. 项目业务

| ID | 场景 | 测试步骤 | 预期结果 | 实际结果 | 状态 | 证据 | 严重度 | 阻塞生产？ |
|---|---|---|---|---|---|---|---|---|
| P1 | 项目列表 | 打开项目列表 | 仅本 org | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| P2 | 项目详情 | 打开项目 | 数据正确 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| P3 | 项目讨论 | 打开讨论入口 | 可读；写操作仅 Preview | | MANUAL_VERIFICATION_REQUIRED | | P1 | 视业务 |
| P4 | 文件入口 | 打开文件区 | 权限内可见 | | MANUAL_VERIFICATION_REQUIRED | | P1 | 视业务 |
| P5 | 项目成员权限 | 非成员/只读成员 | 拒绝越权写 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| P6 | 跨组织项目隔离 | 替换他 org project id | 404/403 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |

---

## 5. AI 与动作（仅 main 已有能力）

| ID | 场景 | 测试步骤 | 预期结果 | 实际结果 | 状态 | 证据 | 严重度 | 阻塞生产？ |
|---|---|---|---|---|---|---|---|---|
| I1 | Assistant 页面 | 打开 Assistant | 可加载，无 5xx | | MANUAL_VERIFICATION_REQUIRED | | P1 | 视业务 |
| I2 | Pending Action 列表 | 打开待确认 | 仅本用户/本 org 可见草稿 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 视是否启用 AI |
| I3 | Email Draft 类型 | 查看/确认一则 email_draft（Preview） | 状态机符合 pending→…；**不真实发信** | | MANUAL_VERIFICATION_REQUIRED | | P1 | 否 |
| I4 | Project Task 类型 | Preview 确认一则 project_task | 创建任务副作用正确；无跨 org | | MANUAL_VERIFICATION_REQUIRED | | P1 | 否 |
| I5 | Internal Note 类型 | Preview 确认一则 internal_note | 笔记写入正确目标 | | MANUAL_VERIFICATION_REQUIRED | | P1 | 否 |
| I6 | 批准 | Preview 批准 pending | 经审批入口执行；有审计/终态 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 视启用 |
| I7 | 拒绝 | Preview 拒绝 | `rejected`，无业务副作用 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 视启用 |
| I8 | 重复执行保护 | 对终态再次批准 | 幂等/拒绝重复执行 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 视启用 |
| I9 | 失败状态 | 制造可安全失败（Preview） | `failed` + 原因，无 Secret 泄露 | | MANUAL_VERIFICATION_REQUIRED | | P1 | 否 |

**不验收：** 实验 Orchestrator / Bid Data 审批树。

---

## 6. 外贸与消息

| ID | 场景 | 测试步骤 | 预期结果 | 实际结果 | 状态 | 证据 | 严重度 | 阻塞生产？ |
|---|---|---|---|---|---|---|---|---|
| T1 | Trade Intelligence | 打开页面 | 可访问或按权限拒绝 | | MANUAL_VERIFICATION_REQUIRED | | P1 | 视业务 |
| T2 | Prospect | 打开线索列表/详情 | org 隔离 | | MANUAL_VERIFICATION_REQUIRED | | P1 | 视业务 |
| T3 | 微信/企微入口 | 打开绑定/回调说明页 | 无凭据不执行业务 | | MANUAL_VERIFICATION_REQUIRED | | P1 | 视业务 |
| T4 | Webhook 无凭据 | 无签名请求 webhook | 401/403；无写入 | 可由 smoke/契约辅助 | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| T5 | Webhook 错凭据 | 错误签名 | 401/403 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| T6 | Worker Token | 无/错 `POSTFLOW_WORKER_TOKEN` | 401 | 契约已覆盖静态 | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| T7 | `/api/trade/cron` 无 Auth | POST 无 Authorization | 401（secret 已配置时） | smoke 可测 | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| T8 | CRON_SECRET 未配置 | 仅安全 staging 验证 | 503 fail-closed | 单元已覆盖 helper | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| T9 | CRON_SECRET 错误 | 错误 Bearer | 401；响应无 secret | smoke 可测 | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| T10 | 正确 Bearer | **禁止**对生产执行业务；仅 Preview/mock | 鉴权通过后才进入业务；生产勿跑 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |

---

## 7. 错误与可观测性

| ID | 场景 | 测试步骤 | 预期结果 | 实际结果 | 状态 | 证据 | 严重度 | 阻塞生产？ |
|---|---|---|---|---|---|---|---|---|
| E1 | 401 | 未登录打受保护 API | 401 | smoke 可测部分 | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| E2 | 403 | 无权限操作 | 403 | | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| E3 | 404 | 不存在资源 | 404 | | MANUAL_VERIFICATION_REQUIRED | | P1 | 否 |
| E4 | 500 | 非漂移未知错误（Preview） | 500 + requestId；无 stack/SQL | | MANUAL_VERIFICATION_REQUIRED | | P1 | 否 |
| E5 | P2021 | 仅在可控环境模拟 | 503 + code=P2021 + requestId | 单元已覆盖 | MANUAL_VERIFICATION_REQUIRED | | P0 | 是* |
| E6 | P2022 | 同上 | 503 + code=P2022 + requestId | 单元已覆盖 | MANUAL_VERIFICATION_REQUIRED | | P0 | 是* |
| E7 | 503 响应体 | 检查 JSON | 无表名/列名/SQL/连接串/Secret | 单元+smoke | MANUAL_VERIFICATION_REQUIRED | | P0 | 是 |
| E8 | requestId | 任意 API 错误/成功 | 响应头或体含 requestId（withAuth 路径） | | MANUAL_VERIFICATION_REQUIRED | | P1 | 否 |

\* 生产不应人为制造 Schema 漂移；依赖 Wave1 单元测试 + 观测。

---

## 8. 自动化 vs 人工分工

| 类型 | 覆盖 |
|---|---|
| 已自动化（CI） | release-safety；schema-drift P2021/P2022；public-route 契约；SWC；wave15 只读 smoke（health/未认证/错 token/敏感信息） |
| 必须人工 | 登录 UX、org 切换、销售/项目主路径、分享链接真实打开、AI 批准/拒绝、Webhook 真签名、生产健康巡检 |
| 禁止自动化/人工 | 生产写客户/报价、真邮件、真微信发送、生产 cron 业务执行、migration |

---

## 9. 签字栏

| 角色 | 姓名 | 日期 | 结论（GO / NO-GO） |
|---|---|---|---|
| 产品负责人 | | | |
| 技术负责人 | | | |

**NO-GO 条件示例：** P0 跨组织泄露、cron/webhook fail-open、登录不可用、生产误写。  
