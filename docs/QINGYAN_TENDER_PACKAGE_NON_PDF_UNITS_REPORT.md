# Tender Package 纳入 docx / xlsx —— 可引用单元（Referenceable Units）

**背景**：2026-08-16 真实包 `08-28 Student Housing Furniture` 上传 12 个文件，只有 3 个 PDF 进入
Package AI；被排除的 9 个里包含 **Master Agreement 模板（docx）** 与 **4 张报价表（xlsx）**——
对投标判断分量最重的两类材料。

**为什么原来排除**：V2 的证据纪律要求每条结论都能落回可核验的定位单元
（`documentId + 单元序号 + 逐字原文`）。docx/xlsx 没有页，早期实现宁可少分析也不编造
"第 3 页"（用户点进去会落空）。本次不是放宽纪律，而是**给非 PDF 造真实单元**。

`SCHEMA_CHANGE = ADDITIVE`（`ProjectDocumentPage` 增 2 列）。

---

## 1. 单元模型

| 文件类型 | 单元 | 标签示例 | 切分规则 |
| --- | --- | --- | --- |
| pdf | page | （沿用页码） | 不变 |
| xlsx / xls / csv | sheet | `Sheet「Category A Pricing」· 行 41–80` | 一表一单元；超长按行切，**每块重复表头** |
| docx / txt | block | `§ 2. PAYMENT TERMS · 第 3 段` | 段落聚块（目标 2.4k 字符），标题处优先断开，标签带最近标题 |
| doc（旧二进制） | — | — | **仍排除**：无可靠文本抽取器，不产出无法核验的内容 |

硬上限：单文档 ≤ 120 单元、单单元 ≤ 6000 字符；整包上限由 200 提到 **400**
（分片续跑后时间不再是约束，该上限只兜 DB/LLM 成本）。

**每块重复表头**是刻意设计：报价表被单独引用时，`1,Bedroom desk,120` 这一行必须自带
`Item,Description,Qty` 才有意义，否则数字失去列语义。

## 2. 引用链（关键：绝不显示假页码）

```
ProjectDocumentPage{pageNumber=单元序号, unitKind, unitLabel}
  → AnalyzerInput.pages[].unitKind/unitLabel
  → 抽取 prompt：`=== documentId X UNIT 3 (sheet: Sheet「Pricing」· 行 41–80) ===`
     （PDF 仍是 `PAGE 3`；模型看到的定位与真实文件结构一致）
  → 证据硬门不变：snippet 必须逐字出现在该单元内
  → TenderAnalysisSourceRef.sectionLabel = 单元标签
  → serializeSourceRef → locationLabel = `文件名 · Sheet「…」`（**不再拼 p.N**）
  → Analyst evidenceIndex.unitLabel → 证据抽屉同样显示单元标签
```

## 3. 触发面（4 处 PDF-only 闸门改为可分析类型）

`package.ts`（包文档筛选）/ `package-ready.ts`（就绪门）/ `package-coverage.ts`（覆盖率）/
`enqueue.ts`（上传即入队）统一走新的 `isAnalyzableFileType`。
覆盖率排除文案随之改为「格式不支持逐条溯源（如旧版 .doc / 图片）」。

`PARSE_VERSION` 升 `tender-page-parse-v1 → v2`：既有文档在下次 ENSURE_PAGES 时按新语义
重解析（worker 的"已解析则跳过"判定以该版本为准），无需手工 backfill。

## 4. 验证

**纯逻辑** `document-units.test.ts` — **39/39 PASS**（已注册 test-all / test-ci-unit）
- UNIT-01..05 表格：一表一单元、超长按行切、每块重复表头、行区间连续无空洞
- UNIT-06..10 文档：段落聚块、标题识别（含 `2. PAYMENT TERMS` 这类带尾点编号）、超长段切分
- UNIT-11..13 边界：空输入零单元、单文档上限截断、近空单元标记
- **UNIT-14 可核验性：每个单元的每一行都能在原文里逐字找到**（否则证据硬门会全量拒收）
- DECODE-01..06 **真实 xlsx buffer**（XLSX.write 生成，非 mock）解码 → sheet 单元；csv/txt 分流；
  旧 `.doc` 明确报不支持

**隔离库集成** `scripts/tender-v2-resumable-isolated-e2e.ts` — **24/24 PASS**（临时 Neon 分支，跑完已删）
新增 A7 组，端到端钉死"不显示假页码"：
- 抽取 prompt 对 xlsx 出现 `UNIT 1 (sheet: Sheet「Category A Pricing」)`，不称 PAGE
- canonical `TenderAnalysisSourceRef.sectionLabel = Sheet「Category A Pricing」`
- 引用原文 `1,Bedroom desk,120` 逐字可核验（通过证据硬门）
- `serializeSourceRef().locationLabel = "Appendix C - Pricing Form.xlsx · Sheet「Category A Pricing」"`，
  且断言**不含 `p.N`**

**回归**：36 个 tender 套件全绿（含按新契约更新的 package-coverage / package-ready /
package-fingerprint 三处旧断言）；migration 双治理门 `check-release-safety` 27/27、
`verify-migration-history` 55/55；`tsc` 0 error；eslint baseline PASS；`next build` 成功。

## 5. 影响与债

| 项 | 说明 |
| --- | --- |
| 成本/时长 | 同一个包的窗口数会显著上升（Master Agreement 一份就可能几十块）。分片续跑保证能跑完，但单包耗时与模型调用数会成倍增长——首个真实包建议看 `[tender-v2-resumable]` 日志确认 tick 数。 |
| D1 | 表格语义仍是"CSV 文本"，未做结构化数量提取（报价表 → 预算/成本的自动映射属独立课题）。 |
| D2 | 旧二进制 `.doc`、扫描件 PDF（OCR_REQUIRED）仍在排除面，覆盖率卡片会如实标注。 |
| D3 | docx 的标题识别是通用启发式（不读 OOXML 样式），复杂排版下段落标签可能不精确；引用本身仍可核验（逐字原文 + 段序号）。 |
| D4 | `pageCount` 对非 PDF 现在存的是**单元数**；文件卡片若展示"N 页"会不准确（已在引用链修正，文件列表文案留作后续小修）。 |

## 6. 上线

**本 PR 带迁移**（`20260816060000_add_document_page_unit_metadata`，additive-only：两列，
既有行默认 `unitKind='page'`，语义与迁移前一致）。上线顺序：

1. 生产库 `scripts/safe-migrate-deploy.ts`（双 env 闸）
2. 部署代码
3. 对已有招标项目**重新触发一次分析**，新 run 会按 `PARSE_VERSION=v2` 重解析并纳入 docx/xlsx

**回滚**：revert 代码即可（列留着不影响旧代码；旧代码读不到 unitKind/unitLabel 也不会报错）。
若需彻底回退解析语义，把 `PARSE_VERSION` 改回 v1 即可让文档重解析回旧形态。
