# INSTALL-2a 报告 — 收口单元覆盖全部产品线

change：`openspec/changes/install-2a-closeout-all-lines/`（proposal / specs ×2 / design D1–D7 / tasks 6/6）
方案：`docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §0 F2、§4.1、§9 第一行（2026-10-28 Lucas 拍板）
零 schema：工艺参数单元的收口记录写既有 `AuditLog`，目标类型新字符串 `blinds_order_unit`。

## 1. 修了什么

| 问题（改前） | 现在 |
|---|---|
| 只有 Shutters（Vinyl）/ 窗帘 / 国内下单 / 外采购行的工艺单窗数 = 0，"完成收口（还差 0 扇）"永远灰、`/complete` 永远 409 且清单为空 | 收口单元 = Blinds 行 + 工艺参数四段每一行；这些单的每扇窗 / 每行都能拍照、收口 |
| 工艺单真的一行都没有时，页面仍显示"还差 0 扇" | 显示"工艺单没有可收口的行，请联系出单补齐后再收口"，不显示按钮；接口 409 `NO_UNITS` |
| 照片的收口记录写入失败（`logAudit` 吞错）时接口照样 200，安装工以为拍过了 | 改用会抛错的写入；失败返回 500 `RECORD_FAILED`"照片已上传但收口记录保存失败，请重拍"，单元保持未收口 |
| — | 出单在拍照后改了工艺参数的位置 → 该照片不再计入，页面提示"位置已变（拍照时：X），请补拍"，防止照片挂错窗 |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/install/closeout.ts` | 收口单元类型；`buildCloseoutUnits`（Blinds → 国内下单 → 窗帘 → Vinyl → 外采购，序号接在 Blinds 最大序号后，布帘 / 纱帘各一）；`specUnitId` / `parseSpecUnitId` / `specUnitLogTargetId`；`aggregateCloseout` 支持审计目标映射与位置快照比对（`sameLocation`：去首尾空白、不区分大小写）；`locationChanged` |
| `src/lib/install/service.ts` | `loadLatestSpecs`（一次查多单最新工艺参数）、`loadCloseoutLogs`（两类记录一条查询）、`loadOrdersCloseout` / `loadCloseoutSummary` / `loadOrderUnits`；详情按单元序列化（含 `section` / `sectionLabel` / `locationChanged`） |
| `src/app/api/install/tasks/route.ts`、`[id]/route.ts` | 列表 / 详情用同一套单元与聚合 |
| `src/app/api/install/tasks/[id]/items/[itemId]/photo/route.ts` | 接受 `spec-<段>-<下标>`（不存在 404，先判定再写文件）；Blinds 行仍写 `blinds_order_item`，工艺参数单元写 `blinds_order_unit` / `<orderId>:<段>:<下标>` + 位置快照；`writeAuditLog` 失败 → 500 |
| `src/app/api/install/tasks/[id]/complete/route.ts` | 零单元 409 `NO_UNITS`；状态日志文案"（N 项）" |
| `src/components/install/install-types.ts`、`install-task-detail.tsx` | 段标签、产品描述行去空、位置已变提示、零单元说明、"还差 N 项" |
| `src/app/(main)/blinds-orders/[id]/page.tsx` | 收口标签显示段标签与"位置已变" |
| 测试 | `closeout-units.test.ts`（纯，27）、`closeout-db.isolated.test.ts`（隔离库 + 真实路由，26）；均已注册 `scripts/test-all.sh` |

未改：`src/lib/sunny-process/**`、文件代理鉴权、状态机、transition 路由、权限键与岗位（design Non-Goals）。

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/install/__tests__/closeout-units.test.ts` | 27 passed |
| `npx tsx src/lib/install/__tests__/closeout.test.ts`（INSTALL-1 既有） | 16 passed（基线 16） |
| `npx tsx src/lib/install/__tests__/scope.test.ts`（INSTALL-1 既有） | 15 passed（基线 15） |
| 隔离库端到端 `closeout-db.isolated.test.ts`（本地 Postgres 16 + pgvector，`prisma db push`） | 26 passed：只有 Vinyl 单 3 单元 → 上传写 `blinds_order_unit` + 位置 → 列表 2/3 = 详情 2/3 → `spec-vinyl-5` 404 且无文件 → 他人 403 且无文件 → 未拍完 409 列出 #3 → 拍完 complete 200、工艺单 installed；混合单 4 单元、Blinds 仍写 `blinds_order_item`；改位置后未收口（原位置主卧）；用数据库触发器制造审计写入失败 → 500 `RECORD_FAILED` 且单元未收口；零单元 409 `NO_UNITS` 状态不变；他人任务详情 403；工艺单已 cancelled → 409 `ORDER_STATUS` 预约不变；响应无金额字段 |
| 浏览器走查（本地 `next dev` + Playwright，手机视口，安装工会话） | 只有 Vinyl 的任务：3 个单元带"Vinyl 百叶"标签、按钮"完成收口（还差 3 项）"禁用 → 逐个拍照（真实 jpeg，经客户端压缩上传）→ 按钮变"完成收口"可点 → 点击后"已于…完成收口"，缩略图经文件代理加载（naturalWidth 780）；零单元任务：显示说明、无按钮、无"还差 0"。截图 `docs/install-2a-screenshots/01-vinyl-before.png`、`02-vinyl-completed.png`、`03-zero-units.png` |
| `npm run typecheck` | 0 error |
| `npm run lint:baseline` | PASS（相对基线 −14 error） |
| `npm run test:ci` | PASS |
| `bash scripts/check-test-registry.sh` | OK（459 注册 / 基线 72） |
| `grep -rnE "grandTotal\|price\|msrp\|costPrice" src/app/api/install src/lib/install` | 空 |
| `openspec validate install-2a-closeout-all-lines --strict` | valid |
| 全量 `npm test`（隔离库，`NODE_OPTIONS=--max-old-space-size=8192`） | 469/478。9 个失败与本 change 无关：8 个与 PERM 交接记录的基线同一批（报价 PDF 分页无 Chromium 字体；Phase3A-3 Approvals Smoke、3A-4 Governance Smoke、3A-4 Acceptance、3A-5 Overview Acceptance；T4 授标情报矩阵；Autopilot A2-P0 —— 本地库缺双租户种子；`sunny-process/autogen-db.isolated` 在 main 上同样 `NO_BINDING`）；第 9 个 Mention Gateway M2-A Identity DB 3 条断言失败，原因是这些 CHECK 约束只在 `prisma/migrations/20260824170000_add_mention_gateway_external_identity/migration.sql` 里，`prisma db push` 建的本地库没有——环境性。TypeScript 类型检查本次在套件内通过（设了堆上限） |

## 4. 判断点（审核请重点看）

1. **单元 id 用"段 + 下标"**（D1）：工艺参数行没有稳定 id；没有给工艺参数加 uid，是为了不碰 `sunny-process`。代价见第 2 点。
2. **位置不一致就不计入**（D2）：出单在拍照后增删行会让下标错位；用位置快照挡住"照片挂错窗"，代价是现场补拍。选的是"宁可多拍一张"，因为收口是会计核对与后续质保的依据。
3. **布帘 / 纱帘各一个单元**（D4）：同一窗两层可能只装了一层；安装工要拍两次。
4. **Blinds 行不做位置比对**：它们有稳定 id，INSTALL-1 的历史记录也没有位置快照，照旧计入。
5. **孤儿文件**（D5）：审计失败时已上传的 Blob 不删除（私有、无引用）。

## 5. 已知限制 / 观察

- `blinds_order_unit` 记录加入不可清理清单（与 INSTALL-1 的 `install.window.completed` / `install.task.*` 一样）。
- 工艺参数单元的产品描述里，Vinyl 行"Vinyl 百叶"会同时出现在段标签与描述行（显示重复，不影响功能）。
- 走查中观察到（INSTALL-1 既有，非本 change）：安装工页面首次加载的瞬间，手机底栏先显示"总览 / AI / 助手 / 更多"，权限加载完才变成"安装 / 助手 / 更多"。
- 第二次安装 / 按访次聚合 / 照片代理放行历史访次被分配人：INSTALL-2d。

## 6. 上线动作

- 无数据迁移、无配置。合并即生效；此前卡住的 Shutters / 窗帘单，安装工重新打开任务页即可拍照收口。
- 合并后独立小 PR `/opsx:archive install-2a-closeout-all-lines --yes`，TASKFLOW INSTALL-2a 改 `[x]`。
- 下一个：`/opsx:propose install-2b-balance-warranty`。
