import assert from "node:assert/strict";
import test from "node:test";
import { SseLineBuffer } from "../sse-line-buffer";

test("保留跨网络块的半截 SSE JSON 行", () => {
  const buffer = new SseLineBuffer();

  assert.deepEqual(buffer.push('data: {"type":"text","content":"本周'), []);
  assert.deepEqual(buffer.push('简报"}\n\n'), [
    'data: {"type":"text","content":"本周简报"}',
    "",
  ]);
  assert.deepEqual(buffer.flush(), []);
});

test("一次读取可返回多个完整事件并保留末尾残片", () => {
  const buffer = new SseLineBuffer();

  assert.deepEqual(
    buffer.push('data: {"type":"mode"}\r\n\r\ndata: {"type":"text"'),
    ['data: {"type":"mode"}', ""],
  );
  assert.deepEqual(buffer.push(',"content":"完成"}\r\n'), [
    'data: {"type":"text","content":"完成"}',
  ]);
});

test("流结束时可以取出没有换行的最后一行", () => {
  const buffer = new SseLineBuffer();
  assert.deepEqual(buffer.push("data: [DONE]"), []);
  assert.deepEqual(buffer.flush(), ["data: [DONE]"]);
  assert.deepEqual(buffer.flush(), []);
});
