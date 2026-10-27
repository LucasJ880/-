# Sunny 工艺单 · 签字自动生成 + Excel 原件对照检验 报告

OpenSpec change：`openspec/changes/sunny-process-order-autogen/`（`openspec validate --strict` 通过）
分支：`claude/sunny-sales-process-order-update-n1si3x`
TASKFLOW：无（Sunny FDE 业务线，不在 Muse 主线）
口径来源：Lucas 2026-10-27 上传的 5 份 Excel 原件，以及同日四项拍板：
Lift L/R = 普通拉绳、M = 电动；罩盒按默认映射且草稿可改；自动生成的工艺单为草稿，工厂核对后确认；窗帘 6cm/7cm 两版都支持，默认 6cm。

## 1. 做了什么

| 环节 | 结果 |
|---|---|
| 触发 | 客户签字后（销售现场「生成订单」→ `mark-signed`；客户线上签字 → 公开 `sign`），自动生成一张 **draft 工艺单**，并给报价创建人发站内通知（点击直达工艺单）。同一报价只生成一次；生成失败不影响签字。 |
| Blinds 自产（卷帘 / 斑马帘 / 香格里拉） | 引擎按原件第 1 窗位模板修正，见 §2。落在既有 `BlindsOrder` / `BlindsOrderItem`。 |
| 国内下单（蜂窝帘 / 梦幻帘 / 罗马帘等外购帘） | 新引擎：英寸转厘米、平方、标签。 |
| 窗帘（Drapes / Sheer） | 新引擎：6cm / 7cm 蛇形帘 + 韩褶，成品宽高、走珠颗数、走珠扣、物料汇总。每单可切 6cm/7cm，默认 6cm。 |
| Vinyl 百叶窗 | 新引擎：外框组合、内空、扇宽高、上/中/下百叶片数、孔距、各料长度/数量/角度、切分、双中分档、下料总表（同料同长合并、料型顺序、长度降序）、每扇 + FRAME 标签。 |
| 待核对 | 报价单没有的工艺参数一律走默认值并列为「提示」；原件不支持或缺失的列为「阻断」。阻断项清零前不能确认（transition 与详情页按钮两条路径都拦）。 |
| 工艺单页 | 来源报价与签字时间、待核对面板、国内下单 / 窗帘 / Vinyl 三个可编辑分页（实时重算、标出有问题的行）、Vinyl 下料总表预览。 |
| 导出 | 一个 xlsx，按实际有的产品线出表：开料表、工艺单、开料表（布料）、Blinds 标签、国内下单表、国内下单标签、窗帘工艺单、窗帘物料、Vinyl 工艺单、Vinyl 下料总表、Vinyl 标签、待核对。**不含任何价格 / 成本 / 定金。** |
| 报价页 | 「生成订单」成功提示里带工艺单草稿链接与待补项数。 |
| 零 schema | 没改 `prisma/`。非 Blinds 工艺参数存为 AuditLog 的追加版本（`process_order.spec`），报价 → 工艺单关联存为 `process_order.generated`。 |

## 2. 对照检验（最重要）

**方法**：`scripts/sunny-process-oracle/oracle.py` 用 LibreOffice 直接打开你给的 5 份原件（按 SHA-256 识别），把测试输入写进原件的输入格、整本重算、读出结果，生成夹具；系统引擎对同样的输入逐项比对。金标准来自原件本身重算，而不是我对公式的理解。输入格按原件实际存储类型写入（例如 Vinyl「外框数」下拉的 `4` 是数字、`3+1` 是文本，写错类型原件会静默算成 0）。

| 原件 | SHA-256（前 12 位） | 用例 | 比对项 | 失败 |
|---|---|---|---|---|
| Blinds 工艺单_圆盒侧盖加厚标准版（20241007 新） | `85d45d627762` | 459 窗（3 产品 × 3 操控 × 8 罩盒 × IN/OUT/Tight × 2 + 27 个拉绳分档边界） | 9,488 | **0** |
| Blinds 国内下单表 1 | `32830359e00d` | 12 单 / 322 行 / 305 张标签 | 2,211 | **0** |
| 6cm 窗帘工艺单 | `9ec1b57e7ba9` | 40 单 / 410 行 | 11,267（两版合计） | **0** |
| 7cm 窗帘工艺单 | `acb309364313` | 40 单 / 366 行 | （同上） | **0** |
| Vinyl shutters 工艺单 AIV1 | `70fc3cdb5c95` | 40 单 / 758 窗 / 3,937 行下料 / 2,674 张标签 | 89,401 | **0** |
| **合计** | | | **112,367** | **0** |

Vinyl 用例覆盖 2.5"/3.5"、6 种受支持外框组合 + 4 种不受支持组合、无框、1–9 扇、25 种开合编码、T柱/挂柱、单/双中分档（含错误的第二档）、全部 19 种切分；每单一次填满 1–30 窗，所以下料总表的跨窗合并与排序也一起比对了。原件出 `#N/A` 的位置，系统同样标为错误（不是凑出一个数）。

**修正前的旧引擎**跑同一份 Blinds 夹具：裁切尺寸全对，但 **拉绳分档 71/459 错**（阈值与原件不一致、"1.0 & 0.7" 显示成 "1 & 0.7"），**斑马帘裁剪位 124/144 错**（旧引擎只支持 3:2 布纱比）。

## 3. 原件缺陷与系统偏离

### 3.1 原件 Blinds 工艺组装：52 个窗位里有 10 个与第 1 窗位模板不一致

两种方法交叉证实，证据在 `src/lib/sunny-process/__tests__/fixtures/blinds-slot-defects.json`：一是每个窗位填不同的探针输入、与"只填第 1 窗位"的结果比；二是公式按块内相对行号归一化后逐格比。

| 窗位 | 原件问题 | 后果（数值实证） |
|---|---|---|
| #22 | 测量方式取了第 29 行（别的窗）的值 | 两窗测量方式不同时，**罩盒 / 38管 / 下杆 / 圆芯杆 / 面料宽 / 插片全差 3/16"**（例：43 → 43 3/16） |
| #15 | 布纱比取了第 26 行（别的窗）的值 | 斑马帘裁剪位错（例：0.55 → 3.675） |
| #45 | 裁剪位引用了错位的纵向Ref 块 | 斑马帘裁剪位恒为 0 |
| #4、#31、#34、#43、#49 | 拉绳分档公式少了 ≤0.6 档 | 矮窗（高 ≤ ~29.5"）分档给成 "0.8 & 0.5"，应为 "0.6 & 0.3" |
| #5、#8 | 斑马帘 / 香格里拉数量公式被改写 | 裁剪数量与模板不同 |

**系统一律按第 1 窗位模板计算，不继承上述缺陷。** 如果工厂目前直接用这份 Excel 填到这些窗位，建议抽查近期订单。

### 3.2 有意偏离登记（代码 `src/lib/sunny-process/deviations.ts`，对照测试遇到时打印编号，不静默跳过）

| 编号 | 原件 | 系统 | 需拍板 |
|---|---|---|---|
| X-1 | 《开料表（布料）》对**所有操控方式**都按 高×2×3/4×0.0254 计拉绳与绳套 | 只给普通操控计拉绳 / 绳套；无绳和电动没有拉绳（与工艺组装"拉绳分档只对普通生效"一致） | **是** |
| X-2 | 卷帘 / 香格里拉下杆数量公式把「亮白插片圆盒」写成「亮白亮白插片圆盒」、把灰弧/白弧写成 GREY ARC/White ARC，这三种罩盒数量算成 0 | 按斑马帘行的正确写法：单件 1、双轨 2 | 否 |
| X-3 | 排序权重按"方型罩盒/弧形罩盒"等不存在的名称匹配，结果 `#NAME?` | 沿用系统既有排序权重 | 否 |
| X-4 | Vinyl 下料总表里 T柱 / 挂柱的数量是文本，SUMIFS 不算文本，**柱子从不出现在下料总表** | 下料总表补上 T柱 / 挂柱（料型顺序 2/3）。对照时用"不含柱"模式与原件逐行比，另验证含柱模式只多出柱行 | 否 |
| X-5 | Vinyl 第 1 窗位 2.5" 开启代码把 LTLR 写成 LLR，其余 29 个窗位写 LTLR | 两种写法都认作 4/2 | 否 |

## 4. 报价单 → 工艺单映射（默认值都进待核对）

| 报价 Order Form | 工艺单 | 级别 |
|---|---|---|
| Lift L / R | 普通拉绳，拉杆位置 L / R | — |
| Lift M | 电动，拉杆位置默认 R | 提示 |
| Mount I / O | IN / OUT（空 → IN） | 空时提示 |
| Bracket C / W（行内空 → 单头 Brackets Type → 顶装） | 顶装 / 墙装 | 默认时提示 |
| Valance Cassette / Fascia / None | 亮白插片圆盒 / 哑白方型罩盒 / 单轨无盒 | 提示 |
| 斑马帘布纱比 | 默认 3:2 | 提示 |
| Cordless Cellular / Skylight / Allusion / Roman | 国内下单：蜂窝帘（无绳）/ 蜂窝帘（备注天窗）/ 梦幻帘 / 罗马帘（原件下拉没有罗马帘） | 罗马帘提示 |
| 窗帘 Pleat P / R / G | 韩褶P / 蛇型R / 无模板 | G 阻断 |
| 窗帘杆型 | 同一行有布和纱 → 方双轨，否则方单轨（只在墙装时需要） | 提示 |
| Vinyl 百叶 2-1/2" / 3-1/2" / 4-1/2" / Arch | 2.5 / 3.5 / 阻断 / 阻断 | — |
| Vinyl Frame L / Z / S / G / M / Casing / 空 | L / Z / 其余留空 | 留空即阻断 |
| Vinyl 开合编码 | Open Dir + 扇数推导（LR × 4 → LLRR） | 提示（含 T 柱需手改） |
| Vinyl Mid Rail | 能解析成英寸数字 → 第一档底部；否则提示 | — |
| Vinyl 外框数 / 结构 / 颜色 | 4 / 有框 / 白色 | 提示 |
| Wooden 百叶 | 无模板 | 阻断 |

## 5. 怎么验

```bash
# 引擎 × 原件（CI 子集也会跑）
npx tsx src/lib/sunny-process/__tests__/blinds-oracle.test.ts     # 9488 / 0
npx tsx src/lib/sunny-process/__tests__/domestic-oracle.test.ts   # 2211 / 0
npx tsx src/lib/sunny-process/__tests__/drapes-oracle.test.ts     # 11267 / 0
npx tsx src/lib/sunny-process/__tests__/vinyl-oracle.test.ts      # 89401 / 0
npx tsx src/lib/sunny-process/__tests__/quote-mapping.test.ts     # 36 / 0
npx tsx src/lib/sunny-process/__tests__/autogen.test.ts           # 27 / 0（幂等 / 并发 / 失败隔离 / 版本 / 门禁 / 接线守卫）
npx tsx src/lib/sunny-process/__tests__/export-workbook.test.ts   # 8 / 0
# 真实数据库 + 真实路由端到端（本地隔离 Postgres 16 + pgvector）
DATABASE_URL=… DIRECT_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated \
  npx tsx src/lib/sunny-process/__tests__/autogen-db.isolated.test.ts   # 19 / 0
# 重新生成金标准（离线；需要 LibreOffice + python3-uno + 原件目录）
python3 scripts/sunny-process-oracle/oracle.py --src <原件目录> --all --scan-blinds-slots
```

门禁结果：`npm run typecheck` 0 错；`npm run lint:baseline` PASS（error 比基线少 14，无新增指纹）；`bash scripts/check-test-registry.sh` OK（422 个已注册）；`openspec validate sunny-process-order-autogen --strict` 通过；`next build` 与 `npm test` 的结果见 §7。

## 6. 待拍板（Lucas）

1. **X-1 拉绳**：无绳 / 电动窗是否也要按原件那样计拉绳米数？（现在不计。）
2. **Fascia 的罩盒**：现在默认哑白方型罩盒；哑灰、灰弧、白弧要另选。是否按面料 / 颜色自动选？
3. **斑马帘布纱比**：报价 SKU 与原件备注表的工厂面料号不是同一套编码。是否建一张「报价 SKU → 布:纱」对照表？（建表后可以自动带出，不再默认 3:2。）
4. **卷帘 / 斑马 / 香格里拉一律按自产**：原件国内下单表也列了这三种。哪些面料走国内下单，需要一个规则。
5. **Vinyl 外框 S / G / M / Casing**：原件只有 L / Z / T / Door。报价单这几种对应原件哪一种？
6. **Wooden 百叶、Grommet 窗帘、4-1/2" 与 Arch 百叶**：没有工艺模板，现在列为阻断、人工处理。是否有对应的 Excel？

## 7. 已知限制 / 环境说明

- 原件不入库（客户文件）；夹具里记录了原件 SHA-256。原件一改，重跑 oracle 后夹具会出现 diff。
- `BlindsOrder` 没有 orgId（既有模型）。新增的 `canViewBlindsOrder` 规则是：平台管理员 / 创建人 / 项目可见 / 关联客户所在组织成员。这条规则用于 PUT、DELETE、transition、spec、export（原先 DELETE 与 export 没有任何校验，PUT 对无项目的单只许平台管理员改）；GET 详情的规则没动。
- `scripts/check-test-registry.sh` 在 main 上本来就失败：a1d951d 新增了 2 个 trade 测试但没注册。本分支顺手补注册（两项都通过 / 无库时跳过），注册门禁才能变绿。
- 下料总表 / 标签 / 窗型示意图的打印宏（原件 `print_*.cmd`）和窗帘结算单金额区不复刻。
- 构建与全量测试：见下方附录（由本次会话实际运行结果填写）。

### 附录：构建与全量测试

（见 §7 末尾追加记录）
