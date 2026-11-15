# Design

## Context

- 现状：全仓没有文件领取方、进口商 / 出口商、公司别名图的任何模型或代码（差距分析 §2）。相邻的现成零件：
  - 名称规范化 `src/lib/corporate-memory/normalize.ts`：确定性规则，文件头写明「禁止模糊相似度参与身份判定」。授标记录的中标方名称用的是同一个函数，只做精确匹配。
  - 金额口径词表 `src/lib/procurement-records/labels.ts`：上限 / 评标 / 承诺 / 下单 / 开票 / 已付 / 未识别。
  - 来源能力声明 `src/lib/procurement-records/watch-config.ts`：有取数模式，没有「未接通」状态。
  - 官方进口线索来源说明 `src/lib/procurement-records/supplier-pure.ts`：写明加拿大不公开逐票报关记录。
  - TI-1 的截标时间校验 `src/lib/tender-price-schedule/closing-time.ts`：严格要求时区。
- 约束：硬纪律第 5 条不触碰需要登录的站点；架构守卫禁止 `src/lib` 文件基本名含 `plan`（所以不叫 plan-takers）。

## Goals / Non-Goals

**Goals:**

- 用类型与规则把「线索」和「结论」分开，覆盖任务书验收项 A3、A4、A5、A6、A15。
- 给后续的持久化与界面一套可直接引用的契约。

**Non-Goals:**

- 不动 `src/lib/corporate-memory/**`、`src/lib/tender-intel/**`、`src/lib/procurement-records/**`、`src/lib/supplier-intel/**`（只引用其中的纯函数与词表）。
- 不动 `prisma/schema.prisma`；不加 `src/app/**` 下任何路由或页面；不加环境变量与开关。
- 不动 `src/lib/muse-bridge/**`。

## Decisions

### D1：新建纯函数目录 `src/lib/tender-competition/`

文件：`document-holders.ts`、`company-identity.ts`、`import-leads.ts`、`source-status.ts`、`amount-measures.ts`。

- 被否决：放进 `tender-intel/`。那里的模块都带数据库读写与外呼开关，纯契约混进去后「零外呼」没法用目录级的源码断言守住。
- 被否决：放进 `supplier-intel/`。文件领取方与竞争对手不是供应商；进口线索以后会写成供应商线索，但那是持久化时的一次映射，不是同一个概念。

### D2：投标人数是独立字段，没有记录时为 null

领取方数与投标人数不共用一个字段，也不提供从一个推另一个的函数。

- 被否决：没有开标记录时投标人数给 0。0 是一个断言（「没人投标」），未知不是。
- 被否决：给一个「预计投标人数」。任务书明确领取文件不预示正式参与。

### D3：名称比对三档——同名、建议、无关

同名 = 现有规范化后完全相等。建议只有两条确定性依据：去掉公司后缀后相等；一方按整词完整包含另一方。建议只是待办，不改变任何计数或分组。

- 被否决：编辑距离或相似度打分。`Pest` 与 `Pet` 只差一个字母，却是两家公司；相似度阈值迟早会合并错。也与企业记忆模块「禁止模糊相似度参与身份判定」的既定规则一致。
- 被否决：只差后缀就自动合并。`X Inc.` 与 `X Ltd.` 可以是两家不同的法人。

### D4：进口线索的状态机只有一条升级路径，且要当期证据

`LEAD_UNVERIFIED →（人工 + 12 个月内的证据 + 确认人）→ CONFIRMED_CURRENT`。没有自动升级。时效阈值 12 个月是常量。

- 被否决：同一对进口商 / 出口商出现多票就自动升级。多票历史运单仍然是历史。
- 被否决：不设时效。任务书验收 A5 针对的就是「2024 年的运单被当成现在的渠道」。

### D5：来源状态里「按纪律禁用」不可被配置覆盖

取得方式为需要登录的门户时，状态函数直接返回按纪律禁用，不看配置。

- 被否决：留一个配置开关。硬纪律第 5 条没有例外条款；真要开，应当先改 `openspec/config.yaml`，再改这段代码与对应测试。

### D6：金额口径沿用采购资料的词表，补两项

在现有七个口径上加「授标值」与「预算估计」。求和函数的入参类型就带口径，混口径在运行时拒绝。

- 被否决：另起一套词表。同一个概念两套叫法，以后历史采购面板要做映射。
- 被否决：只靠类型系统阻止混加。数据来自外部与人工录入，运行时必须再挡一次。

## 与八条硬纪律的关系

1. 零 schema：不涉及。不落库。
2. 出站先审批：不涉及。没有任何对外动作；规格里另有一条「不提供联系竞争对手的动作」。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及敏感字段；规格明确不输出对竞争对手投标价、成本、毛利的推断。
5. 不爬登录页：遵守，并用代码固化——需要登录的门户来源恒为按纪律禁用（D5）。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。全部是查表与字符串规则，零模型调用，有源码断言。
8. 测试注册：新增 3 个测试文件，全部登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-competition/__tests__/document-holders.test.ts`
- `npx tsx src/lib/tender-competition/__tests__/leads-and-sources.test.ts`
- `npx tsx src/lib/tender-competition/__tests__/amount-measures.test.ts`
- `bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-competition-leads --strict`

## Risks / Trade-offs

- [建议规则漏掉真实的同一实体]（如商号与法定名称完全不同）→ 这类只能靠人工添加别名；规则宁可漏报也不误并。
- [12 个月的阈值是经验值] → 做成具名常量，改它只动一处与一条测试。
- [测试里的公司名是虚构的] → 有意为之：不把真实公司与「未证实的关系」写进仓库。
- [本次代码线上不可达] → 有意为之，先过 Owner Gate B。

## Open Questions

无。
