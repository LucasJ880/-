# INSTALL-2d 报告 — 装不完：现场标记问题 + 数字化维修单

change：`openspec/changes/install-2d-repair-form/`（proposal / specs：新 `installation/repairs`、`installation/install-stage`，改 `installation/window-closeout`「收口状态聚合」、`installation/install-tasks`「开始与完成状态」/ design D1–D12 / tasks 8/8）
方案：`docs/QINGYAN_INSTALL-2_CLOSEOUT_REPAIR_TASKBRIEF.md` §1、§4.1–4.3、§5、§6、§12 Q8 / Q11
零 schema：问题记录 `AuditLog(install.window.issue)`、维修单 `AuditLog(install.repair.submitted)`、预约用既有 `status / completedAt`、通知用既有 `Notification`。不加权限键，不建审批，不对外发送，不新增 LLM 调用。

## 1. 做了什么

| 场景 | 改前 | 现在 |
|---|---|---|
| 现场有窗装不了 | 只能"完成收口"；有问题的窗无处记录，按钮一直"还差 N 项" | 每扇窗二选一：「拍照完成」或「有问题」（问题类型下拉、描述、问题照必填）；修好后再拍完工照即恢复为已收口 |
| 底部按钮 | 只有「完成收口」 | 全部已收口 →「完成收口」；没有未处理且有问题 →「提交维修单（N 项有问题）」；还有未处理 → 禁用并写"还差 N 项：#3 Kitchen" |
| 维修单 | 纸质（SUNNY SHUTTER INC 模板） | 表单预填客户名 / 电话（可改）、Order#、Taken by、Notes、Filling Date；行由系统按"有问题"的窗生成（位置 / 描述 / 问题类型 / 是否需工厂 / 问题照）；客户期望日（可选）、"已和客户确认"；目标返修日 = 期望日或填写日 + 7 天；单号 `R-<工艺单号>-<n>` |
| 提交之后 | — | 本次安装结束（结果"需返修"），工艺单保持"已排期"（不进会计待收尾款）；同一次安装重复 / 同时提交只产生一张 |
| 谁知道 | 没人知道 | 需工厂行品类的出单岗（品类推不出 → 三个出单岗）、运营主管、会计、老板收到"返修单 R-…"→ 维修单详情；销售收到"返修中：…"→ 工艺单详情的安装状态卡；客户原因 / 现场条件的单不通知出单岗；提交人不收 |
| 返修单页面 | — | `/install/repairs` 列表（按目标日，逾期标红；`/install` 对全企业范围的人显示入口）、详情（问题照）、打印版（纸质版式，抬头大写，补到 10 行，无照片无金额）；安装工、销售打不开 |
| 销售看到什么 | 工艺单详情只有工艺参数 | 顶部"安装状态"卡：已排 X 日安装 / 返修中，目标 X 日（单号、各行位置与问题类型）/ 已装完，收尾款 / 已结清 · 质保邮件状态 / 已完工（历史单）；不出照片、描述、电话、金额 |
| 工艺单"收口"标签 | 只看照片张数 | 按单元状态显示已收口 / 有问题（问题照与描述）/ 未收口，标出有问题数与维修单号 |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/install/repair.ts`（新，纯） | 问题类型表与是否需工厂、问题 / 表头校验、目标日、单号、逾期、记录解析、需工厂品类、打印补行 |
| `src/lib/install/stage.ts`（新，纯） | `installStage` 与阶段名 / 销售文案（与 2b 会计列表同一规则，测试对拍全组合） |
| `src/lib/install/closeout.ts` | 聚合同时读问题记录，单元状态取最新（done / issue / pending），汇总加有问题数，`unhandledUnits` |
| `src/lib/install/service.ts` | 收口日志同时查问题记录；列表 / 详情带有问题数、单元问题、维修单摘要 |
| `src/lib/install/repair-service.ts`（新） | 读维修单、提交（两把 advisory lock、服务端生成行、事务内写维修单 + 预约完成 + `install.task.completed` needs_repair）、通知收件人、`loadOrderStages`、序列化 |
| `src/lib/install/balance.ts`、`balance-service.ts` | 落点函数加 `install_repair` / 维修单通知；`notifyInstallUser` 可传实体 id；完成收口记录排除 needs_repair |
| 路由（新） | `POST /api/install/tasks/[id]/items/[itemId]/issue`、`POST /api/install/tasks/[id]/repair`、`GET /api/install/repairs`、`GET /api/install/repairs/[id]`、`GET /api/blinds-orders/[id]/install-status` |
| `src/app/api/install/tasks/[id]/route.ts` | 已完成任务带维修单摘要 |
| 页面 / 组件 | `install-task-detail.tsx`（有问题表单、按钮切换、维修单对话框）、`install-task-list.tsx`（返修单入口、需返修标记）、`install-types.ts`、`repair-pages.tsx`（列表 / 详情 / 打印）、`install-status-card.tsx`、`src/app/(main)/install/repairs/**`、`blinds-orders/[id]/page.tsx`（状态卡 + 收口标签按状态） |
| 通知登记 | `install_repair_submitted`：类型表、引入日期、开关文案"返修单已提交"、图标 |
| `src/lib/api-fetch.ts` | `/api/install/repairs` 按当前企业 |
| 测试 | `repair.test.ts`（35）、`stage.test.ts`（23）、`repair-db.isolated.test.ts`（61）、`closeout-units.test.ts`（+9 → 41）、`balance.test.ts`（+2 → 46）；均已注册 |

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/install/__tests__/repair.test.ts` | 35 passed |
| `npx tsx src/lib/install/__tests__/stage.test.ts` | 23 passed |
| `closeout-units.test.ts` / `closeout.test.ts` / `scope.test.ts` | 41 / 16 / 15 passed |
| `balance.test.ts` / `warranty.test.ts` | 46 / 46 passed |
| 隔离库 + 真实路由 `repair-db.isolated.test.ts` | 61 passed（见 §3.1） |
| 2a / 2b / 2c 隔离库回归 | `closeout-db` 26、`balance-db` 36、`warranty-db` 31 全过 |
| 浏览器走查（本地 `next dev` + Playwright，安装工手机视口 → 出单·Vinyl → 运营主管 → 会计 → 销售） | 16/16 + 收口标签 5/5（见 §3.3） |
| `npm run typecheck` | 0 error |
| `npm run test:ci` | PASS |
| `npm run lint:baseline` | PASS（相对基线 −14 error，无新增 fingerprint） |
| `bash scripts/check-test-registry.sh` | OK（468 注册） |
| `openspec validate install-2d-repair-form --strict` | valid |

### 3.1 隔离库端到端覆盖

标记问题：缺照片 / 缺描述 / 未知类型 400 且不写记录；他人任务 403；不属于该单的单元 404；成功 → 审计目标 `<工艺单>:vinyl:1`、需工厂、位置快照；详情带类型名 / 描述 / 问题照（代理地址）、汇总"已收口 1 / 3，有问题 1"；数据库触发器制造写入失败 → 500 提示重拍，单元仍未处理。提交条件：还有未处理 409 `UNITS_UNHANDLED`（列出 #2 Living Room）；全部已收口 409 `NO_ISSUES`；期望日早于今天 / 客户名为空 400 且预约不变、无维修单；他人任务 403。提交效果：单号 `R-<单号>-1`、目标日 = 今天 + 7、1 行；预约 completed、工艺单仍 scheduled、无新状态日志；`install.task.completed` 结果 needs_repair 带单号；行 = Den / 尺寸不符 / 需工厂 / Vinyl / 问题照；表头 Taken by / 电话 / 填写日（企业时区）；重复提交 200 idempotent 同一单号；任务详情带单号 / 目标日 / 行数；完成后再标问题 409；已收口完成的任务提交 409；并发两次只一张、通知不重复。通知：出单·Vinyl 一条（维修单实体），布帘 / Roller 不收；运营主管 / 会计 / 老板各一条；销售一条（工艺单实体）；提交人不收；标题摘要无金额；四个收件岗打开维修单详情 200，销售打开工艺单详情与状态卡 200；客户原因单（期望日 +10、已确认）出单岗都不收；品类推不出（产品"百叶窗X"）三个出单岗都收。列表 / 详情：安装工、销售 403；出单岗 200（阶段返修待出单、品类 Vinyl、按目标日升序、客户原因单为返修待排期）；详情含问题照代理地址与表头，打印抬头取质保设置种子；不出金额与原始存储路径；他企业 404；id 指向别的审计行 404。状态卡：创建人销售看到"返修中，目标 <日期>"、单号、行位置与问题类型，不出照片 / 描述 / 电话 / 备注 / 金额；他企业 404；同企业另一位销售与工艺单详情读权一致；客户原因单返修待排期且已确认；未返修单"已排 <日期> 安装"；正常收口完成的单"已装完，收尾款"。

### 3.2 全量 `npm test`

隔离库、`NODE_OPTIONS=--max-old-space-size=8192`：**478/487**。9 个失败与 2a / 2b / 2c 报告记录的同一批环境性失败完全一致、与本 change 无关：Mention Gateway M2-A Identity DB（`prisma db push` 不建迁移里的 CHECK 约束）、`sunny-process/autogen-db.isolated`（`NO_BINDING`）、Phase3A-3 Approvals Smoke、Phase3A-4 Governance Smoke、Phase3A-4 Acceptance、Phase3A-5 Overview Acceptance、Autopilot A2-P0、T4 授标情报矩阵、报价 PDF 分页（无 Chromium 字体）。套件内 TypeScript 类型检查通过；本 change 的 `repair`（35）、`stage`（23）、`repair-db.isolated`（61）与 2a / 2b / 2c 的收口、尾款、质保测试全过。

### 3.3 浏览器走查

| # | 谁 | 步骤 | 结果 |
|---|---|---|---|
| 1 | 安装工（手机） | 1 号窗拍完工照；2 号窗"有问题"选"尺寸不符需重做"、写"高度短 2cm"、拍问题照 | 2 号窗显示有问题卡片；底部按钮禁用"还差 1 项：#3 Kitchen" |
| 2 | 安装工 | 3 号窗拍完工照 | 底部变「提交维修单（1 项有问题）」，没有「完成收口」 |
| 3 | 安装工 | 打开维修单 | 客户名 / 电话已预填；问题行预览；"默认填写日 + 7 天"；写备注、勾选已和客户确认 |
| 4 | 安装工 | 提交 | 200，单号 `R-<单号>-1`；任务页显示"已提交维修单 … 目标返修日 …" |
| 5 | 出单·Vinyl | 点铃铛里的"返修单 R-…" | 落到维修单详情：返修待出单、尺寸不符需重做、高度短 2cm、Vinyl、问题照 |
| 6 | 出单·Vinyl | 打印维修单 | SUNNY SHUTTER INC / 2-680 PROGRESS AVENUE…、10 行、Filling Date、目标返修日，无照片无金额 |
| 7 | 运营主管 | `/install` →「返修单」 | 列表行：单号 / 已和客户确认 / Vinyl / 返修待出单 |
| 8 | 会计 | 点铃铛里的"返修单 R-…" | 维修单详情可读 |
| 9 | 销售 | 点铃铛里的"返修中：…" | 落到工艺单详情，状态卡"返修中，目标 2026-11-04"、单号、"Den · 尺寸不符需重做"；不出描述 / 电话 / 金额；打不开 `/install/repairs` |
| 10 | 出单·Vinyl | 工艺单"收口"标签 | 已收口 2 / 3、有问题 1 项、提交维修单单号、2 号窗"有问题：尺寸不符需重做"+ 问题照 + 描述 |

截图：`docs/install-2d-screenshots/01-installer-issue-pending.png` … `11-order-closeout-tab.png`。

走查与自审中发现并修正：
- 工艺单"收口"标签原来按照片张数判断，先拍完工照后标问题的窗会显示绿色"1 张"——改为按单元状态显示，并标出有问题数与维修单号（spec「收口状态聚合」要求收口标签与列表 / 详情一致）。
- 状态卡最初只在部分阶段显示——spec 要求每个阶段都显示，已改。
- spec「安装状态接口」原写"非创建人销售 → 404"，与既有读范围不符（同企业成员可读无项目归属的单，`fulfillment/order-category-access`）——场景改为"他企业成员 → 404"，并加"状态卡与工艺单详情读权一致"的断言。
- 截图时照片还没加载完显示为空白——确认代理对四个岗位都返回 200 后，等图片解码完成再截。

## 4. 判断点（审核请重点看）

1. **维修单的行由系统生成**（D2）：安装工不能另填与窗无关的行；与窗无关的问题写在 Notes。
2. **提交即结束本次安装、工艺单不动**（D4）：工艺单保持"已排期"，不进会计"待收尾款"；系统里排第二次安装在 2e。**2d 与 2e 同批上线**：只上 2d 时，提交维修单后系统里排不了二次上门，状态卡一直"返修中"。
3. **通知谁**（D7）：出单只收到自己品类、且需工厂的单；客户原因 / 现场条件只通知运营 / 会计 / 老板 / 销售。
4. **"其他"类型默认需工厂**：安装工可以取消勾选。
5. **历史手工完工**（§12 Q11）：状态卡显示"已完工"，不算待收尾款；2b 列表同一规则（2b 单独修正提交 `62476e3`）。
6. **维修单暂不能作废**：提交错了要到 2e（返修关闭 / 作废）才能处理。

## 5. 已知限制

- 维修单列表取最近 200 张再按目标日排序；量大后需分页。
- 维修单表单的目标日预览按浏览器日期算，提交时以企业时区为准（跨日时两者可能差一天，服务端结果为准）。
- 打印走浏览器打印（隐藏页面其余部分），不生成 PDF。
- `install.window.issue`、`install.repair.*` 在不可清理清单（任务书 §7）。
