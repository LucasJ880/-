# 批次二 — 抽取分类学扩容实施报告（incumbent_supplier + evaluation_criteria）

日期：2026-08-20 · 分支 `feature/tender-extraction-taxonomy` · SCHEMA_CHANGE = NONE

## 1. 背景（HRM-2026-0395 实测盲区）

Halifax Media Monitoring RFQ 对照 ChatGPT 深读，青砚漏掉两类**文档里明写**的关键事实：

1. **现任供应商**：文档载明「services provided by the current supplier since
   November 2021」「current contract expires November 1, 2026」——分类学里没有槽位，
   抽取层无处可落，于是工作台显示「无历史供应商」（用户实测投诉点）。
2. **评分标准**：价格 70% / 绩效 10% / 国籍 10% 等评分公式散落 requirement/other，
   情报与策略层拿不到结构化数字，备忘录只能靠猜。

## 2. 改动（全部纯代码，零 schema/env）

- **`tender-understanding/contract.ts`** — `CRITICAL_FACT_TYPES` 追加
  `incumbent_supplier`、`evaluation_criteria`（含盲区注释）。`criticalFacts` 是
  `Record<CriticalFactType, …>`，synthesize 程序化遍历 → 新槽位自动进入合成与投影，
  无需改 synthesize/RESOLVE（已核实 RESOLVE prompt 无槽位清单）。
- **`tender-understanding/prompts.ts`** — `PROMPT_EXTRACT` 升 **@5**（带 changelog）：
  - factType 枚举行加入两新类型（探针 P2T-04 双源零漂移守卫）；
  - 新增覆盖指引 d（现任供应商：**可未具名也抽取**，逐字引文）、
    e（评分权重/公式/扣分规则：**数字逐字进 rawValue**——直接驱动报价策略）。
- **`tender-auto-analysis/executive-brief.ts`** — 简报外部字段新状态 **`DOC_STATED`**：
  `previousWinner` 槽在无人工确认、无 AI 研判时，若 `run.summaryJson.criticalFacts.
  incumbent_supplier` 有值（N/A 过滤），显示「文档载明 · 名称待核」。
  优先级 READY（人工确认）> AI_RESEARCHED > DOC_STATED > NEEDS_EXTERNAL_RESEARCH——
  文档载明不越权顶替人工确认（探针 P2T-07 反例守卫）。
- **`project-intel-sections.tsx`** — DOC_STATED 状态词典 + 靛蓝配色。
- **`extract-prompt-locator.test.ts`** — LOC-01 版本钉更新 @4→@5（版本进入检查点
  指纹：部署后进行中 run 的窗口断点因指纹失效而重算，语义即「不许用旧 prompt 的
  断点续新 prompt」，设计如此）。

## 3. 测试证据

- 新探针套件 **taxonomy-p2 9/9**（`src/lib/tender-understanding/__tests__/taxonomy-p2.test.ts`，
  已注册 test-all + test-ci-unit）：enum/zod/版本/**prompt factType 行 ≡ enum+other
  双源零漂移反例守卫**/覆盖指引措辞/DOC_STATED 优先级两向（补显 + 不越权）/UI 词典。
- 回归：executive-brief **24/24**、eval-harness 自检 **12/12**、
  extract-prompt-locator **7/7**（LOC-01 更新后）、CI 单测子集 **13 套全 PASS**。
- tsc 全量零错（autopilot 两错为 #131 新表的陈旧 prisma client，`prisma generate`
  后消失，与本分支无关）；eslint 变更文件仅 1 条 main 上既有 warning
  （executive-brief FB-12 无用 disable 指令，非本次引入，不动）。

## 4. tender-eval 基准复跑（真实数据，非合成）

本机三案全可跑（修正此前「真实 case 无本地 fixture」预设——真实 RCMP 43 页原件
在 `~/Desktop/青砚-tender-analysis/fixtures/private/`）。双 lane 复跑
`runId=20260820-172049Z-83c7a21`（artifacts/tender-eval/…，V2 = 真实 LLM 调用）：

**V1 确定性 lane：三案逐 fact 与 baseline-v1 完全一致（零漂移）**——@5 prompt
与新槽位对确定性管线零扰动（预期内，V1 不经 LLM prompt）。

**V2 lane vs v2-postfreeze**（LLM 单次采样，含 run 间方差）：

| 指标 | postfreeze | 本次 |
| --- | --- | --- |
| 三案 fact verdict 合计 | CORRECT 64 / WRONG 3 / 漏 9 | **CORRECT 65 / WRONG 1** / 漏 10 |
| case-a 真实 43 页 mandatory recall (strict/lenient) | 76.3% / 84.2% | **86.8% / 94.7%** |
| case-a 真实全事实准确 | 79.0% | 81.6% |
| case-b 全事实准确 | 93.3%（FB-SAMPLES 错值） | **100.0%** |
| case-a0 合成全事实准确 | 87.0% | 82.6%（-1 条，方差） |
| Risk recall / 泄漏 / unsupported | 不变 | 不变（real 案 risk 100%、泄漏 0） |

**新槽位实证（本次核心验证目标）**：
- `evaluation_criteria` 在三案共承接 **8 条 golden fact** 的 CORRECT 匹配——含
  case-b 的**价格权重**（FB-EVAL-PRICE-WEIGHT，正是 Halifax「价格 70%」盲区的同类
  事实）、real 案的评标方法/DDP/付款条款、a0 的评标基准。
- `incumbent_supplier`：三案文档均无现任供应商 → 三案全部正确落 UNKNOWN 槽清单，
  **零幻觉**（新指引「可未具名也抽取」没有诱发无中生有）。
- 退步 3 条（a0 F0-QTY-ANNUAL、real F-ENQUIRY-DEADLINE / F-PRICE-ONLY-FINANCIAL）
  均为 "no system fact matched anchors" 的方差型漏抽，无系统性模式（同类评标事实
  F-EVAL-METHOD 本次即通过新槽 CORRECT）。

**golden 纪律**：未改任何 golden；新类型事实不自评自证——golden 只能人工冻结，
Halifax 案的 incumbent/评分 golden 留待 Lucas 人工确认后由导出脚本另立 case。

## 5. Gate

```
BATCH2_SCHEMA_CHANGE      = NONE
BATCH2_NEW_FACT_TYPES     = 2（incumbent_supplier / evaluation_criteria）
BATCH2_PROMPT_VERSION     = tender-understanding-v2-extract@5（进入检查点指纹）
BATCH2_DOC_STATED_STATE   = PASS（补显不越权，P2T-06/07 两向守卫）
BATCH2_PURE_SUITES        = taxonomy-p2 9/9 + locator 7/7 + brief 24/24 + CI 子集 PASS
BATCH2_BENCHMARK          = PASS（V1 三案零漂移；V2 CORRECT 64→65 / WRONG 3→1；
                            real 案 mandatory strict 76.3%→86.8%；新槽承接 8 条
                            golden 匹配；incumbent 零幻觉；runId 20260820-172049Z）
BATCH2_GOLDEN_TOUCHED     = NONE（golden only human）
BATCH2_STATUS             = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
