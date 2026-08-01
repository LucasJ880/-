# Wave 1.5 — 人工验收执行记录（2026-08-01）

**性质：** 执行副本（非模板原文）  
**模板来源：** `docs/QINGYAN_WAVE15_PRODUCTION_ACCEPTANCE.md`（未改写模板）  
**Stable Tag：** `qingyan-stable-wave1-2026-08-01` → `bc132fd8e9306e6f9905facf17f6ab4c8a280e8b`  
**当前 main：** `dbcd73a2f4640b14a3e3a81b60d266fe69bfeeac`  
**PR：** #47  
**纪律：** 不伪造 PASS；生产禁止写操作；Wave2 **未批准**

---

## 0. 执行元数据

| 项 | 值 |
|---|---|
| 生产环境（只读匿名） | `https://qingyan.ca`（`qingyan.ai` 本次不可达 URLError） |
| Preview | `https://git-stabilization-wave15-productio-17b699-lucas-9039s-projects.vercel.app` |
| 本地 | CI/自检脚本（无业务写） |
| 验收执行方 | Cursor Agent（Wave1.5 会话） |
| 开始时间（UTC） | 2026-08-01T20:24:00Z |
| 结束时间（UTC） | 2026-08-01T20:30:00Z |
| 测试账号环境变量 | `WAVE15_*` **全部缺失** |
| 证据目录 | `docs/evidence/wave15/` |

### 汇总（本轮真实结果）

| 状态 | 数量 |
|---|---:|
| PASS | 8 |
| FAIL | 0 |
| BLOCKED_BY_DEPLOYMENT_PROTECTION | 4 |
| BLOCKED_BY_TEST_ACCOUNT | 27 |
| MANUAL_VERIFICATION_REQUIRED（未触达） | 0 |

> 登录态 P0（组织/销售列表/项目列表/Pending Action 等）因缺少测试账号全部 **BLOCKED_BY_TEST_ACCOUNT**，**不得**计为 PASS。

### GO / NO-GO

| 角色 | 结论 | 说明 |
|---|---|---|
| 产品负责人 | **NO-GO** | 缺少测试账号；登录、组织隔离、销售、项目和 Pending Action 等关键 P0 尚未完成；当前证据不足以批准 GO |
| 技术负责人 | **NO-GO** | 匿名安全路径已验；关键登录态 P0 未执行；不能证明客户/报价/项目列表可用与组织隔离；0 confirmed P0 FAIL |
| Wave2 | **仍未批准** | 本记录不构成批准 |

> **PR #47 保持 Draft，不得合并。** 本结论仅为验收结论，不是产品代码修改。  
> 补齐 `WAVE15_*` 临时环境变量并完成登录态关键 P0 之前，不得将结论改为 GO。

### 接受的残余风险（不自动 NO-GO）

- Preview Deployment Protection 阻止匿名 smoke  
- Raw ESLint 历史债务  
- P0-04 全量 fuzz/限流未完成  
- Wave2 Approval Consolidation 未实施  

### 阻塞上线项目（本轮）

1. **缺少测试账号** → 登录/组织/销售/项目/AI 关键 P0 无法验收  
2. Preview 匿名 smoke **BLOCKED_BY_DEPLOYMENT_PROTECTION**（非产品 FAIL）  

无已证实的 P0 **FAIL**（跨组织泄露、cron fail-open、Secret 泄露等未观察到；亦未在登录态充分证伪）。

---

## 1. 基础访问

| ID | 环境 | 执行人 | 实际结果 | 状态 | 时间(UTC) | 证据 | 阻塞上线？ |
|---|---|---|---|---|---|---|---|
| A1 | 生产只读 | Agent | `GET https://qingyan.ca/` → **200** | **PASS** | 2026-08-01T20:25Z | `docs/evidence/wave15/anonymous-prod-probe-summary.json` | 否 |
| A2 | 生产 | — | 无 `WAVE15_ADMIN_*` | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| A3 | 生产 | — | 无测试账号 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| A4 | 生产 | — | 无测试账号 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | 否 |
| A5 | 生产 | — | 无测试账号 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| A6 | 生产只读 | Agent | `GET /api/health` → **200**；摘要未见 Secret/SQL | **PASS** | 2026-08-01T20:25Z | 同上 | 否 |
| A6-PREVIEW | Preview 匿名 | Agent | `GET /api/health` → **302**（保护墙） | **BLOCKED_BY_DEPLOYMENT_PROTECTION** | 2026-08-01T20:26Z | `preview-anonymous-smoke-2026-08-01.log` | 否 |
| E1-PREVIEW | Preview 匿名 | Agent | `GET /api/ai/pending-actions` → **302** | **BLOCKED_BY_DEPLOYMENT_PROTECTION** | 2026-08-01T20:26Z | 同上 | 否 |

---

## 2. 组织权限

| ID | 环境 | 执行人 | 实际结果 | 状态 | 时间(UTC) | 证据 | 阻塞上线？ |
|---|---|---|---|---|---|---|---|
| O1 | 生产 | — | 需登录 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| O2 | 生产 | — | 需登录 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| O4 | 生产 | — | 需 outsider 账号 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| O5 | 生产 | — | 需双组织账号 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| O6 | 生产 | — | 需 admin+member | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |

---

## 3. 销售

| ID | 环境 | 执行人 | 实际结果 | 状态 | 时间(UTC) | 证据 | 阻塞上线？ |
|---|---|---|---|---|---|---|---|
| S1 | 生产 | — | 需登录 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| S2 | 生产 | — | 需登录 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| S5 | 生产 | — | 需登录 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| S7 | 生产 | — | 需登录 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| S8 | 生产 | — | 无有效 share token 样本 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| S9 | 生产只读 | Agent | `GET /api/sales/quotes/share/wave15-invalid-token-000` → **404**；文案「报价不存在或链接已失效」；无 SQL/Secret | **PASS** | 2026-08-01T20:26Z | `anonymous-prod-share-auth-summary.json` | 否 |

---

## 4. 项目

| ID | 环境 | 执行人 | 实际结果 | 状态 | 时间(UTC) | 证据 | 阻塞上线？ |
|---|---|---|---|---|---|---|---|
| P1 | 生产 | — | 需登录 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| P2 | 生产 | — | 需登录 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| P5 | 生产 | — | 需登录 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| P6 | 生产 | — | 需登录 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |

---

## 5. AI / Pending Action（Preview/Staging only）

| ID | 环境 | 执行人 | 实际结果 | 状态 | 时间(UTC) | 证据 | 阻塞上线？ |
|---|---|---|---|---|---|---|---|
| I2 | Preview | — | 无账号；且匿名 302 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | 视启用 |
| I6 | Preview | — | 禁止在生产批准；Preview 无账号 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | 视启用 |
| I7 | Preview | — | 同上 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | 视启用 |
| I8 | Preview | — | 同上 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | 视启用 |
| I9 | Preview | — | 同上 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | 否 |

未确认 Preview 是否连接非生产数据库 → **未执行**任何批准/拒绝写操作。

---

## 6. 外贸 / Cron / Webhook

| ID | 环境 | 执行人 | 实际结果 | 状态 | 时间(UTC) | 证据 | 阻塞上线？ |
|---|---|---|---|---|---|---|---|
| T4 | Preview/生产 | — | 无安全 staging webhook 样本；未对生产发真实 webhook 体 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | 静态契约仍在 CI | **是**（未人工动态验） |
| T5 | 同上 | — | 同上 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| T6 | 同上 | — | 同上 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| T7 | 生产只读 | Agent | `POST /api/trade/cron` 无 Auth → **401** | **PASS** | 2026-08-01T20:25Z | `anonymous-prod-probe-summary.json` | 否 |
| T7-PREVIEW | Preview 匿名 | Agent | **302** | **BLOCKED_BY_DEPLOYMENT_PROTECTION** | 2026-08-01T20:26Z | preview log | 否 |
| T9 | 生产只读 | Agent | 错误 Bearer → **401**；响应未回显 token；未见 SQL/Secret | **PASS** | 2026-08-01T20:25Z | 同上 | 否 |
| T9-PREVIEW | Preview 匿名 | Agent | **302** | **BLOCKED_BY_DEPLOYMENT_PROTECTION** | 2026-08-01T20:26Z | preview log | 否 |

未使用正确 `CRON_SECRET`。

---

## 7. 错误与安全

| ID | 环境 | 执行人 | 实际结果 | 状态 | 时间(UTC) | 证据 | 阻塞上线？ |
|---|---|---|---|---|---|---|---|
| E1 | 生产只读 | Agent | `/api/ai/pending-actions`、`/api/sales/customers`、`/api/projects` 未登录 → **401**；体为「未登录」 | **PASS** | 2026-08-01T20:26Z | share-auth summary | 否 |
| E2 | 生产 | — | 需登录后制造无权限场景 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T20:24Z | — | **是** |
| E5/E6 | 本地 CI | Agent | 单元 `with-auth-schema-drift` 覆盖 P2021/P2022→503；**未**在生产人造漂移 | **PASS**（契约层） | 2026-08-01T20:27Z | `npm run test:ci` | 否* |
| E7 | 生产只读 | Agent | 401/404 摘要未见 SQL/表名/连接串/token 回显 | **PASS** | 2026-08-01T20:26Z | evidence json | 否 |

\* E5/E6 生产不人造漂移；契约 PASS 不替代生产事故演练。

---

## 8. Deployment Protection 处理

- 保持 **BLOCKED_BY_DEPLOYMENT_PROTECTION**，**不**记产品 FAIL  
- **未**关闭生产/Preview 保护  
- 继续路径：提供 `WAVE15_*` + 浏览器登录 Preview，或无保护的非生产 Staging，或本地  

---

## 9. PR #24（本轮未触碰）

- Open，非 Draft，CONFLICTING  
- ahead 3 / behind 67（封版时记录）  
- **不属于**本验收范围；等待产品负责人单独决定  

---

## 10. 签字栏

| 角色 | 姓名 | 日期 | GO / NO-GO |
|---|---|---|---|
| 产品负责人 | 产品负责人（会话确认） | 2026-08-01 | **NO-GO**（缺测试账号；关键登录态 P0 未完成） |
| 技术负责人 | Cursor Agent 汇总 | 2026-08-01 | **NO-GO**（同上；0 confirmed P0 FAIL） |

**Wave2 仍未批准。PR #47 保持 Draft，不得合并。**
