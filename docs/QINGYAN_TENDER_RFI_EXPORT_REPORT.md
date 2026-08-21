# RFI 问题清单导出实施报告（Lane 2）

日期：2026-08-21 · 分支 `feature/tender-rfi-export` · base = main `6bbbfb2d` · SCHEMA_CHANGE = NONE

## 1. 目标

备忘录 v2/v3 已产出策略 RFI，分析器也有澄清问题，但没有「一键导出成可直接提交给业主的中英问题单」。
Halifax 提问窗口（门户 8/28）前这是最直接能用上的产出。

## 2. 改动（复用既有文档链，不另起炉灶）

- **新 `src/lib/projects/generate/rfi-export.ts`**：`buildRfiItems`（备忘录策略 RFI 优先 → 分析器澄清按
  BLOCKING/HIGH 排序；跨源去重（标点/空白归一）；编号；上限 20；无来源 → 空清单不编造）、
  `translateRfiToEn`（AI 只做中→英，数字/条款号逐字；`looksEnglish` 反向守卫拒照抄/混中文；失败留空
  标「待人工补译」不抛）、`renderRfiHtml`（中英对照表 + 招标编号/业主/提问截止/截标/提交渠道元信息；
  提问截止文件未给时**明示「以门户公告为准」**；内部核对清单）。
- **`generate-docs.ts`**：`owner_clarification`（原空模板）升级为真·RFI 清单：读最新 run 的
  `analystSynthesis.clarifications` + `criticalFacts` 元信息、房间 `bidStrategyMemo.strategicRfis`，
  经 `htmlOverride` 走 `persistGeneratedHtml`（Chromium PDF，中文完好）。标题改「RFI 问题清单（中英）」。
- **UI**：生成菜单文案改「RFI 问题清单 PDF（中英，可直接提交）」；备忘录卡新增「导出 RFI 问题清单 PDF」
  一键按钮（同一 generate-pdf 端点，提示英文列提交前人工核对）。

## 3. 证据

- 纯平面 rfi-export **9/9**（已注册 test-all + test-ci-unit）：合并去重排序 / 空来源不编造 / 上限 /
  looksEnglish 两向 / 翻译成功-照抄拒-模型坏留空 / HTML 转义与待译标注 / 结构守卫 ×3。
- **真实 E2E 4/4**（生产只读 + 真实模型，零写入）：Halifax 备忘录 6 条 + 分析澄清 6 条 → 去重 12 条；
  **12/12 英译（7s，1 次调用）**；含数字问题 3 条数字逐字保留；HTML 含 HRM-2026-0395 与
  「提问截止文件未明确——以门户公告为准」。
- tsc 零错；eslint 零新告警（project-generate-menu 的 useEffect 依赖警告为既有）。

## 4. 上线后

Halifax 情报 tab 备忘录卡点「导出 RFI 问题清单 PDF」→「文件」tab 出现中英对照 PDF，英文列人工核对后
逐条贴进 Bids&Tenders「Submit a Question」。无新 env / 无 schema；回滚 = revert。

## 5. Gate

```
RFI_SCHEMA_CHANGE  = NONE
RFI_SOURCES        = memo.strategicRfis ∪ analystSynthesis.clarifications（去重，不编造）
RFI_AI_BOUNDARY    = 仅中→英翻译（数字逐字，反向守卫，失败留空标注）
RFI_PURE_SUITES    = 9/9
RFI_REAL_E2E       = PASS 4/4（12/12 英译，数字保留）
RFI_STATUS         = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
