/**
 * Keeps an incomplete SSE line between network chunks.
 *
 * A ReadableStream chunk is an arbitrary byte boundary, so one `data:` JSON
 * line may arrive across multiple reads. Parsing each chunk independently can
 * silently discard long assistant replies.
 */
export class SseLineBuffer {
  private pending = "";

  push(chunk: string): string[] {
    const parts = `${this.pending}${chunk}`.split(/\r?\n/);
    this.pending = parts.pop() ?? "";
    return parts;
  }

  flush(): string[] {
    if (!this.pending) return [];
    const line = this.pending;
    this.pending = "";
    return [line];
  }
}
