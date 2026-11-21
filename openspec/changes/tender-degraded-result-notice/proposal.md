# Proposal：招标分析的降级结果用白话说清楚（FIX-17）

TASKFLOW：FIX-17（Phase F（续）表末，FIX-12 的后续，2026-11-21）

> **范围待定**：任务书要求这份四件套先写出来，等 FIX-12（#540）、FIX-13 都上线、Evan 重测看到真实的降级样子之后再定范围、再实现。下面是按读代码能确认的现状写的初稿。前置：#540 已合并（本 change 用到它引入的错误码 `CALL_DEADLINE_EXCEEDED`）。

## Why

FIX-12 之后，以前「整个分析失败」的情况会变成「分析完成但有降级」：有的页面段落没读完、中文综合解读没生成、AI 复核没跑完、澄清检查没来得及做。现在这些降级只记在数据里——界面、通知、Muse 消息都看不出来，一份跳过了几页的分析和一份完整的分析看起来一样，用户可能直接批准。

## What Changes

- 在分析结果里存一份结构化的降级记录（放在既有的分析摘要 JSON 里）：没读完的页面段落（哪个文件第几页到第几页）、综合解读有没有生成及原因、AI 复核有没有跑完、有几条澄清检查没来得及做。
- 在运行详情接口返回这份降级记录。
- 在分析面板顶部显示降级说明：每一种降级一句白话，不出现英文错误码、不说「窗口」。
- 把「AI 复核没跑完」与「没通过 AI 质检」分成两句不同的横幅。
- 在没来得及核对的澄清问题上注明「没来得及核对文件里是否已有答案」。
- 改分析完成的站内通知与 Muse 消息：有降级时不再写「可以开始确认招标要求」，改为说明有降级、请先看说明，优先级提高。
- 把写进局限说明的句子改成中文白话（不带英文错误码、不说「窗口」）。
- 在分析面板显示既有的覆盖说明「N 个可分析文件尚未纳入本次分析」，并修正「N 个文件文件解析失败」的重复用字。

## Capabilities

### New Capabilities

- `tender/analysis-degradation-notice`：招标分析降级时记下什么、在哪里用什么话告诉用户。

### Modified Capabilities

（无。`tender/analysis-slice-budget`、`tender/analysis-package-coverage` 的要求不改；后者的界面只多显示一句既有的说明。）

## Impact

- 代码：`src/lib/tender-understanding/analyzer.ts`（局限说明的句子、降级记录的来源）；`src/lib/tender-auto-analysis/v2-map.ts`（把降级记录放进分析摘要）；新文件 `src/lib/tender-auto-analysis/degradation.ts`（纯函数：由检查点与结果算出降级记录、生成各处的句子）；`src/app/api/projects/[id]/tender-analysis/runs/[runId]/route.ts`（返回降级记录）；`src/components/tender-analysis/analysis-panel.tsx`、`analyst-synthesis-view.tsx`（显示）；`src/lib/tender-auto-analysis/alerts.ts`（通知文案与优先级）；`src/lib/muse-bridge/events-pure.ts`（Muse 消息文案）；`src/lib/tender-auto-analysis/package-coverage.ts`（重复用字）。
- 受影响的 Muse 意图：无查询类意图改动；受影响的是「分析完成」这一条推送消息的文案（`events-pure.ts`）。
- 测试：新增 `src/lib/tender-auto-analysis/__tests__/degradation-notice.test.ts`，注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`；扩 `alerts.test.ts` 与 muse-bridge 的事件测试。
- 无 schema（降级记录放在既有 JSON 位）、无新开关、无新模型调用；合并即生效。旧的分析没有降级记录，界面按「没有降级」显示，不回填。

## Out of scope

- 不改任何时序：澄清检查的开工门槛、Analyst 的开工门槛与尝试次数、备用模型的时间分配——属于 FIX-16。
- 不让被截止的澄清检查重查：本次只注明；要不要重查等重测后定。
- 不拦截「批准分析」：有降级时只提示，不禁止批准。要不要加确认框等重测后定。
- 不改导出文档（询价单、RFI、内部备忘）：本次核对它们不直接引用局限说明；有需要另开。
- 不改一键分析的最终结果卡片的生成方式（它自己有一套局限说明），只在分析面板与通知上说明。
- 不新增模型调用去「解释」降级：句子全部由固定模板生成。
