# Spec Delta

## MODIFIED Requirements

### Requirement: 只起草，不批准、不发信
自动起草 SHALL 经既有的建轮次流程产出一张状态为待批的发询价审批卡，有效期、幂等键、载荷结构、轮次锁与人工起草的相同。系统 SHALL NOT 批准这张卡，SHALL NOT 发出任何邮件。自动起草的卡 SHALL 只在触发起草的操作者本人开启了「自动起草的轮次带跟进授权」的个人开关、且跟进授权的功能开关对该组织打开时带跟进授权；否则 SHALL NOT 带。带授权时，面板上的结果 SHALL 写明这张卡带跟进授权、批准它会一并批准后面的催单和追问。自动起草的卡 SHALL NOT 能在 Muse 里批准（起草时没有人看过收件人与正文，而 Muse 里只显示标题），只能在网页上批；驳回不受影响。卡的来源 SHALL 记为自动起草；卡的标题 SHALL 标明「自动起草」，摘要 SHALL 写明供应商取自谁的常用供应商、询价单带了几条已确认的要求、有几条没有确认的没带上。

#### Scenario: 起草后零出站
- **WHEN** 自动起草成功
- **THEN** 库里有一张待批的发询价卡（没有批准人）、没有任何询价项被标为已发出、轮次还没有开始；操作者没有开启个人开关时，卡的载荷里没有跟进授权（`auto-draft-db.isolated.test.ts`）

#### Scenario: 自动起草的卡不能在 Muse 里批
- **WHEN** 有人在 Muse 里对一张自动起草的发询价卡回复「批准」
- **THEN** 不批准、不发信，回复说明这一轮是系统自动起草的、还没有人核对过收件人和正文，需在青砚项目页看完后批准（`npx tsx src/lib/muse-bridge/__tests__/muse-bridge-pure.test.ts`）

#### Scenario: 驳回后不再自动起草
- **WHEN** 人驳回了自动起草的卡，之后又确认或驳回了别的要求
- **THEN** 不再自动起草（项目已有轮次），原因为项目已有询价轮次（`auto-draft-db.isolated.test.ts`）

#### Scenario: 带授权时结果里写明
- **WHEN** 操作者开启了个人开关，自动起草成功
- **THEN** `rfqAutoDraft` 里带一个标记说明这张卡带跟进授权，说明文字写明「批准它会一并批准后面的催单和追问」（`npx tsx src/lib/tender-rfq/__tests__/auto-draft-pure.test.ts`）
