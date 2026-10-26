# Design

## Context

- 见 proposal.md「Why」。两个文件在干净 `main`（`51cc62c`）上实跑：`inbound-org.test.ts` 4 条通过；`channel-inbound-id-db.isolated.test.ts` 无 `DATABASE_URL` 时打印「⏭ 跳过通道入站标识唯一性 DB 测试」并退出 0。
- `scripts/test-all.sh` 第 66–75 行是 PR #242 同一批入站测试（网站询盘 / 嵌入表单 / 邮件转发 / WhatsApp）的所在，顺序与 `scripts/test-ci-unit.sh` 第 125–132 行一致；第 467–483 行是 SDD-0 的 muse-bridge / tender-rfq 块与注册校验。

## Goals / Non-Goals

**Goals：** `check-test-registry.sh` 在 `main` 上回到退出 0；两个测试进入 `npm test`。

**Non-Goals：** 不改 `scripts/test-ci-unit.sh`、`scripts/check-test-registry.sh`、`ci/test-registry-baseline.txt`；不改 `src/lib/trade/**`。

## Decisions

### D1 放在第 75 行之后，与同批入站测试相邻
- **选择**：紧随「WhatsApp/微信来信进 Revenue Spine DB 端到端(isolated)」插入，与 CI 子集里的相对位置一致，读 `test-all.sh` 的人在同一段看到整批入站测试。
- **否决：追加到 SDD-0 块末尾（第 481 行后）** —— 那一块的注释写明是 muse-bridge / tender-rfq 的补注册，混入 trade 条目会误导。
- **否决：放进基线** —— 基线只记 SDD-0 之前的欠账且只减不增（spec 第 3 条 Requirement）；新文件进基线等于绕过纪律。

### D2 `skip_specs: true`
- **选择**：不写 specs 增量。`qa/test-registry` 已覆盖此行为；archive 时不改 `openspec/specs/**`。
- **否决：给 `qa/test-registry` 加一条「PR #242 的两个测试必须注册」** —— 把一次性修复写成永久规格，规格会迅速过期，且与 OpenSpec「不为满足校验发明 Requirement」的指引相悖。

### D3 名称沿用现有风格
- 「通道入站标识 取值口径/跨组织重复列举（纯函数）」、「通道入站标识跨组织唯一 DB 端到端(isolated)」——与第 66–75 行同段的命名方式（功能 + 纯逻辑/DB 端到端(isolated)）一致。

## 与八条硬纪律的关系

| # | 纪律 | 本 change |
|---|---|---|
| 1–7 | 零 schema / 出站先审批 / 禁止第三套队列 / 脱敏 / 不爬登录页 / 邮箱分离 / 确定性优先 | 不涉及（只改测试入口脚本） |
| 8 | 测试注册 | **合规修复**：让 `main` 重新满足 `qa/test-registry`，不改规则本身 |

## Risks / Trade-offs

- [isolated 测试在有库环境下真实跑，可能比纯逻辑慢] → 与同段其它 isolated 条目同一约定；无库时立即跳过。
- [下一次有人再只改 CI 子集] → 本 change 不解决根因；根因修复是把 `check-test-registry.sh` 加进 `test-ci-unit.sh`，另开 change（见 proposal Out of scope）。

## 验证方式

- `bash -n scripts/test-all.sh` 通过。
- 两个文件逐个 `npx tsx` 退出 0。
- `bash scripts/check-test-registry.sh` → `OK … 已注册 385 个；历史欠账基线剩余 76 条`，退出 0。
- `npm test`：两个新 `▶` 项与「测试注册校验（SDD-0）」PASS；失败项不多于当前 `main` 的环境性失败集合。
