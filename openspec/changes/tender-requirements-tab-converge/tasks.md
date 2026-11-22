# Tasks：「招标要求」页签收口（FIX-22）

前提：FIX-13（#546）与 FIX-18（`tender-analysis-single-entry`）已合并进 main，本分支已 rebase 到合并后的 main。tasks 按 design「留给 GATE」的推荐写（G1 A、G2 A、G3 A、G4 A、G5 A）；GATE 选了别的，按对应条目改写第 2、3、4、5 条。

## 1. 测试先行（不改业务代码）

- [ ] 1.1 记基线，再写两个新测试，在改动前的代码上各跑一遍。
  - 基线：跑 design「验证方式」表里五个既有测试与「不改、要照旧过」那一组，记下各自的通过数。
  - 写 `src/lib/tender-auto-analysis/__tests__/requirements-tab-converge.test.ts`（design D18 第 1 层），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - 写 `src/lib/tender-auto-analysis/__tests__/requirements-tab-converge-db.isolated.test.ts`（D18 第 2 层，没有隔离库时跳过），同样注册进两处。
  - verify：
    - 改动前 `npx tsx src/lib/tender-auto-analysis/__tests__/requirements-tab-converge.test.ts` 退出码非 0，输出里报出「矩阵只取等待审核 / 已批准」「面板里还有要求列表」「卡片加载即自动带入」；
    - 隔离库上 12-3 形状、确认状态、409、补翻各组失败；
    - `bash scripts/check-test-registry.sh` OK；
    - 基线通过数与两份红的输出存进报告。

## 2. 服务端：哪次分析、标注即确认

- [ ] 2.1 新增纯函数 `src/lib/tender-auto-analysis/requirement-matrix.ts` 与写入模块 `requirement-matrix-write.ts`，改 `src/app/api/projects/[id]/bid-fit/route.ts`。
  - 纯函数（客户端可用）：
    - 完成判定（D1）；
    - 标注后的审阅状态，即 D4 的表；
    - 行上显示什么（D8）；
    - 中文化状态（D16）；
    - 全部中文文案。
  - 写入模块（D4、D12、D17）：锁这次分析的记录行 → 重读 → 校验最新且已完成 → 只改 `bidFitMatrix` 里涉及的键 → 改审阅状态 → 写审计。
  - GET：
    - 收 `runId`，不属于本项目 / 本组织时 404；
    - 不带 `runId` 时取最新一条；
    - 返回状态、是否完成、是否最新、总条数、每行的审阅状态与来源（`serializeSourceRef`）。
  - POST：
    - 加 `NOT_A_REQUIREMENT` 与 `action: "confirm-marked"`；
    - `apply-memory` 排除已驳回的行；
    - 未完成 / 不是最新一条 / 批准后越界的写入返回 409；
    - 不调用自动起草与供应商情报。
  - 同步改 `bid-strategy-memo.test.ts` 的 FIT-01（五态字面量与归属校验跟着实际位置）。
  - verify：
    - 隔离库测试的「哪次分析」「409」「D4 每一行」「审计」「批准并发」「询价单按矩阵确认取行」「矩阵标注不触发起草」「跨项目 404」「响应字段」各组通过；
    - `npx tsx src/lib/tender-intel/__tests__/bid-strategy-memo.test.ts`、`npx tsx src/lib/tender-compliance-memory/__tests__/compliance-memory.test.ts` 的 CM-09a、`npx tsx src/lib/tender-auto-analysis/__tests__/bid-fit-usability.test.ts` 的 BF-09a 通过；
    - `NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/auto-draft-db.isolated.test.ts` 与 `requirement-batch-confirm-db.isolated.test.ts` 不改断言即通过。

## 3. 自动补翻

- [ ] 3.1 新增 `src/lib/tender-auto-analysis/zh-backfill.ts`，在矩阵读接口上挂触发点，改手动补翻接口。
  - `zh-backfill.ts`：
    - 认领与计次（D15：锁行重读、150 秒、自动最多 2 次、第 2 次要有进展）；
    - 取目标，调用 `translateAnalysisZh(…, { timeoutMs: 100_000 })`；
    - 按 D17 合并写回。
  - `bid-fit/route.ts`：`export const maxDuration = 120`；GET 判定为「该补」时先认领，再用 `after()` 调补翻，响应写 `zh: { state: "auto", englishCount }`（D14、D16）。
  - `bid-fit/translate/route.ts`：
    - 取最新一条，未完成返回 409；
    - 补翻在进行时返回 409；
    - 改走同一个函数；
    - 写权限、60 秒频控、返回字段不变。
  - 同步改 `bid-fit-usability.test.ts` 的 BF-14b：写回断言改读 `zh-backfill.ts`。
  - verify：
    - 隔离库测试的补翻各组通过（两次读只认领一次、零进展不发第 2 次、有进展发第 2 次后停、补翻期间的标注保留、手动接口两种 409、语义字段不动）；
    - `bid-fit-usability.test.ts` 全过；
    - `npx tsx src/lib/tender-auto-analysis/__tests__/v2-slice-deadline.test.ts` 不改断言即通过；
    - `git diff origin/main -- vercel.json src/lib/tender-auto-analysis/requirement-translate.ts src/lib/tender-auto-analysis/v2-resumable.ts` 为空。

## 4. 矩阵卡片

- [ ] 4.1 改 `src/components/tender-analysis/bid-fit-matrix-card.tsx`。
  - 改成用父级给的分析 id 与状态读接口，根元素加 `id="bid-fit-matrix"`。
  - 显示：
    - 未完成时两句与只读，没有要求时第三句（D3）；
    - 每行「来源」与「来源未记录」（D11）；
    - 「这不是要求」选项；
    - 按 D8 的行上显示；
    - 「已标的 N 条还没算确认」与「把这 N 条一并确认」；
    - 超过 300 条那句。
  - 顶部放「批准分析」、`approveHintZh`、三项审阅计数与自动起草结果，只给 `canManage`（D10）；批准成功后调用父级的「重新加载」。
  - 三个批量按钮都过确认框（D9）；删掉加载后自动调用逐字一致带入的那段（`bid-fit-matrix-card.tsx:155-162`）。
  - 中文化状态按 D16 显示，「正在自动翻译成中文…」时每 15 秒重读、最多 12 次；「翻译成中文」只在 `fallback` 且 `canManage` 时出现。
  - 同步改 `compliance-memory.test.ts` 的 CM-09c：不自动带入、采纳按钮带确认框。
  - verify：
    - `requirements-tab-converge.test.ts` 的卡片部分通过；
    - `bid-fit-usability.test.ts` 的 BF-10、BF-11、BF-12 与 `compliance-memory.test.ts` 全过；
    - `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0。

## 5. 面板与页签

- [ ] 5.1 改 `src/components/tender-analysis/analysis-panel.tsx` 与 `src/components/project-detail/tabs/requirements-tab.tsx`（D2、D13）。
  - 面板：
    - 删要求列表、批量确认的状态与函数、「批准分析」与提示、自动起草结果那一块（FIX-13 后的位置见 design D13）；
    - 进度部分之后加矩阵插槽，交出分析 id、状态与重新加载；
    - 加「收起其余分区」属性；
    - 分析者模式的页签按 `sections` 过滤；
    - 「关键要求」不可见时，项目解读里那两个按钮改为滚到矩阵（`analyst-synthesis-view.tsx:306`、`:480` 改文字与去处）。
    - 覆盖清单、FIX-18 的两个旧按钮与卡片回报、`id="tender-analysis"` 一字不动。
  - 页签：分区改为 `["risks","clarifications","report","sources"]`、初始 `risks`、默认收起；矩阵经插槽挂载。
  - 同步改：
    - `requirement-batch-confirm.test.ts` 的「面板源码」一段（读面板的 15 条改为「面板里已没有这些控件」；读 `review.ts` 与接口的几条、纯函数部分不动）；
    - `tender-detail-ia.test.ts` 的分区与「来源」两条。
  - verify：
    - `requirements-tab-converge.test.ts` 的面板部分通过；
    - `npx tsx src/lib/tender-auto-analysis/__tests__/requirement-batch-confirm.test.ts`、`npx tsx src/components/project-detail/__tests__/tender-detail-ia.test.ts` 通过；
    - FIX-13 的 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts`、FIX-18 的 `npx tsx src/lib/tender-workforce/__tests__/single-entry.test.ts`、`npx tsx src/lib/tender-next-step/__tests__/web-next-step.test.ts`、`npx tsx src/lib/tender-submission-checklist/__tests__/checklist.test.ts` 不改断言即通过；
    - typecheck 退出码 0。

## 6. 验收

- [ ] 6.1 跑全部门禁并截图。
  - verify：
    - `npm test` 对照既有失败清单没有新增；
    - `npm run test:ci` PASS；
    - `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0；
    - `npm run lint:baseline` PASS；
    - `bash scripts/check-test-registry.sh` OK；
    - `bash scripts/test-runtime-architecture.sh` 通过；
    - `OPENSPEC_TELEMETRY=0 openspec validate tender-requirements-tab-converge --strict` valid；
    - 1.1 记下的通过数不减（被改写的断言按报告里的对照表计）；
    - 本地夹具组织截图 6 张，存 `docs/acceptance/fix-22/`，内容按 design「验证方式」。

## 7. 报告与 TASKFLOW

- [ ] 7.1 写 `docs/QINGYAN_FIX-22_REPORT.md`，并在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 FIX 序列里加 FIX-22 一行，状态 `[~]`。
  - 报告写：
    - 73 与 54 的原因（design Context 2）与附录 A、B 的生产结果；
    - 五态推出确认状态的表；
    - 上线前数据的四种显示与附录 C、F、G 的条数；
    - 页面会换一份分析的项目（附录 E）；
    - 自动补翻的触发点、次数上限与第 7 条例外的登记；
    - 改动前后的测试输出、门禁结果与截图；
    - GATE 八条的结论；
    - 另开的任务：摘要 JSON 其它写入方加锁；G5 的口径统一。
  - 附录 SQL 由有生产只读权限的人跑；没跑的写明「未核对」。
  - verify：报告文件存在、含上面各节；TASKFLOW 里 FIX-22 状态为 `[~]`；FIX-12 那一行不动（由归档 PR #545 修）。

## Workflow follow-up

- `/opsx:verify tender-requirements-tab-converge`。
- 开 PR 前做多维审查，至少四个维度：正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案。本次再加三个维度：
  - 并发与锁：标注、批准、补翻三方交错；
  - 权限：读权限触发补翻、写入的 409；
  - 模型花费：自动补翻的次数与预算。
- 每条意见核实后再修，修完重跑测试；PR 正文写「多维审查」一节。
- 合并后通知招投标同事：要求只在矩阵里确认；合规记忆要点一下才带入。
- PR 合并后 `/opsx:archive tender-requirements-tab-converge --yes`：
  - 独立小 PR，TASKFLOW 里 FIX-22 改成 `[x]`；
  - 至少派一个子 agent 核对主规格与 delta 一致：`tender/requirement-review-batch-confirm` 移除两条、改两条，`tender/rfq-auto-draft` 改两条，新增两个能力。
