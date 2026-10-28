# Design: install-2a-closeout-all-lines

## Context

见 proposal.md「Why」。现状（2026-10-28 已读代码）：
- 收口单元 = `BlindsOrderItem`（`src/lib/install/service.ts` `INSTALL_ORDER_SELECT.items`）；`aggregateCloseout` 要求 `windows.length > 0`（`src/lib/install/closeout.ts:104`），任务页按钮读同一个 `allCompleted`（`src/components/install/install-task-detail.tsx:229-240`）。
- 工艺参数：最新一条 `AuditLog(action=process_order.spec, targetType=blinds_order, targetId=<orderId>)`，`sanitizeSpec` 后得到 `domestic / drapes / vinyl / purchase` 四段数组（`src/lib/sunny-process/process-spec.ts:94-104`），每行都有 `location`，**没有稳定 id**；`loadProcessSpec(db, orderId)`（`src/lib/sunny-process/autogen.ts:285`）一次读一单。
- 照片记录：`logAudit`（失败只 `console.error`，`src/lib/audit/logger.ts:104-110`）；`writeAuditLog(client, …)` 失败抛错。
- 照片代理 `src/app/api/files/[...path]/route.ts` 按 `install-photos/{orgId}/{orderId}/…` 判定，只用到 `orgId / orderId`，第 4 段不参与鉴权。
- 工艺单详情"收口"标签渲染 `/api/install/tasks/{appointmentId}` 的 `windows`（`src/app/(main)/blinds-orders/[id]/page.tsx:201-215`）。

## Goals / Non-Goals

**Goals:**
- 列表、详情、上传、完成收口、工艺单收口标签用**同一个**单元构建函数和聚合函数，计数在任何入口一致。
- 已有的 Blinds 行收口记录（`blinds_order_item`）原样有效，不迁移、不重写。
- 收口记录要么写进库、要么接口报错，不存在"前端显示已拍、库里没有"。

**Non-Goals:**
- 不改 `src/lib/sunny-process/**`（工艺参数结构、`sanitizeSpec`、`saveProcessSpec`、挪行）。
- 不改 `src/app/api/files/[...path]/route.ts` 的鉴权规则（路径第 4 段从行 id 变成单元 id，鉴权不读它）。
- 不改 `src/lib/blinds/order-state-machine.ts`、`src/app/api/blinds-orders/[id]/transition/route.ts`。
- 不改 `src/app/api/install/tasks/[id]/start/route.ts`、`src/app/api/install/installers/route.ts`、`src/lib/install/scope.ts`。
- 不改权限键与岗位（`src/lib/authorization/**`）。

## 八条硬纪律对照

| # | 纪律 | 本 change |
|---|---|---|
| 1 | 零 schema | 遵守。工艺参数单元的收口记录写既有 `AuditLog`，目标类型新字符串 `blinds_order_unit`；不加字段 / 表 |
| 2 | 出站先审批 | 不涉及。无对外发送 |
| 3 | 禁止第三套队列 | 不涉及 |
| 4 | 脱敏 | 不涉及 Muse。单元序列化只取位置 / 尺寸 / 产品 / 色号，沿用 window-closeout「不输出的内容」，工艺参数里的价格类字段不出（工艺参数本身不含价格，`export-workbook.test.ts` EX-02 守着） |
| 5 | 不爬登录页 | 不涉及 |
| 6 | 邮箱分离 | 不涉及 |
| 7 | 确定性优先 | 遵守。单元构建、编号、位置比对、完成判定全是纯函数 |
| 8 | 测试注册 | 遵守。`closeout-units.test.ts`、`closeout-db.isolated.test.ts` 在同一 task 注册 `scripts/test-all.sh` |

## Decisions

### D1 单元 id：`spec-<段>-<下标>`，审计目标 `<orderId>:<段>:<下标>`
工艺参数行没有 id，用"段 + 段内下标"定位；URL 段用连字符（`spec-vinyl-0`，cuid 不含连字符，不会和 Blinds 行 id 冲突），审计目标带上工艺单 id，便于按 `targetId startsWith "<orderId>:"` 一次查出整单。
- 否决：给工艺参数行加 `uid` 字段——要改 `process-spec.ts`、`sanitizeSpec`、挪行与 oracle 夹具，属于另一个 change，且旧参数没有 uid 仍要回退到下标。
- 否决：目标类型仍用 `blinds_order_item`、目标填单元 id——同一列混两种 id 语义，按 itemId 查询时会误命中。

### D2 位置快照比对，不一致即不计入
下标会因出单增删行而错位；比位置能拦住"照片挂到别的窗上"。不一致时计为未收口并提示补拍，安装工在现场补一张即可。
- 否决：不一致也计入、只显示提醒——可能把未装的窗算作已装，收口是会计结算依据（INSTALL-1 报告 §3），宁可多拍一张。
- 否决：自动按位置重新匹配下标——同一单常有同名位置（两扇"Kitchen"），匹配不确定。

### D3 单元顺序与编号
Blinds 行按行序号在前；工艺参数按 国内下单 → 窗帘 → Vinyl → 外采购（`ProcessSpec` 字段顺序），段内原顺序，序号从 Blinds 最大序号 + 1 连续编。409 清单与任务页用同一序号。
- 否决：每段各自从 1 编号——"#1"在同一张单里出现多次，安装工和办公室沟通会混。

### D4 布帘、纱帘各一个单元
工艺参数里同一窗的布帘与纱帘是两行（`part: drape | sheer`），分开装、可能只装了一层。
- 否决：按位置合并——同位置可能有两套窗帘，合并规则不确定。

### D5 收口记录改用会抛错的写入
上传路由改用 `writeAuditLog(db, …)`；捕获错误返回 500"照片已上传但记录失败，请重拍"。孤立的 Blob 文件不清理（私有、无引用、体积小）。
- 否决：Blob 与审计放进同一事务——Blob 不在数据库事务内，做不到原子；先写审计再传 Blob 又会出现"有记录没文件"，更糟。

### D6 批量读取
列表接口一次查出所有相关工艺单的最新工艺参数（`findMany` + 按单取最新）与两类收口记录（`blinds_order_item` 按 itemId `in`；`blinds_order_unit` 按 `targetId startsWith` 每单一个 OR 条件），避免 N+1。详情 / 上传 / 完成走同一函数，传单张单。
- 否决：列表逐单调用 `loadProcessSpec`——300 条任务时 300 次查询。

### D7 零单元的 409 `NO_UNITS`
单独的错误码与文案，任务页在 `total === 0` 时直接显示"工艺单没有可收口的行，请联系出单补齐"，按钮不显示"还差 0 扇"。
- 否决：零单元视为可直接完成——没有任何照片证据就把工艺单推到已安装，会计无从核对。

## 验证方式

| 项 | 命令 / 产物 |
|---|---|
| 单元构建、编号、id 编解码、位置比对、聚合 | `npx tsx src/lib/install/__tests__/closeout-units.test.ts` |
| INSTALL-1 既有聚合与校验不回归 | `npx tsx src/lib/install/__tests__/closeout.test.ts` |
| 真实路由端到端（隔离库）：只有 Vinyl 的单上传 → 列表 / 详情计数一致 → 完成收口 200；零单元 409 `NO_UNITS`；不存在的单元 404；位置改后计为未收口；审计写入失败 500 | `DATABASE_URL=… NODE_ENV=test DATABASE_ENVIRONMENT=isolated PRODUCT_CONTENT_LOCAL_STORE=1 npx tsx src/lib/install/__tests__/closeout-db.isolated.test.ts` |
| 类型 / lint / 注册 | `NODE_OPTIONS=--max-old-space-size=8192 npm run typecheck`；`npm run lint:baseline`；`bash scripts/check-test-registry.sh`；`npm run test:ci` |
| 不出金额 | `grep -rnE "grandTotal|price|msrp|costPrice" src/app/api/install src/lib/install` 为空 |
| 规格 | `openspec validate install-2a-closeout-all-lines --strict` |
| 页面 | 本地 `next dev` + Playwright（mock 登录同仓库既有做法）：只有 Vinyl 的任务页显示 3 个单元、拍完后"完成收口"可点；零单元任务页显示说明文案。截图存 `docs/QINGYAN_INSTALL-2a_REPORT.md` 引用目录 |

## Risks / Trade-offs

- [出单在安装后删行导致下标整体前移] → 位置比对使后面的单元变成未收口并提示补拍；现场成本是补拍几张，不会误判完成。
- [审计表继续承载业务记录] → `blinds_order_unit` 目标类型加入 INSTALL-1 的"不可清理"清单（报告写明）。
- [Blob 写成功、审计失败留下孤儿文件] → 私有、无引用、无鉴权外泄面；接受。
- [列表接口 `startsWith` OR 条件随任务数增长] → 列表上限 300 条（既有 `take: 300`），可接受；超过时再按工艺单分批。

## Migration Plan

无数据迁移。上线即生效：既有 Blinds 行照片继续计入；此前收不了口的 Shutters / 窗帘单，安装工打开任务页即看到工艺参数单元并可拍照。回滚 = 回退本 change 的代码，已写入的 `blinds_order_unit` 审计行无害（旧代码不读）。
