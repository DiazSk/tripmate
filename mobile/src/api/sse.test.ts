import { createSseParser, type SseFrame } from './sse';

function collect() {
  const frames: SseFrame[] = [];
  return { frames, parser: createSseParser((f) => frames.push(f)) };
}

test('parses a named frame with JSON data', () => {
  const { frames, parser } = collect();
  parser.feed('event: stage\ndata: {"stage":"geocode","status":"start"}\n\n');
  expect(frames).toEqual([{ event: 'stage', data: '{"stage":"geocode","status":"start"}' }]);
});

// The real stream opens with 2048 bytes of `:` padding to defeat WebKit's buffering. A parser
// that routes on the event name alone hands `undefined` to a handler here and throws.
test('drops the opening padding comment', () => {
  const { frames, parser } = collect();
  parser.feed(`:${'x'.repeat(2048)}\n\n`);
  expect(frames).toEqual([]);
});

test('drops the bare keepalive comment that arrives every 20s', () => {
  const { frames, parser } = collect();
  parser.feed(':\n\n');
  parser.feed('event: plan\ndata: {"runId":"r1"}\n\n');
  expect(frames).toEqual([{ event: 'plan', data: '{"runId":"r1"}' }]);
});

test('emits several frames arriving in one chunk', () => {
  const { frames, parser } = collect();
  parser.feed(
    'event: stop\ndata: {"stopIndex":0}\n\nevent: stop\ndata: {"stopIndex":1}\n\n'
  );
  expect(frames.map((f) => f.data)).toEqual(['{"stopIndex":0}', '{"stopIndex":1}']);
});

// Chunks arrive at arbitrary byte offsets, so a frame is routinely cut in half mid-JSON.
test('reassembles a frame split across chunks', () => {
  const { frames, parser } = collect();
  parser.feed('event: pl');
  expect(frames).toEqual([]);
  parser.feed('an\ndata: {"tra');
  expect(frames).toEqual([]);
  parser.feed('ceId":"t1"}\n\n');
  expect(frames).toEqual([{ event: 'plan', data: '{"traceId":"t1"}' }]);
});

test('joins a multi-line data payload with newlines', () => {
  const { frames, parser } = collect();
  parser.feed('event: note\ndata: line one\ndata: line two\n\n');
  expect(frames).toEqual([{ event: 'note', data: 'line one\nline two' }]);
});

test('strips exactly one framing space after the colon', () => {
  const { frames, parser } = collect();
  parser.feed('event: e\ndata:  two spaces\n\n');
  expect(frames[0].data).toBe(' two spaces');
});

test('a frame with no event line defaults to message', () => {
  const { frames, parser } = collect();
  parser.feed('data: bare\n\n');
  expect(frames).toEqual([{ event: 'message', data: 'bare' }]);
});

test('end() flushes a frame whose terminator never arrived', () => {
  const { frames, parser } = collect();
  parser.feed('event: done\ndata: {"ok":true}');
  expect(frames).toEqual([]);
  parser.end();
  expect(frames).toEqual([{ event: 'done', data: '{"ok":true}' }]);
});

test('end() on a trailing keepalive emits nothing', () => {
  const { frames, parser } = collect();
  parser.feed(':');
  parser.end();
  expect(frames).toEqual([]);
});
