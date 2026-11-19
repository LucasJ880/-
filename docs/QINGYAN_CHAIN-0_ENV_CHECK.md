# CHAIN-0 开关核查与提速 — 核查表（待填）

任务书：`docs/QINGYAN_CHAIN_TENDER_INTEL_CHAIN_TASKBRIEF.md`「CHAIN-0」。TASKFLOW：Phase F（续）— 情报串联 · CHAIN-0。
本表由有 Vercel 生产权限的人填写；不写代码。骨架 2026-11-19 入库（main `15bb79c`），「代码里怎么读」一列已逐条在代码里核对，**「原值 / 新值 / 日期」三列空着，等人填**。

## 填写顺序

先 1–6，验证通过后再等 CHAIN-4b（`rfq-supplier-identity-guard`）合并，才动第 7 项。改完任何一项都要重新部署生产才生效。

| # | 环境变量 | 代码里怎么读（已核对） | 建议值 | 原值 | 新值 | 日期 |
|---|---|---|---|---|---|---|
| 1 | `WORKFORCE_CONTINUATION_SELF_TRIGGER_URL` | 去首尾空白后须以 `http://` 或 `https://` 开头，否则视为未配置（关）；末尾 `/` 被去掉（`workforce-runtime/self-trigger.ts:40-47`）。**另外要求 `CRON_SECRET` 非空**，否则同样不触发（`self-trigger.ts:61`） | `https://qingyan.ca`（生产主域；不能是 `.vercel.app`，后者会被 SSO 302，见 `docs/QINGYAN_TENDER_OBS_P1_LATENCY_REPORT.md` §2 / §5 第 1 条） | | | |
| 1a | `CRON_SECRET` | 第 1 项的前提，只确认存在，不改 | 保持现值 | （只记「存在 / 不存在」） | — | |
| 2 | `WORKFORCE_JOB_MAX_PARALLEL_TASKS` | 空 / 非数字 → 1；取整后夹在 1–4（`workforce-runtime/parallel.ts:37-48`） | 先 `2`，观察一单再定是否到 `3` | | | |
| 3 | `TENDER_EXTERNAL_INTEL_ENABLED` | 去首尾空白后**必须恰好等于 `1`**；`true` / `on` / `yes` 都算关（`tender-intel/canadabuys.ts:20-22`）。注意：本仓库其它开关多数认 `1/true/on/yes`，唯独这一项只认 `1` | `1` | | | |
| 4 | `T4_AWARD_INTELLIGENCE_SCHEMA_READY` | 认 `1 / true / on / yes`（不分大小写）（`tender-intel/award-flags.ts:26-40`）。前提：生产库已应用迁移 `20260814150000_add_tender_t4_award_record_foundation`（`award-flags.ts:10`、`docs/QINGYAN_TENDER_T4_INTELLIGENCE_P1_REPORT.md`） | 迁移核对后设 `1` | | | |
| 5 | `TAVILY_API_KEY` | 与第 3 项同为外部检索的两道门；缺任一项，供应商发现只走内部来源（`supplier-intel/discovery-service.ts:237-243`） | 确认存在（只记「存在 / 不存在」，不抄值） | | — | |
| 6 | `SUPPLIER_INTEL_ENABLED` + `SUPPLIER_INTEL_ORG_ALLOWLIST` | 主开关认 `1 / true / on / yes`；白名单逗号分隔组织 id，**为空 = 对所有组织生效**（`supplier-intel/flags.ts:19-38`） | 主开关 `1`；白名单填 Sunny 的组织 id（不能留空，否则全组织生效） | | | |
| 7 | `TENDER_RFQ_AUTO_DRAFT_ENABLED`、`TENDER_RFQ_SUPPLIER_GROUPS_ENABLED`、`TENDER_RFQ_FOLLOWUP_PREAPPROVAL_ENABLED`（各自 `*_ORG_ALLOWLIST`） | 均认 `1 / true / on / yes`；白名单为空 = 所有组织（`tender-rfq/auto-draft-flags.ts`、`supplier-groups-flags.ts`、`followup-flags.ts`） | **CHAIN-4b 合并之后**再开 | | | |

## 验证（每项写下证据：项目 / 时间 / 看到的值）

| 项 | 怎么看 | 目标 | 实测 |
|---|---|---|---|
| 第 1 项 | 下一单分析的事件里，`job.queued(yielded=true)` 到下一次 `job.claimed` 的间隔 | ≤ 15 秒（原约 2 分钟） | |
| 第 1–2 项 | 一份 150 页以上标包从上传到分析完成的总耗时 | ≤ 20 分钟（OBS-P1 首单 163 页 35.6 分钟） | |
| 第 3–5 项 | 用 TBS 24062-27-057 跑一次：项目情报室 `summaryJson.externalIntelStatus.status` 与 `awardCandidates` 计数 | `status = "ran"`，`awardCandidates` 有计数 | |
| 第 6 项 | Sunny 的项目上能从界面发起供应商情报 run；其它组织看不到入口 | 只对 Sunny 生效 | |

## 不在本表处理

- 扫描版 PDF 的 `OCR_REQUIRED` 页读不出文字（影响读全，不影响速度）：见任务书后续队列 CHAIN-6。
