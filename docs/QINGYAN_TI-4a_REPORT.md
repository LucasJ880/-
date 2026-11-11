# TI-4a 报告：投标工作区的存取接口

| 项 | 值 |
|---|---|
| change | `tender-bid-workspace-api` |
| TASKFLOW | TI-4a（Phase F，Tender Intelligence Phase C 第一项） |
| 来源 | `docs/tender-intelligence-gap-analysis.md` §6 的 N12、§7 方案甲 |
| 授权 | Lucas 2026-11-11：「其他你来主导，需要确定的按推荐做」——四件套未另等审核；Owner Gate B 的数据库方案由本会话代定为零 schema |
| 分支 | `claude/tender-bid-workspace-api`（叠在 TI-3b 之上） |
| 性质 | 新增三个接口，开关默认关。零 schema、零模型调用、零对外动作。开关关闭时线上行为零变化 |

## 1. 交付清单

| 位置 | 内容 |
|---|---|
| `src/lib/tender-bid-workspace/flags.ts` | 开关 `TENDER_BID_WORKSPACE_ENABLED` 与组织白名单 `TENDER_BID_WORKSPACE_ORG_ALLOWLIST`，默认关 |
| `src/lib/tender-bid-workspace/contract.ts` | 已存内容、保存请求、成本核算请求的校验；未知字段一律剥除；分块合并 |
| `src/lib/tender-bid-workspace/workspace-view.ts` | 由已存内容现算读取结果；由请求里的成本输入加已存行项算核算表 |
| `src/lib/tender-bid-workspace/store.ts` | 加锁读改写、只替换自己的键、写审计；读取所需的项目事实 |
| `src/app/api/projects/[id]/bid-workspace/route.ts` | `GET` 读取、`PUT` 分块保存 |
| `src/app/api/projects/[id]/bid-workspace/cost-sheet/route.ts` | `POST` 成本核算（不落库） |
| `.env.example` | 两个变量的说明 |

## 2. 接口

| 接口 | 权限 | 做什么 |
|---|---|---|
| `GET /api/projects/{id}/bid-workspace` | 项目读权限 | 返回已存内容与现算结果：价格表校验、逐行尺寸对照、逐行认证闸、文件领取方汇总、可投标判定、十三个阶段的决定与三张清单。**不含任何金额** |
| `PUT /api/projects/{id}/bid-workspace` | 项目写权限 | 分块保存：价格表行项、每行的拟投品牌型号 / 产品尺寸 / 证书、文件领取方名单、补遗。没给的块保持原值 |
| `POST /api/projects/{id}/bid-workspace/cost-sheet` | 财务查看权 | 请求里带成本输入，返回核算表视图、Markdown、带成本的可投标判定。**不保存任何东西** |

开关关闭，或项目所属组织不在非空的白名单内：三个接口都返回 404，不读不写。

## 3. 一个改变了存储方案的发现

Owner Gate B 原定「零 schema，落既有 JSON 位」。实施前核对存储位时发现：

- `GET /api/projects/{id}/bid-intelligence` 把情报室整行（含 `summaryJson`）返回给任何有项目读权限的人（`src/app/api/projects/[id]/bid-intelligence/route.ts:20-31`）。
- 另一个候选位 `BidIntelligenceModule.dataJson` 也不行：情报页签会遍历全部模块，把未知模块的数据原样渲染出来。

所以**供应商报价与成本假设不能放进这个 JSON 位**——放进去就绕过了「成本按财务访问规则看」（Owner Gate A 第 10 项）。本次这样处理：

- 非财务内容（价格表行项、拟投型号、证书、领取方名单、补遗）照常存 `BidIntelligenceRoom.summaryJson.bidWorkspace`。它们与情报页签里已有的内容同一敏感级别。
- 成本核算做成「带着输入算一次」：输入来自请求，结果只返回给有财务查看权的人，不落库。

顺带说明：这个 JSON 位里早就有 `pricingInputs.ourCostCad`（定价助手的手填成本），它今天对所有项目读者可见。这是差距分析 §8 记过的既有问题，本次没有动。

### 成本输入最终存哪里：需要 Owner 决定

| 候选 | 好处 | 代价 |
|---|---|---|
| 甲：专用表（成本情景与其行） | 有约束、可按财务权限单独控制、可审计、可跨项目查询 | 需要硬纪律第 1 条的例外并写进 `openspec/config.yaml`；一次生产迁移，走 Owner Gate |
| 乙：并入报价引擎（`ProjectQuote` + `QuoteCostLine`） | 不新增表；成本分项名称已对齐；核算结果直接成为可审批的报价 | 报价引擎的内部成本今天对所有项目角色（含只读）可见，比财务访问规则宽；建一行报价会改变既有流程的判断（「下一步」查表用报价是否存在判断是否已定价）；要改报价引擎的行模型以对应招标行 |
| 丙：维持不落库 | 零风险 | 成本输入只在浏览器里，换设备就没了；不能多人协作 |

我的建议是甲。成本数据值得一张有权限边界的表，而且「按招标行的成本情景」与报价引擎现在的「按成本类别的成本行」形状不同，硬并进去两边都别扭。在 Owner 决定之前，本次与下一个界面 change 都按丙运行。

## 4. 验收项对应

| 任务书验收项 | 测试（`bid-workspace-db.isolated.test.ts`，真实路由 + 隔离库） |
|---|---|
| A17 租户 A 读不到也改不了租户 B 的证据、笔记、文档与导出 | 其它组织的管理员读、写、成本核算都被拒，数据未变；请求体里伪造的组织与用户被忽略，数据落在项目自己的组织下 |
| A20 开关关闭不改变现有 Tender / Supplier 流程 | 开关关闭或组织不在白名单：三个接口 404，没有新建情报室记录，没有审计记录；保存时同一 JSON 位里其它功能的内容逐字保留 |
| A22 真实的 Owner 动作由登录态记录，不是自动填的字段 | 审计记录的操作者是登录用户；请求体里的 `userId` / `updatedById` 被忽略 |

另外覆盖：只读成员能读不能存；有写权限但没有财务查看权的成员拿不到核算表（403）；成本核算不落库（情报室记录与审计记录都不变）；并发的两次分块保存不互相覆盖。

## 5. 测试输出（实际运行）

```text
tender-bid-workspace contract: 24 passed
tender-bid-workspace view: 22 passed
TI-4a bid workspace DB: 40 passed, 0 failed
```

隔离库测试是在本容器的本地 PostgreSQL 16（已应用仓库全部 43 个迁移）上跑的，`assertSafeTestDatabase` 输出 `Host: localhost`、`SAFE_TO_TEST = YES`。没有隔离库时该测试自动跳过（CI 里就是这样）。

门禁：

```text
bash scripts/check-test-registry.sh → OK 测试注册校验通过：已注册 579 个；历史欠账基线剩余 68 条（只减不增）
bash scripts/test-runtime-architecture.sh → runtime-architecture guards PASS
npx tsx scripts/public-route-auth-contracts.test.ts → 164 passed, 0 failed
npm run typecheck → 通过（tsc --noEmit，退出码 0）
npm run lint:baseline → PASS（无新增 error fingerprint / 无 count 上升）
openspec validate tender-bid-workspace-api --strict → Change 'tender-bid-workspace-api' is valid
```

## 6. 已知限制

- **成本输入不落库**（§3）。
- **锁只保护本功能的写入。** 保存时锁住情报室那一行再读改写，所以本功能不会丢别人的改动。但既有的几处写入（定价助手、公告监控、分析备忘录等）是无锁的读改写，它们仍可能在一次请求的时长内覆盖本键。彻底解决要给那几处也加锁，不在本次范围。
- **截标时间取自 `Project.closeDate`。** 该字段的写入不校验时区（差距分析 §8），所以判定用的时刻以库里的值为准。
- **我方名称只有组织名一个。** 商号与法定名称不同的话，领取方名单里的我方条目认不出来。
- **读取结果里的可投标判定恒含「还没有成本核算」**——因为成本不落库，读取接口不知道成本。带成本的判定由成本核算接口返回。
- **「手头材料」里的供应商报价**按该项目询价里是否有「已报价」的供应商行推导；系统外拿到的报价不算。

## 7. 没做的

- 没有界面（TI-4b）。
- 没有保存进口线索、开标记录；没有识别截图。
- 没有从分析结果自动填充价格表行项（FIX-2）。
- 没有改任何既有接口；没有新增权限键、审批类型、定时任务。
- 没有改 `openspec/config.yaml`。方案甲依赖「情报室的 JSON 位可作扩展落点」这一代码先例，规则第 1 条的文字里没有列出它，等 Lucas 确认。
- 开关在生产保持关闭；打开属于部署决定。
