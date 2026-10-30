# Proposal: sunny-process-order-autogen

**TASKFLOW：** 无（Sunny FDE 业务线，不在 Muse 招投标主线；不改 `docs/QINGYAN_MUSE_BRIDGE_TASKFLOW.md`）。
**受影响的 Muse 意图：** 无。本 change 不触碰 `src/lib/muse-bridge/**`。
**口径来源：** Lucas 2026-10-27 提供的 5 份 Excel 原件（SHA-256 见 design.md D1）+ 同日 AskUserQuestion 四项拍板：
Lift L/R = 普通拉绳、M = 电动；罩盒按默认映射且草稿可改；自动生成的工艺单为草稿、工厂核对后确认；窗帘 6cm/7cm 两版都支持、默认 6cm。
同日第二、三轮拍板（附 3 张真实订单 G0927 梦幻帘 / G1024 蛇形 / G1025 韩褶）：无绳 / 电动不计拉绳米数；Fascia 罩盒维持默认；建可编辑的「报价 SKU → 布:纱」对照表；多开一个按钮把自产行一键发给国内（按销售写的直接生成，交外采购）；Wooden 百叶（S/G/M/Casing 外框）、打孔窗帘、4-1/2" / Arch 百叶按销售写的直接生成外采购单；窗帘成品高改用真实订单里的新版公式（6cm / 7cm 都改）；所有窗帘成品帘子高默认再减 2cm（韩褶与蛇形一样）。

## Why

销售报价单客户签字（销售现场「生成订单」或客户线上签字）后，工厂今天要把 Order Form 重新手抄进 5 份 Excel 才能出工艺单，而系统现有 Blinds 工艺引擎只覆盖卷帘/斑马/香格里拉、且与原件有出入（拉绳分档阈值、斑马帘非 3:2 布纱比、双轨件数）。本 change 让签字即生成草稿工艺单，四类工艺计算与 Excel 原件逐值对照一致。

## What Changes

- 修正 Blinds（卷帘/斑马帘/香格里拉）工艺引擎，使罩盒/38管/下杆/圆芯杆/面料宽长/插片/拉绳分档/斑马帘裁剪位/裁剪数量/A·B·C 切割类与《Blinds 工艺单_圆盒侧盖加厚标准版》第 1 窗位模板公式逐值一致；斑马帘裁剪位支持任意布纱比。
- 新增窗帘（Drapes/Sheer）工艺引擎：6cm / 7cm 两版蛇形帘与韩褶工艺，输出成品宽高(cm)、韩褶上端宽、走珠颗数、走珠扣类型与物料汇总（杆子/布料/走珠布袋/安装码/韩褶走珠）；成品高按新版原件（cm 扣减 + 四舍五入），成品帘子高 = 成品高 − 2cm（拍板）。
- 新增 Vinyl 百叶窗工艺引擎：按《Vinyl shutters 工艺单 AIV1》计算内空、成品扇宽高、上/中/下百叶片数、孔距、直柱/横档/中分档/百叶片/控制杆/T柱/挂柱/外框/框内横料长度与数量与角度、切分与双中分档；输出下料总表（同料同长合并、料型顺序与长度降序）与每扇 + FRAME 标签。
- 新增国内下单表生成（蜂窝帘 / 梦幻帘 / 罗马帘等外购帘）：英寸转厘米、平方米、标签行。
- 新增「报价单 → 工艺单」映射：从已签字报价的 Order Form（formDataJson）推导四类工艺输入，所有默认推导项写入「待核对」清单。
- 新增外采购单：Wooden 百叶（含 S/G/M/Casing 外框）、4-1/2" / Arch 百叶、打孔窗帘与没有工艺模板的帘子按销售填写原样生成外采购行，不阻断确认，导出为「外采购单」。
- 新增「发给国内 / 退回自产」：草稿工艺单内把自产 Blinds 行按销售写的原样移到国内下单表（单行或全部），或把国内下单表里的卷帘 / 斑马帘 / 香格里拉退回自产；只挪行，不对外发送。
- 新增斑马帘「面料编码 → 布:纱」对照表：组织级、可编辑（页面 `/blinds-orders/zebra-ratios`），以原件 Sheet1 备注为种子；生成与退回自产时查表，查不到默认 3:2 并提示。
- 新增签字后自动生成：`mark-signed` 与公开签字两条路径在报价置为 signed 后生成一张 draft 工艺单（幂等：同一报价只生成一次），并给报价创建人发站内通知；生成失败不阻断签字。
- 新增确认门禁：工艺单从 draft 转 confirmed 前，存在阻断级「待核对」项（如 Vinyl 缺外框类型、开合编码与扇数不符）时拒绝转换并列出原因。
- 扩展工艺单导出：同一个 xlsx 按实际存在的产品线输出 Blinds 三表 + 标签、国内下单表、窗帘工艺单 + 物料、Vinyl 工艺单 + 下料总表 + 标签、待核对清单。
- 扩展工艺单详情页：显示来源报价、待核对清单，以及国内下单 / 窗帘 / Vinyl 三段可编辑参数与实时计算结果。
- 新增对照检验：`scripts/sunny-process-oracle/` 用 LibreOffice 打开 Excel 原件回填输入重算，生成金标准夹具；`src/lib/sunny-process/__tests__/*.test.ts` 用夹具逐值比对引擎并注册进 `scripts/test-all.sh`；另以 3 张真实订单做回归（按销售填写值重算，与工厂收到的单逐值比对）。

## Capabilities

### New Capabilities
- `sunny/process-order-engines`：Sunny 四类工艺计算（Blinds / 国内下单 / 窗帘 / Vinyl）与 Excel 原件逐值一致的计算契约及对照检验机制。
- `sunny/process-order-autogen`：已签字报价自动生成草稿工艺单、待核对清单、确认门禁、导出与详情页呈现。

### Modified Capabilities
（无。`openspec/specs/` 下仅有 `qa/test-registry`，本 change 只新增注册条目，不改其 Requirement。）

## Impact

- `src/lib/blinds/calculation-engine.ts`、`deduction-rules.ts`、`excel-export.ts`（Blinds 引擎修正与导出扩展）。
- 新目录 `src/lib/sunny-process/`（窗帘 / Vinyl / 国内下单引擎、报价映射、自动生成服务、待核对、工作簿生成）。
- `src/app/api/sales/quotes/[quoteId]/mark-signed/route.ts`、`src/app/api/sales/quotes/share/[token]/sign/route.ts`（签字后调用生成）。
- `src/app/api/blinds-orders/[id]/transition/route.ts`（确认门禁）、`[id]/export/route.ts`（导出 + 补可见性校验）、新增 `[id]/spec/route.ts`（读写非 Blinds 工艺参数）。
- `src/app/(main)/blinds-orders/[id]/page.tsx` 与新组件；`src/app/(main)/sales/quote-sheet/page.tsx` 成功提示带工艺单链接。
- 新增 `src/app/api/blinds-orders/[id]/move-lines/route.ts`（发给国内 / 退回自产）、`src/app/api/sunny-process/zebra-ratios/route.ts` 与页面 `src/app/(main)/blinds-orders/zebra-ratios/page.tsx`（布纱比对照表）。
- `scripts/test-all.sh` 新增注册条目；新目录 `scripts/sunny-process-oracle/`（Python + LibreOffice，仅离线生成夹具，CI 不依赖）。
- 数据：零 schema。工艺单头与 Blinds 行用既有 `BlindsOrder` / `BlindsOrderItem`；非 Blinds 工艺参数（含外采购行）与报价关联写 `AuditLog`（append-only 版本）；布纱比对照表写 `Organization.settingsJson.sunnyProcess.zebraRatios`（每次保存记 `AuditLog`）；通知写 `Notification`。

## Out of scope

- 不做 Wooden（实木）百叶、Grommet（打孔）窗帘、4-1/2" 与 Arch 百叶的工艺计算：原件没有对应模板，按销售填写原样进外采购单（拍板），不阻断。
- 「发给国内」不自动发送给国内供应商或外采购：仍由人导出国内下单表 / 外采购单后自行下单（硬纪律 2）。
- 不复刻 Excel 的窗型示意图（`窗型示意` / `绘图数据` 隐藏表）、打印宏（`print_*.cmd`）与窗帘结算单金额区。
- 不改报价单 Order Form 的录入字段与报价计价逻辑（`pricing-engine` / `sunny-quote.html` 不动）。
- 不做面料库存预留、生产排程、安装预约联动；工艺单状态机其余转换不变。
- 不改 `BlindsOrder` 无 orgId 的既有可见性模型（admin 全见、其余按项目/创建人）。
- 不在本 change 内 archive；PR 合并后另开小 PR。
