# Tasks

## 1. 注册

- [ ] 1.1 在 `scripts/test-all.sh` 第 75 行「WhatsApp/微信来信进 Revenue Spine DB 端到端(isolated)」之后插入两条 `run_test`：「通道入站标识 取值口径/跨组织重复列举（纯函数）」→ `src/lib/trade/__tests__/inbound-org.test.ts`；「通道入站标识跨组织唯一 DB 端到端(isolated)」→ `src/lib/trade/__tests__/channel-inbound-id-db.isolated.test.ts`。不改其它行。verify：`bash -n scripts/test-all.sh` 通过；两个文件逐个 `npx tsx` 退出 0（无库时第二个打印跳过）；`bash scripts/check-test-registry.sh` 退出 0 且输出「已注册 385 个；历史欠账基线剩余 76 条」。
- [ ] 1.2 跑 `npm test`。verify：输出含两个新 `▶` 项与「测试注册校验（SDD-0）」，三项 PASS；失败项集合不超出当前 `main` 的环境性失败（`MISSING_DATABASE_URL` 等）。

## Workflow follow-up

- PR 合并后 `/opsx:archive register-acquisition-hub-tests --yes`（`skip_specs`，归档不改 `openspec/specs/**`）。
