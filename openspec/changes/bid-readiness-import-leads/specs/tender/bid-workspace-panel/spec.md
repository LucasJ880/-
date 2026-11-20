## MODIFIED Requirements

### Requirement: 显示判定、阻断项与三张清单
面板 SHALL 显示可投标判定（「不可投标」或「可提交 Owner 决定」）与每个阻断项的说明；SHALL 分别显示缺的材料、未接通的来源（标题 `未接通、也没有人工材料的来源`）、等批准的动作三张清单；SHALL 显示十三个阶段各自的决定，取决于来源的阶段 SHALL 另在下面写出 `{阶段}：{说明}`。面板 SHALL NOT 出现询问用户是否执行某个阶段的控件或文案。「可提交 Owner 决定」旁 SHALL 写明这不是批准。

#### Scenario: 渥太华项目
- **WHEN** 项目已存渥太华 18 行与 9 家领取方名单、截标时间已过
- **THEN** 面板显示「不可投标」、逐条阻断项、三张清单与 13 个阶段的决定（截图 `docs/acceptance/ti-4b/overview.png`）

#### Scenario: 靠人工材料执行的阶段
- **WHEN** 项目导入了进口记录，打开投标工作区
- **THEN** 「进口线索 · 执行」下面写着 `进口线索：只处理人工提供的进口线索`，未接通清单的标题是 `未接通、也没有人工材料的来源`（`npx tsx src/lib/tender-bid-workspace/__tests__/panel-helpers.test.ts` 源码断言）
