import type { HandoffFailureCode } from "./types";

export class HandoffError extends Error {
  code: HandoffFailureCode;
  status: number;
  constructor(code: HandoffFailureCode, message: string, status = 400) {
    super(message);
    this.name = "HandoffError";
    this.code = code;
    this.status = status;
  }
}
