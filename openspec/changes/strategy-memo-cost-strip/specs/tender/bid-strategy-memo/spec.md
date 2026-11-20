## Purpose

投标策略备忘给所有项目读者看，所以送进模型的输入里不带我方成本与毛利，提示词不要求也不允许写成本与毛利；改动以前生成的旧版备忘里由成本写成的两段不再给出。

## ADDED Requirements

### Requirement: 备忘的报价演算不带我方成本
外部情报运行时为策略备忘装配的报价演算 SHALL 在不使用我方成本与目标毛利的情况下算出。送进备忘模型的输入 SHALL NOT 含我方成本、成本来源、目标毛利、「成本 + 目标毛利」或「成本价」情景、任何情景的毛利，以及由我方成本算出的任何数字；评分模型、对手价、打平价、跟价与让价 5% / 10% / 15% 四个情景 SHALL 照旧给出，并附一句 `我方成本、目标毛利与成本底价只给有财务查看权的人看，这里不提供；不要推测。`。模型调用次数 SHALL NOT 增加。

#### Scenario: 成本数字进不了模型输入
- **WHEN** 调查室里存着我方成本 87654.32、目标毛利 23.7%、对手价 100000，为备忘装配报价演算并交给备忘的模型调用
- **THEN** 送进模型的整段输入（系统提示与用户输入）里搜不到 87654.32、87654 与 23.7，没有毛利字段，也没有成本底价情景；四个对手价情景与打平价与不传成本时的演算结果相同（`npx tsx src/lib/tender-intel/__tests__/memo-pricing.test.ts`）

### Requirement: 备忘不写也不推测成本与毛利
备忘提示词 SHALL NOT 要求引用任何情景的毛利；SHALL 写明报价演算有意不含我方成本、目标毛利与成本底价，备忘任何一段 SHALL NOT 陈述、估算或推测我方成本、毛利或成本底价，报价策略只讲相对对手价与对标价的位置和总分差。按此生成的备忘版本 SHALL 为 `tender-bid-strategy-memo/v3`。

#### Scenario: 提示词与版本
- **WHEN** 读取备忘的系统提示与版本号
- **THEN** 逐字引用的那一条不再提毛利，有禁止写、估、推成本与毛利的那一条；新生成的备忘版本是 `tender-bid-strategy-memo/v3`（`npx tsx src/lib/tender-intel/__tests__/memo-pricing.test.ts`；`npx tsx src/lib/tender-intel/__tests__/bid-strategy-memo.test.ts`）

### Requirement: 旧版备忘的评分与报价两段不再给出
情报页签读取外部情报结果时，版本不是 `tender-bid-strategy-memo/v3` 的备忘 SHALL 不带「评分演算」与「报价策略」两段的文字，SHALL 带标记 `legacyCostRedacted: true`；其余段落照旧。卡片 SHALL 把报价策略那一行写成 `报价策略：这份策略备忘是旧版生成的，可能含我方成本或毛利，已隐藏；重新检索外部情报后会生成新的。`。v3 的备忘 SHALL 原样给出。

#### Scenario: 旧版与新版
- **WHEN** 调查室里存着一份 v2 备忘（评分演算与报价策略里写着成本 87654.32）与另一份 v3 备忘，分别经情报页签读取
- **THEN** v2 的两段为空、带标记，响应里搜不到 87654.32，摘要、风险门与 RFI 照旧；v3 原样；卡片在标记时写上面那句（`npx tsx src/lib/tender-intel/__tests__/memo-pricing.test.ts`，纯函数与接口、卡片的源码断言）
