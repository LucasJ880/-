# Proposal：中标者 → 进口线索 → 供货商候选（CHAIN-3）

TASKFLOW：CHAIN-3（Phase F（续）— 情报串联；任务书 `docs/QINGYAN_CHAIN_TENDER_INTEL_CHAIN_TASKBRIEF.md` 2026-11-19 13:05 修订版「CHAIN-3」）。核对基线：main `93ba6c8e`（CHAIN-2 已合并并归档之后）。判断点 3 取 A（先做人工导入，留好数据源接口）、判断点 7 取 A（汇总全部确定性，不调模型）（Lucas 2026-11-19「之后是 CHAIN-1、2、3……你全权负责」，按推荐）。

## Why

TI-3a 已有进口线索的契约（`LEAD_UNVERIFIED` 只能人工用 12 个月内的证据升级）与公司名三档比对，但没有任何数据进得来：用户在第三方网站查到「中标者从谁那里进口」，只能记在别处，系统里看不到，也变不成询价对象。

## What Changes

- 新增开关 `TENDER_IMPORT_LEADS_ENABLED`（默认关）+ `TENDER_IMPORT_LEADS_ORG_ALLOWLIST`。
- 新增人工导入：用户把在别处查到的进口记录（进口商、出口商、日期、品名、数量、来源网址）以 CSV 或从表格直接粘贴导入；表头整格认列，日期只认年在前的写法或用户为这一批选的「月/日/年」「日/月/年」；有问题的记录按原因归并报出，同批与已导入过的重复记录跳过；同一项目的导入不并发。系统不访问任何第三方网站。
- 新增数据源接口 `ImportLeadProvider`，现在只有「人工粘贴」一种实现；授权贸易数据来源照旧显示「未接通」。
- 新增匹配：把每行的进口商与本项目采购方的历史中标者（授标记录，剔除我方结果）按 TI-3a 三档比对——同名或已确认的别名自动挂上；「疑似同一家」列出来等人确认或否决（否决过的不再建议）；无关的不导入，只报行数。
- 新增落库：每条挂上或待确认的记录存为一条供应商发现信号（平台新增目录值 `TRADE_DATA`，来源「人工录入」），运单明细进信号的 JSON 位、存后不改；挂上 / 待确认 / 否决在读的时候按最新的人工裁决算；线索状态一律「线索，未证实当前供货」，界面固定显示 TI-3a 的线索说明。
- 新增别名裁决：「疑似同一家」由能修改本项目的人确认或否决，记在审计里（每一对一条，对本组织所有项目生效；已裁决的再裁决返回 409）。
- 新增确定性汇总：按出口商列出票数、近 12 个月票数、最近一票日期、是否超过 12 个月、品名与本标已确认要求的关键词重合、对应哪个中标者；按近 12 个月票数排序；不调模型、不打「推荐」标签。
- 新增「加入供应商库」：一键为出口商建供应商（来源 `trade_data`；同名已在库里的按固定规则关联一家，已停用的照实说）；线索经既有的「关联供应商」流程关联过去；提单数据通常没有邮箱，缺邮箱就停在这一步、提示去补，系统不去网上找邮箱。建好后出现在询价入口的供应商列表里。
- 修改其它页面的显示：供应商来源 `trade_data` 显示为「进口线索」（供应商页、列表、筛选）；这类线索在供应链页的信号列表里显示平台「进口记录（人工导入）」，不带「找厂优先级」。
- 修改情报页签「供应链情报」槽：开关打开时从规划占位改为真实内容（线索摘要 + 展开的导入与汇总面板）。

## 受影响的 Muse 意图

不改 `src/lib/muse-bridge/**`，所有意图不涉及。

## Out of scope

- 接任何授权贸易数据 API（判断点 3 B；要付费授权、合同须允许程序化使用）——只留接口。
- 访问、抓取或解析任何第三方网站或页面（含用户贴进来的来源网址：只存原文，不打开）。
- 为出口商画像或调模型（判断点 7 B）。
- 去网上找出口商的邮箱或联系方式。
- 把线索升级为「已确认当前供货」的界面（TI-3a 的 `confirmCurrentSupply` 规则不变，本次不做入口）。
- 自动把进口线索的供应商并进自动起草的收件人（判断点 4 B 的条件是「首选 / 备选、强制闸通过」：他们照旧要先在供应链页评估，才可能经 CHAIN-2 的情报推荐进入）。**与任务书验收项的出入**：任务书写「加入供应商库并补邮箱后，下一次起草询价的卡上它出现在收件人里，来源写『进口线索』」——本次做到的是：它出现在询价入口的供应商列表里、来源显示「进口线索」，人勾选后进卡；自动起草不自动加它（见 design D4b）。
- 投标准备度「进口线索」阶段的判定（`tender-bid-readiness/stage-policy.ts`）。

## Capabilities

### New Capabilities

- `tender/import-leads`：进口记录的人工导入、与历史中标者的匹配、线索的存放与确定性汇总、加入供应商库、情报页签的供应链槽。

### Modified Capabilities

无（`tender/competition-leads` 的线索契约、名称比对、来源状态原样复用，不改它的要求）。

## Impact

- 新增：`src/lib/tender-import-leads/`（开关、解析、数据源接口、匹配与汇总纯函数、服务）；`src/app/api/projects/[id]/tender-intel/import-leads/`（读 / 导入、别名裁决、加入供应商库三个接口）；`src/components/tender-intel/import-leads-panel.tsx`。
- 修改：`src/lib/tender-intel/sourcing-suggestions.ts`（把「本采购方的他人授标、剔除我方结果」导出为 `listOthersAwardsForBuyer`，寻源建议与本功能共用，行为不变）、`src/lib/supplier-intel/constants.ts`（`SIGNAL_PLATFORMS` 加 `TRADE_DATA`）、`src/lib/supplier-intel/workspace-labels.ts`（平台名称）、`src/lib/supplier-intel/discovery-priority-service.ts`（这类线索不算找厂优先级）、`src/lib/inquiry/types.ts` 与 `src/app/(main)/suppliers/` 下四处来源名称表（`trade_data`「进口线索」）、`src/components/tender-intel/org-award-intel-slots.tsx`（供应链槽）。
- 不新增依赖；零 schema（信号与供应商用既有表，线索明细进 `SupplierDiscoverySignal.rawMetadataJson`，别名裁决进 `AuditLog`）。
