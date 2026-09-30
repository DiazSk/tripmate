import assert from "node:assert/strict";
import { test } from "node:test";

import { aboutDuration } from "./travelTime.ts";

test("aboutDuration hedges a formatted duration", () => {
  assert.equal(aboutDuration("22 min"), "about 22 min");
});

test("aboutDuration leaves a long formatted duration intact", () => {
  assert.equal(aboutDuration("1 hr 20 min"), "about 1 hr 20 min");
});
