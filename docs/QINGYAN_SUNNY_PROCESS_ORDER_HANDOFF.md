# Sunny 工艺单 · 交接（HANDOFF）

接手人先读：`docs/QINGYAN_SUNNY_PROCESS_ORDER_REPORT.md`（做了什么、对照结果、待拍板），再读 `openspec/changes/sunny-process-order-autogen/`（proposal / specs / design / tasks）。续做用 `/opsx:continue sunny-process-order-autogen`，不要凭记忆重写。

## 1. 现在的状态

| 项 | 状态 |
|---|---|
| 分支 | `claude/sunny-sales-process-order-update-n1si3x`（已推送） |
| OpenSpec | `sunny-process-order-autogen`，tasks 全部完成，`validate --strict` 通过；**未 archive**（PR 合并后另开小 PR 做 `/opsx:archive sunny-process-order-autogen --yes`） |
| PR | 未开（等 Lucas / Evan 决定） |
| 拍板 | 报告 §6：8 项已拍板并落地（第二、三轮：外采购、发给国内、布纱比对照表、窗帘新公式与 −2cm）；剩 3 件小事待确认（布纱比表补报价 SKU、SC-ZD-XZ74-1 原件两处不一致、G1024 历史单） |

## 2. 代码地图

```
src/lib/blinds/calculation-engine.ts   Blinds 引擎（修正后，规则版本 blinds_20261027_v2）
src/lib/blinds/deduction-rules.ts      盖盒Ref 减尺表、拉绳分档表、斑马帘裁剪位常数
src/lib/blinds/excel-export.ts         导出入口：Blinds 四表 + 调 sunny-process/workbook 出其余表
src/lib/sunny-process/
  excel-fns.ts        ROUNDUP / ROUNDDOWN / ROUND / TEXT("# ??/16") 等 Excel 语义
  domestic-calc.ts  国内下单表
  drapes-calc.ts    窗帘 6cm / 7cm（新版成品高公式；成品帘子高 = 成品高 − 2，偏离 X-6）
  vinyl-calc.ts     Vinyl 单窗工艺 / 下料总表 / 标签（NaN = 原件 #N/A）
  deviations.ts       与原件的有意偏离登记 X-1…X-6（测试与报告共用）
  process-spec.ts     非 Blinds 工艺参数 JSON 结构（v2：purchase 外采购行）+ 入参清洗（读 v1 unsupported 自动转换）
  quote-mapping.ts    报价 Order Form → 工艺输入（拍板都在这里；外采购判定、布纱比查表）
  zebra-ratios.ts     斑马帘「面料编码 → 布:纱」对照表：种子、匹配、settingsJson 读写
  line-moves.ts       发给国内 / 退回自产的纯函数规划（字段换算、提示重排）
  issues.ts           待核对（提示 / 阻断）——读取时实时重算
  autogen.ts          生成服务（幂等、失败隔离、通知）+ spec 版本读写 + moveProcessOrderLines；db 注入
  server.ts           真实 db / 通知门控 / 可见性 canViewBlindsOrder
  workbook.ts         国内下单 / 窗帘 / Vinyl / 外采购单 / 标签 / 待核对 工作表
  __tests__/          10 个纯逻辑测试 + 1 个隔离库端到端；fixtures/ 是金标准（含 real-orders.json 真实订单）
scripts/sunny-process-oracle/          LibreOffice 重算原件 → 夹具（离线工具）
src/app/api/blinds-orders/[id]/spec/   GET / PUT 工艺参数
src/app/api/blinds-orders/[id]/move-lines/   POST 发给国内 / 退回自产
src/app/api/sunny-process/zebra-ratios/      GET / PUT 布纱比对照表（组织级）
src/app/api/blinds-orders/[id]/{route,transition,export}   门禁 + 可见性
src/app/api/sales/quotes/[quoteId]/mark-signed、share/[token]/sign   签字后调用生成
src/app/(main)/blinds-orders/[id]/{page,process-sections}.tsx       工艺单页（总览「发给国内」、国内下单「退回自产」、外采购分页）
src/app/(main)/blinds-orders/zebra-ratios/page.tsx                  布纱比对照表页
```

## 3. 数据落点（零 schema）

- 工艺单头 + Blinds 行：`BlindsOrder`（status=draft，code = 报价 orderNumber；被占用时加 `-Q<报价 id 后 6 位>`）/ `BlindsOrderItem`。
- 报价 → 工艺单关联：`AuditLog(targetType="sales_quote", targetId=<quoteId>, action="process_order.generated", afterData={orderId, code})`。
- 非 Blinds 工艺参数：`AuditLog(targetType="blinds_order", targetId=<orderId>, action="process_order.spec", afterData=<ProcessSpec JSON>)`，每次保存追加一条，取最新。**不要清理这两类 AuditLog**，否则工艺单会丢参数、报价会重复生成。
- 通知：`Notification(type="process_order_generated", entityType="blinds_order")`，`sourceKey` 去重。
- 斑马帘布纱比对照表：`Organization.settingsJson.sunnyProcess.zebraRatios`（整表覆盖写；从未保存过 = 用原件种子），每次保存记 `AuditLog(action="sunny_process.zebra_ratios", targetType="organization")`。改 settingsJson 的其它代码不要整对象覆盖掉 `sunnyProcess` 键。
- 并发：生成用 `pg_advisory_xact_lock('sunny-process-order:'+quoteId)`；保存参数与挪行共用 `pg_advisory_xact_lock('sunny-process-spec:'+orderId)` + `baseVersion`。

## 4. 常见续做怎么改

| 需求 | 改哪里 | 必跑 |
|---|---|---|
| 罩盒默认映射改了（如 Fascia → 哑灰） | `quote-mapping.ts` 的 `VALANCE_TO_HEADRAIL` | `quote-mapping.test.ts` |
| 布纱比匹配规则要改（如支持前缀） | `zebra-ratios.ts` 的 `lookupZebraRatio`；页面试查同一函数 | `zebra-ratios.test.ts`（ZR-02 有误中反例，别删） |
| 某种产品不走外采购了（有了模板） | `quote-mapping.ts` 的外采购判定（`WOODEN_FRAMES` / `louverPurchase` / Pleat G / `DOMESTIC_PRODUCT`）+ 下一行"新增产品线模板" | `quote-mapping.test.ts` QM-05/06/07 |
| 窗帘扣减 / −2cm 改了 | `drapes-calc.ts` 的 `heightDeductionCm` / `FINISHED_HEIGHT_ALLOWANCE_CM`；`oracle.py` 的 `PATCHES` 同步改并重跑 `--only drapes-6cm,drapes-7cm --real-orders` | `drapes-oracle.test.ts`、`real-orders.test.ts` |
| 原件 Excel 更新了 / 又来了真实订单 | 新原件 SHA-256 填进 `oracle.py` 的 `SOURCES`（真实订单填 `REAL_ORDERS`），跑 `oracle.py --all --scan-blinds-slots --real-orders`，看夹具 diff；引擎按新公式改到对照测试 0 失败。`.et`（WPS）也能直接读 | 4 个 `*-oracle.test.ts` + `real-orders.test.ts` |
| 新增产品线模板（如 Wooden） | 照 `drapes-calc.ts` 写引擎 + 在 `oracle.py` 加生成器 + `*-oracle.test.ts`；`quote-mapping.ts` 把 `unsupported` 改成新段；`process-spec.ts` / `issues.ts` / `workbook.ts` / `process-sections.tsx` 各加一段 | 新对照测试 + `autogen-db.isolated.test.ts` |

## 5. 本地重跑金标准 / 端到端

```bash
# 金标准（需要 LibreOffice 与 python3-uno；原件放任意目录，按 SHA-256 识别）
python3 scripts/sunny-process-oracle/oracle.py --src <原件目录> --all --scan-blinds-slots   # ~10 分钟

# 隔离库端到端（本机 Postgres 16 + pgvector）
su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb -D /var/lib/postgresql/sunny-e2e -U postgres --auth=trust -E UTF8 && \
  /usr/lib/postgresql/16/bin/pg_ctl -D /var/lib/postgresql/sunny-e2e -o '-p 55432 -k /var/lib/postgresql' -l /var/lib/postgresql/sunny-e2e.log start && \
  /usr/lib/postgresql/16/bin/createdb -h 127.0.0.1 -p 55432 -U postgres sunny_e2e"
export DATABASE_URL=postgresql://postgres@127.0.0.1:55432/sunny_e2e DIRECT_URL=$DATABASE_URL
npx prisma db push --skip-generate          # 只对本地隔离库
NODE_ENV=test DATABASE_ENVIRONMENT=isolated npx tsx src/lib/sunny-process/__tests__/autogen-db.isolated.test.ts
```

## 6. 不要做的事

- 不要把 Blinds 引擎"改回"原件某个非第 1 窗位的公式：原件第 4/5/8/15/22/31/34/43/45/49 窗位有缺陷（报告 §3.1）。
- 不要在工艺单 / 导出 / 参数里放任何价格、成本、折扣、定金字段（spec Requirement「计算不输出价格」，`export-workbook.test.ts` EX-02 守着）。
- 不要绕过门禁改状态：transition 与 `PUT /api/blinds-orders/[id]` 用同一个判定（`orderIssues` + `blockingIssues`）。
- 不要加 Prisma 字段（硬纪律 1）；要存新东西就放进 `ProcessSpec` JSON，并在 `sanitizeSpec` 里清洗。
- 不要让「发给国内」真的发出去（邮件 / 微信 / 供应商接口）：那是出站动作，必须先走 PendingAction 审批（硬纪律 2）。现在它只是把行挪进国内下单表，`line-moves.test.ts` LM-05 守着。
- 不要对布纱比做模糊匹配：布纱比错了斑马帘裁剪位就错。
