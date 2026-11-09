# Spec Delta

## MODIFIED Requirements

### Requirement: 每个自动化恰好归属一个岗位
自动化注册表里的每一个自动化键 SHALL 恰好出现在一个岗位的自动化清单中；岗位清单 SHALL NOT 引用自动化注册表中不存在的键。按自动化键反查岗位 SHALL 返回唯一岗位；未知键 SHALL 返回"无归属"。

#### Scenario: 当前 30 个自动化全部归属
- **WHEN** 运行岗位注册表测试
- **THEN** 自动化注册表中全部 34 个键（新增岗位日结、未读升级邮件、每日未读汇总邮件与采购监控后；场景名沿用初版计数）各自恰好命中一个岗位，退出码 0

#### Scenario: 新增自动化未归属
- **WHEN** 自动化注册表新增一个键而岗位注册表未把它分给任何岗位
- **THEN** 岗位注册表测试失败并打印该键；`npm run typecheck` 失败并在错误中报出该键

#### Scenario: 同一自动化归属两个岗位
- **WHEN** 同一自动化键同时出现在两个岗位的清单中
- **THEN** 岗位注册表测试失败并打印该键与两个岗位

#### Scenario: 审批超时检查归属运维与知识岗位
- **WHEN** 按 `approval-timeout` 反查岗位
- **THEN** 返回 `ops_knowledge`

#### Scenario: 岗位日结归属运维与知识岗位
- **WHEN** 按 `post-daily-digest` 反查岗位
- **THEN** 返回 `ops_knowledge`

#### Scenario: 未读升级邮件归属运维与知识岗位
- **WHEN** 按 `notify-email-escalation` 反查岗位
- **THEN** 返回 `ops_knowledge`

#### Scenario: 每日未读汇总邮件归属运维与知识岗位
- **WHEN** 按 `notify-email-digest` 反查岗位
- **THEN** 返回 `ops_knowledge`

#### Scenario: 采购监控归属投标岗位
- **WHEN** 按 `procurement-watch` 反查岗位
- **THEN** 返回 `tender`；`npx tsx src/lib/cockpit/__tests__/posts.test.ts` 覆盖
