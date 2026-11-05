# P2-0c 报告：授标去重——不同招标编号不判疑似重复

| 项 | 值 |
|---|---|
| TASKFLOW | P2-0c |
| OpenSpec change | `openspec/changes/award-dedupe-solicitation/` |
| 来源 | P2-0b 截图发现（`docs/QINGYAN_P2-0b_REPORT.md` §3，PR #385） |
| 分支 | `claude/award-dedupe-solicitation`（基于 main `05090b0`，与 #384 / #385 独立） |

## 1. 问题

`createOrObserveAwardRecord` 的弱信号规则：同一中标方在同一买家已有记录 → 新记录一律 NEEDS_REVIEW（疑似重复），不看招标编号。系统没有裁决疑似重复的界面，这些记录一直只算线索：

- 我方在同一机构第二次中标（结果标记回灌）→ 疑似重复；
- 在位供应商在同一机构再次中标 → 疑似重复（竞争情报最想看的事实被压成线索）；
- 买家采购周期因此缺样本。

隔离库复现（同一测试跑旧规则）：我方第二次中标落 NEEDS_REVIEW；对手第二次中标落 NEEDS_REVIEW；同机构同范围 5 次真实中标，周期只用上 3 次——3 failed。

## 2. 改了什么

- 弱信号改为：取同中标方 + 同买家的候选（按创建时间，最多 200 条），跳过"两条都有招标编号、且规范化后不同"的记录；剩下有一条就判疑似重复，没有就正常 ACTIVE。
- 规范化：大写、去空白与标点（`normalizeSolicitationKey`），只用于判断，不改存储值。
- 编号缺一方、或只差写法 → 保持原规则。强匹配与幂等不变。

零 schema、零出站、零 LLM；仍是确定性规则。

## 3. 测试与门禁（实际运行）

| 检查 | 结果 |
|---|---|
| `awards.test.ts`（+T4-01d 不同编号 ACTIVE / 01e 写法不同仍疑似重复 / 01f 缺编号仍疑似重复 / 01g 规范化） | 24 passed（原 T4-01c 仍过） |
| `award-dedupe-db.isolated.test.ts`（新增，隔离库，虚构企业） | 新规则 6 passed；同一测试跑旧规则 3 failed |
| `award-semantics` / `intel-slots-p1p2` / `intel-auto-flow` | 12 / 13 / 16 passed |
| `awards-db.test.ts`（既有，隔离库） | 16 passed / 2 failed：T4-DB-08/09 需要生产快照里的调查室行，空隔离库没有，与本改动无关 |
| `check-test-registry.sh` / typecheck / `lint:baseline` | OK（536）/ exit 0 / PASS |
| `openspec validate award-dedupe-solicitation --strict` | valid |

以上全部是测试数据，不是真实业务证据。

## 4. 已有数据

已经落成 NEEDS_REVIEW 的历史记录不会自动改状态（改状态属数据修正，走 Owner Gate）。想先知道生产上有多少，可跑下面的只读查询（已在隔离库验证可执行）；"其中编号不同"只和被指向的那条原记录比较，是近似值：

```sql
-- 只读：现有「疑似重复」授标里，按 P2-0c 新规则其实是另一次招标的大约条数（不改任何数据）
SELECT count(*) AS "疑似重复总数",
       count(*) FILTER (
         WHERE r."solicitationNumber" IS NOT NULL AND o."solicitationNumber" IS NOT NULL
           AND upper(regexp_replace(r."solicitationNumber", '[^[:alnum:]]', '', 'g'))
            <> upper(regexp_replace(o."solicitationNumber", '[^[:alnum:]]', '', 'g'))
       ) AS "其中编号不同"
FROM "AwardRecord" r
LEFT JOIN "AwardRecord" o ON o.id = r."possibleDuplicateOfId"
WHERE r.status = 'NEEDS_REVIEW';
```

## 5. 上线

无迁移、无新 env；合并即生效，只影响之后新写入的授标记录。回滚 = 还原文件。
