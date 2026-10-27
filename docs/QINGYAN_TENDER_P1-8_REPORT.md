# P1-8 完成报告：建议式回复契约 + `next_step` 意图 + 个人偏好记忆

任务书：`docs/QINGYAN_TENDER_P1-8_ADVISORY_PREFS_TASKBRIEF.md`
分支：`feature/muse-bridge-advisory-p1-8`（基于合并后的 main，含 #235）

---

## 1. 做了什么

### A. 回复契约（结论 → 理由 → 下一步）
| 文件 | 内容 |
|---|---|
| `src/lib/muse-bridge/advisory.ts` | `Advisory` 类型、`advisory()`（规整：结论 ≤ 60、理由 ≤ 3 条且每条 ≤ 80、备选 ≤ 2，超长截断不报错）、`renderAdvisory()`、`advisoryResponse()`（ok 回复唯一构造入口，`suggestedActions[0]` 恒等于 `nextStep`）、`gateAdvisory()`、`eventSummary()`；出站脱敏 `sanitizeOutbound` 移到这里（`router-pure` 再导出，旧 import 不变） |
| `src/lib/muse-bridge/router-pure.ts` | 每个意图一个 Advisory 构造器：`statusAdvisory`、`askAdvisory`（+ `parseAskAnswer` / `mapNextStepHint`）、`formatApprovalOutcome`、`rfqDraftAdvisory` / `rfqCandidatesAdvisory`、`compareAdvisory`、`priceScenarioAdvisory`、`preferencesAdvisory` / `setPreferenceAdvisory`；`okResponse` 删除 |
| `src/lib/muse-bridge/router.ts` | 所有 ok 回复经 `respond()` → `gateAdvisory` → `advisoryResponse`；`ask` 的 prompt 要求输出 `{conclusion, reasons[], nextStepHint}`，下一步由代码查 §2.1 表 |
| `src/lib/muse-bridge/events-pure.ts` / `events.ts` / `hooks.ts` | `analysis.ready`、`quote.parsed`、`missing_fields` 摘要改成"结论 + 1 条理由"；action：analysis.ready / missing_fields → `next_step`，quote.parsed → `compare` |

### B. `next_step`（确定性查表，零 LLM）
- `src/lib/muse-bridge/next-step.ts`：纯函数 `decideNextStep(snapshot)`，按任务书表的顺序命中第一条即返回；分析相位用 `tender/workbench-state` 的 `analysisPhaseFromRunStatus`（与工作台同一套判断）。
- `router.ts handleNextStep`：项目字段与 `handleStatus` 共用 `loadStatusRows`（抽出来的同一份取数）；待批来自 `listApprovalInbox`；另取最新 run 的 `criticalFacts` / 不合规强制要求、最新一轮询价、是否已有 `ProjectQuote`、操作者偏好。

### C. 个人偏好记忆（零 schema）
- `src/lib/muse-bridge/prefs-pure.ts` / `prefs.ts`：`Organization.settingsJson.museBridge.userPrefs[userId] = { defaultSupplierIds, defaultIncoterm, chaseAfterDays, lastUpdatedAt }`，与绑定表同一父键、互不干扰。写回时只序列化这四个字段。
- 学习：`selectItem(scope, { actorUserId })` 成功后把该供应商挪到操作者的常用列表最前（上限 5，去重）；`execTenderSendRfq` 发出后，若批准人没有默认贸易条款，记下这轮的。两处都是 best-effort。
- 使用：`prepareRfqRound` 选供应商顺序 显式 > 名称提示 > 偏好 > 候选列表；贸易条款 显式 > 偏好。草稿回复理由写"按你常用的 A厂、B厂"，偏好来的条款注明"（你的默认）"。
- 可查可改：`preferences` / `set_preference`（`key` ∈ `defaultSupplierIds | defaultIncoterm | chaseAfterDays`，`null` 清空；供应商 id 必须属于本组织）。

### 契约
`MUSE_INTENTS` 加 `next_step` / `set_preference` / `preferences`，三者进 Phase 0 默认白名单。`set_preference.key` 是 enum：`{key:"price"}` 在契约层被拒，command 路由回 `VALIDATION_FAILED`。

---

## 2. 怎么验

```bash
npx tsx src/lib/muse-bridge/__tests__/advisory.test.ts    # 70 passed（每个意图 + §4-1、§4-7、§4-12）
npx tsx src/lib/muse-bridge/__tests__/next-step.test.ts   # 56 passed（表里每一行 + 表外 1 行 + §4-2…§4-6）
npx tsx src/lib/muse-bridge/__tests__/prefs.test.ts       # 26 passed（§4-8…§4-11、选择顺序、只对操作者生效）
```
回归：`muse-bridge-pure` 43、`compare` 40、`landed-cost` 66、`notes-parse` 15、`inbound-apply` 45、`inbound-parse` 38、`build` 21、`round-pure` 25。本地 `npm run test:ci`、`typecheck`、`lint:baseline`、`build` 全部通过。

本地 Postgres 端到端（`handleMuseCommand` 真实入口，发信用假 send）：无分析 → "招标文件还没分析"（无下一步）→ 建分析 → "还没问过供应商" → `set_preference` 常用 2 家 + DDP → `preferences` 读回 → `next_step` 建议的 rfq 带常用供应商 → `rfq` 不带 supplierIds 直接用偏好、理由"按你常用的…"、"贸易条款 DDP（你的默认）" → `next_step` "有 1 条等你批"指向该草稿 → 清空默认条款后执行发送 → 学回 DDP → 两家报价 → "报价齐了" → `compare` → `selectItem(B)` → B 挪到常用最前 → "供应商定了，还没定投标价" → `price_scenario`（supplierItemId = B）。偏好 JSON 只有四个键，`museBridge.bindings` 保留。

---

## 3. 判断点（请审）

1. **`next_step` 表外加了一行"分析进行中"**（排在"无分析 / 失败"之后）：→ 结论"招标文件正在分析"、`nextStep = null`。不加的话，分析中的项目会落到"还没问过供应商 → rfq"，而 rfq 会因要求未确认直接失败。
2. **"强制要求非合规"按 `complianceStatus = NON_COMPLIANT` 计**（结论是"当前无法满足"）。若按"不是 COMPLIANT"计，新分析默认 `NOT_ASSESSED` 会让每个标都命中这一行。
3. **建议里不出现未放行的意图**（`gateAdvisory`）：例如 `ask` 映射到 `chase`（P1-7 未做）或环境没开 `rfq` 时，`nextStep = null`，不给点了就被 `INTENT_NOT_ENABLED` 拒掉的按钮。也因此 `suggestedActions[0] = nextStep` 只在 nextStep 可用时成立。
4. **"截标 ≤ 3 天"只算未来 0–3 天**；已过截标不触发这一行（继续往下判断）。
5. **`status` 多项目回复**：理由只列前 3 个项目（契约上限），结论注明"另 N 个见列表"，完整列表在 `data.projects`；下一步是排第一的那个标的 `next_step`。
6. **`ask` 的 LLM 不按 JSON 输出时**：第一行当结论、后面最多 3 行当理由、`nextStep = null`（不猜）。
7. ~~**Muse 的 `rfq` 意图没有 `incoterm` 参数**~~：后续已补 `incoterm?`（EXW/FOB/CIF/DDP/DAP），显式 > 偏好。
8. **`selectItem` 加了可选 `{ actorUserId }`**，只有 select 路由传（操作者 = 登录用户）；没有操作者就不学习。
9. **`MUSE_BRIDGE_INTENTS` 显式配置时不会并入默认集**：GATE-1 的值要写全：`status,ask,approve,reject,next_step,set_preference,preferences,rfq,compare,price_scenario`。

---

## 4. 已知限制

- 偏好与绑定共用 `Organization.settingsJson`，读改写没有加锁（与现有绑定写法一致，按禁令不加队列 / 锁）；同一组织两人同一毫秒改偏好，后写者覆盖前者的那一条。
- `quote.parsed` 事件 action 是 `compare`；`compare` 默认不在白名单，事件里的 action 不经 `gateAdvisory`（事件落库时不知道 Bridge 部署开了哪些意图）。
