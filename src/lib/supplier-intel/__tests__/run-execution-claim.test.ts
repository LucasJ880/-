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
  const {
    readExecutionClaimRecord,
    readExecutionClaimMarker,
    readActiveExecutionClaim,
    classifyRunExecutionState,
  } = await import("../run-execution-state");

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

  console.log("A5：marker 三态——区分「没有声明」与「声明不可验证」");
  assert.equal(readExecutionClaimMarker({}).kind, "NO_CLAIM", "键不存在 = 真空闲");
  assert.equal(readExecutionClaimMarker(null).kind, "NO_CLAIM", "statusDetail 非对象 = 没有键");
  assert.equal(readExecutionClaimMarker([1, 2]).kind, "NO_CLAIM");
  assert.equal(
    readExecutionClaimMarker({ someOtherField: 1, note: "executionClaim 只是文本" }).kind,
    "NO_CLAIM",
    "判定必须基于结构化自有属性，不是字符串搜索",
  );
  assert.equal(readExecutionClaimMarker({ executionClaim: validClaim }).kind, "VALID_CLAIM");
  for (const [label, raw, reason] of [
    ["旧格式（无 claimId）", { claimedAt: now.toISOString(), expiresAt: future, byUserId: "u1" }, "MISSING_CLAIM_ID"],
    ["空 claimId", { ...validClaim, claimId: "" }, "EMPTY_CLAIM_ID"],
    ["非法 expiresAt", { ...validClaim, expiresAt: "not-a-date" }, "INVALID_EXPIRES_AT"],
    ["缺时间戳", { claimId: "c", byUserId: "u" }, "MISSING_TIMESTAMPS"],
    ["缺 byUserId", { claimId: "c", claimedAt: "x", expiresAt: future }, "MISSING_USER"],
    ["值不是对象", "whatever", "NOT_AN_OBJECT"],
    ["值为 null", null, "NOT_AN_OBJECT"],
  ] as Array<[string, unknown, string]>) {
    const m = readExecutionClaimMarker({ executionClaim: raw });
    assert.equal(m.kind, "INVALID_CLAIM", `${label} 必须判为 INVALID_CLAIM（而不是「没有声明」）`);
    assert.equal(m.kind === "INVALID_CLAIM" && m.reason, reason, `${label} 的原因码`);
    assert.deepEqual(
      m.kind === "INVALID_CLAIM" ? m.raw : undefined,
      raw,
      `${label} 必须原样带上 raw——整块重写 statusDetail 时要搬运它`,
    );
  }

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

  console.log("T1：旧格式声明（无 claimId，且 expiresAt 在未来）→ RECOVERY_REQUIRED");
  assert.equal(
    classifyRunExecutionState(
      {
        status: "RUNNING",
        statusDetailJson: {
          executionClaim: { claimedAt: now.toISOString(), expiresAt: future, byUserId: "u1" },
        },
      },
      now,
    ),
    "RECOVERY_REQUIRED",
    "无法证明 owner，即使时间戳还没到期也不能视作 IDLE 或 IN_PROGRESS",
  );

  console.log("T2：claimId 有值但 expiresAt 非法 → RECOVERY_REQUIRED");
  assert.equal(
    classifyRunExecutionState(
      {
        status: "RUNNING",
        statusDetailJson: { executionClaim: { ...validClaim, expiresAt: "not-a-date" } },
      },
      now,
    ),
    "RECOVERY_REQUIRED",
  );

  console.log("T3：claimId 为空串 → RECOVERY_REQUIRED");
  assert.equal(
    classifyRunExecutionState(
      { status: "RUNNING", statusDetailJson: { executionClaim: { ...validClaim, claimId: "" } } },
      now,
    ),
    "RECOVERY_REQUIRED",
  );

  console.log("T3b：其它 malformed 值（非对象 / null / 数组）→ RECOVERY_REQUIRED");
  for (const raw of ["x", null, [], 42, { nested: { claimId: "c" } }]) {
    assert.equal(
      classifyRunExecutionState({ status: "PLANNED", statusDetailJson: { executionClaim: raw } }, now),
      "RECOVERY_REQUIRED",
      `executionClaim=${JSON.stringify(raw)} 不可验证，必须走恢复`,
    );
  }

  console.log("T4：真正的空闲仍然是 IDLE（不能把正常路径也一并阻断）");
  assert.equal(classifyRunExecutionState({ status: "PLANNED", statusDetailJson: {} }, now), "IDLE");
  assert.equal(
    classifyRunExecutionState(
      { status: "RUNNING", statusDetailJson: { status: "ran", perSource: { saved: { status: "EMPTY" } } } },
      now,
    ),
    "IDLE",
    "有别的状态字段但没有 executionClaim 键 = 真空闲",
  );
  assert.equal(classifyRunExecutionState({ status: "PLANNED", statusDetailJson: null }, now), "IDLE");

  console.log("T4b：终态优先——不可验证的声明也不该把终态 Run 说成需要恢复");
  for (const terminal of ["COMPLETED", "FAILED", "CANCELLED"]) {
    assert.equal(
      classifyRunExecutionState(
        { status: terminal, statusDetailJson: { executionClaim: { legacy: true } } },
        now,
      ),
      "TERMINAL",
    );
  }

  console.log("\nFR1 执行声明纯核全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
