# Proposal：投标工作区的存取接口——价格表、拟投产品与证书、领取方名单、可投标判定、阶段清单、成本核算表

TASKFLOW：TI-4a（Phase F，Tender Intelligence Phase C 第一项；来源 `docs/tender-intelligence-gap-analysis.md` §6 的 N12 与 §7 方案甲）。依赖 TI-1、TI-2、TI-3a、TI-3b。审核：Lucas 2026-11-11 授权「其他你来主导，需要确定的按推荐做」，四件套不另等审核，实施后以 Draft PR 交付。

## Why

TI-1 至 TI-3b 交付的规则都是线上不可达的纯函数。要让核算表、阻断项和三张清单出现在项目页上，先得有一处能按项目存取这些输入并把结果算出来的接口。

## What Changes

- 新增开关 `TENDER_BID_WORKSPACE_ENABLED` 与组织白名单 `TENDER_BID_WORKSPACE_ORG_ALLOWLIST`，默认关；关闭时三个新接口一律 404，不读不写任何数据。
- 新增按项目存取「投标工作区」：价格表行项、每行的拟投品牌型号与产品尺寸、每行的证书、文件领取方名单、补遗。存在该项目情报室的既有 JSON 位下的一个新键里，不动数据库结构。
- 新增 `GET /api/projects/{id}/bid-workspace`：返回已存内容与由它算出的结果——价格表校验、逐行尺寸对照、逐行认证闸、文件领取方汇总、可投标判定、十三个阶段的决定与三张清单。项目读权限。
- 新增 `PUT /api/projects/{id}/bid-workspace`：整块或分块保存上述内容，逐字段校验，写审计。项目写权限。
- 新增 `POST /api/projects/{id}/bid-workspace/cost-sheet`：请求里带成本输入，返回核算表视图、Markdown 与带成本的可投标判定。**不保存成本输入。** 须有财务查看权。
- 保存时只改自己的那个键，同一 JSON 位里的其它内容原样保留。
- 新增纯逻辑测试与隔离库端到端测试。

## 受影响的 Muse 意图

无。不触碰 muse-bridge。

## Out of scope

- **不保存供应商报价与成本假设。** 该项目情报室的 JSON 位会被既有接口 `GET /api/projects/{id}/bid-intelligence` 整块返回给所有能读项目的人，成本数据放进去就绕过了财务访问规则。成本输入存在哪里（专用表，需要硬纪律第 1 条的例外；或并入报价引擎）留给 Owner 决定。
- 不做界面（TI-4b）。
- 不保存进口线索（下一批）；不识别截图，领取方名单由调用方给出。
- 不改既有接口：`bid-intelligence`、`pricing-helper`、`bid-fit`、报价引擎、询价都不动。
- 不新增权限键、审批类型、定时任务、模型调用；不做任何对外动作。
- 不从分析结果自动填充价格表行项（FIX-2）。

## Capabilities

### New Capabilities

- `tender/bid-workspace`：按项目存取投标工作区并返回由它算出的结果——开关、访问控制、保存规则、读取结果的构成、不落库的成本核算。

### Modified Capabilities

无。

## Impact

- 新增目录 `src/lib/tender-bid-workspace/` 与两个路由文件 `src/app/api/projects/[id]/bid-workspace/route.ts`、`…/bid-workspace/cost-sheet/route.ts`。
- 数据：`BidIntelligenceRoom.summaryJson` 下新增键 `bidWorkspace`；项目没有情报室时按既有写法建一行。不改表结构。既有接口 `GET …/bid-intelligence` 会把这个键连同其它内容一起返回——所以这个键里只放非财务内容。
- 新增环境变量两个，默认不设即关闭；`.env.example` 补说明。
- 新测试登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`（隔离库测试在没有隔离库时自动跳过）。
- 依赖无变化。
