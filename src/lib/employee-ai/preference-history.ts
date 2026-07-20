/**
 * 个人确认偏好变更史（存于 manuallyConfirmedPreferences JSON）
 */

export interface ConfirmedPreferenceValue {
  value: unknown;
  effectiveFrom: string;
  scope?: unknown;
}

export interface PreferenceHistoryEntry {
  key: string;
  value: unknown;
  effectiveFrom: string;
  effectiveTo: string | null;
  decision: "confirm" | "reject" | "scope_limit" | "stop_learning" | "manual";
}

export function unwrapConfirmedValue(raw: unknown): unknown {
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "value" in (raw as object)
  ) {
    return (raw as ConfirmedPreferenceValue).value;
  }
  if (
    raw &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "preference" in (raw as object)
  ) {
    return (raw as { preference: unknown }).preference;
  }
  return raw;
}

export function applyPreferenceDecision(input: {
  confirmedBag: Record<string, unknown>;
  key: string;
  decision: PreferenceHistoryEntry["decision"];
  nextValue?: unknown;
  scope?: unknown;
}): {
  confirmedBag: Record<string, unknown>;
  confirmed: Record<string, unknown>;
} {
  const now = new Date().toISOString();
  const confirmedBag = { ...input.confirmedBag };
  const confirmed = {
    ...((confirmedBag.confirmed as Record<string, unknown>) || {}),
  };
  const history = Array.isArray(confirmedBag.history)
    ? ([...confirmedBag.history] as PreferenceHistoryEntry[])
    : [];

  // 关闭同 key 仍开放的历史条目
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    if (h.key === input.key && h.effectiveTo == null) {
      history[i] = { ...h, effectiveTo: now };
    }
  }

  if (
    input.decision === "reject" ||
    input.decision === "stop_learning"
  ) {
    delete confirmed[input.key];
    history.push({
      key: input.key,
      value: input.nextValue ?? null,
      effectiveFrom: now,
      effectiveTo: now,
      decision: input.decision,
    });
  } else {
    const packed: ConfirmedPreferenceValue = {
      value: input.nextValue,
      effectiveFrom: now,
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
    };
    confirmed[input.key] = packed;
    history.push({
      key: input.key,
      value: input.nextValue,
      effectiveFrom: now,
      effectiveTo: null,
      decision: input.decision,
    });
  }

  // 保留最近 100 条
  confirmedBag.confirmed = confirmed;
  confirmedBag.history = history.slice(-100);

  return { confirmedBag, confirmed };
}

/** 注入用：confirmed map → 扁平当前值（兼容旧标量） */
export function flattenConfirmedForInject(
  confirmed: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(confirmed || {})) {
    out[k] = unwrapConfirmedValue(v);
  }
  return out;
}
