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
| 生产环境 | `https://qingyan.ca`（只读；匿名 + 登录态 Phase1） |
| Preview | `https://git-stabilization-wave15-productio-17b699-lucas-9039s-projects.vercel.app` |
| 本地 | CI/自检脚本（无业务写） |
| 验收执行方 | Cursor Agent + 人工终端输入 `WAVE15_*` |
| 匿名探测开始（UTC） | 2026-08-01T20:24:00Z |
| Phase1 登录态完成（UTC） | 2026-08-01T21:49:04Z |
| 测试账号角色 | Admin **可用**；Member **可用**；Outsider **登录 401（凭据无效）** |
| 证据目录 | `docs/evidence/wave15/`（已脱敏） |

### 汇总（验收口径纠正后）

| 状态 | 数量 |
|---|---:|
| PASS | **16** |
| FAIL | **0** |
| BLOCKED | **6**（`A2_OUTSIDER` / `O2` / `O4` / `O5` / `P5` / `P6`） |
| Product Owner | **NO-GO** |
| Technical Owner | **NO-GO** |

#### 验收口径纠正（2026-08-01）

> **这是验收口径纠正，不是重跑探针。**  
> 原始探针证据 `docs/evidence/wave15/phase1-prod-login-readonly-summary.json` **保留未删**（其中仍可见探针当时标记的 `A2_OUTSIDER=FAIL`、`P5=PASS`）。以下为产品验收判定覆盖：

| ID | 探针原始标记 | 纠正后验收状态 | 原因 |
|---|---|---|---|
| `A2_OUTSIDER` | FAIL（HTTP 401） | **BLOCKED_BY_TEST_ACCOUNT** | 测试凭据 401，尚未执行产品权限验证；**不属于** confirmed product P0 FAIL |
| `P5` | PASS（假 id → 404） | **BLOCKED_BY_ENVIRONMENT** | 「Member PATCH 不存在项目 → 404」不能证明普通成员无写权限；须在已确认非生产库的 Preview/Staging 对**真实测试项目**验证；生产禁止真实 PATCH |

探针原始 counts（证据文件内，供对照）：PASS 17 / FAIL 1 / BLOCKED 4。

#### 其他记录口径

- **匿名只读仍成立：** A1、A6、T7、T9、E1 等  
- **Preview Deployment Protection：** 4 项保持 BLOCKED（非产品 FAIL）  
- **Preview 写路径 / webhook 动态 / P5：** BLOCKED_BY_ENVIRONMENT  
- 下一轮跨组织与写路径验收**尚未开始**（前置条件未满足，见 §11）

### GO / NO-GO

| 角色 | 结论 | 说明 |
|---|---|---|
| 产品负责人 | **NO-GO** | Outsider / 跨组织 / O2 / P5 真实写拒 / Preview Pending Action 与 webhook 动态项未完成 |
| 技术负责人 | **NO-GO** | Admin/Member 关键销售与项目只读路径 PASS；**confirmed product P0 FAIL = 0**；跨组织隔离与成员写拒**尚未证明** → 不能 GO |
| Wave2 | **仍未批准** | 本记录不构成批准 |

> **PR #47 保持 Draft，不得合并。**

### 接受的残余风险（不自动 NO-GO）

- Preview Deployment Protection 阻止匿名 smoke  
- Raw ESLint 历史债务  
- P0-04 全量 fuzz/限流未完成  
- Wave2 Approval Consolidation 未实施  

### 阻塞上线项目（本轮）

1. **Outsider 测试账号不可用**（`A2_OUTSIDER` → BLOCKED_BY_TEST_ACCOUNT）→ O4 无法执行  
2. **缺少组织 B 资源 ID**（`WAVE15_ORG_B_*`）→ O5/P6 未执行  
3. **单组织账号无法验证 O2 切换**  
4. **P5** 须非生产环境真实项目写拒验证（生产禁止真实 PATCH）  
5. Preview 写路径未确认非生产库 → I2/I6–I9 / T4–T6 保持阻塞  
6. Preview 匿名 **BLOCKED_BY_DEPLOYMENT_PROTECTION**（非产品 FAIL）  

**confirmed product P0 FAIL：0**

---

## 1. 基础访问

| ID | 环境 | 执行人 | 实际结果 | 状态 | 时间(UTC) | 证据 | 阻塞上线？ |
|---|---|---|---|---|---|---|---|
| A1 | 生产只读 | Agent | 首页 **200** | **PASS** | 2026-08-01T20:25Z | `anonymous-prod-probe-summary.json` | 否 |
| A2 | 生产只读 | Agent+人工 | Admin 登录 **200** + session | **PASS** | 2026-08-01T21:49Z | `phase1-prod-login-readonly-summary.json` | 否 |
| A2_MEMBER | 生产只读 | Agent+人工 | Member 登录 **200** | **PASS** | 2026-08-01T21:49Z | 同上 | 否 |
| A2_OUTSIDER | 生产只读 | Agent+人工 | Outsider 登录 **401**「邮箱或密码错误」；探针曾标 FAIL，**口径纠正**为测试账号阻塞 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T21:49Z | 同上（原始证据保留） | **是**（阻塞 O4） |
| A3 | 生产只读 | Agent+人工 | 错误密码 **401** | **PASS** | 2026-08-01T21:49Z | 同上 | 否 |
| A4 | 生产只读 | Agent+人工 | 退出 **200** | **PASS** | 2026-08-01T21:49Z | 同上 | 否 |
| A5 | 生产只读 | Agent+人工 | 退出后客户列表 **401** | **PASS** | 2026-08-01T21:49Z | 同上 | 否 |
| A6 | 生产只读 | Agent | `/api/health` **200** | **PASS** | 2026-08-01T20:25Z | anonymous summary | 否 |
| A6-PREVIEW | Preview 匿名 | Agent | **302** | **BLOCKED_BY_DEPLOYMENT_PROTECTION** | 2026-08-01T20:26Z | preview log | 否 |
| E1-PREVIEW | Preview 匿名 | Agent | **302** | **BLOCKED_BY_DEPLOYMENT_PROTECTION** | 2026-08-01T20:26Z | preview log | 否 |

---

## 2. 组织权限

| ID | 环境 | 执行人 | 实际结果 | 状态 | 时间(UTC) | 证据 | 阻塞上线？ |
|---|---|---|---|---|---|---|---|
| O1 | 生产只读 | Agent+人工 | `activeOrgId` 存在 **200** | **PASS** | 2026-08-01T21:49Z | phase1 summary | 否 |
| O2 | 生产只读 | Agent+人工 | 仅单组织，无法切换验证 | **BLOCKED_BY_TEST_DATA** | 2026-08-01T21:49Z | 同上 | **是** |
| O4 | 生产只读 | — | Outsider 登录失败 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T21:49Z | 同上 | **是** |
| O5 | 生产只读 | — | 无 `WAVE15_ORG_B_CUSTOMER_ID` | **BLOCKED_BY_TEST_DATA** | 2026-08-01T21:49Z | 同上 | **是** |
| O6 | 生产只读 | Agent+人工 | Member `switch-org` 假 org → **403** `ORG_SWITCH_NOT_ALLOWED` | **PASS** | 2026-08-01T21:49Z | 同上 | 否 |

---

## 3. 销售

| ID | 环境 | 执行人 | 实际结果 | 状态 | 时间(UTC) | 证据 | 阻塞上线？ |
|---|---|---|---|---|---|---|---|
| S1 | 生产只读 | Agent+人工 | 客户列表 **200**（带 `orgId`） | **PASS** | 2026-08-01T21:49Z | phase1 summary | 否 |
| S2 | 生产只读 | Agent+人工 | 客户详情 **200** | **PASS** | 2026-08-01T21:49Z | 同上 | 否 |
| S5 | 生产只读 | Agent+人工 | `GET /api/sales/quotes/list` **200** | **PASS** | 2026-08-01T21:49Z | 同上 | 否 |
| S7 | 生产只读 | Agent+人工 | 报价详情 **200** | **PASS** | 2026-08-01T21:49Z | 同上 | 否 |
| S8 | 生产只读 | Agent+人工 | 有效 share token **200** | **PASS** | 2026-08-01T21:49Z | 同上 | 否 |
| S9 | 生产只读 | Agent+人工 | 错误 token **404** 安全文案 | **PASS** | 2026-08-01T21:49Z | 同上 | 否 |

---

## 4. 项目

| ID | 环境 | 执行人 | 实际结果 | 状态 | 时间(UTC) | 证据 | 阻塞上线？ |
|---|---|---|---|---|---|---|---|
| P1 | 生产只读 | Agent+人工 | 项目列表 **200** | **PASS** | 2026-08-01T21:49Z | phase1 summary | 否 |
| P2 | 生产只读 | Agent+人工 | 项目详情 **200** | **PASS** | 2026-08-01T21:49Z | 同上 | 否 |
| P5 | Preview/Staging（待） | — | 探针曾对假 id 得 404 并标 PASS；**口径纠正**：不能证明成员无写权限；生产禁止真实 PATCH | **BLOCKED_BY_ENVIRONMENT** | 2026-08-01T21:49Z | phase1 summary（原始证据保留） | **是** |
| P6 | 生产只读 | — | 无组织 B 项目 ID | **BLOCKED_BY_TEST_DATA** | 2026-08-01T21:49Z | 同上 | **是** |

---

## 5. AI / Pending Action（Preview/Staging only）

| ID | 环境 | 执行人 | 实际结果 | 状态 | 时间(UTC) | 证据 | 阻塞上线？ |
|---|---|---|---|---|---|---|---|
| I2–I9 | Preview | — | 未书面确认非生产库；未执行写操作 | **BLOCKED_BY_ENVIRONMENT** | 2026-08-01T21:49Z | — | 视启用 |

---

## 6. 外贸 / Cron / Webhook

| ID | 环境 | 执行人 | 实际结果 | 状态 | 时间(UTC) | 证据 | 阻塞上线？ |
|---|---|---|---|---|---|---|---|
| T4–T6 | Preview | — | 未确认非生产环境 | **BLOCKED_BY_ENVIRONMENT** | 2026-08-01T21:49Z | — | **是** |
| T7 | 生产只读 | Agent | 无 Auth → **401** | **PASS** | 2026-08-01T20:25Z | anonymous summary | 否 |
| T7-PREVIEW | Preview 匿名 | Agent | **302** | **BLOCKED_BY_DEPLOYMENT_PROTECTION** | 2026-08-01T20:26Z | preview log | 否 |
| T9 | 生产只读 | Agent | 错 Bearer → **401**，无回显 | **PASS** | 2026-08-01T20:25Z | anonymous summary | 否 |
| T9-PREVIEW | Preview 匿名 | Agent | **302** | **BLOCKED_BY_DEPLOYMENT_PROTECTION** | 2026-08-01T20:26Z | preview log | 否 |

未使用正确 `CRON_SECRET`。

---

## 7. 错误与安全

| ID | 环境 | 执行人 | 实际结果 | 状态 | 时间(UTC) | 证据 | 阻塞上线？ |
|---|---|---|---|---|---|---|---|
| E1 | 生产只读 | Agent | 未登录 API → **401** | **PASS** | 2026-08-01T20:26Z | share-auth / A5 | 否 |
| E2 | 生产 | — | Outsider 不可用，完整无权限矩阵未完成 | **BLOCKED_BY_TEST_ACCOUNT** | 2026-08-01T21:49Z | — | **是** |
| E5/E6 | 本地 CI | Agent | 契约层 P2021/P2022→503 | **PASS**（契约） | 2026-08-01T20:27Z | `test:ci` | 否 |
| E7 | 生产只读 | Agent+人工 | Phase1 全项 `leak=false` | **PASS** | 2026-08-01T21:49Z | phase1 summary | 否 |

---

## 8. Deployment Protection 处理

- 保持 **BLOCKED_BY_DEPLOYMENT_PROTECTION**，**不**记产品 FAIL  
- **未**关闭保护  

---

## 9. PR #24（本轮未触碰）

- Open，非 Draft，CONFLICTING  
- ahead 3 / behind 67（封版时记录）  
- **不属于**本验收范围  

---

## 10. 签字栏

| 角色 | 姓名 | 日期 | GO / NO-GO |
|---|---|---|---|
| 产品负责人 | 产品负责人（会话确认） | 2026-08-01 | **NO-GO** |
| 技术负责人 | Cursor Agent 汇总 | 2026-08-01 | **NO-GO**（confirmed product P0 FAIL = 0） |

**Wave2 仍未批准。PR #47 保持 Draft，不得合并。**

---

## 11. 下一轮继续条件（尚未满足 → 本轮不执行）

须**同时**满足后才继续 O2/O4/O5/P5/P6 与 Preview 写路径：

1. Outsider 凭据可登录  
2. `WAVE15_ORG_B_CUSTOMER_ID` 已设置  
3. `WAVE15_ORG_B_PROJECT_ID` 已设置  
4. 有可验证 O2 的第二组织  
5. Preview/Staging **已书面确认**使用非生产数据库  

届时执行：O2、O4、O5、P6、P5（真实测试项目写拒）、I2/I6–I9、T4–T6。  
纪律：生产只读；写测试仅非生产；不用正确 `CRON_SECRET`；不发真实邮件/微信；不入库 Secret；不改产品代码/Schema/migration；不触碰 #24；不合并 #47；不启动 Wave2。

**本轮状态检查（2026-08-01）：** Outsider / `WAVE15_ORG_B_*` / 第二组织 / Preview 非生产库书面确认 → **均未就绪**；下一轮**未启动**。

### 11.1 恢复验收门禁检查（2026-08-01T22:25Z UTC）

按产品要求恢复 O2/O4/O5/P5/P6/I*/T4–T6 前，逐项确认；**任一未满足则立即停止，不得重跑占位测试**。

| 条件 | 结果 |
|---|---|
| Outsider 可登录且仅属组织 B | **未满足**（`WAVE15_OUTSIDER_*` MISSING；未做登录探测） |
| 已设置组织 B 脱敏客户 ID | **未满足**（`WAVE15_ORG_B_CUSTOMER_ID` MISSING） |
| 已设置组织 B 脱敏项目 ID | **未满足**（`WAVE15_ORG_B_PROJECT_ID` MISSING） |
| Admin 同时属于两个测试组织 | **未满足**（无 `WAVE15_ADMIN_*` / 无第二组织上下文；Phase1 时 O2 为单组织 BLOCKED） |
| Preview/Staging 书面确认非生产数据库 | **未满足**（无书面确认；无 `WAVE15_PREVIEW_*_CONFIRMED`） |
| Preview/Staging 不发送真实邮件/微信 | **未满足**（无书面确认） |
| Preview/Staging 不触发生产 cron/worker | **未满足**（无书面确认） |

**处置：** 全部剩余验收（O2/O4/O5/P5/P6/I2/I6–I9/T4–T6）**未执行**。  
统计与结论不变：PASS **16** / FAIL **0** / BLOCKED **6**；Product Owner **NO-GO**；Technical Owner **NO-GO**；Wave2 **未批准**；#47 保持 Draft。

### 11.2 Preview 隔离评估（2026-08-01）— production-adjacent

证据：`docs/evidence/wave15/vercel-preview-isolation-assessment-2026-08-01.md`

| 项 | 结论 |
|---|---|
| Preview vs Production `DATABASE_URL` endpoint | **相同**（`ep-super-field-antfibsl-pooler`） |
| `HOSTS_EQUAL` | **true** |
| 环境定性 | **production-adjacent environment** |
| 默认 Preview 写验收 | **禁止** |
| `P5` / `I2` / `I6`–`I9` / `T4`–`T6` | **BLOCKED_BY_ENVIRONMENT** |
| Product Owner | **NO-GO** |
| Technical Owner | **NO-GO** |
| #47 | **Draft，不得合并** |
| Wave2 | **未批准** |

整改路径：独立 Staging 隔离 PR（`stabilization/wave15-staging-isolation`）；**不得**在当前默认 Preview 执行写操作；**不得**在 #47 修改产品代码。

### 11.3 历史 Preview 写路径审计（2026-08-01）

证据：`docs/evidence/wave15/preview-write-path-audit-2026-08-01.md`

| 项 | 结论 |
|---|---|
| Pending Action / Note / Task / Gmail / 微信 / cron / worker | **NO_EVIDENCE_FOUND** |
| 是否等于「从未发生写」 | **否**（不得写成 `NO_WRITES_OCCURRED`） |
| 生产-like DB live 查询 | **跳过**（避免对 `ep-super-field*` 做 agent 侧操作） |

### 11.4 当前验收统计（环境证据更新后，仍不变）

| 状态 | 数量 |
|---|---:|
| PASS | **16** |
| FAIL | **0** |
| BLOCKED | **6**（含 `P5`/`I*`/`T4–T6` 的环境阻塞） |

Product Owner **NO-GO** · Technical Owner **NO-GO** · #47 Draft · Wave2 未批准 · **未自动恢复写验收**
