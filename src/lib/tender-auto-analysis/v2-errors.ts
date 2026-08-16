/** V2 canonical 写/检查点被 lease fence 拒绝（stale worker）。worker 转 graceful yield。 */
export class TenderV2LeaseLostError extends Error {
  constructor(runId: string) {
    super(`v2_persist_lease_lost: ${runId}`);
    this.name = "TenderV2LeaseLostError";
  }
}
