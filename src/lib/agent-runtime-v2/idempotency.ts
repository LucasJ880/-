/**
 * Runtime V2 稳定业务幂等键（不含 attempt）
 * ar2:{runId}:{stepKey}:{actionType}:{targetId}
 */

export function buildRuntimeV2OperationKey(input: {
  runId: string;
  stepKey: string;
  actionType: string;
  targetId: string;
}): string {
  const target = input.targetId.trim() || "none";
  return `ar2:${input.runId}:${input.stepKey}:${input.actionType}:${target}`;
}

export function buildStepOperationKey(input: {
  runId: string;
  stepKey: string;
  toolName: string;
}): string {
  return `ar2:${input.runId}:${input.stepKey}:${input.toolName}:step`;
}
