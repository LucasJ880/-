# Design：项目页的阶段与进度条跟着实际进度显示（FLOW-H1b）

## Context

- 阶段由项目上的五个时间推导（`src/lib/tender/stage.ts`）。自动写的只有两处：分析完成写「项目解读」，第一封询价发出写「供应商询价」。「供应商报价」「项目提交」只能人工推进（基线 G10）——而页面上并没有推进的按钮，只在项目对话里有。
- 读阶段记录的地方很多：项目页（决策摘要标题、项目进度区、提交页）、项目列表、Muse 的 `status`、主动提醒扫描、放弃项目的接口。推进阶段时还会同步写 `tenderStatus`，它被情报卡、对外同步、对话上下文读取。
- FLOW-H1 已经有一次只读的取数，拿到了判断实际进度所需的全部事实。
- 工作台的三步卡（`ProjectOnboardingGuide`）由 `deriveTenderWorkbenchState` 驱动：上传 → 确认要求 → 准备标书，第三步没有完成信号。

## Goals / Non-Goals

**Goals**

- 同一页上不再出现卡片说「报价齐了」、标题却写「项目分发」。
- 不改变任何别处的行为。

**Non-Goals（具体到文件）**

- 不写阶段记录：`src/lib/tender/stage-transition.ts`、`src/app/api/projects/[id]/advance-stage/**` 不动。
- 不改 `src/lib/muse-bridge/**`、`src/lib/proactive/**`、项目列表、`src/components/project-detail/tabs/submission-tab.tsx`。
- 不改 `src/lib/tender/workbench-state.ts`、`src/lib/tender/stage-tasks.ts`、`src/components/project-onboarding/**`（三步卡的代码留着，只是在卡片出现时不渲染）。
- 不改 `prisma/schema.prisma`。

## Decisions

### D1 只改显示，不自动推进阶段记录

页面显示 = 阶段记录与实际进度里靠后的那个；阶段记录本身不动。

- 否决：第一家报价录入时自动写「供应商报价」的时间（像已有的两处自动写那样）。这才是根治，但阶段记录被列表、Muse、主动提醒、`tenderStatus` 的对外同步读取，自动写会改变这些地方的行为；「前进要人工确认」是当初定下的规则。这是一个要 Lucas 决定的产品问题，不夹在显示的改动里做。
- 否决：页面只显示实际进度、不看阶段记录。有人手工把阶段推到了前面（比如口头拿到了报价、还没录入），页面会把它退回去。

### D2 实际进度从「下一步」的同一次取数里得出

接口多返回一个字段。实际进度看所有没取消的轮次（不只是当前这一轮）：报价在第 1 轮、第 2 轮刚发出时，仍是「供应商报价」。

- 否决：页面自己再发请求去数询价与报价。多一次请求，还会与卡片用的事实不一致。
- 否决：只看当前这一轮。开新一轮会让进度条倒退。

### D3 「靠后的那个」与进度条的计算放在既有的阶段函数里

`stage.ts` 的 `getStageSteps` / `getProjectCompletion` 加一个可选的「按这个阶段算」参数；不传时与现在逐字相同。

- 否决：在组件里另写一套六段的顺序与权重。两处定义会漂移。

### D4 不一致时写明，而不是悄悄换掉

项目进度区在显示的阶段与记录不同时加一行说明。

- 否决：不加说明。人在列表或 Muse 里看到的仍是记录的阶段，不说明就成了「两个地方说的不一样、不知道信哪个」。

### D5 三步卡在卡片出现时不渲染

- 否决：两个都留。三步卡的第三步永远是「准备标书与报价」，与卡片重复且更粗。
- 否决：删掉三步卡。开关关闭时页面要与现在相同。

### D6 新能力单列，不改「下一步」的规格

规格放在新能力 `tender/web-progress`。

- 否决：作为 `tender/web-next-step` 的增量。那份规格的归档 PR 还没合并，对一份还不在主规格里的能力写增量，归档时容易出错。

## 与八条硬纪律的关系

1. **零 schema**：遵守。不新增表、列、迁移；不写任何既有字段。
2. **出站先审批**：不涉及。没有任何对外动作。
3. **禁止第三套队列**：遵守。没有后台执行。
4. **脱敏**：遵守。新增的字段只是一个阶段名，不含金额；Muse 通道没有新增内容。
5. **不爬登录页**：不涉及。
6. **邮箱分离**：不涉及。
7. **确定性优先**：遵守。实际进度是固定规则，不调模型。
8. **测试注册**：新测试注册进 `scripts/test-all.sh` 与 `scripts/test-ci-unit.sh`。

## 验证方式

- `npx tsx src/lib/tender-next-step/__tests__/web-progress.test.ts`（新）：实际进度逐段；靠后的那个（记录落后 / 超前 / 相同）；进度条与百分比在传与不传「按这个阶段算」时的结果；不一致的说明；接线的源码断言（三步卡让位、页面不写阶段、页面文件仍有默认导出）。
- `npx tsx src/lib/tender-next-step/__tests__/web-next-step-db.isolated.test.ts`（既有，补用例）：真实路由返回的实际进度，含「报价在更早的一轮」「已取消的轮次不算」；调用前后阶段记录没有变化。
- `npx tsx src/lib/tender-next-step/__tests__/web-next-step.test.ts`、`src/lib/tender/__tests__/*stage*` 等读到被改文件的既有测试重跑。
- 变异核对：把实现逐处改坏，每一处都要有测试失败。
- 真实浏览器：开关开与关各打开一次页面（确认页面能渲染），截图存 `docs/acceptance/flow-h1b/`。
- 全量：`npm run test:ci`、`npm run typecheck`、`npm run lint:baseline`、`bash scripts/check-test-registry.sh`、`bash scripts/test-runtime-architecture.sh`。
- 开 PR 前请一个不带结论的独立审查。
- `openspec validate tender-web-progress-from-facts --strict`。

## Risks / Trade-offs

- **项目页与别处说的阶段会不一样**（列表、Muse、提交页仍是记录的阶段）。页面上写明了；根治要靠 D1 里被否决的那条，等决定。
- **实际进度看的是「有没有」，不是「够不够」**：一家报价就算到了「供应商报价」，与阶段记录原来的含义（进入这一段）一致。
- **开关关闭时没有任何变化**，问题照旧。

## Migration Plan

无数据迁移。回滚 = 关开关或回滚代码。

## Open Questions

- 要不要让阶段记录自动前进（D1 被否决的那条）。本次不做；在 PR 里作为待定事项提出。
