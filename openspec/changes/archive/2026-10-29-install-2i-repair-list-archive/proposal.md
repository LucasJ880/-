# Proposal: install-2i-repair-list-archive

**TASKFLOW：** INSTALL-2i（`docs/QINGYAN_PERMISSION_TASKFLOW.md` INSTALL-2 段）。依赖 INSTALL-2f（维修单关闭原因、原因说明、操作人）。来源：Lucas 2026-10-29——"维修单列表分页，但是要分开那种，完成后自动归档，之后我们查的时候就知道是什么情况"。
**受影响的 Muse 意图：** 无。不改 `src/lib/muse-bridge/**`。

## Why

维修单列表只取最近 200 张、进行中与已关闭混在一张表里：单子多了以后旧单查不到，已经处理完的单挤占着要跟进的单，事后查一张单也看不出它是怎么结束的。

## What Changes

- 维修单列表分"进行中"与"已归档"两栏：维修单一关闭（返修完成、转入新单、已作废、关闭不返修）就自动只出现在已归档栏，不需要人操作。
- 两栏都分页（默认每页 20、最多 50），去掉 200 张上限；进行中按目标日升序，已归档按关闭时间倒序。
- 搜索：按单号、工艺单号、客户名不分大小写包含匹配，两栏通用；两栏标签显示各自的条数（按同一搜索词）。
- 已归档每条另含关闭原因、原因说明或转入单号、关闭人与关闭时间，一眼看出这张单是怎么结束的。
- 页面 `/install/repairs`：两个页签、搜索框、翻页；栏、搜索词、页码写进地址（可直接分享、刷新不丢）。
- 写 `docs/QINGYAN_INSTALL-2i_REPORT.md`，TASKFLOW 增 INSTALL-2i 行并改 `[G]`。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `installation/repairs`：修改「维修单列表与详情」「维修单的进度与可执行操作」（列表关闭原因改在已归档栏）；新增「维修单列表分栏、分页与搜索」「已归档维修单的结束情况」。

## Impact

- 改：`src/lib/install/repair.ts`（分栏 / 搜索 / 排序 / 分页纯函数）、`src/app/api/install/repairs/route.ts`（参数、只对当前页做完整序列化、两栏计数）、`src/lib/install/repair-service.ts`（列表项带关闭时间 / 关闭人 / 原因说明）、`src/components/install/repair-pages.tsx` 与 `install-types.ts`（页签、搜索、翻页、已归档列）。
- 数据库：零 schema。分栏由既有 `AuditLog(install.repair.completed)` 推导，不写新记录。
- 权限：不变（`install.task.read` ORG）。
- 测试：`repair.test.ts` 补纯函数断言；新增 `repair-list-db.isolated.test.ts`（真实路由 + 隔离库）并注册；`repair-close-db.isolated.test.ts` 的列表断言改查已归档栏。

## Out of scope

- 手动归档 / 取消归档（归档只由关闭决定；撤销关闭另议）。
- 按日期范围、品类、阶段筛选；导出。
- 安装任务列表、会计"待收尾款"列表的分页。
