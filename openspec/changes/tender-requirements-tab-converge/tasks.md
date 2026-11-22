# Tasks：「招标要求」页签收口（FIX-22）

前提：

- 合并顺序：#548 FIX-17 → FIX-21 → FIX-19 → FIX-14 → FIX-20 → FIX-15 → FIX-18 → FIX-20b → FIX-22 → FIX-16（FIX-13 #546 已合并，main `13c7ed33`）。**FIX-20b 合并后把 main 合入本分支再开工**；合入后先核对 design 引用的行号（特别是 FIX-15 改过的 `src/lib/tender-workforce/tools.ts`），对不上的先改四件套再写代码。
- FIX-19 已合并：本 change 隔离库测试建 `ProjectDocument` 夹具一律写 `source: "upload"`；分析面板覆盖清单下带角色标签的文件列表一字不改。
- FIX-21 已合并：本 change 改的 `src/app/api/projects/[id]/` 下四个接口（`bid-fit`、`bid-fit/translate`、`bid-draft`、`tender-analysis/runs`），每个处理函数第一步不带条件地调用项目级守卫、紧接着检查结果，其余改动都放在检查之后（design D21）。
- 「留给 GATE」十二条已按推荐定为 A（Lucas 2026-11-22 授权），tasks 按此写。

## 1. 测试先行（不改业务代码）

- [ ] 1.1 记基线，再写两个新测试，在改动前的代码上各跑一遍。
  - 基线：跑 design「验证方式」表里五个既有测试与「不改、要照旧过」那一组，记下各自的通过数。
  - 写 `src/lib/tender-auto-analysis/__tests__/requirements-tab-converge.test.ts`（design D20 第 1 层），注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。
  - 写 `src/lib/tender-auto-analysis/__tests__/requirements-tab-converge-db.isolated.test.ts`（D20 第 2 层，没有隔离库时跳过；文件夹具写 `source: "upload"`；「响应发出后执行」换成测试收集的执行），同样注册进两处。
  - verify：
    - 改动前 `npx tsx src/lib/tender-auto-analysis/__tests__/requirements-tab-converge.test.ts` 退出码非 0，输出里报出「矩阵只取等待审核 / 已批准」「面板里还有要求列表」「卡片加载即自动带入」「读接口只列 300 条」；
    - 隔离库上 12-3 形状、确认状态、409、投标草稿、补翻各组失败；
    - `bash scripts/check-test-registry.sh` OK；
    - 基线通过数与两份红的输出存进报告。

## 2. 服务端：哪次分析、标注即确认、投标草稿

- [ ] 2.1 新增纯函数 `src/lib/tender-auto-analysis/requirement-matrix.ts` 与写入模块 `requirement-matrix-write.ts`，改 `src/app/api/projects/[id]/bid-fit/route.ts`、`src/lib/tender-bid-draft/gather.ts`、`src/app/api/projects/[id]/bid-draft/route.ts`、`src/lib/tender-auto-analysis/serializers.ts`、`src/app/api/projects/[id]/tender-analysis/runs/route.ts`。
  - 纯函数（客户端可用）：
    - 完成判定与 D3 第二句（含「分析失败」会不会重试）、旧管线失败的两句白话（D13）；
    - 标注后的审阅状态，即 D4 的表（含已批准几行）；
    - 行上显示什么（D8）、计数口径（D11）；
    - 中文化状态与重读何时停（D16）；
    - 全部中文文案。
  - 写入模块（D4、D12、D17、D19）：锁这次分析的记录行 → 重读 → 校验 `matrixVersion`、最新、已完成、行的范围 → 只改 `bidFitMatrix` 里涉及的键 → 改审阅状态 → 提交 → 提交后用 `logAudit` 写审计。
  - GET：
    - 收 `runId`，不属于本项目 / 本组织时 404；不带 `runId` 时取最新一条；
    - 去掉 300 条上限；返回状态、是否完成、是否最新、是否还会自动重试、总条数、每行的审阅状态、来源（`serializeSourceRef`）、译文全文与原文。
  - POST：
    - 加 `NOT_A_REQUIREMENT` 与 `action: "confirm-marked"`；缺 `matrixVersion: 2` 或 `mode: "exact"` 返回 409；
    - 批量与 `apply-memory` 在锁里按库里的标注与审阅状态重新筛行，排除已驳回与已标的；批量仍 ≤ 300 条；
    - 未完成 / 不是最新一条 / 批准后越界的写入返回 409；
    - 不调用自动起草与供应商情报。
  - 投标草稿：`gather.ts` 取要求的条件加「审阅状态不是已驳回」；`bid-draft/route.ts` 的要求条数与已标条数不算已驳回的。
  - 序列化：分析记录多一项「分析失败后是否还会自动重试」；列表接口查询多取 `nextAttemptAt`。
  - 同步改读源码的断言（意思不变，只改读哪个文件）：`bid-strategy-memo.test.ts` 的 FIT-01、FIT-02，`compliance-memory.test.ts` 的 CM-09a，`bid-fit-usability.test.ts` 的 BF-09a。
  - verify：
    - 隔离库测试的「哪次分析」「409」「D4 每一行」「审计（含写不进去）」「批准并发」「已批准待确认行」「询价单按矩阵确认取行」「投标草稿不收已驳回」「不设 300 条上限」「矩阵标注不触发起草」「跨项目 404」「旧页面 409」「响应字段」各组通过；
    - `npx tsx src/lib/tender-intel/__tests__/bid-strategy-memo.test.ts`、`npx tsx src/lib/tender-compliance-memory/__tests__/compliance-memory.test.ts` 的 CM-09a、`npx tsx src/lib/tender-auto-analysis/__tests__/bid-fit-usability.test.ts` 的 BF-09a 通过；
    - `npx tsx src/lib/tender-bid-draft/__tests__/bid-draft.test.ts`、`npx tsx src/lib/tender-decision-gates/__tests__/decision-gates.test.tsx`、`npx tsx src/lib/tender-profile/__tests__/tender-profile.test.ts` 不改断言即通过；
    - `NODE_ENV=test npx tsx src/lib/tender-rfq/__tests__/auto-draft-db.isolated.test.ts` 与 `requirement-batch-confirm-db.isolated.test.ts` 不改断言即通过；
    - FIX-21 的 `npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts` 不改断言即通过。

## 3. 自动补翻

- [ ] 3.1 新增 `src/lib/tender-auto-analysis/zh-backfill.ts`，在矩阵读接口上挂触发点，改手动补翻接口。
  - `zh-backfill.ts`：
    - 开始与计次（D15：锁行重读、150 秒、只记开始时间与方式、自动最多 2 次、第 2 次要第 1 次有进展、中断按没有进展）；
    - 预算（D18：min(100 秒, 请求开始 + 105 秒 − 现在)）；
    - 取目标，调用 `translateAnalysisZh(…, { timeoutMs })`；
    - 按 D17 合并写回，写 `last`、`autoLastTranslated`。
  - `bid-fit/route.ts`：`export const maxDuration = 120`；项目级守卫检查通过后紧接着记请求开始时刻（D18、D21）；只对最新一条判定「该补」；该补时经可替换的「响应发出后执行」依赖（生产用 `after()`）交出「开始 → 翻译 → 写回」，交出成功才在响应里写 `zh: { state: "auto", englishCount, attempt }`（D14、D16）。
  - `bid-fit/translate/route.ts`：
    - 取最新一条，未完成返回 409；
    - 补翻在进行时返回 409；
    - 改走同一个函数，预算按同一算法；
    - 写权限、60 秒频控、返回字段不变。
  - 同步改 `bid-fit-usability.test.ts` 的 BF-14b：写回断言改读 `zh-backfill.ts`。
  - verify：
    - 隔离库测试的补翻各组通过（两次读只开始一次、不是最新一条不补、零进展不发第 2 次、中断不发第 2 次、有进展发第 2 次后停、补翻期间的标注保留、手动接口两种 409、交出抛错时次数不变、语义字段不动）；
    - `bid-fit-usability.test.ts` 全过；
    - `npx tsx src/lib/tender-auto-analysis/__tests__/v2-slice-deadline.test.ts` 不改断言即通过；
    - `npx tsx src/lib/projects/__tests__/project-routes-guard.test.ts` 不改断言即通过；
    - `git diff origin/main -- vercel.json src/lib/tender-auto-analysis/requirement-translate.ts src/lib/tender-auto-analysis/v2-resumable.ts` 为空。

## 4. 矩阵卡片

- [ ] 4.1 改 `src/components/tender-analysis/bid-fit-matrix-card.tsx`。
  - 改成用父级插槽给的对象（分析 id、状态、重新加载）读接口，根元素加 `id="bid-fit-matrix"`；收到「已有更新」的 409 或读到「不是最新一条」时调用重新加载。
  - 显示：
    - 未完成时两句与只读，没有要求时第三句（D3）；
    - 每行「来源」与「来源未记录」，每行可展开看译文全文与原文（D11）；
    - 「这不是要求」选项（只在等待审核时）；
    - 按 D8 的行上显示与已批准的后缀；
    - 「已标的 N 条还没算确认」与「把这 N 条一并确认」；
    - 计数按全部要求算、五态计数与例外区不算已驳回的行。
  - 顶部放「批准分析」、`approveHintZh`、三项审阅计数与自动起草结果，只给 `canManage`（D10）；批准成功后调用父级的「重新加载」。
  - 三个批量按钮都过确认框（D9，等待审核与已批准两种文案），未标超过 300 条时按钮写「先把前 300 条设为已有」；删掉加载后自动调用逐字一致带入的那段（`bid-fit-matrix-card.tsx:155-162`）；所有写入带 `matrixVersion: 2`。
  - 中文化状态按 D16 显示，自动 / 手动两种进行中文案；按 `attempt` 每 15 秒重读、同一次最多 12 次、停下后的那句；「翻译成中文」只在 `fallback` 且 `canManage` 时出现。
  - 同步改 `compliance-memory.test.ts` 的 CM-09c：不自动带入、采纳按钮带确认框。
  - verify：
    - `requirements-tab-converge.test.ts` 的卡片部分通过；
    - `bid-fit-usability.test.ts` 的 BF-10、BF-11、BF-12 与 `compliance-memory.test.ts` 全过；
    - `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` 退出码 0。

## 5. 面板与页签

- [ ] 5.1 改 `src/components/tender-analysis/analysis-panel.tsx`、`src/components/project-detail/tabs/requirements-tab.tsx` 与 `src/components/tender-analysis/analyst-synthesis-view.tsx`（D2、D13）。
  - 面板：
    - 删要求列表、批量确认的状态与函数、「批准分析」与提示、自动起草结果那一块（位置见 design D13）；
    - `runs?latest=1` 一返回就渲染矩阵插槽，交出对象（分析 id、状态、重新加载）；详情加载中或失败时照样挂一键分析卡片、显示出错提示与矩阵；
    - 加「收起其余分区」属性；分析者模式的页签按 `sections` 过滤；
    - 最新一条是旧管线「分析失败」时，分析状态那一栏显示 D13 的两句白话之一。
    - 覆盖清单（含带角色标签的文件列表）、FIX-18 的两个旧按钮与卡片回报、`id="tender-analysis"` 一字不动。
  - `analyst-synthesis-view.tsx`：「关键要求」不可见时，`:313`、`:488` 两个按钮改为「去投标合规矩阵逐条看」并滚到矩阵；其余不动。
  - 页签：分区改为 `["risks","clarifications","report","sources"]`、初始 `risks`、默认收起；矩阵经插槽挂载，插槽对象原样展开成卡片属性。
  - 同步改：
    - `requirement-batch-confirm.test.ts` 的「面板源码」一段（读面板的 15 条改为「面板里已没有这些控件」；读 `review.ts` 与接口的几条、纯函数部分不动）；
    - `tender-detail-ia.test.ts` 的分区与「来源」两条。
  - verify：
    - `requirements-tab-converge.test.ts` 的面板部分通过；
    - `npx tsx src/lib/tender-auto-analysis/__tests__/requirement-batch-confirm.test.ts`、`npx tsx src/components/project-detail/__tests__/tender-detail-ia.test.ts` 通过；
    - FIX-13 的 `npx tsx src/lib/tender-auto-analysis/__tests__/package-coverage.test.ts`、FIX-18 的 `npx tsx src/lib/tender-workforce/__tests__/single-entry.test.ts`、FIX-20b 的 `npx tsx src/lib/tender-workforce/__tests__/continue-eligibility.test.ts`、`npx tsx src/lib/tender-next-step/__tests__/web-next-step.test.ts`、`npx tsx src/lib/tender-submission-checklist/__tests__/checklist.test.ts` 不改断言即通过；
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
    - 本地夹具组织截图 7 张，存 `docs/acceptance/fix-22/`，内容按 design「验证方式」。

## 7. 报告与 TASKFLOW

- [ ] 7.1 写 `docs/QINGYAN_FIX-22_REPORT.md`，并在 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的 FIX 序列里加 FIX-22 一行，状态 `[~]`。
  - 报告写：
    - 「没有开关，合并即在生产生效」；
    - 「合并后要人做的事」（design Migration Plan）：附录 A–I 合并前全部跑一次作基线、合并后一周内再跑 C、D、F、H，由 Lucas 指定的有生产只读权限的人跑；合并当天通知招投标同事刷新开着的项目页；「把这 N 条一并确认」由各项目有写权限的人自己点，按附录 F 的名单逐个通知负责人；
    - 73 与 54 的原因（design Context 2）与附录 A、B 的生产结果；
    - 五态推出确认状态的表与 Context 4 的读者表；
    - 上线前数据的四种显示与附录 C、F、G 的条数（F 按来源与供应商侧拆开，对应 G11 各做法让询价单多几条）；
    - 页面会换一份分析的项目（附录 E）、已批准分析里待确认的行（附录 H）、超过 300 条的分析（附录 I）、只有编号的要求（附录 D）；
    - 自动补翻的触发点、次数上限、开始频控与第 7 条例外的登记；
    - 改动前后的测试输出、门禁结果与截图；
    - GATE 十二条的结论（全部按推荐定为 A，Lucas 2026-11-22 授权）。
  - 附录 SQL 由有生产只读权限的人跑；没跑的写明「未核对」。
  - `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`：开工时先记下 `grep -c "| 待定 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 的条数 M。新增 FIX-22 一行，状态 `[~]`。同时登记 4 条后续任务，各一行，编号写「待定」，状态 `[ ]`：
    1. 「这不是要求」撤回之前写进组织合规记忆的那条立场（`src/lib/tender-compliance-memory/**`；proposal Out of scope、design D5）；
    2. 摘要 JSON 的其它写入方 `src/app/api/projects/[id]/tender-benchmark/route.ts:158-170`、`src/lib/tender-auto-analysis/reply-resolution.ts:206-222` 改为「锁分析记录行 → 重读 → 只改自己的键」（design Risks）；
    3. 最新一条分析未完成时，询价、自动起草、提交清单、投标草稿统一取哪一份（G5）；
    4. `openspec/config.yaml` 第 7 条写进「招标分析中文补翻的自动触发：只对项目最新一条分析，每次分析至多 2 次，只用既有补翻调用」（G8，由 Evan 改）。
  - verify：报告文件存在、含上面各节；`grep -n "FIX-22" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 有一行，状态为 `[~]`；`grep -c "| 待定 |" docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md` 不少于 M + 4；FIX-12 那一行不动（由归档 PR #545 修）。

## Workflow follow-up

- `/opsx:verify tender-requirements-tab-converge`。
- 开 PR 前做多维审查，至少四个维度：正确性与回归、安全 / 隐私与八条硬纪律、规格—代码—测试一致性、使用流畅与文案。本次再加三个维度：
  - 并发与锁：标注、批准、补翻三方交错；
  - 权限：读权限触发补翻、写入的 409、旧页面的写入；
  - 模型花费：自动补翻的次数与预算。
- 每条意见核实后再修，修完重跑测试；PR 正文写「多维审查」一节。
- 合并后通知招投标同事：要求只在矩阵里确认；合规记忆要点一下才带入；开着的项目页刷新一次。
- PR 合并后 `/opsx:archive tender-requirements-tab-converge --yes`：
  - 独立小 PR，TASKFLOW 里 FIX-22 改成 `[x]`；
  - 至少派一个子 agent 核对主规格与 delta 一致：`tender/requirement-review-batch-confirm` 移除两条、改两条，`tender/rfq-auto-draft` 改三条，新增两个能力。
