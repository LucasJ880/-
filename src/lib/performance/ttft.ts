/**
 * Time To First Token：记录流式 LLM 首个可见 token 的等待时间。
 * 不记录 token 文本本身。
 */

export interface TtftTracker {
  noteVisibleToken(): void;
  ttftMs(): number | null;
  totalMs(): number;
}

export function createTtftTracker(now: () => number = Date.now): TtftTracker {
  const startedAt = now();
  let firstAt: number | null = null;
  return {
    noteVisibleToken() {
      if (firstAt == null) firstAt = now();
    },
    ttftMs() {
      return firstAt == null ? null : Math.max(0, Math.round(firstAt - startedAt));
    },
    totalMs() {
      return Math.max(0, Math.round(now() - startedAt));
    },
  };
}

function defaultHasVisibleToken(chunk: unknown): boolean {
  if (!chunk || typeof chunk !== "object") return false;
  const choices = (chunk as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return false;
  const delta = (choices[0] as { delta?: { content?: unknown } } | undefined)
    ?.delta;
  return typeof delta?.content === "string" && delta.content.length > 0;
}

export function observeStreamTtft<T>(
  stream: AsyncIterable<T>,
  opts: {
    onFirstToken: (ttftMs: number) => void;
    hasVisibleToken?: (chunk: T) => boolean;
    now?: () => number;
  },
): AsyncIterable<T> {
  const tracker = createTtftTracker(opts.now);
  const hasVisible = opts.hasVisibleToken ?? defaultHasVisibleToken;
  return {
    [Symbol.asyncIterator]() {
      const it = stream[Symbol.asyncIterator]();
      let emitted = false;
      return {
        async next() {
          const result = await it.next();
          if (!result.done && hasVisible(result.value) && !emitted) {
            emitted = true;
            tracker.noteVisibleToken();
            const ms = tracker.ttftMs();
            if (ms != null) opts.onFirstToken(ms);
          }
          return result;
        },
        return: it.return?.bind(it),
        throw: it.throw?.bind(it),
      };
    },
  };
}
