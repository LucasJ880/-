# Sunny 工艺单 · 交接（HANDOFF）

接手人先读：`docs/QINGYAN_SUNNY_PROCESS_ORDER_REPORT.md`（做了什么、对照结果、待拍板），再读 `openspec/changes/sunny-process-order-autogen/`（proposal / specs / design / tasks）。续做用 `/opsx:continue sunny-process-order-autogen`，不要凭记忆重写。

## 1. 现在的状态

| 项 | 状态 |
|---|---|
| 分支 | `claude/sunny-sales-process-order-update-n1si3x`（已推送） |
| OpenSpec | `sunny-process-order-autogen`，tasks 全部完成，`validate --strict` 通过；**未 archive**（PR 合并后另开小 PR 做 `/opsx:archive sunny-process-order-autogen --yes`） |
| PR | 未开（等 Lucas / Evan 决定） |
| 待拍板 | 报告 §6 的 6 项；拍板后多数只改映射表或默认值（见 §4 的"改哪里"） |

## 2. 代码地图

```
src/lib/blinds/calculation-engine.ts   Blinds 引擎（修正后，规则版本 blinds_20261027_v2）
src/lib/blinds/deduction-rules.ts      盖盒Ref 减尺表、拉绳分档表、斑马帘裁剪位常数
src/lib/blinds/excel-export.ts         导出入口：Blinds 四表 + 调 sunny-process/workbook 出其余表
src/lib/sunny-process/
  excel-fns.ts        ROUNDUP / ROUNDDOWN / ROUND / TEXT("# ??/16") 等 Excel 语义
  domestic-calc.ts  国内下单表
  drapes-calc.ts    窗帘 6cm / 7cm
  vinyl-calc.ts     Vinyl 单窗工艺 / 下料总表 / 标签（NaN = 原件 #N/A）
  deviations.ts       与原件的有意偏离登记 X-1…X-5（测试与报告共用）
  process-spec.ts     非 Blinds 工艺参数 JSON 结构 + 入参清洗
  quote-mapping.ts    报价 Order Form → 工艺输入（四项拍板都在这里）
  issues.ts           待核对（提示 / 阻断）——读取时实时重算
  autogen.ts          生成服务（幂等、失败隔离、通知）+ spec 版本读写；db 注入
  server.ts           真实 db / 通知门控 / 可见性 canViewBlindsOrder
  workbook.ts         国内下单 / 窗帘 / Vinyl / 标签 / 待核对 工作表
  __tests__/          7 个纯逻辑测试 + 1 个隔离库端到端；fixtures/ 是金标准
scripts/sunny-process-oracle/          LibreOffice 重算原件 → 夹具（离线工具）
src/app/api/blinds-orders/[id]/spec/   GET / PUT 工艺参数
src/app/api/blinds-orders/[id]/{route,transition,export}   门禁 + 可见性
src/app/api/sales/quotes/[quoteId]/mark-signed、share/[token]/sign   签字后调用生成
src/app/(main)/blinds-orders/[id]/{page,process-sections}.tsx       工艺单页
```

## 3. 数据落点（零 schema）

- 工艺单头 + Blinds 行：`BlindsOrder`（status=draft，code = 报价 orderNumber；被占用时加 `-Q<报价 id 后 6 位>`）/ `BlindsOrderItem`。
- 报价 → 工艺单关联：`AuditLog(targetType="sales_quote", targetId=<quoteId>, action="process_order.generated", afterData={orderId, code})`。
- 非 Blinds 工艺参数：`AuditLog(targetType="blinds_order", targetId=<orderId>, action="process_order.spec", afterData=<ProcessSpec JSON>)`，每次保存追加一条，取最新。**不要清理这两类 AuditLog**，否则工艺单会丢参数、报价会重复生成。
- 通知：`Notification(type="process_order_generated", entityType="blinds_order")`，`sourceKey` 去重。

## 4. 常见续做怎么改

| 需求 | 改哪里 | 必跑 |
|---|---|---|
| 罩盒默认映射改了（如 Fascia → 哑灰） | `quote-mapping.ts` 的 `VALANCE_TO_HEADRAIL` | `quote-mapping.test.ts` |
| X-1 拍板为"无绳/电动也计拉绳" | `calculation-engine.ts` 的 `calcCordLength`；删除 `deviations.ts` 里的 X-1，并去掉 `blinds-oracle.test.ts` 的 X-1 分支 | `blinds-oracle.test.ts`（应全部直接比对） |
| 报价 SKU → 斑马帘布纱比对照表 | 在 `quote-mapping.ts` 斑马帘分支查表；查到就不写 3:2 默认提示 | `quote-mapping.test.ts` |
| 原件 Excel 更新了 | 把新原件 SHA-256 填进 `oracle.py` 的 `SOURCES`，跑 `oracle.py --all --scan-blinds-slots`，看夹具 diff；引擎按新公式改到对照测试 0 失败 | 4 个 `*-oracle.test.ts` |
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
