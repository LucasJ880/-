/** PendingAction 终态：重复确认应幂等返回，不得再次产生副作用 */
export function isTerminalPendingActionStatus(status: string): boolean {
  return (
    status === "executed" || status === "failed" || status === "rejected"
  );
}
