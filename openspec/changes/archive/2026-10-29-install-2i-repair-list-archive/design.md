# Design: install-2i-repair-list-archive

## Context

动机见 proposal.md。现状（2d–2f）：维修单是 `AuditLog(install.repair.submitted)`，出单、排期、关闭都是同一工艺单上的后续事件（`install.repair.factory_issued / scheduled / completed`，`afterData.repairId` 指向维修单）；"是否关闭、怎么关的"由 `repairProgress` 从事件推导。列表接口取本企业最近 200 条提交记录，对每条都算阶段、姓名、进度后整体返回，页面一张表。

## Goals / Non-Goals

**Goals**
- 关闭即归档，不需要人操作，也不新增任何记录。
- 列表没有条数上限；每次请求只对当前页做完整计算。
- 已归档的每条能直接看出结束方式。

**Non-Goals**
- 不改维修单详情接口 `src/app/api/install/repairs/[id]/route.ts` 与打印页。
- 不改关闭 / 作废 / 排期等写接口与通知（`repair-service.ts` 的写路径）。
- 不改 `/install` 任务列表、会计"待收尾款"列表。
- 不碰 Prisma schema、`src/lib/muse-bridge/**`。

## Decisions

### D1 归档由关闭事件推导
已归档 = 存在本维修单的 `install.repair.completed` 事件（任何原因）；未关闭 = 进行中。
- 否决：关闭时另写一条"已归档"事件——与关闭事件重复，两者可能不一致。
- 否决：让人手动归档——Lucas 要的是"完成后自动归档"。

### D2 服务端先轻量全量、再只序列化当前页
一次请求：① 读本企业全部维修单提交记录（只取 id / afterData / createdAt / userId）；② 读这些工艺单上的关闭事件（只 `install.repair.completed`）；③ 读工艺单归属与单号（id / code）；④ 纯函数分栏、搜索、排序、分页并算两栏总数；⑤ 只对当前页读阶段、提交人 / 关闭人姓名与全部事件，复用既有列表序列化。
- 否决：在数据库里按 JSON 分页——关闭是另一条审计记录，需要 JSON 关联查询，复杂且难测。
- 否决：浏览器端分页——仍要一次拿全量到浏览器，还保留 200 上限。

### D3 排序与搜索
进行中：目标日升序，同日按单号；已归档：关闭时间倒序，同时间按单号。`q` 去首尾空格、最多 60 字、转小写，对单号、工艺单号（当前工艺单号，没有时用提交时记的单号）、客户名做包含匹配。

### D4 参数容错
`tab` 不是 `archived` 一律按 `open`；`page` 非正整数按 1；`pageSize` 非数字按 20，再夹到 1–50。页码超出总页数返回空列表与正确总数（不报错）。

### D5 列表项的关闭情况补全
列表项 `closed` 在原有原因 / 中文名 / 转入单号之外加原因说明、关闭时间、关闭人姓名；进行中项的 `closed` 仍为 null。
- 否决：已归档只给单号让人点进详情——"查的时候就知道是什么情况"要在列表一眼看到。

### D6 页面状态在地址里
`/install/repairs?tab=&q=&page=`：切页签保留搜索词、页码回到 1；搜索提交页码回到 1；翻页只改 page。刷新、分享链接都保持同一视图。

## 与八条硬纪律

1. 零 schema：只读既有 `AuditLog` 与工艺单字段；不写任何新记录。
2. 出站先审批：不涉及（无对外发送）。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及 Muse；列表仍不出金额与照片。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：分栏 / 搜索 / 排序 / 分页都是纯函数，不加 LLM 调用。
8. 测试注册：新增 `repair-list-db.isolated.test.ts` 登记进 `scripts/test-all.sh`。

## Risks / Trade-offs

- [每次请求读全量提交记录] → 只取 4 列、关闭事件只取一种动作，当前页之外不做序列化；维修单量级（每年数百到数千）下可接受。量再大时可加缓存，接口不变。
- [默认只显示进行中] → 页签上显示已归档条数，一键切换；搜索在两栏都显示条数。

## Migration Plan

部署即生效；无数据迁移。回滚 = 回退本 PR，页面回到单表、200 上限。

## 验证方式

- `npx tsx src/lib/install/__tests__/repair.test.ts`：参数容错、分栏、搜索、排序、分页、两栏总数。
- 隔离库 `repair-list-db.isolated.test.ts`：作废后自动归档；205 张进行中分页；搜索；已归档结束情况；安装工 403。
- `repair-db`、`repair-dispatch-db`、`repair-close-db` 隔离库回归（后者列表断言改查已归档栏）。
- `npm run typecheck`、`npm run lint:baseline`、`npm run test:ci`、`bash scripts/check-test-registry.sh`、`openspec validate install-2i-repair-list-archive --strict`；全量 `npm test`。
- 本地浏览器走查：两个页签与条数、搜索、翻页、已归档结束情况、地址保持；截图存 `docs/install-2i-screenshots/`。
