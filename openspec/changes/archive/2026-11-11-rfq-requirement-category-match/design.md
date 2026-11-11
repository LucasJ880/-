# Design

## Context

- 询价生成器是纯函数（`src/lib/tender-rfq/build.ts`），由 `prepareRfqRound`（Web 与 Muse 共用）把库里的要求原样传入。
- 库里的类别有两种来源：V2 分析入库时写小写（`v2-map.ts:214`）；V1 分析写旧式代码 `mandatory_technical` / `mandatory_general`（`extract/requirements.ts`）。
- 其它按类别工作的模块已经各自先转小写再查表（`bid-fit-groups.ts`、`supplier-intel/procurement-display.ts`、`mandatory-gate.ts`、`score-components.ts`），只有询价生成器直接拿原值与大写清单比较。
- 生成器内还有四处与大写字面量比较，用来生成「请随报价提供」清单（`build.ts:170-173`）。

## Goals / Non-Goals

**Goals:**

- 询价生成器对入库的任何写法都给出与大写写法相同的判定。
- 用入库真实写法的测试把这条行为钉住，并让「分析契约新增类别」时漂移能被测试发现。

**Non-Goals:**

- 不动 `src/lib/tender-auto-analysis/v2-map.ts`、`v2-persist-core.ts`、`extract/requirements.ts` 的入库写法。
- 不动 `src/lib/tender-rfq/service.ts`、`web-entry.ts`、`execute.ts`、`inbound-*.ts`、`chase-*.ts`、`compare*.ts`、`landed-cost.ts`。
- 不动 `src/lib/tender-auto-analysis/bid-fit-groups.ts` 与 `src/lib/supplier-intel/**`。
- 不动 `prisma/schema.prisma`，不写迁移，不回填数据。
- 不动 `src/lib/muse-bridge/**`。

## Decisions

### D1：在生成器入口归一，不改入库

在生成器内加一个归一函数：去首尾空白 → 转大写 → 旧式代码映射 → 得到标准类别或「未知」。类别判定、行项类别、附件提示都用归一后的值。

- 被否决：改 `v2-map` 入库为大写。四个已按小写工作的模块都要跟着改，已有数据还要回填，改动面与风险远大于缺陷本身。
- 被否决：在 `service.ts` 传入前转换。生成器是对外契约的纯函数，别的调用方（测试、将来的入口）仍会踩同一个坑；归一应当在判定发生的地方。

### D2：旧式代码用显式映射表，不做前缀猜测

`mandatory_technical → TECHNICAL`；`mandatory_general → 未知（不进入）`。表里只有这两项。

- 被否决：凡 `mandatory_` 开头都算供应商侧。`mandatory_general` 是通用强制条款（保险、资质、提交格式一类），发给供应商没有意义，还可能把内部条款带出去。
- 被否决：按要求正文关键词推断类别。等于新增一套启发式，且与「确定性优先」不符。

### D3：未知类别保持不进入

归一后不在标准清单里的一律记 `not_supplier_facing`。

- 被否决：未知类别默认进入。询价单是出站内容，宁可少带不可错带。

### D4：「双源一致」断言放在询价生成器的测试里

测试遍历分析契约导出的类别清单，对每个类别用大写与小写各调一次生成器，断言判定相同。

- 被否决：只为当前十个供应商侧类别各写一条小写用例。契约以后新增类别时，这种写法发现不了新类别的漂移。

## 与八条硬纪律的关系

1. 零 schema：不涉及。不新增模型、字段、迁移。
2. 出站先审批：触碰但不改变。询价仍只经 `tender.send_rfq` 审批卡发出；本次只修正询价单里带哪些要求，敏感内容整单拦截照旧在生成器里执行。
3. 禁止第三套队列：不涉及。
4. 脱敏：不涉及。询价单不含毛利率、项目估值、我方报价；Muse `rfq` 响应结构不变。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。发件邮箱读取逻辑不动。
7. 确定性优先：遵守。归一是查表，不新增模型调用。
8. 测试注册：`build.test.ts` 已在 `scripts/test-all.sh` 注册；本次只往该文件加用例，不新增测试文件。

## 验证方式

- `npx tsx src/lib/tender-rfq/__tests__/build.test.ts`：基线 21 项通过；改后新增用例全部通过，原 21 项不变。
- 先写测试、看它失败（小写与旧式代码用例在改之前应失败），再改实现。
- tender-rfq 目录全部已注册测试、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`openspec validate rfq-requirement-category-match --strict`。

## Risks / Trade-offs

- [修复后询价单内容变多] 此前带不上的要求现在会进入发给供应商的邮件 → 这是预期行为；每封询价仍须人工在审批卡上看过正文再批。报告里写明这一点，提醒首次使用时核对正文。
- [V1 的 `mandatory_technical` 归为技术类是一个判断] V1 引擎的类别粒度粗，个别技术强制条款可能不适合发给供应商 → 只收已确认的要求，确认与审批两道人工闸都在；若审核认为不应进入，把映射表里这一项去掉即可，规格里对应的 Requirement 同步改。
- [行项类别从原写法变为标准写法] 询价单结构体里的 `category` 字段值会从小写变成大写 → 该字段只在生成器内部与邮件渲染使用；已核对回信解析与比价读取的是要求编号与强制标记，不读类别。

## Open Questions

无。
