/* Run: node --import ./scripts/ts-resolve.mjs --test src/lib/bench/postJson.test.mjs */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { postJson } from "./postJson.ts";

function serve(handler) {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/` }));
  });
}

test("postJson returns status and parsed body", async () => {
  const { server, url } = await serve((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  assert.deepEqual(await postJson(url, { a: 1 }, 5000), { status: 200, payload: { ok: true } });
  server.close();
});

test("a socket dropped mid-response rejects instead of crashing the process", async () => {
  const { server, url } = await serve((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"itinerary": {"days"');
    setTimeout(() => res.socket.destroy(), 20);
  });
  await assert.rejects(postJson(url, {}, 5000));
  server.close();
});
