## MODIFIED Requirements

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

## ADDED Requirements

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
