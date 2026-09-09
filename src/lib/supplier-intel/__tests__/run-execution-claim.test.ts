/**
 * FR1 纯核：执行声明的所有权与恢复语义（CI 可执行，无 DB、无网络）。
 *
 * 这些断言锁住三件不能退回去的事：
 *   1. 声明必须带唯一 claimId——没有它就无法区分「同一个人的两次执行」；
 *   2. 过期 ≠ 空闲。过期只证明上一次执行没收尾，结果未知（no-takeover）；
 *   3. 缺字段的历史声明按「不是有效声明」处理，但不能被当成「可以直接重跑」。
 */
import assert from "node:assert/strict";

async function main() {
  const { readExecutionClaimRecord, readActiveExecutionClaim, classifyRunExecutionState } =
    await import("../run-execution-state");

  const now = new Date("2026-09-10T00:00:00.000Z");
  const future = new Date(now.getTime() + 60_000).toISOString();
  const past = new Date(now.getTime() - 60_000).toISOString();
  const validClaim = {
    claimId: "claim-1",
    claimedAt: now.toISOString(),
    expiresAt: future,
    byUserId: "u1",
  };

  console.log("A1：合法声明可解析");
  const parsed = readExecutionClaimRecord({ executionClaim: validClaim });
  assert.equal(parsed?.claimId, "claim-1");

  console.log("A2：缺 claimId 的旧格式声明不被认为是有效声明");
  const legacy = readExecutionClaimRecord({
    executionClaim: { claimedAt: now.toISOString(), expiresAt: future, byUserId: "u1" },
  });
  assert.equal(legacy, null, "没有 claimId 就无法做所有权判定，必须拒绝识别");

  console.log("A3：非对象 / 数组 / 空 claimId 一律拒绝");
  assert.equal(readExecutionClaimRecord(null), null);
  assert.equal(readExecutionClaimRecord([{ executionClaim: validClaim }]), null);
  assert.equal(readExecutionClaimRecord({ executionClaim: "x" }), null);
  assert.equal(
    readExecutionClaimRecord({ executionClaim: { ...validClaim, claimId: "" } }),
    null,
  );
  assert.equal(
    readExecutionClaimRecord({ executionClaim: { ...validClaim, expiresAt: "not-a-date" } }),
    null,
  );

  console.log("A4：过期声明仍能被读出来（恢复策略要看得见它）");
  const expiredRecord = readExecutionClaimRecord({
    executionClaim: { ...validClaim, expiresAt: past },
  });
  assert.equal(expiredRecord?.claimId, "claim-1", "过期不等于不存在");
  assert.equal(
    readActiveExecutionClaim({ executionClaim: { ...validClaim, expiresAt: past } }, now),
    null,
    "但它不再算「进行中」",
  );

  console.log("B1：执行态四分类");
  assert.equal(
    classifyRunExecutionState({ status: "PLANNED", statusDetailJson: {} }, now),
    "IDLE",
  );
  assert.equal(
    classifyRunExecutionState(
      { status: "RUNNING", statusDetailJson: { executionClaim: validClaim } },
      now,
    ),
    "IN_PROGRESS",
  );
  assert.equal(
    classifyRunExecutionState(
      { status: "RUNNING", statusDetailJson: { executionClaim: { ...validClaim, expiresAt: past } } },
      now,
    ),
    "RECOVERY_REQUIRED",
    "FR1-C：过期声明 = 结果未知，必须显式恢复，不能自动重跑",
  );
  for (const terminal of ["COMPLETED", "FAILED", "CANCELLED"]) {
    assert.equal(
      classifyRunExecutionState(
        { status: terminal, statusDetailJson: { executionClaim: validClaim } },
        now,
      ),
      "TERMINAL",
      `${terminal} 一律终态：重搜只能新建 Run`,
    );
  }

  console.log("B2：过期边界——恰好到期算过期（不给「还能再跑一下」的模糊地带）");
  assert.equal(
    classifyRunExecutionState(
      { status: "RUNNING", statusDetailJson: { executionClaim: { ...validClaim, expiresAt: now.toISOString() } } },
      now,
    ),
    "RECOVERY_REQUIRED",
  );

  console.log("\nFR1 执行声明纯核全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
