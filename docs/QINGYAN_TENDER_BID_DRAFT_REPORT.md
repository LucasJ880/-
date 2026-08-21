# 投标文件起草实施报告（Lane 5 · tender-bid-draft/v1）

日期：2026-08-21 · 分支 `feature/tender-bid-draft-stacked`（**堆叠于 feature/tender-rfi-export / PR #147**，复用其 `htmlOverride` 文档链）· SCHEMA_CHANGE = NONE

## 1. 目标

从「分析 → 矩阵 → 备忘录」走到「产出」：按 RFQ 提交结构生成**英文提交稿草案 + 中文审阅注**，
逐条合规响应直接吃合规矩阵的人工标注，公司资质只能来自可核依据。

## 2. 结构

- **`tender-bid-draft/contract.ts`**：五态 → 合规状态（HAVE 合规 / BUILD 授标后合规 / PARTNER 经合作方 /
  RFI 已提澄清 / NO_GO 内部未满足 / **未标 → TO_CONFIRM 占位，绝不默认合规**）；zod 逐项预处理硬化。
- **`gather.ts`**（只读装配）：run 要求（含矩阵标注）/事实/关键事实/分析综合/提交清单；房间备忘录
  （内部，不直引）、报价输入（只引人工价，不编）、**竞对/现任名称剔除名单**；组织品牌档案（含禁用语）、
  **企业记忆仅 HUMAN_CONFIRMED/SYSTEM_VERIFIED 事实**、**我方中标记录（own-result）**。
- **`synthesize.ts`**：prompt 硬规则（能力只来自依据、不编价、不提竞对、占位格式、无 GO/NO-GO）；
  后处理三道闸：每条要求必有响应（LLM 漏的按状态补占位/标签）、提交面竞对名称替换为
  `[a third-party supplier]`、品牌禁用语替换为占位——命中均写入中文内部注。失败 → null 不写半成品。
- **`render.ts`**：AI DRAFT 红色横幅、占位 `<mark>` 高亮、合规响应表（MANDATORY 标、待确认行底色）、
  中文内部审阅注与矩阵对照（提交前删除）。
- **接线**：docType `bid_draft`（GenerateDocType / DOC_TITLES / PROJECT_PDF_DOC_TYPES / 菜单）；
  generate-docs 分支 装配→合成→渲染→`htmlOverride`→Chromium PDF，元信息落 `room.summaryJson.bidDraft`；
  `GET /api/projects/[id]/bid-draft` 元信息；工作台「投标文件起草」卡（显示矩阵已标比例、上次起草
  占位/待确认计数与内部注；提示先标矩阵再起草）。

## 3. 证据

- 纯平面 bid-draft **11/11**（已注册）：五态映射 / schema 硬化 / 覆盖补齐 / 竞对剔除反例 / 禁用语反例 /
  占位计数 / 失败不半成品 / 渲染 / prompt 硬规则反例 / 四处注册 / 依据限定。
- **真实 E2E 8/8**（生产只读 + 真实模型，零写入）：Halifax 120 条要求 → 合成 41s 一次调用 →
  120/120 响应；矩阵 0 标 → 120 条 TO_CONFIRM、190 处占位（不默认合规）；提交面零 Meltwater；
  报价摘要无金额、引用 Bid Form；**内部注第一条即指出组织资料（窗饰业务）与媒体监测项目不匹配、
  未提供平台能力**——不编造纪律在真实数据上成立。
- tsc 零错；eslint 零告警。

## 4. 对 Halifax 的实际含义

起草可用，但产出质量取决于三样人工输入：① 合规矩阵先标（未标 = 占位）；② 组织档案/企业记忆里要有
媒体监测相关能力或合作方信息（目前只有窗饰）；③ 报价表助手里填我方价。缺这三样，草稿就是一份
「诚实的占位骨架」。

## 5. Gate

```
BID_DRAFT_SCHEMA_CHANGE = NONE
BID_DRAFT_AI_BOUNDARY   = 能力仅限依据 / 不编价 / 不提竞对 / 未标不默认合规 / 无 GO-NO-GO（三道后处理闸）
BID_DRAFT_PURE_SUITES   = 11/11
BID_DRAFT_REAL_E2E      = PASS 8/8（120/120 响应；0 标 → 120 占位；零竞对名；无金额）
BID_DRAFT_STACKED_ON    = PR #147（先合 #147，再合本 PR）
BID_DRAFT_STATUS        = READY_FOR_FINAL_REVIEW（Draft PR，不 merge）
```
