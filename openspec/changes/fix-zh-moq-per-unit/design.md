# Design

## Context

- 参考原句由 `src/lib/revenue-spine/reply-draft.ts` 的模板生成：中文分支起订量一句原来只对 `per === "style"` 写"款"、`unit === "pcs"` 写"件"，其余值原样拼进中文句子。英文分支照企业配置原样输出单位和口径。
- 起订量来自 `revenue_spine.policy` 的 `businessProfile.commercialFacts.moq`（`{ quantity, unit, per }`）。合并时 `unit` 缺省为 `pcs`、`per` 缺省为 `style`，两者只截长度，不归一化大小写；Factory Knowledge 原样透传。
- 参考原句随草稿一起携带（`referenceLines`）。守卫先把原句从正文剔除再按最严规则检查；润色后原句必须一字不差保留，否则回退模板。原句只在生成草稿时计算一次，后面不重算，也没有别的模块解析它。
- 英文草稿的审批预览附一份同一模板生成的中文版（`src/lib/revenue-spine/fde/inbound-sales.ts` 里的 `reviewZh`），它也走同一个中文分支。
- B-2（`claude/fde-fact-proposals`，未合并）的商务事实抽取把口径归一化为 `color / size / design / style / sku / item / order`、单位归一化为 `pcs / units / sets / m / kg`，批准后写进 `commercialFacts.moq`。
- B-3（`claude/fde-preferences-in-draft`，未合并）目前只提交了四件套；金样本 `draft-golden-pre-b3.json` 与生成脚本 `draft-golden-cases.ts` 在任何分支上都还不存在。

## Goals / Non-Goals

**Goals:**
- 中文参考原句的口径与单位在对照表覆盖范围内全部写成中文。
- 现有配置（`style` / `pcs`）的中文与英文原句逐字节不变。
- 守卫白名单契约不变：原句依旧确定性生成、随草稿携带、润色必须原样保留。

**Non-Goals:**
- `reply-draft.ts` 的英文分支、大货周期句、装运港句、`checkDraftGuardrails` 正则、`polishReplyDraftWithLlm` 提示词。
- `src/lib/revenue-spine/policy.ts` 的商务事实合并与校验（不在入口处归一化口径 / 单位）。
- `src/lib/revenue-spine/factory-knowledge.ts`（MOQ 透传不变）。
- `src/lib/revenue-spine/fde/inbound-sales.ts`（`reviewZh` 自动受益，不改代码）。
- `src/lib/revenue-spine/fde/no-reply-followup.ts`、`src/lib/revenue-spine/rfq/heuristic-extractor.ts`。
- B-2 的 `src/lib/revenue-spine/fact-extract.ts`（未合并，不跨分支修改）。

## Decisions

### D1 在中文模板里查表翻译，而不是在配置入口归一化成中文
- **选择**：`reply-draft.ts` 里两张常量表（口径 → 中文、单位 → 中文量词）加一个查表函数；中文分支起订量一句改用查表，表外值原样保留。
- **否决 A：在 `policy.ts` 合并商务事实时把 `per` / `unit` 存成中文** —— 英文原句依赖英文口径（`per color`），存中文会让英文原句变成 `per 色`；而且存量数据要迁移。
- **否决 B：给 `MoqInfo` 增加 `perZh` / `unitZh` 字段由 Factory Knowledge 填** —— 多一处接口变更，翻译只服务中文模板一个出口，放在模板旁边最近。

### D2 查表前去首尾空格、转小写
- **选择**：`per` / `unit` 在 `policy.ts` 只截长度、不归一化大小写，手工配置可能是 `Color`、`PCS`；查表前 `trim().toLowerCase()`，表外值仍输出原始字符串（不输出转小写后的值）。
- **否决：严格大小写匹配** —— `Color` 会照旧漏成"每Color"，修复不完整；转小写只影响查表键，不改变任何已能命中的输出。
- 查表只认对照表自身的键（`Object.hasOwn`），`constructor`、`toString` 这类与对象内置属性同名的配置值按表外值原样输出，不会取到原型链上的函数。

### D3 单位表覆盖 B-2 归一化后的全部单位（含 `units`、`kg`）
- **选择**：`pcs → 件`、`units → 件`、`sets → 套`、`m → 米`、`kg → 公斤`。
- **否决：只收任务书点名的 `pcs / sets / m`** —— B-2 合并后 `units`、`kg` 会以同样方式漏进中文句（"每色 500 units"），与本缺陷同类；多两项不增加复杂度。

### D4 不加 `colour` 等别名
- **选择**：口径表只收 B-2 归一化后的七个值。
- **否决：在这里收英式拼写与复数（`colours`、`styles`）** —— 别名归一化是 B-2 抽取的职责，两处各维护一份会漂移；手工配置的罕见别名按"未知值原样保留"处理，不会比现在更差。

## 与八条硬纪律的关系

1. 零 schema：不涉及。不改 Prisma、不加字段、不写 migration；只读既有 `commercialFacts.moq`。
2. 出站先审批：不涉及。只改草稿措辞；草稿仍只经 PendingAction 审批后发送，本 change 不新增任何出站路径。
3. 禁止第三套队列：不涉及。不新增 scheduler / queue / worker。
4. 脱敏（Decision A）：不涉及。起订量不在三项禁出字段（毛利率 / 项目估值 / 我方最终报价）之内，不碰 Muse 通道。
5. 不爬登录页：不涉及。
6. 邮箱分离：不涉及。不改发件人与授权邮箱逻辑。
7. 确定性优先：遵守。翻译是查表，同一配置输出逐字相同；不新增 LLM 调用；参考原句的白名单契约依赖这种确定性。
8. 测试注册：遵守。新测试加在已注册的 `src/lib/revenue-spine/__tests__/scoring-draft.test.ts`，不新增测试文件。

## Risks / Trade-offs

- [风险] 已生成、尚未审批的中文草稿里仍是"每color"→ 它们携带的是生成时的原句，守卫与润色按携带的原句检查，不会因部署而误判；只有新生成的草稿用新措辞。
- [风险] B-3 若先基于未修复代码生成金样本，`zh-website-configured-facts` 一例会含"每color"，合并本 change 后金样本比对失败 → 在 PR 描述里写明：B-3 合并本 change 后按 `draft-golden-cases.ts` 写明的命令重新生成金样本。本 change 不跨分支修改 B-3。
- [取舍] `item → 品` 的"每品"不如"每款"常见，但沿用任务书给定译法；需要改时只改一张表。

## Migration Plan

- 无数据迁移。部署即生效；回滚 = 回退本 PR，存量配置不受影响。

## 验证方式

- `npx tsx src/lib/revenue-spine/__tests__/scoring-draft.test.ts`：新测试"中文参考原句：起订量口径与单位写成中文…"覆盖 `color / size / style / order` 四种口径、`pcs / sets / m` 单位、未知值原样保留（含 `constructor` / `toString`）、大小写与首尾空格、整封中文草稿与英文草稿审批预览的中文对照、守卫白名单复查。实施前对旧代码运行此测试应失败（实际得到"每color 500 件"）。
- `npx tsx src/lib/revenue-spine/__tests__/commercial-facts.test.ts`：既有"每款 1,000 件"中文原句、英文原句与守卫白名单测试照旧通过（23 条）。
- `npm test` 与 main 基线比较新增失败为 0；`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh` 通过；`openspec validate fix-zh-moq-per-unit --strict` 通过。
