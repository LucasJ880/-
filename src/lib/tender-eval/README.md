# tender-eval — Tender Real Evaluation Benchmark (v1)

固定考卷 + 人工黄金答案 + 可重复评分，用来回答"青砚有没有变聪明"，而不是"测试有没有报错"。

## 运行

```bash
npm run test:tender-eval
```

- 输出：`artifacts/tender-eval/<runId>/results.{json,md}`（目录已 gitignore）
- 提交的基线快照：`docs/tender-eval/baseline-v1/`
- 评分引擎自测（已注册进 `scripts/test-all.sh`）：`npx tsx src/lib/tender-eval/__tests__/eval-harness.test.ts`

## 边界（硬约束）

1. **本目录不得被生产代码 import。** 评估只读生产管线（Phase E/F/G 纯函数面），绝不修改生产算法。
2. **Golden Answer 只能来自人读源文件**，逐条带页码+原文引文；AI/抽取器输出不得反向作为黄金答案。`goldenAnswerMethod` 未达 `HUMAN_CONFIRMED` 前一切结果都是"临时基线"。
3. **repo 是 PUBLIC**：真实标书全文只存 `fixtures/private/`（gitignored）；case 文件里只允许引文级 `sourceQuote`。
4. Benchmark 不迁就系统：发现问题记录在案，禁止为了让分数好看调生产代码或放宽判定。

## 结构

| 文件 | 职责 |
| --- | --- |
| `contract.ts` | tender-eval/v1 case 契约（goldenFacts / goldenRequirements / risks / clarifications / expectedUnknowns / hallucinationProbes） |
| `normalize.ts` | 归一化判等：日期（`2026-08-13` == `Aug 13 2026`）、金额、数量、时长、锚词组、token 覆盖率 |
| `evaluate.ts` | 评分引擎：MATCHED/PARTIAL/MISSED/FALSE_POSITIVE/DUPLICATE、值+证据双重判定（值对证据错=失败）、风险/澄清分类、指标计算 |
| `run-pipeline.ts` | 驱动真实生产管线产出 SystemOutput（与 worker.ts DB 步骤逐一对应，见文件头注） |
| `real-pdf.ts` | 本地私有真实 PDF → PageInput[]（缺失 → case SKIPPED，绝不合成顶替） |
| `report-io.ts` | JSON + Markdown 结果输出 |
| `cases/` | case-a0（合成对照）/ case-a-real（43 页真实原件）/ case-b（DSBN 窗饰业务域） |

新增真实 case 的流程：`npx tsx scripts/tender-eval-export-case.ts <projectId> <caseId>` 导出页文本到
`fixtures/private/tender-eval/<caseId>/`，人工填写 `golden-skeleton.md`，再新建 case 文件接入 `cases/index.ts`。

完整背景、基线数字与失败清单见 `docs/QINGYAN_TENDER_REAL_EVALUATION_V1.md`。
