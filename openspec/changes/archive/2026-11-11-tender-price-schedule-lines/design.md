# Design

## Context

- 现状见 proposal.md 的 Why。库里的要求行（`TenderExtractedRequirement`）没有数量、单位、包装数、尺寸字段；询价生成器的数量取自一条关键事实里的第一个数字。
- 现有金额运算有两套：报价引擎与落地成本用 JS 浮点、输出时取整到分；盈利分析用定点（`src/lib/project-finance/money.ts`，`Prisma.Decimal`，ROUND_HALF_UP，文件头写明「禁止 JS number 参与权威财务计算」）。
- 现有时间解析 `parseBusinessDateTime`（`src/lib/time/core.ts`）把不带时区的时间按 America/Toronto 解释；`Project.closeDate` 的写入不校验时区。
- 架构守卫禁止 `src/lib` 下文件基本名（按 `-`、`_`、`.` 切分后）含 `plan`、`engine`、`queue`、`scheduler` 等词（`src/lib/runtime-architecture/scan.ts:132`）。
- 回归样例来自 Lucas 2026-11-11 提供的 Skill 包里的 `assets/ottawa-bedbug-case.json`。原件不在仓库里。

## Goals / Non-Goals

**Goals:**

- 给「价格表行项」一个可被 TI-2（逐行成本）与 TI-3（可投标判定）直接引用的类型与规则。
- 把渥太华 18 行钉成回归测试，覆盖任务书验收项 A1、A2、A8、A9、A10、A16。

**Non-Goals:**

- 不动 `prisma/schema.prisma`；不动 `src/lib/tender-understanding/**`、`src/lib/tender-auto-analysis/**`。
- 不动 `src/lib/tender-rfq/**`、`src/lib/quote-engine/**`、`src/lib/tender-pricing/**`。
- 不动 `src/lib/time/**` 与 `src/app/api/projects/[id]/route.ts` 的截标时间读写。
- 不加 `src/app/**` 下任何路由或页面；不加环境变量与开关。
- 不动 `src/lib/muse-bridge/**`。

## Decisions

### D1：新建纯函数目录 `src/lib/tender-price-schedule/`

文件按规则分：`contract.ts`（类型、单位目录、结构校验、汇总）、`unit-conversion.ts`（换算与金额）、`dimension-match.ts`、`closing-time.ts`、`official-export.ts`。基本名均不含守卫禁用词。

- 被否决：放进 `tender-understanding/`。那里是模型抽取与其契约；本次是抽取之后的确定性规则，混在一起会让「零模型调用」难以用源码断言守住。
- 被否决：放进 `quote-engine/`。报价引擎绑定数据库模型与浮点运算，且成本行与招标行没有关联。

### D2：金额用现有定点工具

复用 `project-finance/money.ts` 的 `dec` 与 `roundMoney`。数量与包装数也按定点处理。

- 被否决：沿用落地成本的 JS 浮点。验收 A10 要求合计对到分，浮点在乘以数千数量后会出现 0.01 的偏差。
- 被否决：新引入 `decimal.js` 或 `big.js`。仓库已经通过 Prisma 带了同一实现，再加依赖没有收益。

### D3：单位目录封闭，未知即失败

目录：`Each`、`Pack`、`Box`、`Roll`、`Pair`、`Set`、`Case`、`Bag`、`kg`、`m`、`ft`、`sqft`。其中 `Pack`、`Box`、`Roll`、`Case`、`Bag`、`Set` 为成组单位，按件换算时必须有包装数。

- 被否决：单位用自由文本。同一单位的多种写法会让汇总与换算静默出错；封闭目录下新单位需要显式加入并带测试。

### D4：尺寸按位置比较，不换位，不设容差

招标写的第 1 维只与产品的第 1 维比较。除非招标自己给了区间或最小值，否则必须完全相等。

- 被否决：把各维排序后再比较。能消除「长宽写反」的误报，但也会把确实不同的规格判成相符；这一步的结果会进入可投标判定，宁可多报不符让人看一眼。
- 被否决：设默认容差（如 ±0.5 英寸）。招标没写容差时系统无权替发标方放宽。

### D5：截标时间严格要求时区，另写一个校验，不改现有解析

本能力的校验拒绝不带时区的输入。`parseBusinessDateTime` 保持原样，其它调用方不受影响。

- 被否决：直接改 `parseBusinessDateTime`。它被日历、销售等多处使用，「按多伦多时间解释」是那些场景的既定行为。
- 被否决：复用它并接受不带时区的输入。验收 A16 明确要求不带时区的截标时间失败。

### D6：导出的是数据行与 CSV 文本，不生成 xlsx

导出函数返回行数组与一段 CSV 文本，由后续 change 决定渲染成界面、PDF 还是回填官方工作簿。

- 被否决：本次直接回填发标方的 xlsx。需要保留原工作簿的格式与公式，属于文件处理，与本次的规则层不是一回事。

### D7：夹具里的公司名用代号

招标编号、发标方、行项、数量是公开的招标事实，原样保留。Skill 包夹具里的一家竞争对手与两家出口商名称不进仓库，用 `COMPETITOR_A`、`EXPORTER_A`、`EXPORTER_B` 代替（Owner Gate A 第 9 项按保守口径执行）。

- 被否决：原样入库。那几条是「未证实的线索」，把真实公司名与未证实的关系一起永久写进仓库没有必要。

## 与八条硬纪律的关系

1. 零 schema：不涉及。不新增模型、字段、迁移；不落库。
2. 出站先审批：不涉及。没有任何对外动作。
3. 禁止第三套队列：不涉及。
4. 脱敏：触碰一处——导出含我方报价单价。本次不接任何通道（无接口、无通知、无 Muse 输出），规格另有一条「导出不含成本、毛利率、加成率、供应商名称」；后续接界面的 change 须按财务访问规则授权。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。
7. 确定性优先：遵守。全部是查表与算术，零模型调用，并有源码断言守住。
8. 测试注册：新增 4 个测试文件，全部登记进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`，不往基线里加欠账。

## 验证方式

- `npx tsx src/lib/tender-price-schedule/__tests__/schedule-contract.test.ts`
- `npx tsx src/lib/tender-price-schedule/__tests__/unit-conversion.test.ts`
- `npx tsx src/lib/tender-price-schedule/__tests__/dimension-match.test.ts`
- `npx tsx src/lib/tender-price-schedule/__tests__/closing-and-export.test.ts`
- `bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`、`npm run typecheck`、`npm run lint:baseline`、`openspec validate tender-price-schedule-lines --strict`

## Risks / Trade-offs

- [尺寸按位置比较会把「长宽写反」报成不符] → 结果带逐维说明，人工一眼能看出；后续若误报多，再加「疑似换位」的提示，而不是自动判相符。
- [单位目录不全] → 未知单位直接失败并指出行号，不会静默算错；补单位是一行常量加一条测试。
- [本次代码线上不可达] → 这是有意的：先让契约与测试过审（Owner Gate B），再接持久化与界面。
- [夹具被误当作实时价格] → 夹具文件头与报告里写明：历史回归样例，不是报价，不是合规证明。

## Open Questions

无。
