# QYANE Supplier Intelligence M1 — S3-B 切片 1：供应商能力与资质归一（服务 + HTTP）

> 本切片**不含 UI**，与 S1 同样是「先把面做对，UI 下一刀」。
> 零 schema / 零 migration：7 张表在 S1 已建好，S3-B 是在既有 spine 上开面。

---

## 1. 这一刀补的是什么

S3-A 让采购同事把一条线索**归属**到某家供应商（LINK）。到此为止只知道「这是谁」，
还不知道「他到底能供什么、凭什么信」。S3-B 补这一层：

| 表 | 语义 | 谁能写 |
| --- | --- | --- |
| `SupplierCapabilitySignal` | 他说他能做什么 | 人工，且**必须挂在已归属到本供应商的线索上** |
| `SupplierOffering` | 具体可供产品（**Supplier ≠ Product**） | 人工录入，来源固定 MANUAL |
| `SupplierCertification` | 声称的资质 + 人工核验状态 | 登记恒为 CLAIMED；VERIFIED 另走 verify |

## 2. 三条纪律（服务层已 fail-closed，本切片只是把面开出来且不放水）

**CLAIMED ≠ VERIFIED。** 资质登记入口**不接受**客户端指定 status——传
`status: "VERIFIED"` 落库仍是 `CLAIMED`（B4b）。要变 VERIFIED 必须走 verify 动作
并提供独立证据（archive 档案项或官方登记库白名单 URL）；无证据 422，坏指针直接拒，
不静默回落到别的证据路径（B5a–B5e）。

**缺价合法。** 不传单价、`priceStatus=UNKNOWN` 不构成任何拒绝理由（B2a–B2c）。
国内厂家报价普遍要谈，缺价就拒等于把大半个市场排除在外。

**能力必须有出处。** `SupplierCapabilitySignal` 挂在 `discoverySignal` 上，
且该线索必须已 LINKED 到本供应商，否则 422（B6a）；不给出处 400（B6b）。
这样每一条能力都能回溯到「哪条线索、哪段原文」——到了 S4 问「这家为什么算合规」时，
答得出来。social 写路径永远产不出 VERIFIED（B6c），目录外能力类型 fail-closed 拒收（B6d）。

## 3. 权限：供应商门**不替代**项目门

供应商是 **org 级**资源，所以本切片的门是「本 org 活跃成员」，与既有 `/api/suppliers`
一致，不另造一套供应商权限；跨 org 一律 404 且响应零业务内容（B1c–B1f、B9a–B9c）。

但能力声明挂在**项目范围**的线索上，因此 `createCapabilitySignal` 内部仍会断言
该线索所属项目的写权限：org 成员但无该项目角色 → **403**（B6e）。
这一条是实测出来的——第一版夹具用普通 org 成员写能力，被 403 拦下，
说明供应商门确实没有覆盖掉项目门。保留为显式断言。

读写同门，所以 `assertSupplierAccessForActor` **不收 level 参数**：
加一个不起作用的 `level` 只会让调用处看起来像做了区分。

## 4. 来源不可冒称

`sourceKind` 由服务端固定：产品录入入口恒为 `MANUAL`，能力录入入口恒为 `extractedBy=HUMAN`。
客户端传 `sourceKind: "DISCOVERY"` 无效（B3b）——不允许有人自称「这是系统搜出来的」。

## 5. 过期是客观事实

视图里的 `expiredByDate` 由到期日直接算出，不依赖有没有人来点「置为过期」（B8a）；
但**不擅自改写落库状态**（B8b）——状态迁移仍是人工裁决。

## 6. 接口

```text
GET   /api/supplier-intel/suppliers/[id]/capability                     聚合只读视图
POST  /api/supplier-intel/suppliers/[id]/offerings                      新建可供产品
PATCH /api/supplier-intel/suppliers/[id]/offerings/[offeringId]         更新工作层字段
POST  /api/supplier-intel/suppliers/[id]/certifications                 登记资质（恒 CLAIMED）
PATCH /api/supplier-intel/suppliers/[id]/certifications/[certId]        verify / reject / expire
POST  /api/supplier-intel/suppliers/[id]/capability-signals             记录能力声明（需出处）
```

全部经 `requireSupplierIntelAccess`（flag 404-dark → 租户 → org allowlist）。

## 7. 验证

| 项 | 结果 |
| --- | --- |
| S3-B 服务 + HTTP（隔离库） | **38 通过 / 0 失败** |
| S1 / S2 / S2-TB / S3-A 回归 | 86 / 32 / 118 / 131，全部 0 失败 |
| typecheck / 改动文件 lint / lint baseline / build | PASS / 0 problems / PASS（error 41，较基线少 12）/ PASS（361/361）|

`updateOffering` 改动**不影响**历史 Candidate 的 `offeringSnapshotJson`（按值快照，T11-C/D/E 已覆盖）。

## 8. 未做（下一刀）

- **UI**：供应商能力面板（从 S3-A 线索抽屉 LINKED 态、以及 Run 内部候选进入）；
- Offering 的批量/导入；资质到期提醒；
- **S4**：`SupplierRequirementMatch` 强制项判定 + supplier-score-v1 评分 + 5 态推荐 + 入库。
  S4 的 gate 要吃本切片产出的能力/产品/资质，所以顺序是 S3-B 先于 S4。

```text
SCHEMA_CHANGED = NO
MIGRATION_CHANGED = NO
PRODUCTION_DB_TOUCHED = NO
PRODUCTION_FLAGS_CHANGED = NO
UI_INCLUDED = NO
S4_STARTED = NO
```
