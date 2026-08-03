import type { ScopeResolveDeniedReason } from "./types";

export class ScopeResolutionError extends Error {
  readonly code = "SCOPE_RESOLUTION_DENIED" as const;
  readonly reason: ScopeResolveDeniedReason;
  readonly status: number;

  constructor(reason: ScopeResolveDeniedReason, message: string, status = 403) {
    super(message);
    this.name = "ScopeResolutionError";
    this.reason = reason;
    this.status = status;
  }
}

export function isScopeResolutionError(err: unknown): err is ScopeResolutionError {
  return err instanceof ScopeResolutionError;
}
