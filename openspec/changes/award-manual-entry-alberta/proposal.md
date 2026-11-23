# Proposal：Alberta 授标的人工录入（CHAIN-1b）

TASKFLOW：CHAIN-1b（新增一行；Phase F（续）— 情报串联；CHAIN-1 前置核查不通过后的人工路线，见 `docs/QINGYAN_CHAIN-1_PRECHECK.md` §3 第 2 条及其更正；Lucas 2026-11-20「做 Alberta 授标的人工录入表单。来源标成人工录入、带 APC 公告链接、信任级为待复核，不进 SYSTEM_VERIFIED，不碰 APC 网站」）。不触碰 muse-bridge，无受影响的 Muse 意图。

## Why

APC 对程序化访问有人机验证，CHAIN-1 不能自动读取 Alberta 授标；现有入口只能确认 CanadaBuys 检索结果，带编号确认时一律记成 CanadaBuys 来源，人在 APC 上看到的 Alberta 中标没有地方如实录进来。

## What Changes

- 新增「历史中标」页上的「录入 Alberta 授标（APC）」表单：采购方、中标方、APC 公告链接必填；招标编号、授标日期、合同金额与币种、范围摘要选填。只对本组织有效成员（组织角色不低于 `org_member`；平台超级管理员按既有规则）显示与开放。
- 新增录入接口 `POST /api/organizations/{组织}/tender-awards/manual`：校验后经既有授标写入服务落一条授标记录——来源类型「人工录入」（`USER_ENTRY`），来源链接为 APC 公告链接，信任级「待人工复核」（`NEEDS_REVIEW`），可信度中；不会落为 `SYSTEM_VERIFIED`。
- 收紧授标写入的一条匹配（Lucas 2026-11-20 GATE）：按「中标方 + 授标日期 + 金额」挂到既有时，两边都有招标编号且不同就不挂，新记录标为疑似重复等组织管理员裁决（对所有写入方生效）；这样的记录不止一条时指向最早建档的那条。
- 疑似重复不被人工确认的写入悄悄转正（2026-11-23 交叉验证 F1）：项目里人工确认或项目结果回灌按编号挂到一条疑似重复上时，只升信任级、不改状态，仍由组织管理员裁决（对所有写入方、所有疑似重复生效）。
- 只认 APC 公告链接 `https://purchasing.alberta.ca/posting/AB-年份-编号`（Lucas 给的样例 `AB-2026-07664`），统一存成一种写法。
- 处理重复：同一条公告的同一个中标方再录 → 不重复建（被撤回过的可以重录）；与已有记录招标编号和中标方相同、或编号没对上而中标方授标日期金额都相同 → 把链接挂到那条记录上，说明是哪种相同、那条记录的内容与可信度不变；疑似重复 → 照既有规则等管理员裁决。
- 写审计：录入写一条审计，含提交的全部字段。
- 校验 APC 公告链接（形状见上）；系统只保存这个链接，SHALL NOT 打开、请求或解析它。
- 修改「历史中标」列表的来源显示：人工录入的记录显示「人工录入 · APC 公告」与那条链接（人点开，系统不访问）、范围摘要；复核仍走既有的组织管理员「确认属实 / 撤回」。
- 修改「历史中标」统计条：「AI 待确认」改为「待确认（AI 提取 / 人工录入，不计入统计）」，「待复核（不计入统计）」改为「疑似重复待裁决（不计入统计）」。
- 修改组织管理员提示与空状态：提到人工录入。
- 新增采购方候选：列表接口给能录入的人返回调用人看得到的本组织招标项目与已有授标里的采购方写法（按规整名去重）。
- 跟随授标情报开关：`T4_AWARD_INTELLIGENCE_SCHEMA_READY` 没开时，表单不出现，接口 409 `组织授标情报尚未启用` 且不访问授标表（与既有处理接口一致）。

## Out of scope

- 不访问、不抓取 APC 或任何 Alberta 网站，不下载公告附件（硬纪律第 5 条；CHAIN-1 前置核查结论不变）。
- 不改 `SYSTEM_VERIFIED` 的白名单（判断点 2 的授权仍未用上）；不改授标确认 / 撤回的规则与入口。
- 不做批量导入（CSV）与其它省份的录入（表单只为 Alberta APC；其它省份另立 change）。
- 不改「历史授标与采购」阶段的材料推导（`AWARD_RECORDS`）。
- 不新增开关（跟随既有授标情报开关）。

## Capabilities

### New Capabilities

- `tender/award-manual-entry`：Alberta 授标的人工录入——入口与权限、校验、落库口径、撤回后重录、不访问 APC、结果说法、列表里的来源显示、审计。

### Modified Capabilities

- `tender/award-records`：修改「不同招标编号不判疑似重复」写明例外（日期与金额也相同时仍标为疑似重复）；新增「按日期金额挂到既有时不跨不同的招标编号」（Lucas 2026-11-20 GATE「收紧」）与「人工确认的写入不让疑似重复转正」（2026-11-23 交叉验证 F1）；都对所有写入方生效。`tender/award-review` 的确认 / 撤回规则原样适用于人工录入的记录。

## Impact

- 新增：`src/lib/tender-intel/award-manual-entry.ts`（纯函数：校验与规整、结果说法、固定文字；页面也用，不依赖 node 模块）、`src/lib/tender-intel/award-manual-entry-key.ts`（来源键，服务端）、`src/app/api/organizations/[orgId]/tender-awards/manual/route.ts`、`src/components/tender-intel/award-manual-entry-form.tsx`（表单）。
- 修改：`src/lib/tender-intel/awards.ts`（强匹配第二条路径不跨不同的招标编号、候选按建档先后排；挂到疑似重复时不改状态）、`src/lib/tender-intel/own-result-backfill.ts`（未中标回灌挂到疑似重复时结果为 `needs_review`，一处条件）、`src/app/api/org/tender-awards/route.ts`（返回 `canEnterManual`、人工录入记录的 APC 链接、采购方候选）、`src/app/(main)/projects/intelligence/awards/page.tsx`（表单、来源显示、统计条、提示）。
- 测试：`src/lib/tender-intel/__tests__/` 新增纯函数测试与隔离库用例（注册进 `scripts/test-all.sh`、`scripts/test-ci-unit.sh`）。
- 零 schema、零依赖、零新增模型调用、零出站请求。
