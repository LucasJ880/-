# Design: sunny-process-order-autogen

## Context

- 现状：`/blinds-orders` 工艺单模块（`BlindsOrder` / `BlindsOrderItem`，规则版本 `blinds_20251024_v1`）只能手工录入卷帘/斑马帘/香格里拉；销售报价（`SalesQuote.formDataJson` 里的 Order Form：`shadeOrders` / `shutterOrders` / `drapeOrders`）签字后与工艺单之间没有任何连接。
- 原件（Lucas 2026-10-27 上传，SHA-256）：
  | 原件 | 用途 | SHA-256 |
  |---|---|---|
  | Blinds 工艺单_圆盒侧盖加厚标准版（20241007 新） | 卷帘/斑马/香格里拉 自产工艺 | `85d45d6277624e35091b5e433e828cdde4d58c103bbc2319f29c6a4d56871e0c` |
  | Blinds 国内下单表（斑马帘 卷帘 香格里拉帘 蜂窝帘 梦幻帘）1 | 外购帘下单 + 标签 | `32830359e00d273b0d35ad60dda36b2776673cf934051c9f601709a438cf1f90` |
  | 6cm 窗帘工艺单（Drapes and Sheer） | 窗帘 6cm 蛇形 / 韩褶 | `9ec1b57e7ba9f344757fc54e4fdbcefd2038a2c19e7542a181ed77508e1b0586` |
  | 7cm 窗帘工艺单（Drapes and Sheer） | 窗帘 7cm 蛇形 / 韩褶 | `acb309364313d09736f78d8e738e91d25c32b54cfc819566db2a5f84bd5312a8` |
  | Vinyl shutters 工艺单 AIV1（整合版） | Vinyl 百叶窗 工艺 / 下料 / 标签 | `70fc3cdb5c9535cbfbf352169eb851e2ebbde4405b05f4c2e3f249f0398ef13c` |
  | 真实订单 G1024-02R4S8AL139-458（.et，2026-10-26） | 新版 6cm 窗帘模板（蛇形）；取代上表 6cm 原件做金标准 | `c10789aba32e3134abfaeb8535f1297130858d76e1bb52fec1a1d3201485f886` |
  | 真实订单 G1025-01D6S2AL810(P)(Canada)（.et） | 新版 6cm 模板（韩褶），成品帘子高人工 268→266 | `f76a3119780dd8df41c9a80d2c7da2ae4311185ebe9ac60968f3f8c1d7e421af` |
  | 真实订单 G0927-01Z3D11S13VS12Ly26-1226（梦幻帘） | 国内下单表，公式与上表国内下单原件一致 | `f6ffe11ad373ae925329c78b727138ae1dcfad9e0add217c7f2b7902f05ff457` |
- 新版窗帘模板与旧版只差 F 列（成品高）：旧版英寸扣减后 ROUNDDOWN，新版 `ROUND(D×2.54 − cm 扣减)`（顶装C 6；方单轨/圆单轨 8；圆双轨 9；方双轨 6）；另去掉结算区、底部说明换成 7 条。
- 原件自身的缺陷（逐窗位比对模板得到，详见报告 §3）：Blinds 工艺组装 52 个窗位块中有块引用了错位的工艺单行（第 15 窗位取第 26 行布纱比、第 22 窗位取第 29 行测量方式）、部分块拉绳分档少 0.6 档；卷帘/香格里拉裁剪数量公式把"亮白插片圆盒"拼成"亮白亮白插片圆盒"、把灰弧/白弧写成 GREY ARC / White ARC，导致这些组合数量为 0；排序权重公式引用未定义名称 `E`（#NAME?）。Vinyl 30 个窗位一致，仅第 1 窗位 2.5" 开启代码把 LTLR 写成 LLR。

## Goals / Non-Goals

**Goals**
- 四类工艺计算以原件"第 1 窗位模板公式"为准逐值一致，并由 LibreOffice 重算原件得到的夹具持续回归。
- 签字即生成 draft 工艺单 + 待核对清单；工厂补齐后确认。
- 导出一个 xlsx，同时承载四类工艺单。

**Non-Goals（具体到文件）**
- 不改 `src/lib/blinds/pricing-engine.ts`、`pricing-data.ts`、`public/sunny-quote.html`、`src/app/(main)/sales/quote-sheet/order-*.tsx`（Order Form 录入字段不变）。
- 不改 `prisma/schema.prisma` 与 `prisma/migrations/**`。
- 不改 `src/lib/blinds/order-state-machine.ts` 的转换表；只在 `transition` 路由加 draft→confirmed 门禁。
- 不改 `src/lib/muse-bridge/**`、`src/lib/tender-rfq/**`。
- 不复刻原件 `窗型示意` / `绘图数据` / `直柱打印` / `横档打印` / `拉绳盖` / `Sheet1 (2)` 隐藏表与打印 `.cmd`。

## Decisions

### D1. 金标准 = LibreOffice 重算原件，而不是人读公式
`scripts/sunny-process-oracle/oracle.py` 通过 UNO 打开原件、把用例输入写进输入格、`calculateAll()`、读出输出格，生成 `src/lib/sunny-process/__tests__/fixtures/*.json`（每条含输入、原件输出、原件 SHA-256）。TS 测试只读夹具，CI 不依赖 LibreOffice。
- 否决：手写期望值——会把"我对公式的理解"当成金标准，正是要防的错误。
- 否决：在 CI 里跑 LibreOffice——镜像重、慢，且原件不入库。
- 拍板后的公式写进原件再重算（`oracle.py` 的 `PATCHES`，记录在夹具 `source.patches`）：6cm（G1024 工作簿）I 列写 `IF(F>0,F−2,0)`；7cm 旧版原件 F 列写新版公式、I 列同上。真实订单另走 `--real-orders`：原样打开、只读保存值，作为回归夹具 `real-orders.json`。
- Blinds 只用第 1 窗位（模板）做逐值金标准；另跑一遍"全部 52 窗位"仅用于生成原件缺陷清单（报告 §3），不作为期望值。Vinyl 30 窗位公式一致，用例一次填满 30 窗，同时校验下料总表的跨窗合并。

### D2. 零 schema 下的存储
- 工艺单头 + Blinds 行：沿用 `BlindsOrder`（status=draft，customerId / opportunityId 取自报价，creatorId = 报价创建人）与 `BlindsOrderItem`。
- 报价关联 + 非 Blinds 工艺参数（国内下单行、窗帘行、Vinyl 窗、单头设置、待核对快照）：写 `AuditLog`，`targetType="blinds_order"`、`targetId=<orderId>`、`action="process_order.spec"`，`afterData` = `{ schema: "sunny-process-order-spec/v2", version, source: { quoteId, orderNumber, signedAt, customerName }, settings, domestic[], drapes[], vinyl[], purchase[], notes[] }`（v1 的 `unsupported[]` 读取时转成 `purchase[]`）（`source` 只由生成服务写入，保存接口一律沿用旧值）；每次编辑追加一条新版本，读取取最新。另写一条 `targetType="sales_quote"`、`targetId=<quoteId>`、`action="process_order.generated"` 供按报价反查（幂等判定）。
- 否决：给 `BlindsOrder` 加 `quoteId` / `specJson` 字段——违反硬纪律 1。
- 否决：把 Vinyl/窗帘塞进 `BlindsOrderItem` 复用列（如把杆型塞 headrailType）——语义错位，现有页面与导出会误读。
- 否决：导出时现读报价 formDataJson——报价签字后仍可能被编辑，工艺单必须冻结签字时刻的数据并允许工厂改参数。

### D3. 幂等
生成在一个事务里：先取事务级 `pg_advisory_xact_lock(hashtext('sunny-process-order:'+quoteId))` 串行化同一报价，锁内查 `AuditLog(targetType=sales_quote, targetId=quoteId, action=process_order.generated)`，有则返回既有工艺单；否则锁内判断编号占用并创建工艺单 + 两条 AuditLog（独立审查发现：只在事务外预检时，后到者会把先到者的单当成"编号被占用"而加后缀另建一张）。工艺单编号确定性取 `quote.orderNumber`（为空时 `Q-<quoteId>`）；编号已被其他无关工艺单占用时取 `<编号>-Q<quoteId 后 6 位>`。并发下第二个事务因 `BlindsOrder.code` 唯一约束失败，捕获后按报价反查返回既有单。
- 否决：用 `remarks` 文本里写报价号来判重——可被人编辑，不可靠。

### D4. 触发点
在 `mark-signed` 与公开 `sign` 两个路由把报价写成 signed 之后，`await` 调用生成服务并 try/catch 吞错（D5）。不经过任何队列或 cron（硬纪律 3）。
- 否决：挂在 `onQuoteSigned`（商机推进）里——它在无商机时直接 return，且公开签字路径对它是 fire-and-forget，无法把结果回给前端。

### D5. 失败隔离
生成服务返回 `{ created, id?, code?, reason? }`，从不抛出；签字路由把它原样放进响应体 `processOrder`。签字的 200/409 语义不变。

### D6. 映射口径与待核对
按 proposal 的四项拍板实现；每个默认推导写一条待核对项 `{ section, line, field, level: "info" | "block", messageZh }`。待核对在读取时由"当前参数 + 引擎校验"重新计算（不是只存快照），所以工厂修正参数后阻断项自动消失。
- 罩盒：Cassette→亮白插片圆盒、Fascia→哑白方型罩盒、None→单轨无盒；Zebra/香格里拉缺 valance 时用亮白插片圆盒。均为提示级。
- 斑马帘布纱比：查组织的对照表（D10），命中用表值并提示来源；未命中默认 3:2 并提示。
- 电动：拉杆位置默认 R 并提示。
- 窗帘杆型：同一行同时有布和纱 → 方双轨，否则方单轨；杆色空；均为提示级。Grommet → 外采购行。
- Vinyl：百叶尺寸 2-1/2"→2.5、3-1/2"→3.5；选了 4-1/2" / Arch → 全部百叶行进外采购，未选 → 留在 Vinyl 段阻断；颜色默认"白色"；外框 L/Z 直接映射，S/G/M/Casing 属于 Wooden 百叶 → 外采购（Vinyl 材质时另给订单级提示），空 → 阻断；外框数默认 4；结构默认有框；开合编码由 Open Dir + 扇数推导（L→全 L，R→全 R，LR→前 ⌈n/2⌉ 个 L、其余 R），提示级；Mid Rail 文本能解析成正数时作为第一档底部(in)，否则提示；Wooden 材质整段进外采购。
- 外采购行（拍板："只需要将销售写的直接生成就行，给到外采购的"）：`{ section, categoryZh, location, widthIn, heightIn, qty, fields: [{label, value}], reasonZh, remark }`，`fields` 按 Order Form 列名记录销售原值（尺寸原样 "50 4/16"；不含价格、不含 data: 草图）；不阻断，订单级一条提示。

### D7. 引擎形态
纯函数、无 I/O：`src/lib/blinds/calculation-engine.ts`（修正）、`src/lib/sunny-process/{domestic,drapes,vinyl}-calc.ts`（文件名不用 engine：R1 架构守卫把 `src/lib` 下带 engine 的文件名视为新执行面，硬纪律 3）。Excel 语义按原件逐一复刻：ROUNDUP 远离零、ROUNDDOWN 趋零、`IF(x, …)` 以非零为真、`LEFT(H5,1)` 产生文本参与算术、`NA()` 映射为阻断问题。
- 否决：把公式写成通用 Excel 解释器——过度设计且不可读。

### D8a. 门禁覆盖两条改状态路径（实施中补充）
详情页"确认工艺单"按钮走 `PUT /api/blinds-orders/{id}`（body.status），不经 transition 路由；门禁因此在 PUT 与 transition 两处用同一个函数判定，否则门禁可被绕过。
- 否决：只改详情页改走 transition——PUT 仍可被直接调用绕过。

### D8b. 可见性（实施中补充）
自动生成的工艺单无项目、创建人是销售，原 PUT 规则"无项目只许平台管理员改"会让工厂无法核对。新增 `canViewBlindsOrder`：平台管理员 / 创建人 / 项目可见 / 关联客户所在组织的活跃成员；用于 PUT、DELETE、transition、spec、export。GET 详情维持原规则不动。
- 否决：给工艺单加 orgId 字段——违反硬纪律 1。

### D9. 发给国内 / 退回自产（拍板："多开一个按钮…一键发给国内…只需要将销售写的直接生成就行"）
`POST /api/blinds-orders/[id]/move-lines`，纯函数 `line-moves.ts` 规划 + `autogen.ts moveProcessOrderLines` 落库：一个事务内先取 `pg_advisory_xact_lock(hashtext('sunny-process-spec:'+orderId))`（保存参数 `saveProcessSpec` 同锁），锁内校验 draft 与 `baseVersion`，删除并按新顺序重建 `BlindsOrderItem`（与 PUT 工艺单同一写法 `itemCreateData`），追加一版 spec；`notes` 中跟随被挪行的提示丢弃、其余按新行号重排，退回行新增布纱比 / 罩盒默认提示。
- 只在工艺单内部挪行：不调用 PendingAction、邮件、通知（硬纪律 2；发给供应商仍由人导出后处理）。
- 国内下单表没有的列（Tight / 侧装 / 拉杆 M / 底杆覆盖 / 布纱比）写成备注标记，退回时解析还原；提示随行换算搬段。
- 整表 PUT 自产行（编辑页）、状态转换与挪行同一把锁；编辑页带打开时的 `updatedAt`，不一致 409（第二轮审查 #1 #8）。
- 否决：前端改完 spec 再 PUT 工艺单 items 两步走——两次写之间失败会丢行或重复，且提示行号无法同步。

### D10. 斑马帘布纱比对照表（拍板：做成可编辑的对照表页）
存 `Organization.settingsJson.sunnyProcess.zebraRatios = [{ codes[], fabric, silk, noteZh }]`（零 schema），`GET/PUT /api/sunny-process/zebra-ratios`（组织按销售模块 `resolveSalesOrgIdForRequest` 解析），整表覆盖写（`SELECT … FOR UPDATE` 行锁）并记 `AuditLog(action="sunny_process.zebra_ratios", targetType="organization")`；成员可读，保存需 org_admin 及以上（影响全组织裁剪位）。从未保存 → 原件 Sheet1 W2:W29 转录的 24 条种子（括号别名并入同一条；W17/W22 对 SC-ZD-XZ74-1 不一致，取 W17 并在备注标注请核对）。匹配：大写、空格/下划线/斜杠视同 `-`；完全相同优先，否则编码作为完整一段出现在 SKU 中，多条取最长。页面列出报价目录（`public/sku-catalog.csv`）里尚未命中的斑马帘系列，点一下加一行。
- 否决：模糊 / 子串匹配——F1091 会误中 F10912，布纱比错了裁剪位就错。
- 只影响之后生成 / 退回自产的行，已生成的布纱比不回写（避免静默改动工厂已核对的值）。

### D8. 导出
`excel-export.ts` 改为按产品线组装工作簿（外采购行出「外采购单」，列出销售填写原值）；非 Blinds 段落从最新 spec 版本重算（不读存储的计算值，延续既有"导出时重新计算"的约定）。导出路由补上与 GET 详情相同的可见性校验（既有路由缺失）。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 触碰并遵守：不改 schema / migration；扩展数据只写 `AuditLog` 与 `Notification`（D2）。 |
| 2 | 出站先审批 | 触碰并遵守：生成 / 编辑 / 确认 / 导出零对外发送；只发站内通知（内部，不出站）。签字路由既有的邮件 / 微信不在本 change 改动范围。 |
| 3 | 禁止第三套队列 | 触碰并遵守：同步调用，无 queue / scheduler / worker（D4）。 |
| 4 | 脱敏 | 不涉及 Muse 通道；另以 Requirement"计算不输出价格"保证工艺单不含金额。 |
| 5 | 不爬登录页 | 不涉及。 |
| 6 | 邮箱分离 | 不涉及（不发邮件）。 |
| 7 | 确定性优先 | 触碰并遵守：映射与待核对全部查表，零 LLM 调用。 |
| 8 | 测试注册 | 触碰并遵守：新增 `src/lib/sunny-process/__tests__/*.test.ts` 与修改的 `src/lib/blinds/__tests__` 全部注册进 `scripts/test-all.sh`；`bash scripts/check-test-registry.sh` 退出 0。 |

## Risks / Trade-offs

- 原件个别窗位与模板不一致 → 以模板为准，偏离逐条登记（报告 §3），交 Lucas 确认。
- 拉绳长度：原件《开料表（布料）》J 列对所有操控方式都计拉绳，系统沿用既有"仅普通操控有拉绳"口径，登记为偏离 X-1（2026-10-27 拍板：不用算拉绳米数）。
- 成品帘子高减 2cm：原件 I 列 = F 列，系统按拍板减 2，登记为偏离 X-6；G1024 历史单未减，回归时跳过并打印。
- AuditLog 当作版本化存储：读取最新版本需按 `createdAt desc` 取 1 条，已有 `(targetType, targetId)` 索引；数据量为每单个位数，无性能风险。
- LibreOffice 与 Excel 在文本/数字比较等边角语义上可能不同 → 用例避开原件靠"文本>数字"巧合成立的分支之外，并在报告中列出该类分支。

## 验证方式

- `python3 scripts/sunny-process-oracle/oracle.py --all`（离线，需 LibreOffice + 原件路径）→ 重新生成夹具，`git diff --stat` 夹具无变化即原件未变。
- `npx tsx src/lib/sunny-process/__tests__/blinds-oracle.test.ts`、`drapes-oracle.test.ts`、`vinyl-oracle.test.ts`、`domestic-oracle.test.ts`、`real-orders.test.ts`、`zebra-ratios.test.ts`、`line-moves.test.ts`、`quote-mapping.test.ts`、`autogen.test.ts`、`export-workbook.test.ts`：全部退出 0；隔离库 `autogen-db.isolated.test.ts` 退出 0。
- `bash scripts/check-test-registry.sh` 退出 0；`npm run typecheck`；`npm run lint:baseline`；`npm test`。
- `openspec validate sunny-process-order-autogen --strict` 通过。
