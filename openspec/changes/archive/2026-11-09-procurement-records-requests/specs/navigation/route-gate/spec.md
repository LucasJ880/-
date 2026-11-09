# Spec Delta

## MODIFIED Requirements

### Requirement: 每个页面都已登记
已登录区的每一个页面 SHALL 有登记的可见规则，且「页面 → 规则」的对应 SHALL 在测试快照里逐条列出。新增页面不在快照里时，测试 SHALL 失败，即使它落在已有前缀之下、能继承一条规则。已登录区以外的页面（登录、注册、选企业、大屏、客户报价、客户分享页）SHALL 在免登录清单或门外清单里。

#### Scenario: 源码断言
- **WHEN** 运行 `npx tsx src/lib/navigation/__tests__/route-gate.test.ts`
- **THEN** 快照里 166 个已登录区页面与实际页面一一对应，每个都映射到其规则（含 PROC-1 新增的 `/projects/intelligence/monitor/settings`、`/projects/intelligence/records`、`/projects/intelligence/records/[id]`，均归「采购情报」`nav-intel-monitor`）；6 个已登录区以外的页面全部在免登录或门外清单里，测试通过

#### Scenario: 新页面漏登记
- **WHEN** 在已登录区新增一个页面（例如 `/projects/<id>/new-tab`，落在已有前缀之下）而不更新快照，再运行同一测试
- **THEN** 测试失败，并打印该页面路径
