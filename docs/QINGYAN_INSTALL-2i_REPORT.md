# INSTALL-2i 报告 — 维修单列表分栏（进行中 / 已归档）+ 分页 + 搜索

change：`openspec/changes/install-2i-repair-list-archive/`（proposal / specs：`installation/repairs` 新增 2 条、修改 2 条 / design D1–D6 / tasks 5/5）
来源：Lucas 2026-10-29——"维修单列表分页，但是要分开那种，完成后自动归档，之后我们查的时候就知道是什么情况"。
零 schema：归档由既有 `AuditLog(install.repair.completed)` 推导，不写任何新记录；只读接口，无对外发送。

## 1. 做了什么

| 项 | 之前 | 现在 |
|---|---|---|
| 列表 | 一张表，取最近 200 张，进行中与已关闭混在一起 | **进行中 / 已归档**两个页签，各带条数 |
| 归档 | — | 维修单一关闭（返修完成、转入新单、已作废、关闭不返修）**自动**只出现在已归档栏，不用人操作 |
| 条数上限 | 200 | 无上限；两栏都分页（默认每页 20，最多 50） |
| 排序 | 目标日升序 | 进行中：目标日升序；已归档：关闭时间倒序（最近结束的在最上面） |
| 搜索 | 无 | 单号 / 工艺单号 / 客户名，不分大小写包含匹配，两栏通用；页签条数按搜索词更新 |
| 查一张旧单 | 只能看到"已作废"等字样 | 已归档每行：结束情况（返修已完成 / 返修时又发现问题，转入 R-… / 已作废：原因 / 关闭不返修：原因）、关闭人、关闭时间 |
| 地址 | `/install/repairs` | `/install/repairs?tab=archived&q=…&page=2`：刷新、分享链接保持同一视图 |

## 2. 改了哪些文件

| 文件 | 内容 |
|---|---|
| `src/lib/install/repair.ts` | `parseRepairListQuery`（参数容错）、`repairListPage`（分栏 / 搜索 / 排序 / 分页 / 两栏总数） |
| `src/app/api/install/repairs/route.ts` | 去掉 200 上限；先轻量全量（提交记录 + 关闭事件 + 工艺单单号）分栏分页，只对当前页读阶段、姓名与全部事件；响应带 `tab / q / page / pageSize / total / counts` |
| `src/lib/install/repair-service.ts` | 列表项 `closed` 补原因说明、关闭时间、关闭人 |
| `src/components/install/repair-pages.tsx`、`install-types.ts`、`src/app/(main)/install/repairs/page.tsx` | 页签、搜索框、翻页、已归档列；地址参数（`useSearchParams`，页面包 `Suspense`） |
| 测试 | `repair.test.ts`（127 → 139）；新增 `repair-list-db.isolated.test.ts`（18）并注册；`repair-close-db.isolated.test.ts` 列表断言改查已归档栏（76 → 77） |

## 3. 怎么验

| 项 | 结果 |
|---|---|
| `npx tsx src/lib/install/__tests__/repair.test.ts` | 139 passed |
| 隔离库 + 真实路由 `repair-list-db.isolated.test.ts` | 18 passed：安装工 403；真实提交 → 作废 → 进行中栏没有、总数减 1、已归档第一条是它；按单号搜已归档带已作废 / 原因说明 / 关闭人 / 关闭时间、不标逾期、不出金额与照片；205 张进行中每页 50 第 5 页 5 条、第 6 页空、跨页升序、`pageSize=500` → 50、进行中 206（无 200 上限）；客户名（大小写不同）/ 单号 / 工艺单号搜索与两栏计数 |
| 维修单回归 | `repair-db` 61、`repair-dispatch-db` 54、`repair-close-db` 77 全过 |
| 浏览器走查（本地 `next dev` + Playwright，运营主管） | 15/15（见 §3.2） |
| `npm run typecheck` | 0 error |
| `npx eslint src/components/install` 与改动文件 | 0 error |
| `npm run lint:baseline` | PASS |
| `npm run test:ci` | PASS |
| `bash scripts/check-test-registry.sh` | OK（492 注册） |
| `openspec validate install-2i-repair-list-archive --strict` | valid |

### 3.1 全量 `npm test`

隔离库、`NODE_OPTIONS=--max-old-space-size=8192`：**502/511**（2h 时 499/508；+1 为本 change 新登记的 `repair-list-db.isolated`，另 +2 为 main 上别的 change）。9 个失败与 2a–2h 报告记录的同一批环境性失败完全一致、与本 change 无关。套件内类型检查与测试注册校验（492）通过；INSTALL-1 / 2a–2i 全部安装测试 0 失败（`repair` 139、`repair-list-db.isolated` 18）。

### 3.2 浏览器走查

| 检查 | 结果 |
|---|---|
| 页签条数：进行中 25、已归档 3；默认选中进行中 | ✓（`01-open-page1.png`） |
| 第 1 页 20 行，"共 25 张 · 第 1 / 2 页" | ✓ |
| 下一页 → 地址 `page=2`、5 行；最后一页"下一页"不可点 | ✓ |
| 切已归档 → 页码回到 1、3 行 | ✓ |
| 结束情况：返修已完成 / 关闭不返修：客户接受色差 / 已作废：Den 标错了，实际没问题；关闭人、关闭时间 | ✓（`02-archived.png`） |
| 搜索 PEMBERTON（大小写不同）→ 已归档 1 行；进行中页签条数按搜索词更新 | ✓（`03-search-archived.png`） |
| 刷新后页签、搜索词、结果保持 | ✓ |

## 4. 判断点

1. **归档 = 已关闭（任何原因）**（D1）：不另写"归档"记录，不会和关闭状态不一致；没有手动归档 / 取消归档。
2. **每次请求读全量提交记录**（D2）：只取 4 列 + 一种关闭事件，当前页之外不序列化；维修单量级（每年数百到数千）可接受，量再大时可加缓存，接口不变。

## 5. 已知限制

- 无按日期、品类、阶段的筛选与导出。
- 安装任务列表、会计"待收尾款"列表未分页（不在本 change）。
