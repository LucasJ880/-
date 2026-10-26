# P1-8 任务书：建议式回复契约 + `next_step` 意图 + 个人偏好记忆

| 项 | 值 |
|---|---|
| 编号 | P1-8（新；P3-4 个人偏好提前到这里做） |
| 动机 | 对照 Muse 工作流（目标级委托、里程碑汇报、记忆驱动主动性），青砚在 Muse 里的回复缺三样：每次回来都有"结论 + 理由 + 下一步"的固定结构；一个"我现在该做什么"的意图；记得用户上次怎么选 |
| 依赖 | #235（P1-5/6）合并 |
| 执行者 | Claude Code |
| 审核 | Claude（chat） |

---

## 0. 先读

- `src/lib/muse-bridge/router-pure.ts` — 现有 `okResponse` / `formatStatusMessage` / `formatCompareResponse`；本任务给它们统一结构
- `src/lib/tender/stage.ts` `getProjectStage` + `src/lib/tender/workbench-state.ts` `deriveTenderWorkbenchState`（已有 `cta` 概念）— `next_step` 用同一套状态判断，不另写一份
- `src/lib/muse-bridge/binding-pure.ts` — `Organization.settingsJson.museBridge.bindings` 的零 schema 写法；个人偏好放同一个父键下
- `src/lib/tender-rfq/service.ts` `prepareRfqRound` — 偏好在这里生效（默认供应商 / 默认 Incoterm）
- `src/lib/inquiry/service.ts` 第 360 行 `selectSupplier` — 偏好在这里学习

---

## 1. 做三件事

### A. 回复契约：结论 → 理由 → 下一步
给 `router-pure.ts` 加一个 `advisory()` 构造器并让所有 ok 回复都走它：

```ts
type Advisory = {
  conclusion: string;          // 1 句，≤ 60 字：发生了什么 / 建议什么
  reasons: string[];           // 0–3 条，每条 ≤ 80 字：依据（要求编号 / 页码 / 数值）
  nextStep: { label: string; command: MuseCommandArgs } | null;   // 唯一的下一步；没有就 null
  alternatives?: MuseSuggestedAction[];   // ≤ 2 个备选
};
```
- `message` 渲染固定格式：第一行结论；理由用"· "起头各占一行；最后一行"下一步：xxx"（没有 nextStep 就不出这一行）。
- `suggestedActions[0]` **必须等于** `nextStep.command`（当 nextStep 非 null），备选排后面。
- 改造范围：`status`、`ask`、`approve/reject` 结果、`rfq` 草稿回复、`compare`、`price_scenario`、以及 events.ts 里的 `analysis.ready` / `quote.parsed` / `missing_fields` 摘要。
- `ask` 的 LLM 回答也套这个壳：prompt 要求输出 JSON `{conclusion, reasons[], nextStepHint}`，代码把 `nextStepHint` 映射到意图（映射表见 §2.1），映射不到就 `nextStep=null`，不编。
- 单测：对每个意图至少一例，断言 message 第一行 ≤ 60 字、`suggestedActions[0]` 与 `nextStep` 一致、理由条数 ≤ 3。

### B. `next_step` 意图（确定性，零 LLM）
`{ intent: "next_step", projectId }` → 按下表回答"这个标现在最该做什么"。规则顺序即优先级，命中第一条即返回：

| 条件 | 结论 | nextStep |
|---|---|---|
| 有待批 PendingAction（该用户可见） | "有 N 条等你批" | `approve`（最早的一条）|
| 截标 ≤ 3 天且未提交 | "N 天后截标，还没提交" | `status` + 备选 `ask`"提交清单差什么" |
| 无分析 run / run FAILED | "招标文件还没分析" | `ask`? 不——`nextStep=null`，理由写"请在青砚上传文件"（Muse 做不了上传）|
| run REVIEW_REQUIRED 且有 UNKNOWN 关键事实 | "分析完了，N 个关键事实没证据" | `ask`"哪些关键事实缺证据" |
| 要求里有 mandatory 且 complianceStatus 非合规 | "N 条强制要求当前无法满足" | `ask`"列出无法满足的强制要求" |
| 无询价轮次 / 轮次全 pending | "还没问过供应商" | `rfq`（supplierIds 取偏好默认，见 C）|
| 轮次已发、≥1 家无回复且超 N 天 | "N 家没回" | `chase`（P1-7 未做前：`nextStep=null`，理由写"P1-7 上线后可一键催"）|
| ≥2 家 quoted 且无 isSelected | "报价齐了，还没定供应商" | `compare` |
| 有 isSelected 且无 ProjectQuote | "供应商定了，还没定投标价" | `price_scenario`（supplierItemId = 选中项）|
| 其它 | "这个标当前没有待办" | `status` |

- 全部数据来自现有表；不要新写查询层，复用 `handleStatus` 已取的字段 + `listApprovalInbox`。
- `next_step` 加入 `MUSE_INTENTS` 与 Phase 0 默认白名单（它只读）。
- 单测：每一行一例，用假数据直接测纯函数 `decideNextStep(snapshot)`，`snapshot` 是一个普通对象。

### C. 个人偏好记忆（零 schema）
存 `Organization.settingsJson.museBridge.userPrefs[userId] = { defaultSupplierIds: string[], defaultIncoterm: string|null, chaseAfterDays: number|null, lastUpdatedAt }`。

- **学习（自动）**：`selectSupplier` 成功后，把该 supplierId 挪到该用户 `defaultSupplierIds` 最前，列表上限 5；只在该用户是操作者时写。`rfq` 草稿被批准后，把这轮用的 `incoterm` 记为 `defaultIncoterm`（仅当之前为 null）。
- **使用**：`prepareRfqRound` 没给 `supplierIds` 也没给 `supplierHint` 时，先看偏好；有就直接用并在草稿回复的理由里写"按你常用的 A厂、B厂"；没有才回候选列表。`incoterm` 同理。
- **可改**：`{ intent: "set_preference", key: "defaultSupplierIds"|"defaultIncoterm"|"chaseAfterDays", value }` 意图（加入 `MUSE_INTENTS`，默认白名单），回复"记住了：…"；`{ intent: "preferences" }` 列出当前偏好（这是 Muse"记忆可检查可编辑"的对应物）。
- 偏好里**不存**任何价格、成本、估值。
- 单测：学习上限 5、去重、只对操作者生效；`prepareRfqRound` 的 supplier 选择顺序（显式 > 提示 > 偏好 > 候选列表）。

---

## 2. 细节

### 2.1 `nextStepHint` → 意图映射表（ask 用）
`"看状态"→status`、`"问价"/"询价"→rfq`、`"比价"→compare`、`"算价"/"定价"→price_scenario`、`"催"→chase`、`"批"→approve(最早待批)`；其它 → null。

### 2.2 不改的
- 不动 `tender-pricing`、`inbound-*`、`landed-cost`。
- 不加 LLM 调用（`ask` 本来就有一次，只改它的输出格式）。
- 不新增 Prisma model；偏好与绑定共用 `museBridge` 父键。

---

## 3. 文件清单

| 文件 | 内容 |
|---|---|
| `src/lib/muse-bridge/advisory.ts` | `Advisory` 类型、`renderAdvisory()`、`advisoryResponse()`；纯函数 |
| `src/lib/muse-bridge/next-step.ts` | `decideNextStep(snapshot)` 纯函数 + `NextStepSnapshot` 类型 |
| `src/lib/muse-bridge/prefs-pure.ts` / `prefs.ts` | 偏好读写（纯 + DB） |
| `src/lib/muse-bridge/contract.ts` | 加 `next_step` / `set_preference` / `preferences` 三个意图与 args |
| `src/lib/muse-bridge/router.ts` / `router-pure.ts` | 全部 ok 回复改走 `advisoryResponse`；新 handler |
| `src/lib/muse-bridge/events.ts` | 事件摘要改成"结论 + 1 条理由"，`action` = nextStep |
| `src/lib/tender-rfq/service.ts` | 偏好介入供应商/Incoterm 选择 |
| `src/lib/inquiry/service.ts` | `selectSupplier` 后调用 `learnSupplierPreference`（best-effort） |
| `src/lib/muse-bridge/__tests__/advisory.test.ts`、`next-step.test.ts`、`prefs.test.ts` | §4 用例 |
| `docs/QINGYAN_TENDER_P1-8_REPORT.md` | 完成报告 |

---

## 4. 验收用例

1. `status` 回复：第一行 ≤ 60 字，`suggestedActions[0]` 是 nextStep。
2. `next_step`：有待批 → nextStep 是 `approve` 且 approvalId 为最早一条。
3. `next_step`：无分析 run → `nextStep=null`，理由含"上传"。
4. `next_step`：2 家 quoted 无 isSelected → `compare`。
5. `next_step`：有 isSelected 无 ProjectQuote → `price_scenario` 且 `supplierItemId` 正确。
6. `next_step` 表里每一行各一例（共 ≥ 10）。
7. `ask` 的 LLM 返回 `nextStepHint:"比价"` → `nextStep.command.intent === "compare"`；返回 `"去火星"` → `nextStep=null`。
8. `selectSupplier` 三次选不同供应商 → `defaultSupplierIds` 顺序为最近优先；选第 6 家 → 列表仍 5 个。
9. `rfq` 不带 supplierIds、偏好有 2 家 → 草稿直接用这 2 家，理由含"常用"。
10. `set_preference` 写 `defaultIncoterm: "DDP"` → `preferences` 能读回；写 `{key:"price"}` → VALIDATION_FAILED。
11. 偏好 JSON 里不存在价格/成本类键（反向断言）。
12. 事件 `analysis.ready` 的 summary 第一行 ≤ 60 字且 `action` 非空。

---

## 5. 禁止事项

- 不让 LLM 决定 `next_step`；它是查表。
- 不在偏好里存任何金额。
- 不把 `nextStep` 做成"猜一个"——映射不到就 null。
- 不新增 model、不加队列。

---

## 6. 提交

分支 `feature/muse-bridge-advisory-p1-8`，基于合并后的 main。PR 描述贴三个测试通过数与报告链接。
