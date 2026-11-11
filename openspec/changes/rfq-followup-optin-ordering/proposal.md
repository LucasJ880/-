# Proposal：个人开关的开与关，先后不再依赖服务器的时钟

TASKFLOW：RFQ-AUTO-3a（Phase F 续；修 RFQ-AUTO-3 留下的一个缺口）
来源：RFQ-AUTO-5 的独立审查顺带发现；Lucas 2026-11-11「RFQ-AUTO-3 的时钟问题可以修，开始吧」。

## Why

个人开关「自动起草的轮次带跟进授权」的状态取本人最近一条记录，而记录时间来自各台服务器自己的时钟：时钟不一致或被回拨时，后点的「关闭」会排在先点的「开启」后面而不生效（已在现有代码上复现：返回成功、状态仍是开、随后自动起草的卡带着授权），而且设置时的「读—判断—写」之间没有互斥。触发概率很低，但这是表示同意的开关，撤回必须可靠，发生时又没有任何提示。

## What Changes

- 把设置个人开关改为一个短事务：取本人的锁 → 读最近一条记录 → 状态已是想要的就不写 → 否则写入一条时间至少比上一条晚 1 毫秒的记录。
- 让同一个人同时到达的多次设置依次执行，最后生效的是后执行的那一次。
- 保持其余行为不变：默认关；只能本人在网页上设置；开启要求两个功能开关都打开；关闭任何时候都可以；开启时绑定模板指纹；状态变了才追加记录；读取方式、接口的请求与响应、界面。

## 受影响的 Muse 意图

无。不改 muse-bridge 的代码；这个开关本来就不能在 Muse 里设置。

## Out of scope

- 修正此前已经写下的记录的先后：做不到也不需要——修复之后的第一次设置一定排在所有旧记录之后，状态从那时起就是对的。
- RFQ-AUTO-1 的「停止自动跟进」：核对过，它看的是「有没有停止记录」，不看先后，没有这个问题。
- RFQ-AUTO-5 的供应商分组：同样的修法已经在它自己的 PR（#431）里。
- 把审计记录的时间统一改成数据库时间：影响全仓的审计写入，不在这里做。
- 新的 LLM 调用、schema 变更、定时任务、功能开关：都没有。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `tender/rfq-followup-preapproval`：新增一条要求——个人开关的最后一次设置一定生效，不依赖各台服务器的时钟，也不受同时到达的另一次设置影响。

## Impact

- `src/lib/tender-rfq/auto-followup-optin-service.ts`：`setAutoDraftFollowUpOptIn` 改为事务 + 本人的事务级锁 + 明确给记录时间。读取函数不变。
- `src/lib/tender-rfq/__tests__/auto-draft-db.isolated.test.ts`：补用例。
- 不改接口的请求与响应、界面、`prisma/schema.prisma`、`src/lib/audit/**`、`openspec/config.yaml`。
