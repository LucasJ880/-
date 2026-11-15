# settings/org-settings-write Specification

## Purpose
规定组织设置（一个组织一份、多个功能共用的那一块配置）的并发写入：不同功能同时各改自己的那一项时，互不覆盖；任何写入方都不能用自己先前读到的旧内容把别人刚写的改动冲掉。

## Requirements

### Requirement: 并发写入互不覆盖
对同一个组织的设置，多个写入同时进行、各改不同的项时，全部完成后每一项 SHALL 都是它自己那次写入的结果，SHALL NOT 有任何一项被别的写入恢复成写入前的旧值。这一条 SHALL 对所有写组织设置的功能成立：收信游标、Muse 个人偏好与绑定、询价设置、投标资料、运营手册执行模式、日历监听的设置与游标、门店折扣设置、开户向导。

#### Scenario: 七种写入同时进行
- **WHEN** 对同一个组织同时发起：回写收信游标、学习一家常用供应商、绑定一个 Muse 账号、保存询价设置、保存投标资料、切换运营手册执行模式、保存日历监听设置，并重复 12 轮
- **THEN** 每一轮结束后七项都是各自写入的值，没有任何一项丢失；同一份测试在改动之前的写入方上第一轮就丢了四到五项（`npx tsx src/lib/organizations/__tests__/settings-write-db.isolated.test.ts`）

#### Scenario: 不加锁的写法会丢
- **WHEN** 用「读出整块、改一个键、把整块写回」且不加锁的写法并发写 12 个不同的键
- **THEN** 至少有一个键丢失；换成统一入口后 12 个键全部保留（同一测试里的对照用例）

#### Scenario: 在自己事务里写设置的功能
- **WHEN** 对同一个组织同时发起：开户向导确认一步、保存门店折扣、绑定一个 Muse 账号、保存投标资料、另一处写入一个新的键，并重复 10 轮
- **THEN** 每一轮五项都在，之前各轮的开户确认也都在（`settings-write-db.isolated.test.ts`）

### Requirement: 写设置不与本组织的其它数据写入互相阻塞
写组织设置时持有的锁 SHALL 只让「写同一个组织设置」的操作互相等待，SHALL NOT 阻塞向该组织新增任何关联记录（审计、项目、成员、把用户的当前组织切到它等），也 SHALL NOT 被这些操作阻塞。先新增一条本组织的记录、再写设置的多个事务同时进行时 SHALL NOT 死锁。这一条 SHALL 对所有写组织设置的位置成立，包括斑马帘比例与质保设置两个接口。

#### Scenario: 有人拿着设置的锁
- **WHEN** 一个事务写了设置后迟迟不提交（0.9 秒），这期间另有操作往本组织插入一条审计、把一个用户的当前组织切到它、以及另一处写设置
- **THEN** 前两个不用等（各自在 0.5 秒内完成）；另一处写设置等到锁放开后完成，两处设置的修改都在（`settings-write-db.isolated.test.ts`）

#### Scenario: 先插入再写设置的事务同时进行
- **WHEN** 8 个事务各自先插入一条本组织的记录、再锁行写设置
- **THEN** 没有死锁，8 处修改都在（`settings-write-db.isolated.test.ts`）

#### Scenario: 有人刚往本组织插入了一条记录还没提交
- **WHEN** 一个事务往本组织插入了一条审计后迟迟不提交（0.9 秒），这期间保存斑马帘比例、保存质保设置
- **THEN** 两个保存都不用等（各自在 0.5 秒内完成），保存的内容都在；改动之前它们要等到那个事务提交（`npx tsx src/lib/organizations/__tests__/org-row-lock-db.isolated.test.ts`）

#### Scenario: 与先插入再锁行的事务同时进行
- **WHEN** 6 个「先插入一条本组织的记录、再锁行写设置」的事务，与保存斑马帘比例、保存质保设置、新建一条配额策略同时进行，重复 6 轮
- **THEN** 没有死锁，没有请求失败，每一轮的修改都在（`org-row-lock-db.isolated.test.ts`；这一条在改动之前同样通过，留作回归检查）

#### Scenario: 这两处与别的设置写入仍然互不覆盖
- **WHEN** 对同一个组织同时保存斑马帘比例、保存质保设置、另一处写入一个新的键，重复 10 轮
- **THEN** 每一轮三项都在（`org-row-lock-db.isolated.test.ts`）

### Requirement: 同一项的并发修改按先后依次生效
对同一个组织的同一项设置，两次修改同时到达时 SHALL 依次执行，后执行的一次 SHALL 在前一次的结果之上修改，SHALL NOT 基于更早读到的内容。同一个人的「设置偏好」与「选定报价后自动学习常用供应商」同时发生时，两者 SHALL 都保留。

#### Scenario: 设置偏好与自动学习同时发生
- **WHEN** 同一个人在 Muse 里设置默认贸易条款，同时他在某个项目里选定了一家供应商的报价
- **THEN** 他的偏好里既有新的贸易条款，也有刚学到的那家常用供应商（`settings-write-db.isolated.test.ts`）

#### Scenario: 同时学习多家供应商
- **WHEN** 同一个人同时选定了 4 家不同供应商的报价
- **THEN** 他的常用供应商里这 4 家都在（`settings-write-db.isolated.test.ts`）

### Requirement: 写入的内容与对外行为不变
每一处写入改哪一项、改成什么、何时不写 SHALL 与改动之前相同；相关接口的请求、响应结构与状态码 SHALL 不变。组织不存在时，原来报错的写入方 SHALL 仍然报错、原来静默不写的 SHALL 仍然静默不写（报错的具体类型可以不同）。Muse `set_preference` 的响应里返回的偏好 SHALL 是这次写入之后库里的偏好（可能包含同时学到的常用供应商）。

#### Scenario: 既有测试不改断言即通过
- **WHEN** 运行各写入方既有的测试
- **THEN** 不改断言全部通过（`npm run test:ci`；本地隔离库的 `auto-draft-db.isolated.test.ts`、`supplier-groups-db.isolated.test.ts`）

#### Scenario: 询价设置接口
- **WHEN** 管理员保存询价设置，内容不合规
- **THEN** 返回 400 与原来相同的说明，设置没有被改；内容合规时返回 200，审计里记着保存前后的询价设置（`settings-write-db.isolated.test.ts`）

### Requirement: 新的写入方不得绕开
代码库里写组织设置的任何位置（应用代码与运维脚本）SHALL 经统一的写入入口，或在同一事务里先锁住该组织的行再读再写。新增一处不满足的写入 SHALL 使自动化检查失败；不经入口、直接写这一列的文件 SHALL 登记在一份名单里，新增的须先加入名单。

#### Scenario: 守卫测试
- **WHEN** 在 `src/` 或 `scripts/` 下新增一个文件，直接读出组织设置、改一个键、整块写回，不经入口也不锁行
- **THEN** `npx tsx src/lib/organizations/__tests__/settings-write-guard.test.ts` 失败并指出这个文件

#### Scenario: 把事务里的锁删掉
- **WHEN** 把门店折扣或开户更新设置里「先锁行」那一句删掉
- **THEN** 守卫测试失败（锁必须在读设置之前），隔离库测试里「在自己事务里写设置的功能」也失败

### Requirement: 借组织行串行的写入用同一种锁
借「锁住组织行」来让同一组织的写入串行的其它功能（能力配额策略的新建与修改）SHALL 使用与写组织设置相同强度的锁：同一组织的这类写入 SHALL 仍然依次执行，SHALL NOT 阻塞向该组织新增关联记录，也 SHALL NOT 被它们阻塞。应用代码与运维脚本 SHALL NOT 对组织行使用会与外键检查互斥的锁；新增一条把表名与锁子句直接写在语句里的 SHALL 使自动化检查失败。

#### Scenario: 配额策略在有人插入记录时不用等
- **WHEN** 一个事务往本组织插入了一条审计后迟迟不提交（0.9 秒），这期间新建一条配额策略、修改一条配额策略
- **THEN** 两个操作都不用等（各自在 0.5 秒内完成）（`org-row-lock-db.isolated.test.ts`）

#### Scenario: 配额策略的写入仍然串行
- **WHEN** 对同一个组织的同一项指标（已有 1 条）同时新建 5 条配额策略；以及同时对同一条策略提交两次修改
- **THEN** 版本号是连续的 1 到 6、只有最新的一条生效；两次修改一成一败（版本冲突）、只多出一个版本（`org-row-lock-db.isolated.test.ts`；既有的 `governance-hygiene-concurrency-gate.test.ts` 不改断言通过）

#### Scenario: 有人拿着组织行的锁
- **WHEN** 一个事务锁住组织行后迟迟不提交（0.9 秒），这期间保存斑马帘比例、保存质保设置、新建一条配额策略
- **THEN** 三个操作都等到锁放开后才完成，拿锁那一方写的与这三处写的都在（`org-row-lock-db.isolated.test.ts`）

#### Scenario: 守卫
- **WHEN** 在 `src/`、`scripts/`、`prisma/` 或 `deploy/` 下新增一条对组织行取 `FOR UPDATE` 的语句（表名与锁子句直接写在语句里；带 schema、JOIN 进来、`FOR UPDATE OF`、写在普通字符串里的都算）
- **THEN** `npx tsx src/lib/organizations/__tests__/settings-write-guard.test.ts` 失败并指出这个文件

#### Scenario: 守卫拦不住的写法
- **WHEN** 表名或锁子句是变量拼出来的
- **THEN** 守卫认不出；这种情形由隔离库测试发现（三处的保存会重新被没提交的插入卡住）
