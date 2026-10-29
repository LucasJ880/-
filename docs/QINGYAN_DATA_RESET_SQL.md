# 生产数据清理 SQL（Neon SQL Editor）

在 Neon Console → 项目「青砚-AI工作助手」→ 分支 `production` → SQL Editor（数据库 `neondb`）执行。

## 用户拍板（2026-10-29）

- 青砚现有记录都是测试数据，全部清掉，包括招标（tender）；**梦馨数据不动**。
- 账号只留 Cathy（`cathy@hlmbedding.com`）、Lucas（`lucas@sunnyshutter.ca`），其他账号之后重新设计。
- 除梦馨外的企业：**保留 Sunny 空壳**（企业本身、岗位模板与权限、报价折扣 / 营销 / 审批设置、工作区，以及 Lucas 的成员身份与岗位），其余测试企业整个删除。
- 平台级（不属于任何企业）的数据：**清记录、留系统配置**（`ApiToken`——含 Muse 桥接令牌、无企业的视觉方案产品目录及其素材）。

## 规则（脚本怎么判定）

- 带 `orgId` 的表按 `orgId` 判定：梦馨的行全留；Sunny 只留"空壳表"里的行；其余删除。
- 不带 `orgId` 的表（或 `orgId` 为空的行）顺着外键判定：上级是梦馨数据 → 也是梦馨数据，保留；Cathy 的个人数据只有在它引用的每一行都保留时才留（例如她在测试企业项目里的成员记录随项目删除）；其余删除。
- 梦馨数据引用到的任何行（例如项目负责人是测试账号）一并保留，预览里标"被梦馨数据引用而保留"，保证梦馨行一个字段都不变。
- 保留下来的非梦馨配置若挂在被删账号名下（如 Sunny 的负责人），改挂 Lucas。
- 没有外键约束、只靠字段关联的表在脚本 `p_soft_fk` 里列出。
- 表结构、主键、外键在运行时从数据库目录读取，不依赖仓库版本。

## 步骤

1. **预览**（只读：只建临时表，不改数据）：执行下面脚本原样（第一行 `'dry-run'`）。结果每行一张表：总行数 / 各类保留 / 改挂 / 删除；`User`、`Organization` 两行的备注列出要删的账号、企业和"被梦馨数据引用而保留"的账号。
2. **备份**：Branches → New branch，父分支 `production`、当前时间点，命名 `backup-before-reset-20261029`。
3. **执行**：把第一行改成 `SET qy.reset_mode = 'execute';` 再执行。整段是一个语句：任何一步出错（包括删后校验失败）全部回滚，库里不变。删后校验三条：不该留的一行不剩、该留的一行不少、梦馨数据一个字段不变（逐表 md5 指纹）。
4. **复查**：再跑一次预览，"删除"列应全为 0。
5. Lucas、Cathy 重新登录；Cathy 确认外贸 / 营收照常。

回退：Neon 左侧「Backup & Restore」把 `production` 恢复到执行前的时间点；备份分支 `backup-before-reset-20261029` 也保留着执行前的完整数据。

注意：对象存储（上传的文件、图片）不在数据库里，被删记录引用的文件不会自动删除。

## 本地演练（2026-10-29）

- 造数据：梦馨 / Sunny / 测试企业 / 无企业招标项目，含交叉引用（梦馨项目负责人是测试账号、Cathy 与 Lucas 的个人任务与通知、Lucas 在测试企业工作区的成员身份、无外键关联表等）：预览与执行结果符合规则；Sunny 负责人改挂 Lucas。
- 本地测试库（46 个企业、287 个账号、约 9000 行）换参数跑：执行通过校验；再跑预览 0 行待删。
- 故意在执行中改一条梦馨数据：校验报错、整段回滚。企业编码写错：报错并列出库里现有企业。

## 脚本

```sql
-- 青砚生产数据清理：梦馨不动；Sunny 只留空壳；账号只留 Cathy、Lucas
-- 第一行是模式：'dry-run' 只预览不删除；改成 'execute' 才真正删除（整段是一个事务，任何一步出错全部回滚）
SET qy.reset_mode = 'dry-run';

DO $reset$
DECLARE
  v_mode text := coalesce(nullif(current_setting('qy.reset_mode', true), ''), 'dry-run');

  -- ===== 参数 =====
  p_keep_org     text[] := ARRAY['mengxin-home-textile'];          -- 整个企业原样保留
  p_shell_org    text[] := ARRAY['sunny-home-deco'];               -- 只留企业本身与下面"空壳表"
  p_mx_users     text[] := ARRAY['cathy@hlmbedding.com'];          -- 梦馨人员：个人数据算梦馨数据
  p_keep_users   text[] := ARRAY['lucas@sunnyshutter.ca'];         -- 只留账号、成员关系与账号设置
  p_reown        text   := 'lucas@sunnyshutter.ca';                -- 保留下来的配置若挂在被删账号名下，改挂此人
  p_shell_tables text[] := ARRAY['RoleProfile','RolePermissionBinding','PositionTemplate',
                                 'AgentApprovalSettings','MarketingEconomicsSetting','QuoteDiscountSettings','Workspace'];
  p_user_tables  text[] := ARRAY['OrganizationMember','PrincipalRoleBinding','WorkspaceMember','ExternalIdentity',
                                 'EmailBinding','WeChatBinding','UserNotificationPreference','CalendarProvider','EmailProvider'];
  p_cfg_all      text[] := ARRAY['ApiToken'];                      -- 平台配置：整表保留
  p_cfg_null_org text[] := ARRAY['VisualizerCatalogProduct'];      -- 平台配置：只留不属于任何企业的行
  p_cfg_child    text[] := ARRAY['VisualizerCatalogAsset','VisualizerCatalogTemplateJob'];  -- 随上面配置保留的下级
  -- 没有外键约束、只靠字段关联的表：表.字段>上级表
  p_soft_fk      text[] := ARRAY['ConversationSummary.userId>User','EmailProvider.userId>User',
                                 'SalesFAQ.userId>User','SalesPlaybook.userId>User',
                                 'EvaluationTag.projectId>Project','EvaluationRun.projectId>Project',
                                 'ConversationFeedback.projectId>Project','MessageFeedback.projectId>Project',
                                 'FabricStockLog.fabricId>FabricInventory','PrincipalRoleBinding.principalId>User'];
  -- ================

  r record; e record; s text; sql text; n bigint; changed boolean; pass int; progress boolean;
  v_reown_id text; v_left text[]; v_next text[]; v_t text;
  v_mx_src constant text := '(''mx'',''mx-desc'',''org'')';
BEGIN
  IF v_mode NOT IN ('dry-run', 'execute') THEN
    RAISE EXCEPTION '模式只能是 dry-run 或 execute，现在是 %', v_mode;
  END IF;

  DROP TABLE IF EXISTS _qr_tbl, _qr_fk, _qr_keep, _qr_reown, _qr_fp, _qr_summary;
  CREATE TEMP TABLE _qr_tbl (tbl text PRIMARY KEY, has_org boolean, kx text);
  CREATE TEMP TABLE _qr_fk (child text, parent text, ccols text[], pcols text[], dt "char", soft boolean, jc text);
  CREATE TEMP TABLE _qr_keep (tbl text, k text, why text, mx boolean, PRIMARY KEY (tbl, k));
  CREATE TEMP TABLE _qr_reown (tbl text, col text, k text);
  CREATE TEMP TABLE _qr_fp (tbl text PRIMARY KEY, fp text);
  CREATE TEMP TABLE _qr_summary (表 text, 总行数 bigint, 保留_梦馨 bigint, 保留_空壳 bigint, 保留_配置 bigint,
                                 保留_账号 bigint, 保留_被引用 bigint, 改挂 bigint, 删除 bigint, 删后剩余 bigint, 备注 text);

  -- 表与主键（kx 用 @@ 作别名占位）
  INSERT INTO _qr_tbl
  SELECT c.relname,
         EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'orgId' AND NOT a.attisdropped),
         (SELECT string_agg(format('@@.%I::text', a.attname), ' || ''|'' || ' ORDER BY u.ord)
            FROM pg_index i
            CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS u(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = u.attnum
           WHERE i.indrelid = c.oid AND i.indisprimary)
  FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname <> '_prisma_migrations';

  IF EXISTS (SELECT 1 FROM _qr_tbl WHERE kx IS NULL) THEN
    RAISE EXCEPTION '有表没有主键：%', (SELECT string_agg(tbl, ',') FROM _qr_tbl WHERE kx IS NULL);
  END IF;

  -- 外键（含自引用）
  INSERT INTO _qr_fk (child, parent, ccols, pcols, dt, soft)
  SELECT cc.relname, pc.relname,
         ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY u(n, o) JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.n ORDER BY u.o),
         ARRAY(SELECT a.attname FROM unnest(k.confkey) WITH ORDINALITY u(n, o) JOIN pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = u.n ORDER BY u.o),
         k.confdeltype, false
  FROM pg_constraint k
  JOIN pg_class cc ON cc.oid = k.conrelid
  JOIN pg_class pc ON pc.oid = k.confrelid
  WHERE k.contype = 'f' AND cc.relnamespace = 'public'::regnamespace AND pc.relnamespace = 'public'::regnamespace;

  FOREACH s IN ARRAY p_soft_fk LOOP
    IF NOT EXISTS (SELECT 1 FROM _qr_tbl WHERE tbl = split_part(split_part(s, '>', 1), '.', 1))
       OR NOT EXISTS (SELECT 1 FROM _qr_tbl WHERE tbl = split_part(s, '>', 2)) THEN
      CONTINUE;
    END IF;
    INSERT INTO _qr_fk (child, parent, ccols, pcols, dt, soft)
    VALUES (split_part(split_part(s, '>', 1), '.', 1), split_part(s, '>', 2),
            ARRAY[split_part(split_part(s, '>', 1), '.', 2)], ARRAY['id'], 'n', true);
  END LOOP;

  UPDATE _qr_fk f SET jc = (SELECT string_agg(format('c.%I = p.%I', cc, pc), ' AND ')
                              FROM unnest(f.ccols, f.pcols) AS u(cc, pc));

  -- ===== 种子 =====
  INSERT INTO _qr_keep SELECT 'Organization', id, 'org', true FROM "Organization" WHERE code = ANY (p_keep_org);
  INSERT INTO _qr_keep SELECT 'Organization', id, 'shell', false FROM "Organization" WHERE code = ANY (p_shell_org)
    ON CONFLICT DO NOTHING;
  INSERT INTO _qr_keep SELECT 'User', id, 'mx-user', true FROM "User"
    WHERE lower(email) = ANY (SELECT lower(x) FROM unnest(p_mx_users) x);
  INSERT INTO _qr_keep SELECT 'User', id, 'user', false FROM "User"
    WHERE lower(email) = ANY (SELECT lower(x) FROM unnest(p_keep_users) x) ON CONFLICT DO NOTHING;

  IF (SELECT count(*) FROM _qr_keep WHERE tbl = 'Organization' AND why = 'org') <> cardinality(p_keep_org) THEN
    RAISE EXCEPTION '保留企业编码没找全：%；库里现有企业：%', p_keep_org, (SELECT string_agg(code || '（' || name || '）', '，') FROM "Organization");
  END IF;
  IF (SELECT count(*) FROM _qr_keep WHERE tbl = 'Organization' AND why = 'shell') <> cardinality(p_shell_org) THEN
    RAISE EXCEPTION '空壳企业编码没找全：%；库里现有企业：%', p_shell_org, (SELECT string_agg(code || '（' || name || '）', '，') FROM "Organization");
  END IF;
  IF (SELECT count(*) FROM _qr_keep WHERE tbl = 'User') <> cardinality(p_mx_users) + cardinality(p_keep_users) THEN
    RAISE EXCEPTION '保留账号没找全：% %', p_mx_users, p_keep_users;
  END IF;
  SELECT id INTO v_reown_id FROM "User" WHERE lower(email) = lower(p_reown);
  IF v_reown_id IS NULL THEN RAISE EXCEPTION '改挂账号不存在：%', p_reown; END IF;

  FOR r IN SELECT * FROM _qr_tbl WHERE has_org LOOP
    EXECUTE format('INSERT INTO _qr_keep SELECT %L, %s, ''mx'', true FROM %I x
                    WHERE x."orgId" IN (SELECT k FROM _qr_keep WHERE tbl = ''Organization'' AND why = ''org'')
                    ON CONFLICT DO NOTHING', r.tbl, replace(r.kx, '@@', 'x'), r.tbl);
    IF r.tbl = ANY (p_shell_tables) THEN
      EXECUTE format('INSERT INTO _qr_keep SELECT %L, %s, ''shell'', false FROM %I x
                      WHERE x."orgId" IN (SELECT k FROM _qr_keep WHERE tbl = ''Organization'' AND why = ''shell'')
                      ON CONFLICT DO NOTHING', r.tbl, replace(r.kx, '@@', 'x'), r.tbl);
    END IF;
    IF r.tbl = ANY (p_cfg_null_org) THEN
      EXECUTE format('INSERT INTO _qr_keep SELECT %L, %s, ''cfg'', false FROM %I x WHERE x."orgId" IS NULL
                      ON CONFLICT DO NOTHING', r.tbl, replace(r.kx, '@@', 'x'), r.tbl);
    END IF;
  END LOOP;

  FOR r IN SELECT * FROM _qr_tbl WHERE tbl = ANY (p_cfg_all) LOOP
    EXECUTE format('INSERT INTO _qr_keep SELECT %L, %s, ''cfg'', false FROM %I x ON CONFLICT DO NOTHING',
                   r.tbl, replace(r.kx, '@@', 'x'), r.tbl);
  END LOOP;

  -- 保留账号的成员关系与账号设置（只限不属于企业、或属于保留 / 空壳企业的行）
  FOR e IN SELECT f.*, t.kx, t.has_org FROM _qr_fk f JOIN _qr_tbl t ON t.tbl = f.child
           WHERE f.parent = 'User' AND f.child = ANY (p_user_tables) LOOP
    EXECUTE format('INSERT INTO _qr_keep SELECT %L, %s, ''user-set'', false FROM %I c JOIN "User" p ON %s
                    WHERE p.id IN (SELECT k FROM _qr_keep WHERE tbl = ''User'') AND %s
                    ON CONFLICT DO NOTHING',
                   e.child, replace(e.kx, '@@', 'c'), e.child, e.jc,
                   CASE WHEN e.has_org THEN '(c."orgId" IS NULL OR c."orgId" IN (SELECT k FROM _qr_keep WHERE tbl = ''Organization''))' ELSE 'true' END);
  END LOOP;

  -- ===== 传播，直到不再变化 =====
  LOOP
    changed := false;

    -- A. 梦馨下级：不带企业字段的表（或企业字段为空的行），上级是梦馨数据 → 也是梦馨数据
    FOR e IN SELECT f.*, ct.kx AS ckx, ct.has_org AS c_org, pt.kx AS pkx
             FROM _qr_fk f JOIN _qr_tbl ct ON ct.tbl = f.child JOIN _qr_tbl pt ON pt.tbl = f.parent
             WHERE f.child NOT IN ('User', 'Organization') LOOP
      EXECUTE format('INSERT INTO _qr_keep SELECT %L, %s, ''mx-desc'', true FROM %I c JOIN %I p ON %s
                      JOIN _qr_keep k ON k.tbl = %L AND k.k = %s AND k.mx AND k.why IN %s
                      WHERE %s
                      ON CONFLICT (tbl, k) DO UPDATE SET why = ''mx-desc'', mx = true
                      WHERE _qr_keep.why NOT IN %s',
                     e.child, replace(e.ckx, '@@', 'c'), e.child, e.parent, e.jc,
                     e.parent, replace(e.pkx, '@@', 'p'), v_mx_src,
                     CASE WHEN e.c_org THEN 'c."orgId" IS NULL' ELSE 'true' END, v_mx_src);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN changed := true; END IF;
    END LOOP;

    -- A2. 配置的下级
    FOR e IN SELECT f.*, ct.kx AS ckx, pt.kx AS pkx
             FROM _qr_fk f JOIN _qr_tbl ct ON ct.tbl = f.child JOIN _qr_tbl pt ON pt.tbl = f.parent
             WHERE f.child = ANY (p_cfg_child) LOOP
      EXECUTE format('INSERT INTO _qr_keep SELECT %L, %s, ''cfg'', false FROM %I c JOIN %I p ON %s
                      JOIN _qr_keep k ON k.tbl = %L AND k.k = %s AND k.why = ''cfg''
                      ON CONFLICT DO NOTHING',
                     e.child, replace(e.ckx, '@@', 'c'), e.child, e.parent, e.jc,
                     e.parent, replace(e.pkx, '@@', 'p'));
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN changed := true; END IF;
    END LOOP;

    -- B. 上级：保留行引用的行也要保留（梦馨数据：任何外键都保留上级，保证梦馨行一个字段都不变；
    --    其他保留行：置空型外键允许置空，引用被删账号的改挂 p_reown，其余保留上级）
    FOR e IN SELECT f.*, ct.kx AS ckx, pt.kx AS pkx
             FROM _qr_fk f JOIN _qr_tbl ct ON ct.tbl = f.child JOIN _qr_tbl pt ON pt.tbl = f.parent
             WHERE NOT f.soft LOOP
      EXECUTE format('INSERT INTO _qr_keep SELECT DISTINCT %L, %s, ''anc'', true FROM %I c
                      JOIN _qr_keep k ON k.tbl = %L AND k.k = %s AND k.mx
                      JOIN %I p ON %s
                      ON CONFLICT (tbl, k) DO UPDATE SET mx = true WHERE NOT _qr_keep.mx',
                     e.parent, replace(e.pkx, '@@', 'p'), e.child,
                     e.child, replace(e.ckx, '@@', 'c'), e.parent, e.jc);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN changed := true; END IF;

      IF e.dt <> 'n' AND e.parent <> 'User' THEN
        EXECUTE format('INSERT INTO _qr_keep SELECT DISTINCT %L, %s, ''anc'', false FROM %I c
                        JOIN _qr_keep k ON k.tbl = %L AND k.k = %s AND NOT k.mx AND k.why <> ''user-set''
                        JOIN %I p ON %s
                        ON CONFLICT DO NOTHING',
                       e.parent, replace(e.pkx, '@@', 'p'), e.child,
                       e.child, replace(e.ckx, '@@', 'c'), e.parent, e.jc);
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN changed := true; END IF;
      END IF;
    END LOOP;

    EXIT WHEN NOT changed;
  END LOOP;

  -- 账号设置 / 成员关系只在它的上级（账号以外）都保留时才留，不反过来把上级拉进保留
  LOOP
    changed := false;
    FOR e IN SELECT f.*, ct.kx AS ckx, pt.kx AS pkx
             FROM _qr_fk f JOIN _qr_tbl ct ON ct.tbl = f.child JOIN _qr_tbl pt ON pt.tbl = f.parent
             WHERE NOT f.soft AND f.dt <> 'n' AND f.parent <> 'User' AND f.child = ANY (p_user_tables) LOOP
      EXECUTE format('DELETE FROM _qr_keep k USING %I c
                      WHERE k.tbl = %L AND k.why = ''user-set'' AND k.k = %s AND %s
                        AND NOT EXISTS (SELECT 1 FROM %I p JOIN _qr_keep kp ON kp.tbl = %L AND kp.k = %s WHERE %s)',
                     e.child, e.child, replace(e.ckx, '@@', 'c'),
                     (SELECT string_agg(format('c.%I IS NOT NULL', x), ' AND ') FROM unnest(e.ccols) x),
                     e.parent, e.parent, replace(e.pkx, '@@', 'p'), e.jc);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN changed := true; END IF;
    END LOOP;
    EXIT WHEN NOT changed;
  END LOOP;

  -- 梦馨人员（Cathy）的个人数据：从账号往下找；只有它引用的每一行都保留时才留，不反过来把上级拉进保留
  -- （例如 Cathy 在测试企业项目里的成员记录，项目要删，这条也删）
  LOOP
    changed := false;
    FOR e IN SELECT f.*, ct.kx AS ckx, ct.has_org AS c_org, pt.kx AS pkx
             FROM _qr_fk f JOIN _qr_tbl ct ON ct.tbl = f.child JOIN _qr_tbl pt ON pt.tbl = f.parent
             WHERE f.child NOT IN ('User', 'Organization') LOOP
      EXECUTE format('INSERT INTO _qr_keep SELECT %L, %s, ''mx-weak'', true FROM %I c JOIN %I p ON %s
                      JOIN _qr_keep k ON k.tbl = %L AND k.k = %s AND k.why IN (''mx-user'', ''mx-weak'')
                      WHERE %s
                      ON CONFLICT DO NOTHING',
                     e.child, replace(e.ckx, '@@', 'c'), e.child, e.parent, e.jc,
                     e.parent, replace(e.pkx, '@@', 'p'),
                     CASE WHEN e.c_org THEN 'c."orgId" IS NULL' ELSE 'true' END);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN changed := true; END IF;
    END LOOP;
    EXIT WHEN NOT changed;
  END LOOP;
  LOOP
    changed := false;
    FOR e IN SELECT f.*, ct.kx AS ckx, pt.kx AS pkx
             FROM _qr_fk f JOIN _qr_tbl ct ON ct.tbl = f.child JOIN _qr_tbl pt ON pt.tbl = f.parent
             WHERE NOT f.soft LOOP
      EXECUTE format('DELETE FROM _qr_keep k USING %I c
                      WHERE k.tbl = %L AND k.why = ''mx-weak'' AND k.k = %s AND %s
                        AND NOT EXISTS (SELECT 1 FROM %I p JOIN _qr_keep kp ON kp.tbl = %L AND kp.k = %s WHERE %s)',
                     e.child, e.child, replace(e.ckx, '@@', 'c'),
                     (SELECT string_agg(format('c.%I IS NOT NULL', x), ' AND ') FROM unnest(e.ccols) x),
                     e.parent, e.parent, replace(e.pkx, '@@', 'p'), e.jc);
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN changed := true; END IF;
    END LOOP;
    EXIT WHEN NOT changed;
  END LOOP;

  -- 改挂：非梦馨的保留行（非置空型外键）引用了被删账号
  FOR e IN SELECT f.*, ct.kx AS ckx FROM _qr_fk f JOIN _qr_tbl ct ON ct.tbl = f.child
           WHERE NOT f.soft AND f.parent = 'User' AND f.dt <> 'n' AND cardinality(f.ccols) = 1 LOOP
    EXECUTE format('INSERT INTO _qr_reown SELECT %L, %L, %s FROM %I c
                    JOIN _qr_keep k ON k.tbl = %L AND k.k = %s AND NOT k.mx
                    WHERE c.%I IS NOT NULL AND c.%I NOT IN (SELECT k FROM _qr_keep WHERE tbl = ''User'')',
                   e.child, e.ccols[1], replace(e.ckx, '@@', 'c'), e.child,
                   e.child, replace(e.ckx, '@@', 'c'), e.ccols[1], e.ccols[1]);
  END LOOP;

  -- ===== 汇总 =====
  FOR r IN SELECT * FROM _qr_tbl LOOP
    EXECUTE format('SELECT count(*) FROM %I', r.tbl) INTO n;
    IF n > 0 THEN
      INSERT INTO _qr_summary
      SELECT r.tbl, n,
             count(*) FILTER (WHERE why IN ('mx', 'mx-desc', 'mx-user', 'mx-weak', 'org')),
             count(*) FILTER (WHERE why = 'shell'),
             count(*) FILTER (WHERE why = 'cfg'),
             count(*) FILTER (WHERE why IN ('user', 'user-set')),
             count(*) FILTER (WHERE why = 'anc'),
             (SELECT count(DISTINCT q.k) FROM _qr_reown q WHERE q.tbl = r.tbl),
             n - count(*), NULL,
             CASE r.tbl
               WHEN 'User' THEN concat_ws('；',
                 (SELECT '被梦馨数据引用而保留：' || string_agg(u.email, '，' ORDER BY u.email) FROM "User" u
                    JOIN _qr_keep k2 ON k2.tbl = 'User' AND k2.k = u.id AND k2.why = 'anc'),
                 (SELECT '删除：' || string_agg(u.email, '，' ORDER BY u.email) FROM "User" u
                   WHERE NOT EXISTS (SELECT 1 FROM _qr_keep k2 WHERE k2.tbl = 'User' AND k2.k = u.id)))
               WHEN 'Organization' THEN concat_ws('；',
                 (SELECT '被梦馨数据引用而保留：' || string_agg(o.code, '，' ORDER BY o.code) FROM "Organization" o
                    JOIN _qr_keep k2 ON k2.tbl = 'Organization' AND k2.k = o.id AND k2.why = 'anc'),
                 (SELECT '删除：' || string_agg(o.code || '（' || o.name || '）', '，' ORDER BY o.code) FROM "Organization" o
                   WHERE NOT EXISTS (SELECT 1 FROM _qr_keep k2 WHERE k2.tbl = 'Organization' AND k2.k = o.id)))
             END
      FROM _qr_keep WHERE tbl = r.tbl;
    END IF;
  END LOOP;

  IF v_mode = 'dry-run' THEN
    RETURN;
  END IF;

  -- ===== 执行 =====
  -- 1) 梦馨数据指纹
  FOR r IN SELECT t.* FROM _qr_tbl t WHERE EXISTS (SELECT 1 FROM _qr_keep k WHERE k.tbl = t.tbl AND k.mx) LOOP
    EXECUTE format('INSERT INTO _qr_fp SELECT %L, md5(coalesce(string_agg(row_to_json(x)::text, chr(10) ORDER BY %s), '''')) FROM %I x
                    WHERE %s IN (SELECT k FROM _qr_keep WHERE tbl = %L AND mx)',
                   r.tbl, replace(r.kx, '@@', 'x'), r.tbl, replace(r.kx, '@@', 'x'), r.tbl);
  END LOOP;

  -- 2) 改挂
  FOR r IN SELECT DISTINCT q.tbl, q.col, t.kx FROM _qr_reown q JOIN _qr_tbl t ON t.tbl = q.tbl LOOP
    EXECUTE format('UPDATE %I x SET %I = %L WHERE %s IN (SELECT k FROM _qr_reown WHERE tbl = %L AND col = %L)',
                   r.tbl, r.col, v_reown_id, replace(r.kx, '@@', 'x'), r.tbl, r.col);
  END LOOP;

  -- 3) 删除：失败的表下一轮再试（等它的下级先删掉）
  SELECT array_agg(表) INTO v_left FROM _qr_summary WHERE 删除 > 0;
  pass := 0;
  WHILE coalesce(cardinality(v_left), 0) > 0 LOOP
    pass := pass + 1;
    progress := false;
    v_next := ARRAY[]::text[];
    FOREACH v_t IN ARRAY v_left LOOP
      BEGIN
        EXECUTE format('DELETE FROM %I x WHERE NOT EXISTS (SELECT 1 FROM _qr_keep k WHERE k.tbl = %L AND k.k = %s)',
                       v_t, v_t, replace((SELECT kx FROM _qr_tbl WHERE tbl = v_t), '@@', 'x'));
        progress := true;
      EXCEPTION WHEN foreign_key_violation THEN
        v_next := v_next || v_t;
      END;
    END LOOP;
    IF NOT progress THEN
      RAISE EXCEPTION '删除卡住（外键）：%', v_next;
    END IF;
    v_left := v_next;
  END LOOP;

  -- 4) 校验：不该留的一行不剩、该留的一行不少、梦馨数据一个字段不变
  FOR r IN SELECT * FROM _qr_tbl LOOP
    EXECUTE format('SELECT count(*) FROM %I x WHERE NOT EXISTS (SELECT 1 FROM _qr_keep k WHERE k.tbl = %L AND k.k = %s)',
                   r.tbl, r.tbl, replace(r.kx, '@@', 'x')) INTO n;
    IF n > 0 THEN RAISE EXCEPTION '校验失败：% 还剩 % 行该删的', r.tbl, n; END IF;
    EXECUTE format('SELECT (SELECT count(*) FROM _qr_keep WHERE tbl = %L) - count(*) FROM %I x', r.tbl, r.tbl) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION '校验失败：% 少了 % 行该留的', r.tbl, n; END IF;
    EXECUTE format('SELECT count(*) FROM %I', r.tbl) INTO n;
    UPDATE _qr_summary SET 删后剩余 = n WHERE 表 = r.tbl;
  END LOOP;
  FOR r IN SELECT f.tbl, f.fp, t.kx FROM _qr_fp f JOIN _qr_tbl t ON t.tbl = f.tbl LOOP
    EXECUTE format('SELECT md5(coalesce(string_agg(row_to_json(x)::text, chr(10) ORDER BY %s), '''')) FROM %I x
                    WHERE %s IN (SELECT k FROM _qr_keep WHERE tbl = %L AND mx)',
                   replace(r.kx, '@@', 'x'), r.tbl, replace(r.kx, '@@', 'x'), r.tbl) INTO s;
    IF s IS DISTINCT FROM r.fp THEN RAISE EXCEPTION '校验失败：梦馨数据在 % 被改动', r.tbl; END IF;
  END LOOP;
END
$reset$;

SELECT * FROM _qr_summary ORDER BY (删除 > 0) DESC, 表;
```
