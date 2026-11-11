## Purpose
规定组织设置（一个组织一份、多个功能共用的那一块配置）的并发写入：不同功能同时各改自己的那一项时，互不覆盖；任何写入方都不能用自己先前读到的旧内容把别人刚写的改动冲掉。

## ADDED Requirements

### Requirement: 并发写入互不覆盖
对同一个组织的设置，多个写入同时进行、各改不同的项时，全部完成后每一项 SHALL 都是它自己那次写入的结果，SHALL NOT 有任何一项被别的写入恢复成写入前的旧值。这一条 SHALL 对所有写组织设置的功能成立：收信游标、Muse 个人偏好与绑定、询价设置、投标资料、运营手册执行模式、日历监听的设置与游标、门店折扣设置、开户向导。

#### Scenario: 七种写入同时进行
- **WHEN** 对同一个组织同时发起：回写收信游标、学习一家常用供应商、绑定一个 Muse 账号、保存询价设置、保存投标资料、切换运营手册执行模式、保存日历监听设置，并重复 12 轮
- **THEN** 每一轮结束后七项都是各自写入的值，没有任何一项丢失；同一份测试在改动之前的写入方上第一轮就丢了五项（`npx tsx src/lib/organizations/__tests__/settings-write-db.isolated.test.ts`）

#### Scenario: 不加锁的写法会丢
- **WHEN** 用「读出整块、改一个键、把整块写回」且不加锁的写法并发写 12 个不同的键
- **THEN** 至少有一个键丢失；换成统一入口后 12 个键全部保留（同一测试里的对照用例）

### Requirement: 同一项的并发修改按先后依次生效
对同一个组织的同一项设置，两次修改同时到达时 SHALL 依次执行，后执行的一次 SHALL 在前一次的结果之上修改，SHALL NOT 基于更早读到的内容。同一个人的「设置偏好」与「选定报价后自动学习常用供应商」同时发生时，两者 SHALL 都保留。

#### Scenario: 设置偏好与自动学习同时发生
- **WHEN** 同一个人在 Muse 里设置默认贸易条款，同时他在某个项目里选定了一家供应商的报价
- **THEN** 他的偏好里既有新的贸易条款，也有刚学到的那家常用供应商（`settings-write-db.isolated.test.ts`）

#### Scenario: 同时学习多家供应商
- **WHEN** 同一个人同时选定了 4 家不同供应商的报价
- **THEN** 他的常用供应商里这 4 家都在（`settings-write-db.isolated.test.ts`）

### Requirement: 写入的内容与对外行为不变
每一处写入改哪一项、改成什么、何时不写 SHALL 与改动之前相同；相关接口的请求、响应与状态码 SHALL 不变；组织不存在时各写入方的既有处理 SHALL 不变。

#### Scenario: 既有测试不改断言即通过
- **WHEN** 运行各写入方既有的测试
- **THEN** 不改断言全部通过（`npm run test:ci`；本地隔离库的 `auto-draft-db.isolated.test.ts`、`supplier-groups-db.isolated.test.ts`）

#### Scenario: 询价设置接口
- **WHEN** 管理员保存询价设置，内容不合规
- **THEN** 返回 400 与原来相同的说明，设置没有被改；内容合规时返回 200，审计里记着保存前后的询价设置（`settings-write-db.isolated.test.ts`）

### Requirement: 新的写入方不得绕开
代码库里写组织设置的任何位置 SHALL 经统一的写入入口，或在同一事务里先锁住该组织的行再读再写。新增一处不满足的写入 SHALL 使自动化检查失败。

#### Scenario: 守卫测试
- **WHEN** 在 `src/` 下新增一个文件，直接读出组织设置、改一个键、整块写回，不经入口也不锁行
- **THEN** `npx tsx src/lib/organizations/__tests__/settings-write-guard.test.ts` 失败并指出这个文件
