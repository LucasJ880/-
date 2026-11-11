# Proposal：项目页上的投标工作区面板

TASKFLOW：TI-4b（Phase F，Tender Intelligence Phase D 第一项；来源 `docs/tender-intelligence-gap-analysis.md` §4 与 §17）。依赖 TI-4a。审核：Lucas 2026-11-11 授权「其他你来主导，需要确定的按推荐做」，四件套不另等审核，实施后以 Draft PR 交付。

## Why

TI-4a 的接口没有界面，核算表、阻断项和三张清单还是看不见。Lucas 的两条要求——只读的事不再逐项询问、核算表要表现出来——要落到项目页上才算数。

## What Changes

- 在项目「标书与报价」页签顶部新增「投标工作区」面板。接口返回 404（开关关闭）时面板不渲染任何内容。
- 面板显示可投标判定与逐条阻断项；显示缺材料、未接通、等批准三张清单；显示十三个阶段各自的决定。面板里没有任何「是否执行」的询问。
- 面板显示价格表行项；有项目写权限的人可以粘贴表格（制表符或逗号分隔）导入并保存。
- 面板显示文件领取方汇总，并常驻「领取文件不等于投标」的说明；有写权限的人可以粘贴公司名单保存。
- 面板提供成本核算：逐行输入采购类型、报价、币种、证据类别、关税率、运费与配送，加上汇率、进口 GST、目标毛利率、预备金，点「计算」显示核算表的四块。成本输入只保存在浏览器里，并在面板上写明；可导出与导入。
- 没有财务查看权的人看到「需要财务查看权」，看不到核算表。
- 新增粘贴解析与成本输入组装的纯函数及测试；用真实应用加本地数据库截图留证。

## 受影响的 Muse 意图

无。不触碰 muse-bridge。

## Out of scope

- 不做逐行的证书录入、拟投型号与产品尺寸录入界面（接口已支持，界面下一批）。
- 不做进口线索、历史采购、供应链图的界面。
- 不做低 / 基准 / 高多情景并排，不做两套模型对账的界面。
- 不做 PDF 或 xlsx 导出。
- 不改「标书与报价」页签里既有的任何卡片，不改工作台三步卡与进度条。
- 不把成本输入存到服务端（存储位置待 Owner 决定，见 `docs/QINGYAN_TI-4a_REPORT.md` §3）。
- 面板不提供发送、提交、批准之类的对外动作。

## Capabilities

### New Capabilities

- `tender/bid-workspace-panel`：项目页投标工作区面板的对外行为——何时出现、显示什么、谁能改什么、成本核算如何输入与显示。

### Modified Capabilities

无。

## Impact

- 新增 `src/components/tender/bid-workspace-panel.tsx`；在 `src/components/project-detail/tabs/bid-tab.tsx` 顶部挂载一行。
- 新增 `src/lib/tender-bid-workspace/paste-import.ts`、`cost-draft.ts`（纯函数）与测试。
- 截图存 `docs/acceptance/ti-4b/`。
- 开关关闭时页面与现在逐像素相同（面板不渲染）。数据库、接口、依赖无变化。
