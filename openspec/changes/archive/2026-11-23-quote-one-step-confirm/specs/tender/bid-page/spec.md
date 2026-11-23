## MODIFIED Requirements

### Requirement: 新页面上刷新汇总
在新页面上，用户回到这个浏览器标签页时，以及在 ② 里定为我方报价、提交给负责人、退回、另起新版成功后，页签 SHALL 再请求一次汇总接口：拿到「已开启」时 SHALL 换上新的状态；拿到明确的 404（未启用）时 SHALL 回到改版前的页面；其余出错（500、401、请求失败、内容不对）时 SHALL 保留当前这份汇总，SHALL NOT 退回改版前的页面。

#### Scenario: 已在新页面上刷新出错
- **WHEN** 新页面已经打开，回到标签页时的那次刷新返回 500（或断网、401、内容不对）
- **THEN** 页面仍是新页面、状态不变；若返回 404 则回到改版前的页面；若返回新的「已开启」则换上新的状态（`npx tsx src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx`）

#### Scenario: 定了以后刷新
- **WHEN** 新页面上在 ② 里定为我方报价成功
- **THEN** 页签再请求一次汇总接口，② 的状态换成新的（`npx tsx src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx`；`npx tsx src/components/bid-page-v2/__tests__/quote-actions.test.tsx`）

### Requirement: 新页面不给看不到金额的人显示带金额的旧组件
新页面 SHALL 只在汇总接口标明能看金额时显示带金额的区块（询价轮次及其中的供应商报价、② 最上面的「我方报价」一行、报价区、旧版报价单（外贸标准报价）、「更多」里的版本历史）；标明不能看时 SHALL 在 ① 显示「询价里会有供应商报价，所以询价区只给项目负责人和有财务查看权的同事看。要起草或查看询价，请找他们。」、在 ② 显示「报价的金额与成本只给项目负责人和有财务查看权的同事看。要做报价或查看金额，请找他们。」，SHALL NOT 显示这些区块与「更多」。这一门只决定新页面挂不挂这些区块，旧接口的口径不在本能力内。新页面 SHALL NOT 挂投标工作区面板、改版前的报价区与改版前的我方报价卡（它们在改版前的页面上照旧）。

#### Scenario: 看不到金额的人在新页面上看不到带金额的旧组件
- **WHEN** 汇总接口标明不能看金额，渲染新页面
- **THEN** 页面上没有询价区、报价区、「更多」，源码里报价区（含我方报价一行）、旧版报价单、版本历史抽屉只在能看金额的分支里；① ② 各有那一句说明；投标价区块的位置仍在（`npx tsx src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx`）

#### Scenario: 看得到金额的人照常
- **WHEN** 汇总接口标明能看金额（报价功能开或没开），渲染新页面
- **THEN** 询价区、报价区、「更多」都在，没有那两句说明；新页面源码里没有投标工作区面板、改版前的报价区与改版前的我方报价卡（同一测试）

### Requirement: 页内位置照常可达
新页面 SHALL 保留改版前页面上供项目页「下一步」卡跳转的位置：供应商询价区块（看得到金额时）、投标价区块（两种人都有）。地址里的 `#位置` 落在某个分区里（含改版前投标工作区的位置与通知带来的 `#bid-quote-{报价 id}`，都对应 ②）时，新页面 SHALL 展开该分区并自己滚动到位置一次；位置不在页面上时 SHALL 展开分区并滚到分区标题。

#### Scenario: 从项目页「下一步」卡跳到投标价
- **WHEN** 地址带 `#bid-quote-area`（或 `#rfq-section`、`#rfq-round-…`、`#bid-workspace`）打开新页面，「下一步」指向别的分区
- **THEN** 对应的分区（② 或 ①）优先展开；展开后滚到位置；带 `bid-quote-area` 的元素在页面上（`npx tsx src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx`）

#### Scenario: 从通知打开一份报价
- **WHEN** 地址带 `#bid-quote-{报价 id}` 打开新页面，这份报价是逐行或总价报价
- **THEN** ② 展开，列表加载后这份报价在页内打开（`npx tsx src/components/bid-page-v2/__tests__/bid-page-v2.test.tsx`；`npx tsx src/components/bid-page-v2/__tests__/quote-actions.test.tsx`）
