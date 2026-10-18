import test from "node:test";
import assert from "node:assert/strict";

process.env.DAILY_SPEND_CAP_USD = "0"; // the cap is always reached
const { readImportRequest } = await import("./importRequest.ts");
const { throttleKeyCount } = await import("./ipThrottle.ts");

test("a daily-cap refusal is not recorded against the per-IP limit", async () => {
  const req = { headers: new Headers({ "x-real-ip": "203.0.113.9" }) };
  const before = throttleKeyCount();
  const res = await readImportRequest(req, "import");
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "daily_cap");
  assert.equal(throttleKeyCount(), before);
});
