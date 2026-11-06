# P1-6G 报告：比价解读数字校验

| 项 | 值 |
|---|---|
| TASKFLOW | P1-6G（Phase 1，P1-6 遗留修补） |
| OpenSpec change | `openspec/changes/rfq-compare-number-guard/` |
| 来源 | `docs/QINGYAN_TENDER_P1-5-6_REPORT.md` 遗留："/compare/analysis 的 LLM 解读仍可能写出矩阵外的数字……没有做数字校验" |
| 分支 | `claude/rfq-compare-number-guard`（基于 main `05090b0`） |

## 1. 改了什么

- `src/lib/tender-rfq/interpretation-guard.ts`（新增，纯函数）：
  - `extractNumberTokens`：从文字取出数字（千分位、万 / 千 / k）、百分比、日期（`YYYY-MM-DD`、`YYYY/MM/DD`、`YYYY年M月D日`）与月日（`M月D日`）；字母后面的数字（型号、供应商名）不取。
  - `collectAllowedNumbers`：遍历交给 LLM 的输入，数值字段直接收，字符串字段按同一规则抽取。
  - `checkInterpretationNumbers`：按写法精度比较（整数 ±0.5、一位小数 ±0.05、`1.2万` ±500），百分比只与百分比比，日期完全一致；找不到出处的数字后面插入「［矩阵中无此数］」，返回 `{ ok, unverified[], annotated }`。
- `src/lib/tender-rfq/compare.ts`：拆出 `buildInterpretationPayload`，`buildMatrixInterpretationPrompt` 改为直接序列化它（提示词文字与输入内容不变）。
- `/compare/analysis` 路由：解读正文换成标注版；响应新增 `numberCheck: { ok, unverified: [{ field, token }] }`；不通过时 `console.warn`（只记项目、轮次与可疑数字，不记正文）。校验不通过不影响返回（矩阵与结论仍可用）。
- `QuoteAnalysisPanel`：`numberCheck.ok=false` 时在结论下方显示提示条（最多列 5 个数字），说明以矩阵为准。

不变：矩阵、一句话结论、推荐供应商（仍只来自代码）；提示词规则；Muse 的 `compare` / `price_scenario` 回复；没有新增 LLM 调用。

## 2. 测试与门禁（实际运行）

| 检查 | 结果 |
|---|---|
| `npx tsx src/lib/tender-rfq/__tests__/interpretation-guard.test.ts` | 29 passed |
| tender-rfq 其余纯测试（build / round-pure / inbound-parse / inbound-apply / landed-cost / compare / notes-parse / chase-pure / chase-execute） | 21 / 31 / 38 / 54 / 70 / 47 / 17 / 55 / 23 passed |
| `bash scripts/check-test-registry.sh` | OK，已注册 536 |
| `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck` | exit 0 |
| `npm run lint:baseline` | PASS（无新增 error fingerprint） |
| `openspec validate rfq-compare-number-guard --strict` | valid |

新测试注册进 `scripts/test-all.sh`（紧跟比价矩阵测试）与 `scripts/test-ci-unit.sh`。

## 3. 已知局限

- 中文数字（"三家""两周"）不检查。
- 模型写"约 12,000"这类合理近似也会被标出——与提示词"引用数字必须与矩阵完全一致"一致，代价是偶尔多一条提示。
- 本地没有可调用的模型，未做真实模型输出的端到端演示；接口改动只在返回前加确定性处理，由类型检查与纯测试覆盖。

## 4. 上线

无迁移、无开关、无新 env；合并即生效。回滚 = 还原上述文件。
