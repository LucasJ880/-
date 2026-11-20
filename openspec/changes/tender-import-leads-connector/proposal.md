# Proposal：中标者 → 进口线索 → 供货商候选（CHAIN-3）

TASKFLOW：CHAIN-3（Phase F（续）— 情报串联；任务书 `docs/QINGYAN_CHAIN_TENDER_INTEL_CHAIN_TASKBRIEF.md` 2026-11-19 13:05 修订版「CHAIN-3」）。核对基线：main `93ba6c8e`（CHAIN-2 已合并并归档之后）。判断点 3 取 A（先做人工导入，留好数据源接口）、判断点 7 取 A（汇总全部确定性，不调模型）（Lucas 2026-11-19「之后是 CHAIN-1、2、3……你全权负责」，按推荐）。

## Why

TI-3a 已有进口线索的契约（`LEAD_UNVERIFIED` 只能人工用 12 个月内的证据升级）与公司名三档比对，但没有任何数据进得来：用户在第三方网站查到「中标者从谁那里进口」，只能记在别处，系统里看不到，也变不成询价对象。

## What Changes

- 新增开关 `TENDER_IMPORT_LEADS_ENABLED`（默认关）+ `TENDER_IMPORT_LEADS_ORG_ALLOWLIST`。
- 新增人工导入：用户把在别处查到的进口记录（进口商、出口商、日期、品名、数量、来源网址）以 CSV 或从表格直接粘贴导入；系统逐行解析，缺列、日期认不出、缺出处的行逐行报错，同批与已导入过的重复行跳过。系统 SHALL NOT 访问任何第三方网站。
- 新增数据源接口 `ImportLeadProvider`，现在只有「人工粘贴」一种实现；授权贸易数据来源照旧显示「未接通」。
- 新增匹配：把每行的进口商与本项目采购方的历史中标者（授标记录，剔除我方结果）按 TI-3a 三档比对——同名或已确认的别名自动挂上；「疑似同一家」列出来等人确认或否决（否决过的不再建议）；无关的不导入，只报行数。
- 新增落库：每条挂上的记录存为一条供应商发现信号（平台新增目录值 `TRADE_DATA`），运单明细进信号的 JSON 位；线索状态一律「线索，未证实当前供货」，界面固定显示 TI-3a 的线索说明。
- 新增确定性汇总：按出口商列出票数、近 12 个月票数、最近一票日期、是否超过 12 个月、品名与本标已确认要求的关键词重合、对应哪个中标者；按近 12 个月票数排序；不调模型、不打「推荐」标签。
- 新增「加入供应商库」：一键为出口商建供应商（来源 `trade_data`；同名已在库里的直接关联）；提单数据通常没有邮箱，缺邮箱就停在这一步、提示去补，系统不去网上找邮箱。建好后出现在询价入口的供应商列表里。
- 修改情报页签「供应链情报」槽：开关打开时从规划占位改为真实内容（线索摘要 + 展开的导入与汇总面板）。

## 受影响的 Muse 意图

不改 `src/lib/muse-bridge/**`，所有意图不涉及。

## Out of scope

- 接任何授权贸易数据 API（判断点 3 B；要付费授权、合同须允许程序化使用）——只留接口。
- 访问、抓取或解析任何第三方网站或页面（含用户贴进来的来源网址：只存原文，不打开）。
- 为出口商画像或调模型（判断点 7 B）。
- 去网上找出口商的邮箱或联系方式。
- 把线索升级为「已确认当前供货」的界面（TI-3a 的 `confirmCurrentSupply` 规则不变，本次不做入口）。
- 自动把进口线索的供应商并进询价收件人（他们照旧要先在供应链页评估，才可能经 CHAIN-2 的情报推荐进入）。
- 投标准备度「进口线索」阶段的判定（`tender-bid-readiness/stage-policy.ts`）。

## Capabilities

### New Capabilities

- `tender/import-leads`：进口记录的人工导入、与历史中标者的匹配、线索的存放与确定性汇总、加入供应商库、情报页签的供应链槽。

### Modified Capabilities

无（`tender/competition-leads` 的线索契约、名称比对、来源状态原样复用，不改它的要求）。

## Impact

- 新增：`src/lib/tender-import-leads/`（开关、解析、数据源接口、匹配与汇总纯函数、服务）；`src/app/api/projects/[id]/tender-intel/import-leads/`（读 / 导入、别名裁决、加入供应商库三个接口）；`src/components/tender-intel/import-leads-panel.tsx`。
- 修改：`src/lib/supplier-intel/constants.ts`（`SIGNAL_PLATFORMS` 加 `TRADE_DATA`）、`src/lib/supplier-intel/workspace-labels.ts`（平台名称）、`src/components/tender-intel/org-award-intel-slots.tsx`（供应链槽）。
- 不新增依赖；零 schema（信号与供应商用既有表，线索明细进 `SupplierDiscoverySignal.rawMetadataJson`，别名裁决进 `Organization.settingsJson`）。
