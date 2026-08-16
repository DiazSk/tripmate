/* Run: node --test src/lib/eventStream.test.mjs
 *
 * SSE frames arrive as raw bytes over a real network connection, which never guarantees
 * one chunk equals one frame. A parser that assumes it will pass every test written
 * against a single enqueue() call and then corrupt real traffic — these asserts
 * specifically split and combine frames across chunk boundaries to catch that class of
 * bug before it ships. */
import assert from "node:assert/strict";
import test from "node:test";
import { readEventStream } from "./eventStream.ts";

function streamFromChunks(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

test("a frame split across two chunks parses as one event", async () => {
  const events = [];
  await readEventStream(
    streamFromChunks(['event: stage\ndata: {"stage":"geo', 'code","status":"start"}\n\n']),
    (event, data) => events.push({ event, data })
  );
  assert.deepEqual(events, [{ event: "stage", data: '{"stage":"geocode","status":"start"}' }]);
});

test("multiple frames in a single chunk parse as several events", async () => {
  const events = [];
  await readEventStream(
    streamFromChunks([
      'event: stage\ndata: {"stage":"geocode","status":"start"}\n\n' +
        'event: stage\ndata: {"stage":"geocode","status":"done"}\n\n',
    ]),
    (event, data) => events.push({ event, data })
  );
  assert.equal(events.length, 2);
  assert.equal(events[0].data, '{"stage":"geocode","status":"start"}');
  assert.equal(events[1].data, '{"stage":"geocode","status":"done"}');
});

test("the leading comment frame is ignored", async () => {
  const events = [];
  await readEventStream(
    streamFromChunks([
      `:${" ".repeat(2048)}\n\n`,
      'event: stage\ndata: {"stage":"geocode","status":"start"}\n\n',
    ]),
    (event, data) => events.push({ event, data })
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].event, "stage");
});

test("a trailing partial frame does not emit", async () => {
  const events = [];
  await readEventStream(
    streamFromChunks([
      'event: stage\ndata: {"stage":"geocode","status":"start"}\n\n',
      'event: stage\ndata: {"stage":"conte',
    ]),
    (event, data) => events.push({ event, data })
  );
  assert.equal(events.length, 1);
});
